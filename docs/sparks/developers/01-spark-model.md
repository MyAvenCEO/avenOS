---
title: Spark model
---

# Spark model

- Table **`sparks`** — `spark_id`, `genesis_b64`, issuer keys, biscuit roots.
- Table **`keyshares`** — wraps DEKs for `recipient_did` under a spark. Column **`wrapper_did`** names the granter (genesis or delegated admin); unwrap uses `DH(recipient, wrapper)`, not always the genesis issuer.
- Encrypted rows carry **`spark_id`**; v1 uses a single admin-style role via biscuit `owns` facts.
