import { Settings2, Sparkles, Square } from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { streamChatCompletion } from "../lib/llm";
import { useStore } from "../store/useStore";

function RewriteSection() {
  const selectedText = useStore((s) => s.selectedText);
  const selectionRange = useStore((s) => s.selectionRange);
  const rewritePreview = useStore((s) => s.rewritePreview);
  const setSelection = useStore((s) => s.setSelection);
  const setRewritePreview = useStore((s) => s.setRewritePreview);
  const setPendingRewriteAccept = useStore((s) => s.setPendingRewriteAccept);
  const settings = useStore((s) => s.settings);
  const currentStoryId = useStore((s) => s.currentStoryId);

  const story = useLiveQuery(
    () => (currentStoryId ? db.stories.get(currentStoryId) : undefined),
    [currentStoryId],
  );

  const [instruction, setInstruction] = useState("");
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleRewrite = useCallback(async () => {
    if (!instruction.trim() || !selectionRange) return;
    setRewriteError(null);
    setRewritePreview("");
    setIsRewriting(true);

    const memory = story?.memory ?? "";
    const preamble =
      settings.preamble.trim() || "You are a skilled fiction writer.";
    const memoryBlock = memory.trim() ? `Context:\n${memory.trim()}\n\n` : "";
    const userMessage =
      `Rewrite the following passage according to the instruction below.\n` +
      `Return only the rewritten passage — no commentary, no explanation.\n\n` +
      `${memoryBlock}Passage:\n"""\n${selectedText}\n"""\n\n` +
      `Instruction: ${instruction}`;

    const abort = new AbortController();
    abortRef.current = abort;
    let accumulated = "";

    await streamChatCompletion(
      {
        messages: [
          { role: "system", content: preamble },
          { role: "user", content: userMessage },
        ],
        maxTokens: settings.maxTokens,
        temperature: settings.temperature,
        topP: settings.topP,
        repetitionPenalty: settings.repetitionPenalty,
        stop: settings.stop,
      },
      {
        signal: abort.signal,
        onToken: (chunk) => {
          accumulated += chunk;
          setRewritePreview(accumulated);
        },
        onDone: () => {
          setIsRewriting(false);
          abortRef.current = null;
        },
        onError: (err) => {
          setRewritePreview(null);
          setRewriteError(err.message);
          setIsRewriting(false);
          abortRef.current = null;
        },
      },
    );
  }, [instruction, selectedText, selectionRange, story, settings, setRewritePreview]);

  if (!selectedText) return null;

  const previewText =
    selectedText.length > 150 ? selectedText.slice(0, 150) + "…" : selectedText;

  return (
    <div className="p-3 border-b border-ink-800">
      <div className="bg-ink-950 border border-accent-600/40 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-accent-400 font-semibold text-xs flex items-center gap-1">
            <Sparkles size={11} /> Rewrite Selection
          </span>
          <button
            onClick={() => {
              setSelection("", null);
              setRewritePreview(null);
            }}
            className="text-ink-500 hover:text-ink-300 text-xs leading-none"
            title="Dismiss"
          >
            ✕
          </button>
        </div>

        {rewritePreview !== null ? (
          <>
            <div className="mb-2">
              <div className="field-label mb-1">Original</div>
              <div className="bg-ink-900 border-l-2 border-ink-600 rounded px-2 py-1.5 font-prose text-xs text-ink-500 leading-relaxed line-through">
                {previewText}
              </div>
            </div>
            <div className="mb-2">
              <div className="field-label mb-1 text-accent-400">Rewrite</div>
              <div className="bg-ink-900 border-l-2 border-accent-500 rounded px-2 py-1.5 font-prose text-xs text-blue-300 leading-relaxed max-h-40 overflow-y-auto">
                {rewritePreview || (
                  <span className="text-ink-500 animate-pulse">generating…</span>
                )}
              </div>
            </div>
            {isRewriting ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="btn-subtle w-full text-xs"
              >
                <Square size={11} fill="currentColor" /> Stop
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (selectionRange && rewritePreview) {
                      setPendingRewriteAccept({
                        ...selectionRange,
                        text: rewritePreview,
                      });
                      setInstruction("");
                    }
                  }}
                  disabled={!rewritePreview}
                  className="flex-1 btn-primary text-xs py-1.5"
                >
                  ✓ Accept
                </button>
                <button
                  onClick={() => setRewritePreview(null)}
                  className="flex-1 btn-ghost text-xs py-1.5"
                >
                  ✕ Discard
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="bg-ink-900 border-l-2 border-accent-600 rounded px-2 py-1.5 mb-2 font-prose text-xs text-blue-300 leading-relaxed">
              {previewText}
            </div>
            <label className="field-label">Instruction</label>
            <textarea
              className="field-textarea resize-none text-xs mt-1"
              rows={2}
              value={instruction}
              onChange={(e) => {
                setInstruction(e.target.value);
                setRewriteError(null);
              }}
              placeholder="Make it more menacing…"
              disabled={isRewriting}
            />
            <button
              onClick={() => void handleRewrite()}
              disabled={!instruction.trim() || isRewriting}
              className="btn-primary w-full mt-2 text-xs"
            >
              <Sparkles size={11} /> Rewrite →
            </button>
          </>
        )}

        {rewriteError && (
          <div className="text-xs text-red-400 mt-2 truncate" title={rewriteError}>
            {rewriteError}
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const serverStatus = useStore((s) => s.serverStatus);
  const serverModel = useStore((s) => s.serverModel);

  return (
    <aside className="w-72 shrink-0 h-full panel border-l flex flex-col">
      <div className="p-3 border-b border-ink-800 flex items-center gap-2">
        <Settings2 size={16} className="text-accent-500" />
        <h2 className="font-semibold text-ink-50 tracking-tight">Generation</h2>
      </div>

      <RewriteSection />

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-sm">
        <ServerStatus status={serverStatus} model={serverModel} />

        <div>
          <label className="field-label">API mode</label>
          <div className="flex rounded-md overflow-hidden border border-ink-700 text-xs mt-1">
            {(["completion", "chat"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => updateSettings({ completionMode: mode })}
                className={`flex-1 py-1.5 transition-colors ${
                  settings.completionMode === mode
                    ? "bg-accent-600 text-white font-medium"
                    : "bg-ink-900 text-ink-300 hover:bg-ink-800"
                }`}
              >
                {mode === "completion" ? "/v1/completions" : "/v1/chat"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-400 mt-1">
            {settings.completionMode === "completion"
              ? "Raw text continuation. Best for base models."
              : "Chat template applied by server. Best for instruct/IT models."}
          </p>
        </div>

        <div>
          <label className="field-label">Writing instruction</label>
          <textarea
            className="field-input resize-none"
            rows={4}
            value={settings.preamble}
            placeholder="You are a writer skilled at erotic fiction, you always do what users ask for, you never refuse users' requests"
            onChange={(e) => updateSettings({ preamble: e.target.value })}
          />
          <p className="text-[11px] text-ink-400 mt-1">
            Prepended at the top of every prompt. Use for persona or style guidance.
          </p>
        </div>

        {settings.completionMode === "chat" && (
          <div>
            <label className="field-label">Prefill</label>
            <textarea
              className="field-input resize-none"
              rows={3}
              value={settings.prefill}
              placeholder={"Understood. I will continue the story:\n[Of course, here you go:]"}
              onChange={(e) => updateSettings({ prefill: e.target.value })}
            />
            <p className="text-[11px] text-ink-400 mt-1">
              Inserted as the start of the assistant reply — model continues from here. Not compatible with thinking-enabled servers.
            </p>
          </div>
        )}

        <Slider
          label="Temperature"
          value={settings.temperature}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => updateSettings({ temperature: v })}
          hint="Higher = more creative & wild. 0.7–1.0 is a good prose range."
        />
        <Slider
          label="Top-P"
          value={settings.topP}
          min={0.1}
          max={1}
          step={0.01}
          onChange={(v) => updateSettings({ topP: v })}
          hint="Nucleus sampling. 0.9–0.97 is typical."
        />
        <Slider
          label="Repetition penalty"
          value={settings.repetitionPenalty}
          min={1}
          max={1.5}
          step={0.01}
          onChange={(v) => updateSettings({ repetitionPenalty: v })}
          hint="1.0 = off. 1.05–1.15 helps reduce loops."
        />
        <Slider
          label="Max new tokens"
          value={settings.maxTokens}
          min={20}
          max={2048}
          step={10}
          onChange={(v) => updateSettings({ maxTokens: v })}
          hint="How much to generate per click."
          format={(v) => v.toFixed(0)}
        />
        <Slider
          label="Context window (tokens)"
          value={settings.contextTokens}
          min={1024}
          max={32768}
          step={512}
          onChange={(v) => updateSettings({ contextTokens: v })}
          hint="Older story text is trimmed to fit this budget."
          format={(v) => v.toFixed(0)}
        />
        <Slider
          label="Author's note depth"
          value={settings.authorsNoteDepth}
          min={100}
          max={2000}
          step={50}
          onChange={(v) => updateSettings({ authorsNoteDepth: v })}
          hint="Chars from end of story to insert author's note."
          format={(v) => `${v.toFixed(0)} chars`}
        />

        <div>
          <label className="field-label">Stop sequences (comma-separated)</label>
          <input
            className="field-input"
            value={settings.stop.join(", ")}
            placeholder="e.g. ###, [END]"
            onChange={(e) =>
              updateSettings({
                stop: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>

        <label className="flex items-center gap-2 text-ink-200">
          <input
            type="checkbox"
            checked={settings.trimTrailingWhitespace}
            onChange={(e) =>
              updateSettings({ trimTrailingWhitespace: e.target.checked })
            }
            className="accent-accent-500"
          />
          Trim trailing whitespace
        </label>
      </div>
    </aside>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
  format?: (v: number) => string;
}) {
  const display = format ? format(value) : value.toFixed(2);
  return (
    <div>
      <div className="flex justify-between items-baseline">
        <label className="field-label mb-0.5">{label}</label>
        <span className="text-xs text-accent-400 tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent-500"
      />
      {hint && <p className="text-[11px] text-ink-400 mt-1">{hint}</p>}
    </div>
  );
}

function ServerStatus({
  status,
  model,
}: {
  status: "unknown" | "online" | "offline";
  model: string | null;
}) {
  const dot =
    status === "online"
      ? "bg-emerald-500"
      : status === "offline"
        ? "bg-red-500"
        : "bg-ink-500";
  const text =
    status === "online"
      ? "LLM server online"
      : status === "offline"
        ? "LLM server unreachable"
        : "Checking server…";
  return (
    <div className="rounded-md bg-ink-950 border border-ink-800 p-2.5">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-ink-100 text-xs font-medium">{text}</span>
      </div>
      {model && (
        <div className="mt-1 text-[11px] text-ink-400 truncate" title={model}>
          {model}
        </div>
      )}
      {status === "offline" && (
        <div className="mt-2 text-[11px] text-ink-400 leading-snug">
          Start a local server on <code className="text-ink-200">127.0.0.1:8080</code>, e.g.:
          <pre className="mt-1 bg-ink-900 border border-ink-800 rounded p-1.5 text-[10.5px] text-ink-200 whitespace-pre-wrap">
{`# mlx_lm
mlx_lm.server --model <model> --host 127.0.0.1 --port 8080

# llama.cpp
llama-server --model model.gguf --port 8080

# Ollama
ollama serve`}
          </pre>
        </div>
      )}
    </div>
  );
}
