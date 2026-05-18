---
title: Sync gating
---

# Sync gating

For each `ObjectUpdated` payload, the gate reads the table and `spark_id` from row metadata. **`peers`** rows never forward. Catalogue frames pass through. Spark-scoped tables forward only when the target peer’s DID is in the biscuit admin set for that spark.
