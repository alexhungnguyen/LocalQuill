/**
 * Thin client for any OpenAI-compatible `/v1/completions` server
 * (mlx_lm, Ollama, llama.cpp, etc.).
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
  /** OpenAI-style repetition penalty. Supported by mlx_lm and llama.cpp. */
  repetitionPenalty?: number;
  /**
   * Avoid setting this field when targeting mlx_lm.server.
   * Sending a `model` value causes it to attempt to load that specific model
   * id (hitting the HF API, potentially loading the wrong one). The server
   * already knows what it loaded via --model; omitting the field lets it use
   * whatever is running. Field kept in the interface for future compatibility
   * but should be left undefined for mlx_lm.
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
    // stream: true,
  };
  if (params.stop && params.stop.length > 0) body.stop = params.stop;
  if (params.repetitionPenalty !== undefined) {
    body.repetition_penalty = params.repetitionPenalty;
  }

  console.log("[llm] POST /v1/completions", body);

  let response: Response;
  try {
    response = await fetch("/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
  } catch (err) {
    console.error("[llm] fetch error:", err);
    handlers.onError(asError(err));
    return;
  }

  console.log("[llm] response status:", response.status, response.statusText);

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    console.error("[llm] error body:", text);
    handlers.onError(
      new Error(
        `Server returned ${response.status} ${response.statusText}` +
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
        // console.log("[llm] chunk:", payload);
        if (payload === "[DONE]") {
          console.log("[llm] done, finish_reason:", finishReason);
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
    console.log("[llm] stream ended, finish_reason:", finishReason);
    handlers.onDone(finishReason);
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      console.log("[llm] aborted by user");
      handlers.onDone("aborted");
      return;
    }
    console.error("[llm] stream error:", err);
    handlers.onError(asError(err));
  } finally {
    reader.releaseLock();
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionParams {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  topP: number;
  stop?: string[];
  repetitionPenalty?: number;
}

/**
 * Stream a chat completion. Tokens are delivered to `onToken` as they arrive.
 * Uses /v1/chat/completions — the server applies the model's chat template,
 * making this suitable for instruct/IT models.
 */
export async function streamChatCompletion(
  params: ChatCompletionParams,
  handlers: StreamHandlers,
): Promise<void> {
  let tokenCount = 0;
  const body: Record<string, unknown> = {
    messages: params.messages,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    top_p: params.topP,
    stream: true,
  };
  if (params.stop && params.stop.length > 0) body.stop = params.stop;
  if (params.repetitionPenalty !== undefined) {
    body.repetition_penalty = params.repetitionPenalty;
  }

  console.log("[llm] POST /v1/chat/completions", body);

  let response: Response;
  try {
    response = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
  } catch (err) {
    console.error("[llm] fetch error:", err);
    handlers.onError(asError(err));
    return;
  }

  console.log("[llm] response status:", response.status, response.statusText);

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    console.error("[llm] error body:", text);
    handlers.onError(
      new Error(
        `Server returned ${response.status} ${response.statusText}` +
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

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const message = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = message
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        // console.log("[llm] chunk:", payload);
        if (payload === "[DONE]") {
          console.log("[llm] done, finish_reason:", finishReason);
          handlers.onDone(finishReason);
          return;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
          };
          const choice = json.choices?.[0];
          if (!choice) continue;
          if (choice.delta?.content) {
            tokenCount++;
            handlers.onToken(choice.delta.content);
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
            if (choice.finish_reason === "content_filter") {
              handlers.onError(new Error("Request blocked by content filter (finish_reason: content_filter)."));
              return;
            }
          }
        } catch {
          // Skip malformed chunks.
        }
      }
    }
    console.log("[llm] stream ended, finish_reason:", finishReason, "tokens:", tokenCount);
    if (tokenCount === 0 && finishReason === "stop") {
      handlers.onError(new Error("Model generated nothing — silent refusal. Try /v1/completions mode or a different model."));
      return;
    }
    handlers.onDone(finishReason);
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      console.log("[llm] aborted by user");
      handlers.onDone("aborted");
      return;
    }
    console.error("[llm] stream error:", err);
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
