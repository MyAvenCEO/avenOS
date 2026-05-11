# Security Guarantees

## Overview

`@avenos/self` provides passkey-based authentication with **zero secret storage**. All cryptographic secrets are derived on-demand from the passkey and **never** written to persistent storage.

## What's Stored in localStorage

**Location:** `localStorage['maia-account']`

**Contents (JSON):**
```json
{
  "accountID": "co_z...",       // PUBLIC - Account identifier
  "credentialId": "base64...",  // PUBLIC - Passkey credential ID
  "salt": "maia.city"           // PUBLIC - Salt for PRF derivation
}
```

### Why These Are Safe to Store

1. **accountID** - Public identifier, safe to share
2. **credentialId** - Public reference to passkey, can't be used without biometric
3. **salt** - Public salt value, deterministic across devices

## What's NEVER Stored

The following are **NEVER** written to any persistent storage:

- ❌ `AgentSecret` - Derived each session, wiped after use
- ❌ `SignerSecret` - Derived each session, wiped after use
- ❌ `SealerSecret` - Derived each session, wiped after use
- ❌ `PRF output` - Used immediately to derive secrets, then wiped
- ❌ Passkey private key - Stays in hardware (Secure Enclave/TPM)

## Security Properties

### Attack Scenarios

| Attack | Impact | Mitigation |
|--------|--------|------------|
| XSS reads localStorage | Gets ONLY public data | No secrets to steal |
| XSS reads memory | Gets ephemeral secrets | Secrets exist only during active session |
| Device theft | Physical access to device | Needs biometric to unlock passkey |
| localStorage dump | Full access to storage | All stored data is public |
| Malware keylogger | Records keyboard input | No passwords to steal |
| Shoulder surfing | Watches user input | Biometric auth, no visible secrets |

### Threat Model

**✅ Protected Against:**
- Secret storage attacks (XSS, localStorage inspection)
- Password-based attacks (phishing, keylogging, shoulder surfing)
- Device theft without biometric access
- Malware reading browser storage

**⚠️ Limited Protection:**
- Sophisticated malware with memory access (can steal ephemeral secrets during active session)
- Compromised hardware security module
- Physical coercion for biometric access

**❌ Not Protected Against:**
- User giving biometric access willingly
- Compromised Secure Enclave/TPM firmware
- Quantum attacks on underlying cryptography

## Validation Mechanisms

### 1. Pre-Storage Validation

Before writing to localStorage, the system validates:

```javascript
// Check key names for forbidden words
const forbiddenKeys = ['secret', 'agentSecret', 'signerSecret', 'sealerSecret', 'privateKey', 'seed'];

// Check only allowed keys are present
const allowedKeys = ['accountID', 'credentialId', 'salt'];

// Validate accountID format (must start with "co_z")
isValidAccountID(data.accountID);
```

### 2. Post-Retrieval Validation

After reading from localStorage, the system validates:

```javascript
// Verify structure integrity
if (!data.accountID || !data.credentialId || !data.salt) {
  // Clear and throw
}

// Double-check no forbidden keys
// (protects against storage tampering)
```

### 3. Runtime Inspection

Debug utility to inspect storage contents:

```javascript
import { inspectStorage } from '@avenos/self';

const report = inspectStorage();
// Returns: { hasAccount, accountID, credentialId, salt, securityCheck, warnings }
```

## Verification Steps

### Manual Verification (Browser DevTools)

1. Open DevTools → Application → Local Storage
2. Look for `maia-account` key
3. Verify contents:
   - ✅ Should contain: `accountID`, `credentialId`, `salt`
   - ❌ Should NOT contain: `secret`, `agent`, `signer`, `sealer`, `private`, `seed`

### Programmatic Verification

```javascript
// In browser console:
window.maia.auth.inspectStorage();

// Expected output:
{
  hasAccount: true,
  accountID: "co_z...",
  credentialId: "xyz123...",
  salt: "maia.city",
  securityCheck: "PASSED",
  warnings: []
}
```

## Secret Lifecycle

### Sign Up Flow

```
1. User triggers passkey creation
2. Browser prompts for biometric (Face ID / Touch ID)
3. Secure Enclave generates and stores private key
   └─> NEVER leaves hardware
4. PRF(salt) evaluated in Secure Enclave
   └─> 32-byte output returned to JS
5. AgentSecret derived from PRF output
   └─> Kept in memory
6. AccountID calculated from AgentSecret
   └─> Stored in localStorage (public)
7. PRF output wiped from memory
8. AgentSecret used to create account
   └─> Sent to cojson LocalNode
9. AgentSecret wiped after account creation
```

### Sign In Flow

```
1. User triggers sign-in
2. Load accountID from localStorage
3. Browser prompts for biometric
4. Secure Enclave evaluates PRF(salt)
   └─> NEVER leaves hardware
5. AgentSecret re-derived (same as before!)
6. AccountID re-calculated
7. Verify matches stored accountID
8. AgentSecret used to load account
9. AgentSecret wiped after account loaded
```

### Session End

```
1. User closes tab / signs out
2. All JS memory cleared (garbage collection)
3. AgentSecret destroyed
4. Only public metadata remains in localStorage
```

## Compliance

### GDPR Considerations

- **Personal Data**: AccountID is a pseudonymous identifier
- **Data Portability**: Account tied to passkey, portable via passkey sync
- **Right to Erasure**: Call `signOut()` to clear metadata
- **Data Minimization**: Only 3 fields stored (accountID, credentialId, salt)

### Security Best Practices

- ✅ Principle of least privilege (minimal storage)
- ✅ Defense in depth (multiple validation layers)
- ✅ Secure by default (no opt-out of security checks)
- ✅ Fail securely (clear storage on validation failure)
- ✅ Zero trust (validate on read AND write)

## Audit Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-01-15 | Initial implementation | Zero secret storage |
| 2026-01-15 | Fixed validation bug | Changed from value check to key check |
| 2026-01-15 | Added inspectStorage() | Debugging and verification |

## Contact

For security concerns or to report vulnerabilities, please open an issue with the `security` label.

## License

MIT
