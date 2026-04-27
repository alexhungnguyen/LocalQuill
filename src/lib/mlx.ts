/**
 * Thin client for the OpenAI-compatible endpoints exposed by `mlx_lm.server`.
 *
 * We deliberately stick to /v1/completions (raw text in, raw text out) rather
 * than chat completions: a NovelAI-style writing UI streams continuations of
 * an arbitrary prose blob, with no chat templating, no system prompts and no
 * special tokens injected by the server.
 */

export interface CompletionParams {
  prompt: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  /** Token strings that, when produced, immediately end generation. */
  stop?: string[];
  /** OpenAI-style repetition penalty (mlx_lm.server accepts this field). */
  repetitionPenalty?: number;
  /**
   * Never set this for completions against mlx_lm.server.
   * Sending any `model` value causes the server to attempt to load that
   * specific model id (hitting the HF API, potentially loading the wrong
   * one). The server already knows what it loaded via --model; omitting
   * the field lets it use whatever is running. Field kept in the interface
   * for future compatibility but should be left undefined.
   */
  model?: never;
}

export interface StreamHandlers {
  onToken: (chunk: string) => void;
  onDone: (finishReason: string | null) => void;
  onError: (err: Error) => void;
  signal?: AbortSignal;
}

/**
 * Stream a completion. Tokens are delivered to `onToken` as they arrive.
 *
 * The server emits Server-Sent-Events lines of the form `data: {json}\n\n`,
 * terminated by a `data: [DONE]` sentinel. We don't pull in an SSE library;
 * the protocol is small enough to parse by hand and that keeps the bundle
 * tiny and the behaviour transparent.
 */
export async function streamCompletion(
  params: CompletionParams,
  handlers: StreamHandlers,
): Promise<void> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    top_p: params.topP,
    stream: true,
  };
  if (params.stop && params.stop.length > 0) body.stop = params.stop;
  if (params.repetitionPenalty !== undefined) {
    body.repetition_penalty = params.repetitionPenalty;
  }

  let response: Response;
  try {
    response = await fetch("/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
  } catch (err) {
    handlers.onError(asError(err));
    return;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    handlers.onError(
      new Error(
        `MLX server returned ${response.status} ${response.statusText}` +
          (text ? `: ${text.slice(0, 200)}` : ""),
      ),
    );
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finishReason: string | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE messages are separated by blank lines. We process whole messages
      // and leave any partial trailing message in the buffer for next round.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const message = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = message
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (payload === "[DONE]") {
          handlers.onDone(finishReason);
          return;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{
              text?: string;
              finish_reason?: string | null;
            }>;
          };
          const choice = json.choices?.[0];
          if (!choice) continue;
          if (choice.text) handlers.onToken(choice.text);
          if (choice.finish_reason) finishReason = choice.finish_reason;
        } catch {
          // Be permissive: skip malformed chunks rather than abort the stream.
        }
      }
    }
    handlers.onDone(finishReason);
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      handlers.onDone("aborted");
      return;
    }
    handlers.onError(asError(err));
  } finally {
    reader.releaseLock();
  }
}

/** Quick reachability check used by the connection indicator. */
export async function pingServer(): Promise<{ ok: boolean; model?: string }> {
  try {
    const res = await fetch("/v1/models");
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return { ok: true, model: json.data?.[0]?.id };
  } catch {
    return { ok: false };
  }
}

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
