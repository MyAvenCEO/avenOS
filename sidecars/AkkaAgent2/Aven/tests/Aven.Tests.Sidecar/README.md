# Aven.Tests.Sidecar

Tests for the stdio sidecar contract and host.

- `MessageFramingTests` / `EnvelopeSerializationTests` / `ProtocolValidationTests` — the
  `Aven.Sidecar.Protocol` framing, serialization, and validation contract.
- `DispatcherIntegrationTests` — drives a real `RuntimeCompositionRoot` (temp SQLite, no LLM)
  through `MethodDispatcher`: session/skills/roles/agents/messages.submit/messages.result/
  humanPrompts, asserting structured envelopes and that submission uses the actor path.
- `RuntimeEventTests` — the M8 event projector mapping/correlation and a runtime event-flow test
  proving the `OnRuntimeEvent` hook delivers durable envelopes.
