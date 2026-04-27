# LocalQuill

A local, NovelAI-style storywriting UI powered by a local LLM. No accounts, no cloud, no telemetry — your prose stays on your machine and stories are saved locally in the browser via IndexedDB.

Works with any OpenAI-compatible `/v1/completions` server: **mlx_lm**, **Ollama**, or **llama.cpp**.

## Features

- **Continuation-first editor** — paste a beginning, hit Generate, watch tokens stream in. The model sees raw text, not a chat template.
- **Memory + Author's Note** — the two NovelAI knobs that matter:
  - *Memory* is prepended to every prompt (worldbuilding, characters, established facts).
  - *Author's Note* is inserted near the tail (tone, pacing, near-term direction).
- **Local story management** — create, rename, duplicate, export (`.json`), import, delete. All data lives in IndexedDB.
- **Sampling controls** — temperature, top-p, repetition penalty, max tokens, context window, stop sequences, author's note depth.
- **Snapshots** — a snapshot is saved before each generation so you can always recover hand-written prose. The 30 most recent are kept per story.
- **Streaming with stop / undo** — `⌘↵` (or `Ctrl+Enter`) to generate, `Esc` to stop mid-stream, *Retry / Undo* to drop the last generated chunk.
- **Connection indicator** — the right panel shows whether the LLM server is reachable and which model it has loaded.

## Setup

### 1. Start a local LLM server

LocalQuill talks to any server that exposes an OpenAI-compatible `/v1/completions` endpoint. Pick whichever backend suits your hardware.

#### mlx_lm (Apple Silicon — recommended)

```bash
pip install mlx-lm
mlx_lm.server \
  --model <hf-model-id-or-local-path> \
  --host 127.0.0.1 \
  --port 8080
```

The first run downloads the model from the Hugging Face Hub. Models quantised to 4-bit (`*-mlx-4bit`) fit comfortably in unified memory.

#### Ollama

```bash
ollama serve          # starts on 127.0.0.1:11434 by default
ollama pull mistral   # or any model you prefer
```

Then point LocalQuill at Ollama's port:

```bash
MLX_SERVER_URL=http://127.0.0.1:11434 npm run dev
```

> **Note:** Ollama's `/v1/completions` endpoint requires a model name in the request body. LocalQuill deliberately omits it (see the mlx_lm notes in the code). If generation returns an error, try wrapping Ollama behind a small proxy or use llama.cpp instead.

#### llama.cpp (llama-server)

```bash
llama-server \
  --model path/to/model.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 8192
```

llama-server exposes a fully compatible `/v1/completions` endpoint with streaming out of the box.

### 2. Run the web UI

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/v1/*` to the MLX server on `127.0.0.1:8080`, so the browser never has to deal with CORS.

If your server runs on a different host or port, set `MLX_SERVER_URL`:

```bash
MLX_SERVER_URL=http://192.168.1.42:8080 npm run dev
```

### 3. Production build (optional)

```bash
npm run build && npm run preview
```

`preview` reuses the same proxy config and serves on `http://localhost:5173`. If you serve `dist/` from your own static host, you'll need a reverse proxy so `/v1/*` reaches the MLX server.

## Keyboard shortcuts

| Shortcut        | Action                            |
| --------------- | --------------------------------- |
| `⌘↵` / `Ctrl+↵` | Generate (or stop, if generating) |
| `Esc`           | Stop a running generation         |

## Tech stack

Vite · React · TypeScript · Tailwind CSS · Zustand · Dexie (IndexedDB).

The LLM client uses the OpenAI-compatible `/v1/completions` endpoint with `stream: true` and parses Server-Sent-Events by hand — no extra deps.

## Privacy

Everything — stories, memory, author's note, settings, snapshots — is stored in your browser's IndexedDB under the origin `http://localhost:5173`. Clearing site data wipes it. There is no telemetry, no analytics, and no network calls beyond your local LLM server.
