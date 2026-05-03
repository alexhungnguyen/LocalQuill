/**
 * Prompt assembly for NovelAI-style continuation.
 *
 * /v1/completions layout (top → bottom):
 *   [Preamble]
 *   [Memory]
 *   [Story body, trimmed from the front to fit the budget]
 *   [Author's Note inserted N chars above the tail]
 *
 * /v1/chat/completions layout (multi-turn):
 *   system:    preamble
 *   user:      memory *** user-typed segment 1
 *   assistant: generated segment 1
 *   user:      user-typed segment 2
 *   assistant: generated segment 2
 *   ...
 *   system:    author's note
 *   assistant: prefill
 */

export interface StorySegment {
  type: "user" | "generated";
  text: string;
}

export interface PromptInputs {
  /** Prepended before everything else — persona/style instruction for the model. */
  preamble?: string;
  memory: string;
  authorsNote: string;
  story: string;
  /**
   * Chat mode only. When provided, used instead of `story` to build multi-turn
   * messages — user segments become user messages, generated segments become
   * assistant messages.
   */
  segments?: StorySegment[];
  /** Soft cap on prompt size, in tokens (approx). */
  contextTokens: number;
  /** Insert author's note this many characters above the tail (completions mode only). */
  authorsNoteDepthChars?: number;
  /**
   * Chat mode only. Inserted as the beginning of the final assistant message so
   * the model continues from mid-sentence. Not supported by servers with
   * thinking/reasoning mode enabled.
   */
  prefill?: string;
}

const CHARS_PER_TOKEN = 4;

export function buildPrompt(inputs: PromptInputs): string {
  const {
    preamble,
    memory,
    authorsNote,
    story,
    contextTokens,
    authorsNoteDepthChars = 600,
  } = inputs;

  const budgetChars = Math.max(512, contextTokens * CHARS_PER_TOKEN);

  const preambleBlock = preamble?.trim() ? `${preamble.trim()}\n\n` : "";
  const memoryBlock = memory.trim() ? `${memory.trim()}\n\n` : "";
  const anLine = authorsNote.trim()
    ? `\n[Author's Note: ${authorsNote.trim()}]\n`
    : "";

  const reserved = preambleBlock.length + memoryBlock.length + anLine.length;
  const storyBudget = Math.max(256, budgetChars - reserved);

  let trimmed = story;
  if (trimmed.length > storyBudget) {
    trimmed = trimmed.slice(trimmed.length - storyBudget);
    const space = trimmed.indexOf(" ");
    if (space > 0 && space < 40) trimmed = trimmed.slice(space + 1);
  }

  let storyWithAN: string;
  if (!anLine) {
    storyWithAN = trimmed;
  } else if (trimmed.length <= authorsNoteDepthChars) {
    storyWithAN = anLine + trimmed;
  } else {
    const cut = trimmed.length - authorsNoteDepthChars;
    storyWithAN = trimmed.slice(0, cut) + anLine + trimmed.slice(cut);
  }

  return preambleBlock + memoryBlock + storyWithAN;
}

/**
 * Build chat messages for /v1/chat/completions using multi-turn history.
 *
 * When `segments` are provided, each user-typed segment becomes a `user`
 * message and each generated segment becomes an `assistant` message —
 * matching NovelAI's conversation structure exactly.
 *
 * Memory goes at the top of the first user message (lorebook format).
 * Author's Note is injected as a system message just before the prefill,
 * giving it maximum authority over the next generation.
 */
export function buildChatMessages(
  inputs: PromptInputs,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const { preamble, memory, authorsNote, story, segments, contextTokens, prefill } = inputs;

  const budgetChars = Math.max(512, contextTokens * CHARS_PER_TOKEN);
  const systemContent = preamble?.trim() || "You are a skilled fiction writer. Continue the story naturally.";
  const memoryBlock = memory.trim() ? `${memory.trim()}\n\n***\n\n` : "";

  // Use provided segments or treat full story as a single user segment.
  // Merge consecutive same-type segments so we never produce two assistant
  // messages in a row (violates the OpenAI alternation requirement).
  const rawSegments: StorySegment[] = mergeSegments(
    segments?.length ? segments : [{ type: "user", text: story }],
  );

  const reserved = systemContent.length + memoryBlock.length + (authorsNote?.length ?? 0);
  const storyBudget = Math.max(256, budgetChars - reserved);
  const trimmedSegments = trimSegments(rawSegments, storyBudget);

  // Auto-prefill: when the last segment is generated and no user prefill is set,
  // use the tail of that segment as the prefill anchor. This prevents the model
  // from repeating its previous turn when the last generation was cut off mid-sentence —
  // the model continues from exactly where it left off instead of regenerating from scratch.
  const AUTO_PREFILL_CHARS = 80;
  let effectivePrefill = prefill?.trim() ?? "";
  const historySegments = [...trimmedSegments];

  if (!effectivePrefill && historySegments.length > 0) {
    const lastSeg = historySegments[historySegments.length - 1];
    if (lastSeg.type === "generated" && lastSeg.text.length > AUTO_PREFILL_CHARS * 2) {
      const rawTail = lastSeg.text.slice(-AUTO_PREFILL_CHARS);
      const firstSpace = rawTail.indexOf(" ");
      const tail = firstSpace > 0 && firstSpace < 30 ? rawTail.slice(firstSpace + 1) : rawTail;
      effectivePrefill = tail;
      historySegments[historySegments.length - 1] = { ...lastSeg, text: lastSeg.text.slice(0, -tail.length) };
    }
  }

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemContent },
  ];

  let memoryAttached = false;
  for (const seg of historySegments) {
    if (seg.type === "user") {
      if (!memoryAttached) {
        messages.push({ role: "user", content: `Continue the following story:\n\n${memoryBlock}${seg.text}` });
        memoryAttached = true;
      } else {
        console.log("user seg", seg.text);
        if (seg.text.trim() === "") {
          continue;
        }
        messages.push({ role: "user", content: seg.text });
      }
    } else {
      if (!memoryAttached) {
        // Edge case: first segment is generated — attach memory to a synthetic user message.
        messages.push({ role: "user", content: `Continue the following story:\n\n${memoryBlock}` });
        memoryAttached = true;
      }
      messages.push({ role: "assistant", content: seg.text });
    }
  }

  // Ensure there is always at least one user message.
  if (!memoryAttached) {
    messages.push({ role: "user", content: `Continue the following story:\n\n${memoryBlock}` });
  }

  const CONTINUE_PROMPT = "Continue the story from where it left off.";

  if (effectivePrefill) {
    console.log("effectivePrefill", effectivePrefill);
    // If the last message is already assistant, insert a user turn before
    // the prefill so we don't produce two consecutive assistant messages.
    if (messages[messages.length - 1]?.role === "assistant") {
      messages.push({ role: "user", content: CONTINUE_PROMPT });
    }
    messages.push({ role: "assistant", content: effectivePrefill });
  } else {
    console.log("no effectivePrefill", messages);
    // Without prefill the last message must be user (or system) so the model
    // knows it's its turn. An assistant-last conversation reads as already
    // complete and the model returns nothing.
    if (messages[messages.length - 1]?.role === "assistant") {
      messages.push({ role: "user", content: CONTINUE_PROMPT });
    }
  }

  // Inject Author's Note into the last user message so it lands immediately
  // before the model generates — recency beats a secondary system message,
  // which most local models effectively ignore.
  if (authorsNote?.trim()) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        const existing = messages[i].content.trim();
        messages[i] = {
          ...messages[i],
          content: existing
            ? `${existing}\n\n[Author's Note: ${authorsNote.trim()}]`
            : `[Author's Note: ${authorsNote.trim()}]`,
        };
        break;
      }
    }
  }

  return messages;
}

/** Collapse adjacent segments of the same type into one. */
function mergeSegments(segments: StorySegment[]): StorySegment[] {
  return segments.reduce<StorySegment[]>((acc, seg) => {
    const last = acc[acc.length - 1];
    if (last && last.type === seg.type) {
      last.text += seg.text;
    } else {
      acc.push({ type: seg.type, text: seg.text });
    }
    return acc;
  }, []);
}

/** Trim segments from the front to fit within budgetChars total. */
function trimSegments(segments: StorySegment[], budgetChars: number): StorySegment[] {
  const total = segments.reduce((sum, s) => sum + s.text.length, 0);
  if (total <= budgetChars) return segments;

  let excess = total - budgetChars;
  const result: StorySegment[] = [];

  for (const seg of segments) {
    if (excess <= 0) {
      result.push(seg);
    } else if (excess >= seg.text.length) {
      excess -= seg.text.length;
    } else {
      let text = seg.text.slice(excess);
      const space = text.indexOf(" ");
      if (space > 0 && space < 40) text = text.slice(space + 1);
      result.push({ type: seg.type, text });
      excess = 0;
    }
  }

  return result.filter((s) => s.text.length > 0);
}

/** Approximate token count, for the UI counter only. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
