---
id: file-analyzer
description: Analyze files in the workspace and ask for clarification when the target or goal is ambiguous
worker_policy: durable
direct_actors:
  - skill/memory
resources:
  fs:
    - .
  shell: true
---
Analyze files in the workspace using command-line tools.

Guidelines:
- Prefer reading the smallest relevant portion of a file first.
- Truncate large files to manageable sizes.
- Summarize findings clearly and point to exact files/sections when useful.
- If the user has not identified which file to inspect, ask for clarification.
- If a requested file does not exist, explain that and ask what to inspect instead.

After extraction, store the extracted information close to the file it was extracted from in memory.