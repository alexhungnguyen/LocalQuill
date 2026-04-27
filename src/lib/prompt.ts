/**
 * Prompt assembly for NovelAI-style continuation.
 *
 * Layout (top → bottom, the order the model sees):
 *   [Memory]
 *   [Story body, trimmed from the front to fit the budget]
 *   [Author's Note inserted N lines above the tail]
 *
 * Memory is "always-on" worldbuilding context. Author's Note is short
 * style/direction guidance placed close to the generation point so it has
 * strong influence without being repeated verbatim.
 *
 * We approximate tokens as `chars / 4`, which is a well-known rule of thumb
 * for English text and good enough for a soft budget. Going slightly over
 * just means the model sees a little less story; we never hard-fail.
 */

export interface PromptInputs {
  memory: string;
  authorsNote: string;
  story: string;
  /** Soft cap on prompt size, in tokens (approx). */
  contextTokens: number;
  /** Insert author's note this many characters above the tail. */
  authorsNoteDepthChars?: number;
}

const CHARS_PER_TOKEN = 4;

export function buildPrompt(inputs: PromptInputs): string {
  const {
    memory,
    authorsNote,
    story,
    contextTokens,
    authorsNoteDepthChars = 600,
  } = inputs;

  const budgetChars = Math.max(512, contextTokens * CHARS_PER_TOKEN);

  const memoryBlock = memory.trim() ? `${memory.trim()}\n\n` : "";
  const anLine = authorsNote.trim()
    ? `\n[Author's Note: ${authorsNote.trim()}]\n`
    : "";

  // Reserve room for memory + author's note inside the budget.
  const reserved = memoryBlock.length + anLine.length;
  const storyBudget = Math.max(256, budgetChars - reserved);

  // Keep the most recent story content; trim from the front and snap to a
  // word boundary so we don't slice mid-token in a visually ugly way.
  let trimmed = story;
  if (trimmed.length > storyBudget) {
    trimmed = trimmed.slice(trimmed.length - storyBudget);
    const space = trimmed.indexOf(" ");
    if (space > 0 && space < 40) trimmed = trimmed.slice(space + 1);
  }

  // Insert author's note `authorsNoteDepthChars` from the end of the story.
  let storyWithAN: string;
  if (!anLine) {
    storyWithAN = trimmed;
  } else if (trimmed.length <= authorsNoteDepthChars) {
    storyWithAN = anLine + trimmed;
  } else {
    const cut = trimmed.length - authorsNoteDepthChars;
    storyWithAN = trimmed.slice(0, cut) + anLine + trimmed.slice(cut);
  }

  return memoryBlock + storyWithAN;
}

/** Approximate token count, for the UI counter only. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
