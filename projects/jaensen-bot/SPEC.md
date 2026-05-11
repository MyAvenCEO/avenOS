# Jaensen Bot - Architecture Specification

## Overview

Jaensen is a multi-skill agent system built on Flue. It uses a dispatcher-worker pattern with "skill agents" that manage pools of specialized workers.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                              │
│  Role: Route incoming messages to the correct Skill     │
│  Input: User message                                    │
│  Output: Routing decision to Skill Agent                │
└───────────────────┬─────────────────────────────────────┘
                    │ POST /agents/<skill>/<id>
                    ▼
┌─────────────────────────────────────────────────────────┐
│  Skill Agent (per skill type)                           │
│  Role: Manage workers, decide routing within skill      │
│  Input: Task from dispatcher or human                   │
│  Output: Spawn worker, route to existing, or respond    │
└───────────────────┬─────────────────────────────────────┘
                    │ direct calls / child management
        ┌───────────┴───────────┐
        ▼                       ▼
   Worker Pool            Worker Pool
   (Skill-specific)       (Skill-specific)
```

## Core Components

### 1. Dispatcher

**File:** `.flue/agents/dispatcher.ts`

**Responsibilities:**
- Accept incoming webhook messages
- Determine which Skill Agent should handle the message
- Route to appropriate Skill Agent via HTTP POST
- Handle notifications TO the human

**System Prompt:** Minimal. Lists available skills and their purposes.

**No:** sandbox, tools, loops, long-running state.

### 2. Skill Agents

**Files:** `.flue/agents/<skill>.ts` (one per skill type)

**Responsibilities:**
- Manage pool of workers (spawn, track, remove)
- Decide: spawn new worker OR dispatch to existing
- Aggregate/combine results from workers
- Report completion back to dispatcher

**State:**
```typescript
interface SkillAgentState {
  activeWorkers: Map<string, WorkerInfo>;
  completedWorkers: WorkerInfo[]; // for audit log
}

interface WorkerInfo {
  id: string;
  status: 'running' | 'completed' | 'failed';
  specialty: string;        // e.g., "thread:people", "archive:pdf"
  createdAt: Date;
  lastUpdate: Date;
  result?: any;
}
```

**Injected Context:** Skill Agent can query actual worker states for routing decisions.

**SKILL.md:** Defines:
- When to spawn vs reuse workers
- How to match tasks to worker specialties
- Worker lifecycle management rules
- Result aggregation strategy

### 3. Workers

**Files:** Created dynamically by Skill Agents at runtime.

**Responsibilities:**
- Actually perform the specialized work
- Report status back to Skill Agent
- Clean up when complete

**Types:**

| Type | Lifecycle | Behavior |
|------|-----------|----------|
| Memory Worker | Long-running | Like a forum thread. Accumulates knowledge in a topic. |
| Ingest Worker | Short-lived | One-shot: download → register metadata → done |
| Extract Worker | Short-lived | One-shot: extract → store result → done |

### 4. Human Inbox

**Role:** External notification endpoint. Human reads, responds.

**Integration:** Dispatcher POSTs notifications to configured endpoint.

---

## Skills

### Memory Skill

**Skill Definition:** `.flue/skills/memory/SKILL.md`

**Concept:** Each Memory Worker is a "thread" that accumulates related knowledge.

**Worker Specialties:**
- Topic-based (e.g., "people", "companies", "events")
- Each worker manages one markdown file for its topic

**Worker Capabilities:**
- `memory_read(query)` → returns matching content
- `memory_write(content)` → appends to thread's file

**Storage:**
```
.flue/memory/
├── people.md      # All person-related knowledge
├── companies.md   # All company-related knowledge
└── events.md      # All event-related knowledge
```

**Skill Agent Rules:**
- On new knowledge: match to existing thread or spawn new one
- Thread naming: derived from content type/keywords
- Reuse existing thread if topic matches
- Max concurrent workers: 10 (configurable)

### Ingest Skill

**Skill Definition:** `.flue/skills/ingest/SKILL.md`

**Concept:** Downloads and archives documents from URLs.

**Worker Lifecycle:** Short-lived, one-shot.

**Worker Capabilities:**
- `download_file(url)` → fetch and store raw bytes
- `archive_blob(path, data)` → write binary to filesystem
- `register_metadata(archivePath, metadata)` → store metadata in Memory

**Workflow:**
1. Download document from URL
2. Store raw binary to filesystem
3. Extract known metadata (URL, timestamp, type, size)
4. Register metadata in Memory (via Memory Skill Agent)
5. Notify Dispatcher: "new document archived"

**Worker Specialties:**
- Content type handling (pdf, image, doc, etc.)
- Each worker type handles specific content types

### Extract Skill

**Skill Definition:** `.flue/skills/extract/SKILL.md`

**Concept:** Extracts structured data from archived documents.

**Worker Lifecycle:** Short-lived, one-shot.

**Worker Capabilities:**
- `read_archive(path)` → read raw binary
- `ocr_image(data)` → extract text from images
- `parse_pdf(data)` → extract text from PDFs
- `store_dossier(dossier)` → store in Memory

**Workflow:**
1. Receive archive path from Skill Agent
2. Read raw binary
3. Extract structured data (people, companies, relationships)
4. Store as "dossier" in Memory
5. Notify Dispatcher: "extraction complete"

**Worker Specialties:**
- Document type (pdf, image, email, etc.)
- Each worker handles specific extraction logic

---

## Communication Flows

### Flow 1: User adds knowledge to memory

```
1. User → Dispatcher: "Remember that Alice works at Acme"
2. Dispatcher → Memory Skill Agent
3. Memory Skill Agent → decides: existing "people" thread
4. Memory Skill Agent → Memory Worker (people): "store: Alice at Acme"
5. Memory Worker → writes to people.md
6. Memory Worker → reports: done
7. Memory Skill Agent → removes worker from pool
8. Memory Skill Agent → Dispatcher: ack
9. Dispatcher → User: done
```

### Flow 2: User ingests a document

```
1. User → Dispatcher: "ingest https://example.com/doc.pdf"
2. Dispatcher → Ingest Skill Agent
3. Ingest Skill Agent → spawns Ingest Worker
4. Ingest Worker → downloads, archives
5. Ingest Worker → registers metadata in Memory Worker (direct call)
6. Ingest Worker → reports: done, archivePath="/tmp/ingest/xxx.pdf"
7. Ingest Skill Agent → removes worker
8. Ingest Skill Agent → Dispatcher: "new document at /tmp/ingest/xxx.pdf"
9. Dispatcher → Extract Skill Agent: "process /tmp/ingest/xxx.pdf"
10. Extract Skill Agent → spawns Extract Worker
11. Extract Worker → reads archive, extracts data
12. Extract Worker → stores dossier in Memory Worker (direct call)
13. Extract Worker → reports: done
14. Extract Skill Agent → removes worker
15. Extract Skill Agent → Dispatcher: "extraction complete"
16. Dispatcher → Human: notification "New dossier created"
```

### Flow 3: Human responds

```
1. Human → Dispatcher: "Add that Alice is the CEO"
2. Dispatcher → Memory Skill Agent
3. ... (back to Flow 1)
```

---

## File Structure

```
projects/jaensen-bot/
├── SPEC.md
├── .env
├── .flue/
│   ├── agents/
│   │   ├── dispatcher.ts      # Main entry point
│   │   ├── memory.ts          # Memory Skill Agent
│   │   ├── ingest.ts          # Ingest Skill Agent
│   │   └── extract.ts         # Extract Skill Agent
│   ├── skills/
│   │   ├── memory/
│   │   │   └── SKILL.md       # Memory skill definition
│   │   ├── ingest/
│   │   │   └── SKILL.md       # Ingest skill definition
│   │   └── extract/
│   │       └── SKILL.md       # Extract skill definition
│   ├── models.ts              # Model registry
│   └── memory/                # Memory worker storage
│       ├── people.md
│       ├── companies.md
│       └── events.md
├── app.ts
├── flue.config.ts
├── package.json
└── tsconfig.json
```

---

## Skill Agent Base Pattern

All Skill Agents inherit from a base that provides:

```typescript
interface SkillAgent {
  // Worker management
  spawnWorker(specialty: string): WorkerHandle;
  getWorker(id: string): WorkerHandle | null;
  getWorkersBySpecialty(specialty: string): WorkerHandle[];
  removeWorker(id: string): void;
  
  // State access
  getActiveWorkers(): WorkerInfo[];
  getInjectedContext(): InjectedContext;
  
  // Lifecycle
  onWorkerComplete(workerId: string, result: any): void;
  onWorkerFailed(workerId: string, error: any): void;
}
```

---

## Injected Context Pattern

When a Skill Agent needs to make routing decisions, it computes context from actual worker states:

```typescript
function getInjectedContext(skillState: SkillAgentState): InjectedContext {
  return {
    workerCount: skillState.activeWorkers.size,
    workers: Array.from(skillState.activeWorkers.values()).map(w => ({
      id: w.id,
      specialty: w.specialty,
      status: w.status,
      lastUpdate: w.lastUpdate
    })),
    // Derived data
    threads: skillState.activeWorkers
      .filter(w => w.specialty.startsWith('thread:'))
      .map(w => ({
        id: w.id,
        topic: w.specialty.replace('thread:', ''),
        lastActive: w.lastUpdate
      }))
  };
}
```

This context is injected into the Skill Agent's prompt for LLM-assisted routing decisions.

---

## TODO

- [ ] Implement Skill Agent base class
- [ ] Implement Memory Skill Agent + workers
- [ ] Implement Ingest Skill Agent + workers
- [ ] Implement Extract Skill Agent + workers
- [ ] Implement Dispatcher
- [ ] Test full flows