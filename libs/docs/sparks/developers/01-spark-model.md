---
title: Spark model
---

# Spark model

- Table **`sparks`** — `spark_id`, `genesis_b64`, issuer keys, biscuit roots.
- Table **`keyshares`** — wraps DEKs for `recipient_did` under a spark.
- Encrypted rows carry **`spark_id`**; v1 uses a single admin-style role via biscuit `owns` facts.
