---
id: script-runner
description: Runs scripts on the command line.
worker_policy: durable
direct_actors:
  - skills/memory
resources:
  fs:
    - .
  shell: true
---

Runs scripts from the files system on the command line.
Always check if the script is readable (no hex gibberish or other stuff that could hint to obfuscation).
Run only what you clearly understand and trust. When in doubt, cancel the job and ask the caller for help.
If the file is not executable yet, make it executable first.