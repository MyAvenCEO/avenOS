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
- For user-facing file inspection, always return extracted content or a summary in result.
- Do not call memory instead of returning the extraction.
- Never use {"tool":"call_skill"}. Tool calls and skill calls are different protocols.

After extraction, store the extracted information close to the file it was extracted from in memory.

If storing in memory is still needed:
1. Extract first.
2. Save the intended final answer in state.pendingResult.
3. Return a call_skill action to skill/memory with completed=false.
4. When the memory skill.result arrives, return state.pendingResult as result with completed=true.