# @avenos/self

Self-sovereign identity for MaiaOS. Two key types (**`passkey`**, **`secretkey`**) with three sources (**`webauthn`**, **`envvars`**, **`config`**) behind a single entry point: **`signIn()`**.

## Overview

`@avenos/self` owns identity keys. CoValue persistence is runtime-driven in `@MaiaOS/storage` (browser-opfs / pglite / postgres) and is never coupled to the key type.

**STRICT: PRF is REQUIRED for passkey paths - no fallbacks.**

### Type × Source

| Type | Source | Where the key comes from |
|---|---|---|
| `passkey` | `webauthn` | WebAuthn PRF (in-memory only, derived per session) |
| `secretkey` | `envvars` | Node: `AVEN_OS_ACCOUNT` + `AVEN_OS_SECRET`. Browser dev: `VITE_AVEN_TEST_ACCOUNT` + `VITE_AVEN_TEST_SECRET` |
| `secretkey` | `config` | Caller-supplied `accountID` + `agentSecret` |

Passkey implies `webauthn` (implicit source). Secret-key requires an explicit source.

## Features

- Hardware-backed passkeys (Secure Enclave/TPM) with PRF-derived agent secrets — nothing stored in `localStorage`.
- Deterministic accounts: same passkey → same `accountID`.
- Cross-device sync via iCloud/Google (passkeys) and self-hosted MaiaOS sync (accounts).
- Uniform contract across browser clients, the sync server, and scripted agents.

## Browser support (passkey paths)

- Chrome / Edge (macOS, Linux, Windows 11), Safari (macOS 13+, iOS 16+).
- Firefox and Windows 10 are unsupported; `signIn({ type: 'passkey', ... })` throws on call.

## Installation

```bash
bun add @avenos/self
```

## Usage

### `signIn(options)` — single entry point

```js
import { signIn } from '@avenos/self'

// Passkey sign-up (2 biometric prompts: temp → final passkey)
const { accountID, agentSecret, loadingPromise } = await signIn({
  type: 'passkey',
  mode: 'signup',
  name: 'maia',
  salt: 'maia.city',
})
const { node, account } = await loadingPromise

// Passkey sign-in (1 biometric prompt, loads existing account)
const { accountID, agentSecret, loadingPromise } = await signIn({
  type: 'passkey',
  mode: 'signin',
  salt: 'maia.city',
})
const { node, account } = await loadingPromise

// Secret-key from env (Node: AVEN_OS_*; browser dev: VITE_AVEN_TEST_*)
const { node, account } = await signIn({
  type: 'secretkey',
  source: 'envvars',
  syncDomain: null,
  createName: 'Maia Agent',
})

// Secret-key from explicit config (e.g. sync server bootstrap)
const { node, account } = await signIn({
  type: 'secretkey',
  source: 'config',
  accountID,
  agentSecret,
  dbPath, // Node PGlite path, optional
  syncDomain: null,
  createName: 'Maia Agent',
})
```

**Options**

| Field | Applies to | Notes |
|---|---|---|
| `type` | all | `'passkey'` \| `'secretkey'` |
| `source` | `secretkey` | `'envvars'` (default) \| `'config'` |
| `mode` | `passkey` | `'signin'` \| `'signup'` |
| `accountID` | `secretkey` + `config` | Required |
| `agentSecret` | `secretkey` + `config` | Required |
| `name` | `passkey` + `signup` | Optional display name |
| `salt` | `passkey` | Defaults to `'maia.city'` |
| `syncDomain` | all | Override sync WS host (optional) |
| `createName` | `secretkey` | Profile name used when the account is first created |
| `dbPath` | Node + `secretkey` | Explicit PGlite directory (otherwise `AVEN_OS_DB_PATH`) |

**Returns**

```ts
{
  accountID: string,
  agentSecret: AgentSecret,
  // passkey paths return a deferred loader:
  loadingPromise?: Promise<{ node, account, accountID }>,
  credentialId?: string, // passkey signup only
  // secretkey paths return the resolved pair directly:
  node?: LocalNode,
  account?: RawAccount,
  wasCreated?: boolean,
}
```

### `ensureAccount(options)` — low-level primitive

Called by `signIn` once the identity material is known. Useful when you already have `agentSecret` + `accountID` and want fine-grained control over `mode: 'signup' | 'signin' | 'bootstrap'`, custom migrations, or a pre-wired storage instance. See `projects/self/src/ensure-account.js`.

### `generateAgentCredentials({ name })` — static key factory

Mint a fresh `(accountID, agentSecret)` pair for scripts/seeds. No network, no storage, no profile. The generated pair is meant to be persisted by the caller (env file, secret store) and later loaded via `signIn({ type: 'secretkey', source: 'config' | 'envvars' })`.

### `isPRFSupported()` / `requirePRFSupport()`

Feature detection for WebAuthn PRF. `requirePRFSupport()` throws with a user-facing upgrade message on unsupported browsers.

## Security properties

- Passkey secrets live in Secure Enclave/TPM only; `AgentSecret` / `SignerSecret` / `SealerSecret` are derived per session.
- No `localStorage` or metadata cache — XSS retrieves nothing.
- Passkeys sync across devices via the platform credential manager; accounts sync via the MaiaOS sync service.

## How the passkey flow works

### Sign-up (2 biometric prompts)

```
Step 1: Create TEMP passkey + evaluate PRF            → 1st biometric prompt
Step 2: Derive AgentSecret, create cojson account     → account.id known
Step 3: Create FINAL passkey with userHandle =
        [PRF_output (32B) || accountID]               → 2nd biometric prompt
```

Two prompts are unavoidable: the `accountID` only exists after step 2, and a passkey's `userHandle` is immutable after creation.

### Sign-in (1 biometric prompt)

```
Step 1: Get existing passkey                          → biometric prompt
Step 2: Parse userHandle → PRF_output + accountID
Step 3: Derive AgentSecret + load account via sync
```

No PRF re-evaluation is needed — the derived secret is already cached in `userHandle`.

## Integration example

```js
import { MaiaOS, subscribeSyncState } from '@AvenOS/kernel/client'
import { OS_REGISTRY_KEY, registerOsSpark } from '@AvenOS/universe'
import { signIn, requirePRFSupport } from '@avenos/self'

async function boot() {
  await requirePRFSupport()
  renderSignInPrompt()
}

async function register(displayName) {
  const { loadingPromise } = await signIn({
    type: 'passkey',
    mode: 'signup',
    name: displayName,
    salt: 'maia.city',
  })
  const { node, account } = await loadingPromise
  subscribeSyncState((state) => console.log('Sync:', state.connected ? 'Online' : 'Offline'))
  registerOsSpark({ node, account })
  const maia = await MaiaOS.boot({
    node,
    account,
    modules: ['db', 'core', 'ai'],
    sparkRegistryKey: OS_REGISTRY_KEY,
  })
  renderApp(maia)
}

async function signInPasskey() {
  const { loadingPromise } = await signIn({ type: 'passkey', mode: 'signin', salt: 'maia.city' })
  const { node, account } = await loadingPromise
  registerOsSpark({ node, account })
  const maia = await MaiaOS.boot({
    node,
    account,
    modules: ['db', 'core', 'ai'],
    sparkRegistryKey: OS_REGISTRY_KEY,
  })
  renderApp(maia)
}
```

## License

MIT
