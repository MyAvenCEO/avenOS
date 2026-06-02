# llm-contracts

Public LLM mailbox, capability, and provider-configuration contracts for the
tree-explorer backend.

## Purpose

This package defines the shared types used to talk to the LLM subsystem and to
describe configured model/provider capabilities.

Examples:

- `LlmRequest`
- `LlmRequestCompleted`
- `LlmResult`
- `LlmMessage`
- `LlmInputPart` / `LlmOutputPart`
- `LlmModelCapabilities`
- `LlmProvidersConfig`

## Boundary

This package should contain only public contracts and shared value types.

It should **not** contain:

- provider client implementations
- dispatcher / worker actor behavior
- config file loading logic
- runtime wiring

## Intended consumers

- intent orchestration
- backend adapters and tests
- future LLM implementation package
- runtime/composition wiring

## Rule of thumb

If another subsystem only needs to describe or send LLM-related messages, it should
be able to import this package without importing `llm-subsystem.ts` or
`llm-provider-config.ts` directly.