---
title: onnxruntime RotaryEmbedding error in the on-device model (cos/sin cache)
summary: The on-device ONNX model (LFM / EmbeddingGemma via ort) logs `[E:onnxruntime ... RotaryEmbedding] Updating cos_cache and sin_cache in RotaryEmbedding is not currently supported` during inference. Surfaces as a hard ExecuteKernel error from onnxruntime.
owner: unassigned
created: 2026-06-13
updated: 2026-06-13
tags: [aven-ai, onnxruntime, bug]
goal:
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

- [ ] Identify which model/path (LFM ONNX vs EmbeddingGemma) emits it + the root cause (export vs runtime).
- [ ] A local-inference smoke test runs clean (no RotaryEmbedding error).

## Progress log

Newest entry first.

- `2026-06-13` — Captured from dev logs while working the memory cards (0029). Pre-existing on-device
  inference issue; not caused by that work. Cloud (Tinfoil) is now the default so it's not blocking,
  but the on-device path needs a fix or a re-export.
