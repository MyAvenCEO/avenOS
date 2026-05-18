---
title: Allowlist storage
---

# Allowlist storage

Rows live in Groove table **`peers`** but inserts set **NoSync** metadata so commits are not forwarded over P2P. Policy is local to each device; authorization to *read* another device’s encrypted sparks still flows from **biscuits** and **keyshares**, not from this table.
