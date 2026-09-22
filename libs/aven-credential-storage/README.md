# Customer credential storage

This host-only package lets a secret-entry process encrypt a value without also
giving that process the ability to decrypt stored values. It is groundwork for
the shared HTTP and IMAP credential boundary. It also contains restricted PostgreSQL
adapters and signed per-use contracts; the customer-facing Vault is not enabled yet.

`createCredentialSealer` accepts only an RSA-OAEP SHA-256 public key.
`createCredentialUnsealer` accepts a bounded, explicitly configured map of private
keys; it never discovers keys from a URL or falls back to another key. Runtime
private keys must be nonextractable WebCrypto keys. RSA keys are 3072–8192 bits.
Key provisioning and external escrow remain the host's responsibility;
nonextractability is not protection from a compromised executor.

The separate host-only `./keys` export loads an operator-mounted JSON key file.
`loadCredentialSealer` accepts the closed `aven-credential-sealing-key-v1` record
(`keyId`, SPKI PEM `publicKey`) and returns only sealing. `loadCredentialUnsealer`
accepts `aven-credential-unsealing-keys-v1` (`keys`, each with `keyId` and PKCS8 PEM
`privateKey`) and imports at most eight nonextractable runtime keys. Duplicate IDs,
unknown fields, missing/oversized files, symlinks, hardlinks and unsafe permissions
fail with one content-free error. Loading never generates replacement keys or contacts
a remote key server. Each loader snapshots its keys until explicitly reconstructed.
Mount only the public file into ingress; only protected executors receive the private
file. Trusted, non-writable parent directories and read-only mounts are operator
requirements; this file-level loader is not a sandbox or a deployment policy.

The encoding is [JWE](https://www.rfc-editor.org/rfc/rfc7516.html), implemented by
the repository's pinned `jose` package, using `RSA-OAEP-256` and `A256GCM`.
The library generates each content key and nonce. Authenticated additional data
binds the environment, owner, credential identity, credential kind and secret
version. Unsealing requires that independently supplied expected context. Copying
ciphertext to another customer or changing its public context does not make it
decryptable there. Only the closed, versioned format is accepted; unknown keys,
algorithms, compression, unprotected headers and extra fields fail closed.

Secret values are bounded to 32 KiB. Errors carry fixed codes without schema values
or nested cryptographic exceptions. Internal temporary plaintext buffers are cleared
where owned; callers must clear returned buffers when finished. Neither this package
nor JavaScript strings provide a guarantee of complete memory erasure. Ciphertext
and its public scope metadata are storage records, never model evidence or artifacts.

Encryption does **not** authorize use, prevent rollback of database state, or prove
revocation. The protected executor must first verify the exact live authority,
current record/version, protocol and durable use claim. It alone may call the
unsealer. Ordinary Actors and public APIs must not receive it. Old key identifiers
can remain decrypt-only during an explicitly controlled re-encryption operation;
removing a needed key makes old ciphertext unavailable, with no plaintext fallback.

The optional `ceo.aven:component:data:credentials@1` catalog entry installs encrypted
records, immutable command receipts, remote IMAP account identities, exact-use claims
and protocol-command outcomes. Its five runtime roles receive named function grants
only: set, metadata, match, HTTP use and IMAP use. Administrative roles cannot read
ciphertext; protocol roles cannot select tables or call the other protocol's functions.
Claims check owner, physical environment/generation, execution fence, binding and
secret versions, expiry and contiguous command budgets. Replays return an outcome
without releasing ciphertext again. Lost wire outcomes remain uncertain; a successful
command does not establish successful artifact publication.

The `./authority` export signs/verifies fixed-audience Ed25519 uses. It is a primitive,
not the application-policy issuer: current identity, parent execution, exact request
and shared review still require host checks. The `./postgres` adapters separate
administrative, metadata and protected-use access. Private command receipts retain
sealed input, never a plaintext password digest. Retry the identical sealed command
or inspect its receipt; re-encryption cannot silently replace a committed command.

The component is not required by default. No key files, public endpoint or running
customer credential service are enabled by this package. Protected-process deployment,
policy/Actor/Artifact Store integration, key escrow and whole-platform restoration
still need integration and proof before customer use.
Tests perform real crypto and temporary-file loss/restore, not external escrow or a
customer database recovery. Key files stay outside customer data and model evidence.
See [the credential boundary](../../docs/http-resource-actors.md) and
[build and test](../../docs/operations/build-and-test.md) for qualification.
