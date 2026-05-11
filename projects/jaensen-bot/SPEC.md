# Jaensen Bot - Architecture Specification

## Overview

Jaensen is a multi-skill agent system built on Flue. It uses a dispatcher-intent-worker pattern with "skill agents" that manage pools of specialized workers. Intents track topics across the system.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Dispatcher                                              │
│  Role: Route messages to Intent or Skill                │
│  - Notify Intents on every event                        │
│  Input: User message, worker reports, human responses   │
│  Output: Routing decisions, notifications               │
└───────────────────┬─────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌───────────────┐      ┌─────────────────┐
│   Intent 1    │      │    Intent 2     │
│ "Project X"   │      │ "Billing Issue" │
│ long-running  │      │ long-running    │
│ sub-agent     │      │ sub-agent       │
└───────────────┘      └─────────────────┘
        │                       │
        │  routes to skill      │
        ▼                       ▼
┌─────────────────────────────────────────────────────────┐
│  Skill Agents (Memory, Ingest, Extract)                 │
│  - Manage workers                                       │
│  - Report back through Dispatcher                       │
│    (Dispatcher notifies relevant Intent)                │
└─────────────────────────────────────────────────────────┘
        │
        │ direct calls
        ▼
┌─────────────────────────────────────────────────────────┐
│  Workers (Memory Workers, Ingest Workers, Extract)      │
└─────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Dispatcher

**File:** `.flue/agents/dispatcher.ts`

**Responsibilities:**
- Accept incoming webhook messages
- Determine routing: Intent OR Skill Agent
- Notify relevant Intents on every event (worker completion, human response, etc.)
- Route to appropriate Skill Agent via HTTP POST
- Handle notifications TO the human

**System Prompt:** Minimal. Lists available skills and intents.

**No:** sandbox, tools, loops.

### 2. Intents

**Files:** `.flue/agents/intents/<id>.ts` (one per active topic)

**Concept:** Intents track one topic/problem/task the human is interested in. They are long-running sub-agents that stay informed about all events related to their topic.

**Responsibilities:**
- Track one topic from creation to resolution
- Log all events related to the topic
- Maintain context and summary
- Influence routing decisions via dispatcher
- Respond to dispatcher queries about state

**State:**
```typescript
interface Intent {
  id: string;
  userId: string;
  topic: string;           // "Project Alpha", "Billing Issue #123"
  summary: string;         // Current understanding of the topic
  status: 'active' | 'pending' | 'resolved';
  events: IntentEvent[];   // Full history of events
  context: {
    relevantWorkers: string[];    // Worker IDs working on this intent
    relevantSkills: string[];     // Skills involved
    humanPreferences: Record<string, any>;
  };
}

interface IntentEvent {
  timestamp: Date;
  source: 'user' | 'worker' | 'human' | 'system';
  type: string;            // 'task_submitted', 'task_complete', 'user_message', etc.
  data: any;
  routedVia: 'dispatcher' | 'skill' | 'direct';
}
```

**Lifecycle:**
- Created: When user starts a new topic or dispatcher detects new intent-worthy content
- Active: Receiving events, influencing routing
- Pending: Awaiting human input or external resolution
- Resolved: Topic closed, archived for reference

**Intent Matching:**
1. **Explicit**: User mentions intent ID or topic keyword
2. **Contextual**: Dispatcher LLM analyzes message, matches to active intent topics
3. **Correlation**: Events from related workers/skills are routed to same intent

### 3. Skill Agents

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

### Flow 1: User adds knowledge to memory (with Intent tracking)

```
1. User → Dispatcher: "Remember that Alice works at Acme"
2. Dispatcher → Intent Matching
   - Matches to Intent "Project Alpha" (ongoing project tracking)
3. Dispatcher → Intent "Project Alpha": notify event
   - Intent logs: user_message, stores context
4. Dispatcher → Memory Skill Agent
5. Memory Skill Agent → decides: existing "people" thread
6. Memory Skill Agent → Memory Worker (people): "store: Alice at Acme"
7. Memory Worker → writes to people.md
8. Memory Worker → reports: done
9. Memory Skill Agent → removes worker from pool
10. Memory Skill Agent → Dispatcher: ack
11. Dispatcher → Intent "Project Alpha": notify event
    - Intent logs: memory_write_complete
12. Dispatcher → User: done (with Intent context)
```

### Flow 2: User ingests a document (with Intent tracking)

```
1. User → Dispatcher: "ingest https://example.com/doc.pdf"
2. Dispatcher → Intent Matching
   - Matches to Intent "Project Alpha"
3. Dispatcher → Intent "Project Alpha": notify event
   - Intent logs: ingest_requested
4. Dispatcher → Ingest Skill Agent
5. Ingest Skill Agent → spawns Ingest Worker
6. Ingest Worker → downloads, archives to /tmp/ingest/xxx.pdf
7. Ingest Worker → registers metadata in Memory Worker (direct call)
8. Ingest Worker → reports: done
9. Ingest Skill Agent → removes worker
10. Ingest Skill Agent → Dispatcher: "new document at /tmp/ingest/xxx.pdf"
11. Dispatcher → Intent "Project Alpha": notify event
    - Intent logs: document_ingested, stores archive path
12. Dispatcher → Extract Skill Agent: "process /tmp/ingest/xxx.pdf"
13. Extract Skill Agent → spawns Extract Worker
14. Extract Worker → reads archive, extracts "Apple Inc" dossier
15. Extract Worker → stores dossier in Memory Worker (direct call)
16. Extract Worker → reports: done
17. Extract Skill Agent → removes worker
18. Extract Skill Agent → Dispatcher: "extraction complete"
19. Dispatcher → Intent "Project Alpha": notify event
    - Intent logs: extraction_complete, stores dossier reference
20. Dispatcher → Human: notification "New dossier created from doc.pdf"
    - Human can review and respond
```

### Flow 3: Human responds to notification

```
1. Human → Dispatcher: "Looks good, but add that Alice is the CEO"
2. Dispatcher → Intent Matching
   - Matches to Intent "Project Alpha"
3. Dispatcher → Intent "Project Alpha": notify event
   - Intent logs: human_response, updates context
4. Dispatcher → Memory Skill Agent
5. ... (Memory flow continues)
6. Dispatcher → Intent "Project Alpha": notify event
    - Intent logs: memory_updated
7. Dispatcher → Human: response
```

### Flow 4: User follows up on existing topic

```
1. User → Dispatcher: "What do we know about Apple in Project Alpha?"
2. Dispatcher → Intent Matching
   - Matches to Intent "Project Alpha" (explicit topic mention)
3. Dispatcher → Intent "Project Alpha": query state
   - Intent responds with summary + relevant context
4. Dispatcher → Memory Skill Agent: "query Apple"
5. Memory Skill Agent → Memory Worker: "query Apple"
6. Memory Worker → returns: Apple Inc dossier
7. Memory Skill Agent → Dispatcher: results
8. Dispatcher → Intent "Project Alpha": notify event
9. Dispatcher → User: "Apple Inc dossier: Alice is CEO..."
```

### Flow 5: Worker completion notifies Intent

```
1. Extract Worker → reports to Dispatcher
2. Dispatcher → matches to Intent "Project Alpha" (via context)
3. Dispatcher → Intent "Project Alpha": notify event
   - Intent logs: worker_complete, updates summary
4. Dispatcher → Human: notification
5. Human may respond → Flow 3
```

---

## File Structure

```
projects/jaensen-bot/
├── SPEC.md
├── scenarios/                  # Step-by-step scenario walkthroughs
│   ├── customer-email.md
│   ├── invoice-processing.md
│   └── knowledge-base.md
├── .env
├── .flue/
│   ├── agents/
│   │   ├── dispatcher.ts      # Main entry point
│   │   ├── memory.ts          # Memory Skill Agent
│   │   ├── ingest.ts          # Ingest Skill Agent
│   │   ├── extract.ts         # Extract Skill Agent
│   │   └── intents/           # Intent agents (created dynamically)
│   │       └── README.md      # Intents are runtime entities
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

- [ ] Implement Intent base class
- [ ] Implement Intent registry (persistence + matching)
- [ ] Implement Skill Agent base class
- [ ] Implement Memory Skill Agent + workers
- [ ] Implement Ingest Skill Agent + workers
- [ ] Implement Extract Skill Agent + workers
- [ ] Implement Dispatcher with intent notification
- [ ] Create scenario walkthroughs
- [ ] Test full flows