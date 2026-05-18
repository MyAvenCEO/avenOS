---
title: What stays private
---

# What stays private

Each spark uses its own DEK material. A peer who is only allowlisted but **not** an admin for spark X **cannot** decrypt X’s ciphertext — outbound sync is also gated so Groove does not fan out arbitrary rows to them.
