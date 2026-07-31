# tauri-plugin-passkey — reference package

**This is documentation, not code.** Card 0121 stripped avenOS back to the
avenCITY seed and removed the auth stack; this file exists so passkeys can be
re-introduced without rediscovering the domain contract, which is the part that
takes a day to get right and five minutes to write down.

> **What was here before:** 2 394 tracked files, 115 MB, entirely
> `swift-lib/.build/` output — Swift build artifacts and vendored dependency git
> repos. **No source was ever committed.** The build output was deleted rather
> than kept, because compiled artifacts for a plugin whose source is missing are
> worse than nothing: they look like a package. If you need the original Swift
> bridge, it is not in this repo's history either — write it fresh against the
> contract below.

Kept alongside: `aven-os-app_iOS.entitlements`, the real entitlements file the app
shipped with.

## The one thing that makes passkeys hard in a native app

A passkey is bound to an **RP ID** (Relying Party ID) — a **domain**, chosen at
registration and unchangeable afterwards. The credential is scoped to it forever.

For a web app the RP ID is just the site's domain. For a **native Tauri app**
there is no domain, so Apple substitutes one: the OS looks up which domains your
app is allowed to claim, and only lets it use passkeys for those. That lookup is
the associated-domains mechanism, and it is why "passkeys don't work locally"
is nearly always a domain problem, never a code problem.

**You cannot use `localhost` as an RP ID for a native app.** There is no way to
serve a trusted association file for it. The working pattern is:

> Point the local app at a **deployed HTTPS origin** and use *that* as the RP ID.
> The app runs on your machine; the RP ID lives on a real domain.

avenOS did exactly this — the app ran locally against `api.next.aven.ceo`.

## The three things that must agree

Passkeys work when the RP ID, the entitlement and the AASA file all name the
**same domain**. Any mismatch fails, usually silently.

### 1. The entitlement — what the app claims

`aven-os-app_iOS.entitlements` (committed here). The `webcredentials:` entries are
the passkey ones; `applinks:` is Universal Links and is unrelated.

```xml
<key>com.apple.developer.associated-domains</key>
<array>
    <string>applinks:aven.ceo</string>
    <string>webcredentials:aven.ceo</string>
    <string>webcredentials:api.next.aven.ceo</string>
</array>
```

List **every** origin you will use as an RP ID, including staging. Adding one
later means a new provisioning profile and a reinstall.

Two gotchas that cost real time:

- **`gen/apple/` is gitignored**, so this file is a template that must be copied
  in after `tauri ios init`:
  ```bash
  cp app/src-tauri/ios-template/aven-os-app_iOS.entitlements \
     app/src-tauri/gen/apple/aven-os-app_iOS/aven-os-app_iOS.entitlements
  ```
- Toggling **Associated Domains** on the App ID **invalidates existing
  provisioning profiles**. Regenerate and re-download, or you get a signing error
  that says nothing about domains.

During development you can append `?mode=developer` to a domain
(`webcredentials:api.next.aven.ceo?mode=developer`) to make the OS fetch the AASA
**directly from your host** instead of Apple's CDN — which otherwise caches it for
up to 24 h and will happily serve you a stale file while you debug.

### 2. The AASA file — what the domain grants

Served at exactly:

```
https://<domain>/.well-known/apple-app-site-association
```

```json
{
  "webcredentials": {
    "apps": ["ABCDE12345.ceo.aven.os"]
  },
  "applinks": {
    "details": [
      { "appIDs": ["ABCDE12345.ceo.aven.os"], "components": [{ "/": "/link/*" }] }
    ]
  }
}
```

`ABCDE12345` is your **Team ID**; `ceo.aven.os` is the bundle identifier. The
format is `<TeamID>.<bundleID>` and it must match byte for byte.

Rules the file must satisfy — each one is a silent failure if broken:

| Rule | Why it bites |
|---|---|
| `Content-Type: application/json` | A `text/plain` response is ignored without an error |
| **No** `.json` extension in the path | The path is literal; `apple-app-site-association.json` is a different URL |
| **No redirect** — 200 directly | A 301 to `www.` fails; Apple does not follow it |
| Valid HTTPS, no client cert | Self-signed will not do |
| **Unsigned** plain JSON | The old signed (CMS) format is long deprecated |

Check it the way Apple does, not the way a browser does:

```bash
curl -sSL -D- -o/dev/null https://api.next.aven.ceo/.well-known/apple-app-site-association   # expect 200, no 30x
curl -sS https://api.next.aven.ceo/.well-known/apple-app-site-association | jq .webcredentials
```

### 3. The RP ID in code — what the app asks for

The server decides the RP ID; the client just talks to it. avenOS used Better
Auth's passkey plugin, so the client was only:

```ts
import { passkeyClient } from '@better-auth/passkey/client'
export const authClient = createAuthClient({
  baseURL: PUBLIC_BETTER_AUTH_URL,      // https://api.next.aven.ceo
  plugins: [adminClient(), passkeyClient()]
})
```

and the server set `rpID` to the **bare host** of that origin — `api.next.aven.ceo`,
no scheme, no port, no trailing slash. If the server's `rpID` and the entitlement's
`webcredentials:` host differ by so much as a subdomain, registration fails.

## Bringing it back

1. Decide the RP ID domain **first** — it is permanent for every credential
   registered against it.
2. Serve the AASA at that domain and verify with the two `curl`s above.
3. Put `webcredentials:<domain>` in the entitlements template, regenerate the
   provisioning profile, copy the template into `gen/apple/`.
4. Wire a WebAuthn server (Better Auth's passkey plugin was the previous choice)
   with `rpID` = that bare host.
5. Test on a **physical device** — passkey behaviour in the Simulator is not
   representative.

## See also

- `../tauri-plugin-biometric/README.md` — Secure Enclave device keys, the local
  half of the same identity story.
- `docs/deploy/ios-associated-domains-and-push.md` — the original notes, if still
  present after the strip.
