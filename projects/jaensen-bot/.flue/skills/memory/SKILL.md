---
name: memory
description: Long-term memory storage and retrieval for facts, entities, and knowledge
---

# Memory Skill

This skill manages long-term memory storage. In the current implementation, memory is organized into topic-based markdown files under `.flue/memory/`.

## When to Use Memory

- Storing facts about people, companies, events
- Recording decisions and their context
- Querying accumulated knowledge
- Maintaining audit trails

## Current Runtime Reality

- Memory workers are **short-lived task executions** in a sandbox.
- There is **no persistent worker pool** yet.
- The actual durable state lives in storage, not in a long-running worker process.
- Supported operations are:
  - `remember`
  - `recall`
  - `search`

## Worker Capabilities

### `remember`
Append a note to a topic.

**Input:**
- `topic?`: Topic name. Falls back to the current intent title.
- `note?`: Note content. Falls back to `content` or the current intent summary.

**Output:**
- Confirmation that the note was stored
- The topic name

### `recall`
Read a topic file from memory.

**Input:**
- `topic?`: Topic name. Falls back to the current intent title.

**Output:**
- Topic content, if found

### `search`
Search memory files for matching content.

**Input:**
- `query?`: Search query. Falls back to the current intent title.

**Output:**
- Matching snippets from stored memory topics

## Storage Layout

### Thread File Location
```
.flue/memory/<topic>.md
```

### Topic Format
```markdown
---
thread: <topic>
updated: <date>
---

# <Topic Name>

## Entry - <date>
Content of the entry...

## Entry - <date>
More content...
```

## Notes

- Search is keyword-based and intentionally simple.
- There is currently no entity-specific indexing, worker specialty routing, or long-running memory agent.
- This skill is invoked only when selected by the intent.