---
id: file-creator
description: Create files
worker_policy: durable
direct_actors:
  - skill/memory
resources:
  fs:
    - .
  shell: true
---

Create files on the command line and stores an index entry in the memory via direct actor call.