# Rewrite Selection Feature — Design Spec

**Date:** 2026-05-03  
**Status:** Approved

---

## Overview

When the user selects text in the story editor, a **Rewrite** section appears at the top of the right-hand Settings panel. The user types a required instruction, clicks Rewrite, and sees a streaming preview. They can Accept (replacing the selection with the rewrite as a new AI-generated span) or Discard (keeping the original).

---

## UI Placement

- **Location:** Top of `SettingsPanel` (far-right panel), above Server Status
- **Visibility:** Only when `selectedText` in the Zustand store is non-empty
- **Dismiss:** `✕` button clears the selection from the store

---

## Two States

### Composing (no preview yet)

- Selected text preview — truncated at ~150 chars, quoted style
- **Instruction** label + textarea — required; Rewrite button disabled when empty
- `✦ Rewrite →` button — triggers LLM call
- `■ Stop` button replaces Rewrite while streaming

### Preview (LLM result ready or streaming)

- **Original** section — dimmed, strikethrough
- **Rewrite** section — highlighted, scrollable, streams in token by token
- `✓ Accept` — applies the rewrite to the editor
- `✕ Discard` — clears preview, keeps selection active for retry

---

## State — Zustand Store Additions

```typescript
// New fields on UIState
selectedText: string                                        // selected text from editor
selectionRange: { start: number; end: number } | null      // char offsets into content
rewritePreview: string | null                              // streaming LLM output
pendingRewriteAccept: { start: number; end: number; text: string } | null

// New actions
setSelection: (text: string, range: { start: number; end: number } | null) => void
setRewritePreview: (text: string | null) => void
setPendingRewriteAccept: (v: { start: number; end: number; text: string } | null) => void
```

`isRewriting` and the abort ref stay local to `RewriteSection` — nothing else needs them.

---

## Editor Changes (`ActiveEditor`)

### Selection tracking

`onMouseUp` and `onKeyUp` on the textarea:
- If `selectionStart !== selectionEnd` → `setSelection(value.slice(start, end), { start, end })`
- If collapsed while editor is focused → `setSelection("", null)`
- Selection is **not** cleared on blur, so it persists when the user clicks into the instruction textarea in SettingsPanel.

### Accept watcher

`useEffect` watching `pendingRewriteAccept`. When set:

1. `pushCheckpoint(content)` — saves undo snapshot
2. Apply replacement: `content.slice(0, start) + text + content.slice(end)`
3. Rebuild `generationSpans`:
   - Drop all spans that overlap `[start, end)`
   - Add `{ start, end: start + text.length }` for the new AI span
4. `setBaseContent(newContent)`
5. Clear: `setPendingRewriteAccept(null)`, `setSelection("", null)`, `setRewritePreview(null)`

---

## SettingsPanel Changes

Extract rewrite UI into a `RewriteSection` component at the top of the panel.

### LLM call

Always uses `/v1/chat/completions` via `streamChatCompletion` (rewriting is instruction-following regardless of the user's `completionMode` setting).

**Prompt:**

```
system:
  <preamble setting, or "You are a skilled fiction writer.">

user:
  Rewrite the following passage according to the instruction below.
  Return only the rewritten passage — no commentary, no explanation.

  [If memory is non-empty:]
  Context:
  <memory>

  Passage:
  """
  <selectedText>
  """

  Instruction: <instruction>
```

`memory` is local state in `ActiveEditor` and not in the Zustand store. `RewriteSection` reads it directly from Dexie via `useLiveQuery(currentStoryId)` — the same pattern `ActiveEditor` uses — keeping the component self-contained with no new store fields needed for memory.

### Streaming

Tokens stream into `setRewritePreview` (appending). A local abort controller allows Stop.

### Accept

Calls `setPendingRewriteAccept({ ...selectionRange!, text: rewritePreview })`.  
Editor's `useEffect` picks it up and applies it (see above).

### Discard

Calls `setRewritePreview(null)`. Selection remains active so the user can adjust the instruction and retry.

---

## Span Reconciliation Detail

When accepting a rewrite over `[start, end)`:

```typescript
function applyRewriteToSpans(
  spans: GenerationSpan[],
  start: number,
  end: number,
  newLen: number,
): GenerationSpan[] {
  const delta = newLen - (end - start);
  return [
    // spans entirely before the replaced range — unchanged
    ...spans.filter(s => s.end <= start),
    // new span for the rewritten text
    { start, end: start + newLen },
    // spans entirely after — shifted by delta
    ...spans
      .filter(s => s.start >= end)
      .map(s => ({ start: s.start + delta, end: s.end + delta })),
    // spans that overlap [start, end) are dropped
  ];
}
```

---

## Files Changed

| File | Change |
|---|---|
| `src/store/useStore.ts` | Add 4 fields + 3 actions |
| `src/components/Editor.tsx` | Add selection tracking + accept watcher |
| `src/components/SettingsPanel.tsx` | Add `RewriteSection` component at top |

No new files needed.

---

## Out of Scope

- Keyboard shortcut for Rewrite (can be added later)
- Rewrite history / multiple alternatives
- Using `/v1/completions` mode for rewrites
