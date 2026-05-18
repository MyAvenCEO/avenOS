---
title: Biscuits as source of truth
---

# Biscuits as source of truth

Groove ReBAC is not used for mesh peers: remote clients are registered as **`ClientRole::Peer`**. Instead, AvenOS wraps outbound `PeerTransport::send_to` with a **biscuit gate** — payloads are forwarded only if the destination DID is an **admin** (`owns`) for the spark inferred from the commit metadata.
