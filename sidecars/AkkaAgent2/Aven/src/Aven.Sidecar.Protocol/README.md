# Aven.Sidecar.Protocol

The executable stdio RPC contract shared by the .NET sidecar host and (by mirror) the Tauri
Rust manager and TypeScript client. See `sidecar-docs/STDIO_RPC_SPEC.md`.

Contents:

- `ProtocolEnvelope` — the single generic `{v,kind,id,method,params,result,error,event,meta}`
  envelope with request/response/event factory helpers.
- `ProtocolError` + `ProtocolErrorCodes` — structured `{code,message,retryable,data}` errors.
- `ProtocolConstants` / `ProtocolKind` — version (1), shared JSON options, the three kinds.
- `ProtocolMethods` / `ProtocolEvents` — the frozen method and event name constants.
- `MessageFraming` + `FrameReader` — `Content-Length` framed read/write over a byte stream.
- `ProtocolValidation` — strict envelope validation.

No runtime dependencies — System.Text.Json only. Tested by `Aven.Tests.Sidecar`.
