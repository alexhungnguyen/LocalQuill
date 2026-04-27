import { Settings2 } from "lucide-react";
import { useStore } from "../store/useStore";

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

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-sm">
        <ServerStatus status={serverStatus} model={serverModel} />

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
      ? "MLX server online"
      : status === "offline"
        ? "MLX server unreachable"
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
          Start it with:
          <pre className="mt-1 bg-ink-900 border border-ink-800 rounded p-1.5 text-[10.5px] text-ink-200 whitespace-pre-wrap">
{`mlx_lm.server \\
  --model nightmedia/Huihui-Qwen3-30B-A3B-Instruct-2507-abliterated-dwq4-mlx \\
  --host 127.0.0.1 --port 8080`}
          </pre>
        </div>
      )}
    </div>
  );
}
