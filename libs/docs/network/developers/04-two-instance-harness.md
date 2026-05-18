---
title: Two-instance harness
---

# Two-instance harness

Use `scripts/dev-two-instances.ts` (or your usual two-window dev flow). The harness scopes each identity inside the normal AvenOS user root:

- `[A] avenAlice` → `~/Documents/.avenOS/avenAlice/{db,self}` on port `1420`.
- `[B] avenBob`   → `~/Documents/.avenOS/avenBob/{db,self}`   on port `1421`.

Reset both identities with `rm -rf ~/Documents/.avenOS/avenAlice ~/Documents/.avenOS/avenBob`.

On **each** instance:

1. Unlock identity and wait for Hyperswarm (`hyperswarm_up` in logs).
2. **Self → Peers & anchor** — Device A: *Invite*, Device B: *Accept* with the code + label → both show the peer as active.
3. **Self → Sharing** — On A, select the default spark → **Grant admin** and pick B’s DID from the paired allowlist.
4. Open todos (or any spark-scoped data) on either side; both should merge updates after sync. Non-admin sparks stay private.

If sync seems quiet, watch the dev log for `groove_p2p link up peer=...` (proves the swarm connection landed) and the periodic mesh reconcile (`peer-mesh reconcile`) — the app auto-registers each new peer with Jazz sync as soon as the swarm connects.
