# 4. Ollama on a remote host

Date: 2026-10-18
Status: Accepted

## Context

Until SAP AI Core access is available, generation runs on a local model. The
development laptop is not the inference machine: Ollama runs on a separate
Windows host on the local network with an **8 GB VRAM** GPU. Questions and
documentation are in English only.

Two constraints follow from the hardware:

- The chat model, the embedding model (`bge-m3`, ~1.2 GB, see
  [ADR 0005](0005-bge-m3-embeddings-and-reindexing.md)) and the KV cache for the
  context window must fit in VRAM **at the same time**. Otherwise Ollama swaps
  models on every question (embed query, then generate), or offloads layers to
  the CPU, and latency grows several times.
- Ollama's default context window (2048–4096 tokens depending on version) is far
  smaller than what a RAG prompt needs (~5.5k–8k tokens: system prompt, 6 chunks,
  history, answer). When a prompt exceeds `num_ctx`, Ollama **silently drops
  content**: older messages first, then it truncates the remaining prompt. No
  error is returned, so the model answers with part of its context missing.

`mistral-nemo:12b` was evaluated first: on this host it already runs 20%/80%
CPU/GPU on its own (`ollama ps`), before loading `bge-m3` or enlarging the context.

## Decision

**Configuration**

- We use Ollama's HTTP API on the remote host. Defaults live in
  `cds.requires.llm` (`chatModel`, `numCtx`, `maxOutputTokens`, `temperature`,
  `timeoutMs`); the environment variables `OLLAMA_BASE_URL`, `OLLAMA_CHAT_MODEL`,
  `OLLAMA_NUM_CTX` and `OLLAMA_TIMEOUT_MS` override them. Real values live in
  `.env`, which is never committed; `.env.example` documents them.
- Ollama is never exposed outside the local network.

**Model and context**

- Default chat model: `qwen2.5:7b`. Estimated VRAM budget:

  | Component             | VRAM                |
  | --------------------- | ------------------- |
  | `qwen2.5:7b` (Q4)     | ~4.7 GB             |
  | KV cache, 16k context | ~0.9 GB             |
  | `bge-m3`              | ~1.2 GB             |
  | Windows desktop       | ~0.5 GB             |
  | **Total**             | **~7.3 GB of 8 GB** |

  Verified on the host: `qwen2.5:7b` and `bge-m3` loaded together run 100% on
  the GPU, and `qwen2.5:7b` stays fully on the GPU with `num_ctx` 16384
  (`/health/llm`). Observed latency: ~5 s for the first question (model load),
  1–2.5 s afterwards.

- `num_ctx` (16384) and `num_predict` (1024) are sent explicitly on every request.
- Generation uses a low temperature (0.2) to favor grounded, stable answers.
- `mistral-nemo:12b` remains a candidate. Both models are compared against the
  golden set in phase 2 ([ADR 0013](0013-testing-strategy-and-golden-set.md));
  changing the default is a configuration change plus an update to this ADR.

**Protection against silent truncation**

- The use case enforces a token budget of 90% of `contextWindow − maxOutputTokens`
  (the 10% absorbs errors of the ~4 characters/token estimate). The system prompt
  and the question are always kept; excerpts are added in rank order, then
  history from newest to oldest. If not a single excerpt fits, the assistant
  abstains.
- After each call, the adapter logs a warning when Ollama's `prompt_eval_count`
  reaches the prompt limit (`num_ctx − num_predict`), which indicates truncation.
  Comparing it with the expected prompt size is not reliable, because Ollama does
  not re-evaluate prompt prefixes it has cached.

**Errors and health**

- The adapter maps failures to typed errors, which the service translates into
  OData errors:
  - host not configured, unreachable or HTTP error → `LLMUnavailableError` → 503
  - timeout → `LLMTimeoutError` → 504
- `GET /health/llm` reports whether the host is reachable, the model is pulled
  and, through Ollama's `/api/ps`, whether the loaded model runs fully on the GPU
  (200 when up, 503 when down).
- CAP's built-in `GET /health` stays a pure liveness probe. An unreachable model
  host must never make the platform restart the application.

## Consequences

- Zero inference cost and full control over models during development.
- Both models stay resident on the GPU, so a question does not pay model swap or
  CPU offload latency.
- A 7B model is less capable than a 12B one; grounding (ADR 0008) and the golden
  set mitigate and measure this.
- `num_ctx`, the VRAM budget and the truncation checks are Ollama-specific and
  live only in its adapter; the token budget uses the generic `contextWindow`
  of the port.
- This ADR is expected to be superseded in phase 5 by an SAP AI Core ADR; the
  port from [ADR 0003](0003-provider-abstraction-via-cap-services.md) keeps that change local.
