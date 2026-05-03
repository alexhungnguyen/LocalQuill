import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles, Square, Undo2, Redo2, FileText, Brain } from "lucide-react";

// Redo2 is imported for Task 3 (redo button UI)
Redo2;
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { db, type Story } from "../db/db";
import { streamCompletion, streamChatCompletion } from "../lib/llm";
import { approxTokens, buildPrompt, buildChatMessages, type StorySegment } from "../lib/prompt";
import type { GenerationSpan } from "../db/db";
import { snapshotStory, updateStory } from "../lib/stories";
import { useStore } from "../store/useStore";

const AUTOSAVE_MS = 400;

function findFirstDiff(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return len;
}

function reconcileSpans(spans: GenerationSpan[], editPos: number): GenerationSpan[] {
  return spans
    .map((s) => ({ start: s.start, end: Math.min(s.end, editPos) }))
    .filter((s) => s.start < s.end && s.start < editPos);
}

function deriveSegments(content: string, spans: GenerationSpan[]): StorySegment[] {
  if (!spans.length) return content ? [{ type: "user", text: content }] : [];
  const segs: StorySegment[] = [];
  let pos = 0;
  for (const span of spans) {
    if (pos < span.start) segs.push({ type: "user", text: content.slice(pos, span.start) });
    const gen = content.slice(span.start, span.end);
    if (gen) segs.push({ type: "generated", text: gen });
    pos = span.end;
  }
  if (pos < content.length) segs.push({ type: "user", text: content.slice(pos) });
  return segs.filter((s) => s.text.length > 0);
}

export function applyRewriteToSpans(
  spans: GenerationSpan[],
  start: number,
  end: number,
  newLen: number,
): GenerationSpan[] {
  const delta = newLen - (end - start);
  return [
    ...spans.filter((s) => s.end <= start),
    { start, end: start + newLen },
    ...spans
      .filter((s) => s.start >= end)
      .map((s) => ({ start: s.start + delta, end: s.end + delta })),
  ];
}

export function Editor() {
  const currentStoryId = useStore((s) => s.currentStoryId);
  const settings = useStore((s) => s.settings);
  const isGenerating = useStore((s) => s.isGenerating);
  const setIsGenerating = useStore((s) => s.setIsGenerating);
  const setLastGenLen = useStore((s) => s.setLastGenerationLength);
  const story = useLiveQuery(
    () => (currentStoryId ? db.stories.get(currentStoryId) : undefined),
    [currentStoryId],
  );

  if (!currentStoryId || !story) {
    return <EmptyState />;
  }

  return (
    <ActiveEditor
      key={story.id}
      story={story}
      isGenerating={isGenerating}
      setIsGenerating={setIsGenerating}
      setLastGenLen={setLastGenLen}
      settings={settings}
    />
  );
}

function ActiveEditor({
  story,
  isGenerating,
  setIsGenerating,
  setLastGenLen,
  settings,
}: {
  story: Story;
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
  setLastGenLen: (n: number | null) => void;
  settings: ReturnType<typeof useStore.getState>["settings"];
}) {
  // Local mirror of fields, debounced into IndexedDB. We treat the store
  // as authoritative for cross-component reads (live query on the same row)
  // but the editing component owns the cursor/selection so we can't simply
  // re-render from props on every keystroke.
  const [content, setContent] = useState(story.content);
  const [memory, setMemory] = useState(story.memory);
  const [authorsNote, setAuthorsNote] = useState(story.authorsNote);
  const [generationSpans, setGenerationSpans] = useState<GenerationSpan[]>(story.generationSpans ?? []);
  const [showSidePanels, setShowSidePanels] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hover preview for undo: state and refs
  const [undoHighlightRange, setUndoHighlightRange] = useState<{ start: number; end: number } | null>(null);
  const savedSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const savedActiveRef = useRef<HTMLElement | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generatingFromRef = useRef<number>(0);
  const preGenerationContentRef = useRef<string>("");
  // Prompts we've already sent during this session.
  //
  // Workaround for an upstream bug in mlx_lm.server: when a request's prompt
  // tokenizes to a sequence that exactly matches one already in the server's
  // KV-cache trie, `fetch_nearest_cache` returns `(cache, [])` and
  // `insert_segments` crashes on `seq[-1]` for an empty list.
  // (mlx_lm/models/cache.py — the exact-match branch fails to keep one token,
  // unlike the longer-match branch.)
  // Triggers in normal use: Undo+Generate, Stop+Generate, double-click.
  // Nudging the prompt with a trailing newline shifts the token sequence just
  // enough to avoid the exact-match path while keeping prefix-cache benefits.
  const sentPromptsRef = useRef<Set<string>>(new Set());

  // History management store selectors and actions
  const undoStack = useStore((s) => s.undoStack);
  const redoStack = useStore((s) => s.redoStack);
  const baseContent = useStore((s) => s.baseContent);
  const pushCheckpoint = useStore((s) => s.pushCheckpoint);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setBaseContent = useStore((s) => s.setBaseContent);
  const clearHistory = useStore((s) => s.clearHistory);

  const setSelection = useStore((s) => s.setSelection);
  const setRewritePreview = useStore((s) => s.setRewritePreview);
  const setPendingRewriteAccept = useStore((s) => s.setPendingRewriteAccept);
  const pendingRewriteAccept = useStore((s) => s.pendingRewriteAccept);

  // Compute undo/redo availability
  const canUndo = undoStack.length > 0 && content === baseContent;
  const canRedo = redoStack.length > 0 && content === baseContent;

  // Track dirty state (uncommitted changes)
  const isDirty = content !== baseContent;

  // Clear history when switching stories
  useEffect(() => {
    clearHistory();
    setBaseContent(story.content);
    setSelection("", null);
    setRewritePreview(null);
    setPendingRewriteAccept(null);
  }, [story.id, clearHistory, setBaseContent, setSelection, setRewritePreview, setPendingRewriteAccept]);

  // When the user switches stories, sync local state from the new row.
  // We compare ids via the `key` on this component, but if the same story
  // gets edited from elsewhere we still want to reflect that.
  useEffect(() => {
    setContent(story.content);
    setMemory(story.memory);
    setAuthorsNote(story.authorsNote);
    setGenerationSpans(story.generationSpans ?? []);
  }, [story.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced autosave. We deliberately don't save on every keystroke —
  // IndexedDB writes are cheap but live queries fan out updates and that
  // can cause re-render churn for very fast typists.
  useEffect(() => {
    const t = setTimeout(() => {
      if (
        content === story.content &&
        memory === story.memory &&
        authorsNote === story.authorsNote &&
        JSON.stringify(generationSpans) === JSON.stringify(story.generationSpans ?? [])
      ) {
        return;
      }
      void updateStory(story.id, { content, memory, authorsNote, generationSpans });
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [
    content,
    memory,
    authorsNote,
    generationSpans,
    story.id,
    story.content,
    story.memory,
    story.authorsNote,
    story.generationSpans,
  ]);

  // Save a snapshot before potentially destructive operations (generate,
  // undo) so the user can recover hand-written prose.
  const flushAndSnapshot = useCallback(
    async (label: string) => {
      await updateStory(story.id, { content, memory, authorsNote });
      await snapshotStory(story.id, content, label);
    },
    [story.id, content, memory, authorsNote],
  );

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setError(null);

    const segments = deriveSegments(content, generationSpans);
    const promptInputs = {
      preamble: settings.preamble,
      prefill: settings.prefill,
      memory,
      authorsNote,
      story: content,
      segments,
      contextTokens: settings.contextTokens,
      authorsNoteDepthChars: settings.authorsNoteDepth,
    };

    const isChatMode = settings.completionMode === "chat";

    if (isChatMode) {
      const hasContent = memory.trim() || content.trim() || authorsNote.trim();
      if (!hasContent) {
        setError("Nothing to continue from yet. Type a sentence, or fill in Memory / Author's Note.");
        return;
      }
    } else {
      const prompt = buildPrompt(promptInputs);
      // An empty prompt crashes mlx_lm.server (IndexError on `seq[-1]`
      // inside generate.py:insert_segments). Catch it here with a friendly hint.
      if (prompt.trim().length === 0) {
        setError("Nothing to continue from yet. Type a sentence, or fill in Memory / Author's Note.");
        return;
      }
    }

    preGenerationContentRef.current = content;
    pushCheckpoint(content);
    await flushAndSnapshot("before generate");

    const abort = new AbortController();
    abortRef.current = abort;
    setIsGenerating(true);
    generatingFromRef.current = content.length;
    let appended = "";

    const sharedHandlers = {
      signal: abort.signal,
      onToken: (chunk: string) => {
        appended += chunk;
        setContent((prev) => prev + chunk);
      },
      onDone: () => {
        if (settings.trimTrailingWhitespace) {
          const trimmed = appended.replace(/\s+$/u, "");
          const drop = appended.length - trimmed.length;
          if (drop > 0) {
            appended = trimmed;
            setContent((prev) => prev.slice(0, prev.length - drop));
          }
        }
        const finalContent = preGenerationContentRef.current + appended;
        if (appended.length > 0) {
          const spanStart = preGenerationContentRef.current.length;
          const spanEnd = spanStart + appended.length;
          setGenerationSpans((prev) => [...prev, { start: spanStart, end: spanEnd }]);
        }
        setBaseContent(finalContent);
        setLastGenLen(appended.length);
        setIsGenerating(false);
        abortRef.current = null;
        requestAnimationFrame(() => {
          const el = editorRef.current;
          if (el) {
            el.focus();
            el.selectionStart = el.selectionEnd = el.value.length;
            el.scrollTop = el.scrollHeight;
          }
        });
      },
      onError: (err: Error) => {
        setError(err.message);
        setIsGenerating(false);
        setLastGenLen(appended.length || null);
        abortRef.current = null;
      },
    };

    if (isChatMode) {
      const messages = buildChatMessages(promptInputs);
      await streamChatCompletion(
        {
          messages,
          maxTokens: settings.maxTokens,
          temperature: settings.temperature,
          topP: settings.topP,
          repetitionPenalty: settings.repetitionPenalty,
          stop: settings.stop,
        },
        sharedHandlers,
      );
    } else {
      // See `sentPromptsRef` declaration above for context.
      let prompt = buildPrompt(promptInputs);
      while (sentPromptsRef.current.has(prompt)) {
        prompt += "\n";
      }
      sentPromptsRef.current.add(prompt);
      if (sentPromptsRef.current.size > 32) {
        const first = sentPromptsRef.current.values().next().value;
        if (first !== undefined) sentPromptsRef.current.delete(first);
      }
      await streamCompletion(
        {
          prompt,
          maxTokens: settings.maxTokens,
          temperature: settings.temperature,
          topP: settings.topP,
          repetitionPenalty: settings.repetitionPenalty,
          stop: settings.stop,
        },
        sharedHandlers,
      );
    }
  }, [
    content,
    memory,
    authorsNote,
    isGenerating,
    settings,
    flushAndSnapshot,
    setIsGenerating,
    setLastGenLen,
  ]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleUndo = useCallback(() => {
    setUndoHighlightRange(null);
    const result = undo();
    if (result) {
      setContent(result.targetContent);
      setGenerationSpans((prev) => reconcileSpans(prev, result.targetContent.length));
    }
  }, [undo]);

  const handleRedo = useCallback(() => {
    const result = redo();
    if (result) {
      setContent(result.targetContent);
      // Redo restores previously generated content — re-add the span for it.
      setGenerationSpans((prev) => {
        const editPos = findFirstDiff(result.targetContent.slice(0, -result.addedText.length), result.targetContent);
        const cleaned = reconcileSpans(prev, editPos);
        return [...cleaned, { start: editPos, end: result.targetContent.length }];
      });
    }
  }, [redo]);

  // Cmd/Ctrl+Enter to generate, Esc to stop, Cmd/Ctrl+Z to undo, Cmd+Shift+Z or Cmd/Ctrl+Y to redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (isGenerating) handleStop();
        else void handleGenerate();
      } else if (e.key === "Escape" && isGenerating) {
        handleStop();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        if (canUndo) {
          e.preventDefault();
          void handleUndo();
        }
      } else if (((e.metaKey || e.ctrlKey) && e.key === "y") || ((e.metaKey && e.shiftKey) && e.key === "Z")) {
        e.preventDefault();
        if (canRedo) void handleRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isGenerating, handleGenerate, handleStop, canUndo, canRedo, handleUndo, handleRedo]);
  // `handleGenerate` already short-circuits on an empty prompt, so the
  // shortcut path is also covered.

  // Auto-scroll the editor to follow new tokens as they stream in.
  useEffect(() => {
    if (!isGenerating) return;
    const el = editorRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content, isGenerating]);

  useEffect(() => {
    if (!pendingRewriteAccept) return;
    const { start, end, text } = pendingRewriteAccept;
    const newContent = content.slice(0, start) + text + content.slice(end);
    pushCheckpoint(content);
    setContent(newContent);
    setGenerationSpans((prev) => applyRewriteToSpans(prev, start, end, text.length));
    setBaseContent(newContent);
    setPendingRewriteAccept(null);
    setSelection("", null);
    setRewritePreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRewriteAccept]);

  // Manage selection highlighting for undo preview
  useEffect(() => {
    if (!editorRef.current) return;
    if (undoHighlightRange) {
      if (savedActiveRef.current === null) {
        savedActiveRef.current = document.activeElement as HTMLElement;
        savedSelectionRef.current = {
          start: editorRef.current.selectionStart,
          end: editorRef.current.selectionEnd,
        };
      }
      editorRef.current.focus();
      editorRef.current.setSelectionRange(undoHighlightRange.start, undoHighlightRange.end);
    } else {
      if (savedActiveRef.current && savedSelectionRef.current) {
        savedActiveRef.current.focus();
        if (savedActiveRef.current === editorRef.current && editorRef.current) {
          editorRef.current.setSelectionRange(savedSelectionRef.current.start, savedSelectionRef.current.end);
        }
      }
      savedActiveRef.current = null;
      savedSelectionRef.current = null;
    }
  }, [undoHighlightRange]);

  const { promptTokens, canGenerate } = useMemo(() => {
    const inputs = {
      preamble: settings.preamble,
      prefill: settings.prefill,
      memory,
      authorsNote,
      story: content,
      segments: deriveSegments(content, generationSpans),
      contextTokens: settings.contextTokens,
      authorsNoteDepthChars: settings.authorsNoteDepth,
    };
    if (settings.completionMode === "chat") {
      const hasContent = !!(memory.trim() || content.trim() || authorsNote.trim());
      const totalText = hasContent
        ? buildChatMessages(inputs).map((m) => m.content).join("\n")
        : "";
      return { promptTokens: approxTokens(totalText), canGenerate: hasContent };
    }
    const preview = buildPrompt(inputs);
    return { promptTokens: approxTokens(preview), canGenerate: preview.trim().length > 0 };
  }, [memory, authorsNote, content, generationSpans, settings.preamble, settings.prefill, settings.completionMode, settings.contextTokens, settings.authorsNoteDepth]);

  const undoPreview = useMemo(() => {
    if (!canUndo || undoStack.length === 0) return "";
    const target = undoStack[undoStack.length - 1];
    return content.slice(target.length);
  }, [canUndo, content, undoStack]);

  // Compute range for editor hover preview
  const undoRange = useMemo(() => {
    if (!canUndo || undoStack.length === 0) return null;
    const target = undoStack[undoStack.length - 1];
    const start = target.length;
    const end = content.length;
    if (start >= end) return null;
    return { start, end };
  }, [canUndo, content, undoStack]);

  const handleUndoHover = useCallback((range: { start: number; end: number }) => {
    setUndoHighlightRange(range);
  }, []);

  const handleUndoLeave = useCallback(() => {
    setUndoHighlightRange(null);
  }, []);

  const handleSelectionChange = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    if (selectionStart !== selectionEnd) {
      setSelection(value.slice(selectionStart, selectionEnd), {
        start: selectionStart,
        end: selectionEnd,
      });
    } else if (document.activeElement === el) {
      setSelection("", null);
    }
  }, [setSelection]);

  return (
    <main className="flex-1 h-full flex flex-col overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-ink-800 bg-ink-900">
        <input
          value={story.title}
          onChange={(e) => void updateStory(story.id, { title: e.target.value })}
          className="flex-1 bg-transparent border-none outline-none text-ink-50
                     font-semibold text-lg placeholder-ink-400"
          placeholder="Untitled story"
        />
        <span className="text-xs text-ink-400 tabular-nums">
          {content.length.toLocaleString()} chars · ~
          {approxTokens(content).toLocaleString()} story tokens · ~
          {promptTokens.toLocaleString()} prompt tokens
        </span>
        <button
          className="btn-ghost"
          onClick={() => setShowSidePanels((v) => !v)}
          title="Toggle memory & author's note"
        >
          <Brain size={14} />
          {showSidePanels ? "Hide" : "Show"} context
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        <section className="flex-1 flex flex-col min-w-0">
          <textarea
            ref={editorRef}
            value={content}
            onChange={(e) => {
              const newValue = e.target.value;
              const editPos = findFirstDiff(content, newValue);
              setContent(newValue);
              setGenerationSpans((prev) => reconcileSpans(prev, editPos));
              if (redoStack.length > 0) {
                useStore.getState().clearRedoStack();
              }
            }}
            onMouseUp={handleSelectionChange}
            onKeyUp={handleSelectionChange}
            placeholder={
              "Start typing your story here, or paste a beginning and hit Generate.\n\nThe model continues from wherever the cursor is at the end of the text — exactly like a typewriter that drinks too much coffee."
            }
            spellCheck
            className={`flex-1 w-full bg-ink-950 ${isDirty ? "text-blue-400" : "text-ink-50"} px-10 py-8
                       font-prose text-[17px] leading-[1.7] resize-none
                       outline-none placeholder-ink-500
                       caret-accent-500`}
          />
          <Toolbar
            isGenerating={isGenerating}
            canGenerate={canGenerate}
            canUndo={canUndo}
            canRedo={canRedo}
            error={error}
            onGenerate={handleGenerate}
            onStop={handleStop}
            onUndo={handleUndo}
            onRedo={handleRedo}
            undoPreview={undoPreview}
            undoRange={undoRange}
            onUndoHover={handleUndoHover}
            onUndoLeave={handleUndoLeave}
          />
        </section>

        {showSidePanels && (
          <aside className="w-80 shrink-0 border-l border-ink-800 bg-ink-900 flex flex-col">
            <div className="p-3 border-b border-ink-800 flex items-center gap-2">
              <FileText size={14} className="text-accent-500" />
              <h3 className="font-semibold text-ink-50 text-sm">
                Story Context
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <div>
                <label className="field-label">Memory</label>
                <p className="text-[11px] text-ink-400 mb-1.5">
                  Always sent at the top of the prompt. Worldbuilding,
                  characters, established facts.
                </p>
                <textarea
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  rows={8}
                  placeholder="In a world where the moons sing on the equinox…"
                  className="field-textarea"
                />
                <div className="text-[11px] text-ink-400 mt-1 text-right">
                  ~{approxTokens(memory).toLocaleString()} tokens
                </div>
              </div>

              <div>
                <label className="field-label">Author's Note</label>
                <p className="text-[11px] text-ink-400 mb-1.5">
                  Inserted near the end of the prompt for strong, recent
                  influence. Tone, pacing, near-term direction.
                </p>
                <textarea
                  value={authorsNote}
                  onChange={(e) => setAuthorsNote(e.target.value)}
                  rows={4}
                  placeholder="[Style: terse, present tense. Tone: dread.]"
                  className="field-textarea"
                />
                <div className="text-[11px] text-ink-400 mt-1 text-right">
                  ~{approxTokens(authorsNote).toLocaleString()} tokens
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

function Toolbar({
  isGenerating,
  canGenerate,
  canUndo,
  canRedo,
  error,
  onGenerate,
  onStop,
  onUndo,
  onRedo,
  undoPreview,
  undoRange,
  onUndoHover,
  onUndoLeave,
}: {
  isGenerating: boolean;
  canGenerate: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  onGenerate: () => void;
  onStop: () => void;
  onUndo: () => void;
  onRedo: () => void;
  undoPreview: string;
  undoRange: { start: number; end: number } | null;
  onUndoHover: (range: { start: number; end: number }) => void;
  onUndoLeave: () => void;
}) {
  const [showUndoPreview, setShowUndoPreview] = useState(false);

  return (
    <div className="border-t border-ink-800 bg-ink-900 px-4 py-2 flex items-center gap-2">
      {isGenerating ? (
        <button onClick={onStop} className="btn-subtle">
          <Square size={14} fill="currentColor" /> Stop
          <span className="text-ink-400 text-[11px] ml-1">Esc</span>
        </button>
      ) : (
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          className="btn-primary"
          title={
            canGenerate
              ? "Continue the story (⌘↵)"
              : "Write something first, or add Memory / Author's Note"
          }
        >
          <Sparkles size={14} /> Generate
          <span className="text-ink-950/70 text-[11px] ml-1">⌘↵</span>
        </button>
      )}
      <button
        onClick={onUndo}
        disabled={!canUndo || isGenerating}
        className="btn-ghost relative"
        title="Retry / Undo"
        onMouseEnter={() => {
          if (undoRange) {
            onUndoHover(undoRange);
          }
          setShowUndoPreview(true);
        }}
        onMouseLeave={() => {
          onUndoLeave();
          setShowUndoPreview(false);
        }}
      >
        <Undo2 size={14} /> Retry / Undo
        {showUndoPreview && undoPreview && (
          <div className="absolute bottom-full left-0 mb-2 p-2 bg-ink-800 text-ink-100 text-xs rounded shadow-lg max-w-xs break-words border border-ink-700 z-10">
            {undoPreview.length > 200 ? undoPreview.slice(0, 200) + "…" : undoPreview}
          </div>
        )}
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo || isGenerating}
        className="btn-ghost"
        title="Redo (⌘⇧Z or Ctrl+Y)"
      >
        <Redo2 size={14} /> Redo
      </button>
      <div className="flex-1" />
      {error && (
        <div className="text-xs text-red-400 truncate max-w-md" title={error}>
          {error}
        </div>
      )}
      {isGenerating && (
        <div className="flex items-center gap-2 text-xs text-accent-400">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
          generating…
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <main className="flex-1 h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ink-800 text-accent-500 mb-4">
          <Sparkles size={20} />
        </div>
        <h2 className="text-ink-50 text-xl font-semibold mb-2">
          Ready when you are.
        </h2>
        <p className="text-ink-300 text-sm leading-relaxed">
          Pick a story from the sidebar, or click{" "}
          <span className="text-accent-400">New Story</span> to start a fresh
          page. LocalQuill talks to your local LLM server and never sends your
          writing anywhere else.
        </p>
      </div>
    </main>
  );
}
