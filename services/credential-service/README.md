# Connection credential management

This private service accepts a user's connection secret, seals it with a public key
and stores it in that user's customer database. It exposes labels, binding settings
and command receipts, never stored values. The implementation has real signature,
encryption and PostgreSQL tests. The native set-only transport and connection settings
are available in the opt-in local composition. The isolated native journey covers
both connection types, rotation, revocation and retained metadata after restart.
This does not qualify hosted deployment or operator key escrow.

Requests require the existing facade bearer, signed identity token and short-lived
customer grant with matching subject, session, component and action. Delegated work
cannot enter secrets. Set and metadata pools use separate function-only roles; neither
has a decryption key or protocol-use grant. Each SQL operation checks current physical
generation, including requests using cached connections. Writes also respect the
execution fence. No body, credential or provider error is logged.

`GET /api/credentials` lists owned metadata. `POST /api/credentials/commands` accepts
a bounded closed command with a fresh command ID: create, rotate, revoke, set binding
or revoke binding. `GET /api/credentials/commands/{id}` retrieves its durable receipt.
An already recorded command returns `previously-processed`, not a claim that a newly
typed secret equals the previous one. Editing a pending form must create a new command
ID. Simultaneous differently sealed submissions with the same ID conflict; clients
resolve uncertainty by reading the receipt rather than silently repeating a write.

The facade validates an interactive request's origin before removing it at the private
handoff. Foreign origins, cookies and delegated work cannot use this surface. Settings
capture the customer and subject when opened; native checks repeat before dispatch and
after the response. Closing or switching the workspace invalidates late results and
clears the secret field. No entered secret is retained for automatic retry. A missing
receipt after a timeout remains uncertain, not evidence that the command never ran.

JavaScript strings cannot guarantee memory erasure. Owned request/plaintext buffers are
cleared when possible. Operators must not add body capture to the facade or ingress.
See [local integration status](../../docs/operations/local-stack.md),
[the credential boundary](../../docs/http-resource-actors.md) and
[qualification](../../docs/operations/build-and-test.md).
