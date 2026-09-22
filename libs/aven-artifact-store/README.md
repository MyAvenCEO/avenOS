# `@avenos/artifact-store`

Framework-neutral TypeScript client for the Aven Artifact Store. It provides an
independent `artifact-json-v1` parser/canonicalizer and a small HTTP client for the
current root vertical.

`ArtifactRunStore` is the shared immutable run publisher for Studio and protected
connection results. It stages each output under a stable publication/output identity,
retains typed source references and evidence, and supports an authority recheck after
staging and before commit. Callers supply their admitted principal, procedure,
implementation and receipt; the Store independently stamps its authenticated publisher.
The helper itself does not grant access, retry a network observation or interpret an
unknown publication outcome as failure.

The parser must be used on raw UTF-8 before ordinary `JSON.parse`: it rejects duplicate
keys, fractional/exponent numbers, and integers outside the signed interoperable
53-bit range. The client canonicalizes publication submissions, supplies the store
epoch precondition, and keeps bearer acquisition outside durable command data.

```ts
import { ArtifactStoreClient } from "@avenos/artifact-store";

const artifacts = new ArtifactStoreClient({
	baseUrl: "http://127.0.0.1:8087",
	bearerToken: () => coordinatorToken,
});
```

The Tauri host or AvenOS coordinator should provide `bearerToken`; UI code must not
construct publisher identity or gain direct database access. In AvenOS tenant mode,
only the trusted server-side coordinator also supplies
`requestHeaders: () => ({ "x-aven-artifact-database": trustedDatabaseName })`; the
browser must never select it. Durable outbox and
projector helpers remain part of the next implementation slice.
