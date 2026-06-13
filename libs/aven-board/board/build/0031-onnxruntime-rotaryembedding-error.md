---
title: onnxruntime RotaryEmbedding error in the on-device model (cos/sin cache)
summary: The on-device ONNX model (LFM / EmbeddingGemma via ort) logs `[E:onnxruntime ... RotaryEmbedding] Updating cos_cache and sin_cache in RotaryEmbedding is not currently supported` during inference. Surfaces as a hard ExecuteKernel error from onnxruntime.
owner: unassigned
created: 2026-06-13
updated: 2026-06-13
tags: [aven-ai, onnxruntime, bug]
goal: "On-device EmbeddingGemma inference runs with NO `RotaryEmbedding ... Updating cos_cache and sin_cache` error across inputs of varying length, and a debug export taken after the fix shows `embedder: gemma` (never falling back) on every round — verified at runtime by rebuilding `--features desktop-ai`."
---

# onnxruntime RotaryEmbedding error (cos/sin cache not updatable)

## Context

Repeated during on-device inference:

```
[E:onnxruntime:, sequential_executor.cc:572 ExecuteKernel] Non-zero status code returned while
running RotaryEmbedding node. Name:'/model/layers.0/attn/k_rotary/RotaryEmbedding'
Status Message: Updating cos_cache and sin_cache in RotaryEmbedding is not currently supported
```

The `RotaryEmbedding` op in the exported ONNX graph tries to UPDATE its cos/sin cache at runtime,
which the bundled onnxruntime build doesn't support → the kernel errors. Likely the on-device text
LLM (LFM2.5 ONNX via `ort`) or EmbeddingGemma path in `libs/aven-ai`. Either the model was exported
with a dynamic-cache RotaryEmbedding the runtime can't honour, or the runtime/op-set needs a config
(static cache / different rotary impl / newer onnxruntime).

## Goal

On-device inference runs without the RotaryEmbedding ExecuteKernel error — the model produces correct
output, no error spam. (Now that Cloud AI is the default, the on-device path is secondary, but it
should still work for offline / local-only mode.)

When moved to discover, make measurable: a small inference smoke test over the affected model that
exits 0 with no onnxruntime error logged.

## Acceptance criteria

- [x] Identify which model/path emits it + the root cause. → **EmbeddingGemma-300m** (the brain
      embedder, `libs/aven-ai/src/embed.rs`). Root cause = **variable sequence length**: the contrib
      `RotaryEmbedding` kernel caches cos/sin for the FIRST run's seq length and can't resize it, so
      a later input of a different length crashes the kernel. (The chat LLM is now llama.cpp, not ONNX;
      the only ONNX models loaded are EmbeddingGemma + MOSS-TTS, and the error fires on every chat turn
      = the embedder.) This is why recall silently degraded to the stub — board [[0032-embedder-required-never-stub]]
      now hard-blocks instead, and [[0033-context-assembler-redundant-gist]] exposed it via the export.
- [ ] A local-inference smoke test runs clean (no RotaryEmbedding error). ← **NEEDS RUNTIME
      VERIFICATION** (no model runtime in CI/here): rebuild `--features desktop-ai`, embed a few texts
      of different lengths, confirm the error is gone and exports show `embedder: gemma` consistently.

## Candidate fix (committed, awaiting runtime verification)

`embed.rs` now pads/truncates EVERY input to one constant length (`PAD_LEN = 512`): real tokens carry
`attention_mask = 1`, padding `0`, so the rotary cache is sized once and never updated, and mean-pooling
ignores the pads (the embedding equals the unpadded run). The canonical onnxruntime workaround for this
exact error. If runtime testing shows it persists, the fallback is a model re-export (static-cache
rotary) or an onnxruntime upgrade.

## Progress log

Newest entry first.

- `2026-06-13` — Root-caused to EmbeddingGemma + variable seq length. Shipped the fixed-length-padding
  candidate fix in `embed.rs`; compiles under `desktop-ai`. Needs runtime verification (rebuild + watch
  the logs / next debug export). Moved to build/.
- `2026-06-13` — Captured from dev logs while working the memory cards (0029). Pre-existing on-device
  inference issue; not caused by that work. Cloud (Tinfoil) is now the default so it's not blocking,
  but the on-device path needs a fix or a re-export.
