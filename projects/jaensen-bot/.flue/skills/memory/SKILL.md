---
name: memory
description: Long-term memory storage and retrieval for facts, entities, and knowledge
---

# Memory Skill

This skill manages long-term memory storage. Memory is organized into **threads** (topic-based files) that accumulate knowledge over time.

## When to Use Memory

- Storing facts about people, companies, events
- Recording decisions and their context
- Querying accumulated knowledge
- Maintaining audit trails

## Memory Worker Lifecycle

### Long-Running Pattern
Memory workers are **long-running**. Each worker manages one thread (markdown file) and persists across multiple tasks.

### Spawning Rules
1. **New topic detected**: Spawn worker with topic specialty (e.g., "thread:people")
2. **Existing topic**: Route to existing worker for that thread
3. **Query without matching worker**: Spawn new worker to search across all threads

### Specialty Naming
- `thread:<topic>` - e.g., `thread:people`, `thread:companies`, `thread:events`
- `search` - special specialty for queries that span multiple threads

## Worker Capabilities

### `memory_read(query)`
Reads memory and returns matching content.

**Input:**
- `query`: Search string or topic

**Output:**
- Matching entries from relevant threads
- Source thread information

### `memory_write(content, topic?)`
Writes content to memory.

**Input:**
- `content`: The knowledge to store (markdown formatted)
- `topic`: Optional topic hint (e.g., "people", "companies")

**Output:**
- Confirmation with thread path

### `memory_search(entity)`
Cross-thread search for an entity.

**Input:**
- `entity`: Name or identifier to search

**Output:**
- All mentions across threads

## Thread Management

### Thread File Location
```
.flue/memory/<topic>.md
```

### Thread Format
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

### Thread Naming Conventions
| Topic | File | Examples |
|-------|------|----------|
| People | people.md | Alice, Bob Smith |
| Companies | companies.md | Acme Corp, Apple Inc |
| Events | events.md | Meetings, Decisions |
| Projects | projects.md | Project Alpha, Initiative X |
| Decisions | decisions.md | Strategic choices |
| Audit | audit.md | System events, changes |

## Injected Context

The Memory Skill Agent provides:
- Active thread workers (per specialty)
- Entry counts per thread
- Last activity timestamps
- Search results across threads

## Routing Logic

### Task: "store fact about X"
1. Analyze X to determine topic (person → people, company → companies)
2. Check if matching worker exists for that topic
3. If yes: route to existing worker
4. If no: spawn new worker for topic, then route

### Task: "what do you know about X"
1. Spawn search worker with entity X
2. Search across all thread files
3. Aggregate and return results

### Task: "remember this decision"
1. Route to "decisions" thread worker
2. If no worker exists, spawn one
3. Store with timestamp and context

## Max Workers
Default: 10 (one per major topic area)

## Direct Calls Not allowed
Memory workers can not be called directly by other skills (Ingest, Extract) without going through the Skill Agent.