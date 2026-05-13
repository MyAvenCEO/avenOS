---
id: invoice-extractor
description: Extracts a clearly defined set of information (defined by json-schema) from an invoice for further processing or memory. Doesn't store the information on its own, but just returns it as json.
worker_policy: durable
resources:
  fs:
    - .
  shell: true
---

