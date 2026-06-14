# Aven.Testing

## Purpose

Shared test-support assembly for reusable in-memory seams and thin actor-backed test gateways that are
useful across multiple test projects but are not production runtime functionality.

## Owns

- in-memory capability admission helper
- in-memory role-agent registry helper
- metadata test clients (`IMetadataStoreClient`, actor-backed wrapper, in-memory implementation)
- in-memory LLM provider and response-planning helpers

## Does not own

- production runtime actors
- toolkit-owned portable contracts
- API/runtime composition

## Important rules

- Types here may reference runtime contracts and actors because they are test support.
- Do not move these seams back under `src/` unless they become real production runtime features.
- Toolkit projects must remain runtime-independent and must not reference this assembly.