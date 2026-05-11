# Jaensen Bot — Simplified Architecture Spec

## Purpose

Jaensen is an LLM-first multi-agent system for handling inbound work such as email triage, document intake, memory building, and follow-up coordination.

The goal is **not** to hardcode workflows too early. The goal is to keep a clear agent hierarchy and durable state model while letting the LLM make most operational decisions.

This spec replaces the earlier overbuilt design.

---

## Design Principles

1. **Keep the hierarchy, remove the ceremony**
   - We still want Dispatcher → Intents → Skills → Workers.
   - But these are logical runtime roles inside one process, not a distributed microservice system.

2. **No HTTP between internal agents**
   - Internal agent-to-agent communication should be plain function calls and shared runtime state.
   - HTTP is only for external boundaries: webhook input, optional human inbox delivery, optional future APIs.

3. **Intent decides, code executes**
   - The dispatcher may help identify relevant intents or create a new one when needed.
   - But once an intent is engaged, the **intent is the actual decision maker** for how to bring the task forward.
   - The intent decides whether memory should be updated, whether ingest/extract should run, and whether a human must enter the loop.
   - Code should mainly provide:
     - state
     - tool execution
     - persistence
     - safety rails

4. **Durable but minimal state**
   - Intents, memory, and archives should persist.
   - Worker state can be lightweight and mostly ephemeral.

5. **Start small, tighten later**
   - Prefer generic interfaces and simple prompts now.
   - Add specialized routing heuristics only after repeated patterns emerge.

6. **Skill strategy lives in markdown, worker tactics live in the sandbox**
   - Skills should define their operating strategy in `SKILL.md`.
   - Workers should not contain hardcoded business workflows.
   - A worker should receive:
     - the intent context
     - the relevant skill markdown
     - the concrete task
     - access to a sandboxed bash environment with the right tools installed
   - The worker then executes the task tactically through the shell.

---

## Simplified System Architecture

```text
External Input
  │
  ▼
Dispatcher
  │
  ├─ consult active intents
  │
  ├─ ask LLM what this message means
  │
  ├─ update / create intent
  │
  └─ invoke one or more skills
        │
        ├─ Memory Skill
        ├─ Ingest Skill
        └─ Extract Skill
              │
              └─ optional lightweight workers

All of this runs in one process.
No internal HTTP.
```

---

## Runtime Model

Jaensen should run as a single runtime with four logical layers:

### 1. Dispatcher

The Dispatcher is the top-level entrypoint and router.

Responsibilities:
- receive incoming events/messages
- load relevant state
- decide which intent or intents are relevant, or whether a new one is needed
- hand control to the relevant intent
- return the intent's final result
- if a relevant intent requests human involvement, deliver that notification externally

Important note:
- The Dispatcher is **not** a rules engine.
- It is **not the operational decision maker**.
- It is a thin router and bootstrapper around state.

### 2. Intents

An Intent is a durable thread of attention around one topic.

Examples:
- “Order #12345 delayed shipment”
- “Invoice INV-2024-0420 review”
- “Project X competitor tracking”

Responsibilities:
- hold topic-level context
- keep event history
- summarize current state
- provide context back to the Dispatcher
- decide what should happen next for the topic
- choose which skills to use and in what order
- decide whether the topic requires human escalation or human review

An Intent is **not** a fully separate networked sub-agent. It is a persisted state object plus promptable context.
It is the primary decision-making unit in the system.

### 3. Skills

Skills are capability domains.

Initial skills:
- Memory
- Ingest
- Extract

Responsibilities:
- expose tool-like operations in their domain
- provide the strategic instructions for how work in that domain should be carried out
- spin up lightweight workers for specific tasks

Skills should not contain lots of policy logic. Their job is to perform actions chosen by the intent.
Their strategy should primarily come from the skill markdown, not from hardcoded branching in TypeScript.

### 4. Workers

Workers are optional task-scoped execution units.

They exist only when needed, for example:
- archive one URL
- process one attachment
- extract text from one file
- append one memory note

Workers are:
- local
- short-lived by default
- implementation details of a skill
- executed inside a sandbox with a bash terminal
- equipped with the tools needed for the current skill/task

The exception is memory threads, which may feel “long-running” conceptually, but can still be represented by persistent files plus lightweight operations rather than permanently running processes.

### Worker execution model

The worker is where tactical execution happens.

Each worker should receive:
- the intent context
- the relevant `SKILL.md`
- a concrete task description
- access to a sandbox abstraction

The sandbox abstraction should provide at least:
- a working directory
- a bash shell
- file read/write access within the sandbox boundary
- installed tools appropriate to the skill
- captured stdout/stderr and exit status

The worker should use the shell to carry out the task rather than relying on hardcoded TypeScript logic for the workflow itself.

Examples:
- an ingest worker may use shell tools to download, inspect, convert, and stage files
- an extract worker may use shell tools to parse text, run OCR, or transform documents
- a memory worker may use shell tools to format, merge, or inspect note files

The exact tactic is determined by the worker from:
- the skill markdown
- the intent context
- the task at hand

This keeps skills strategic and workers tactical.

---

## Communication Model

### Internal communication

Internal communication should be in-process only:

- Dispatcher calls Intent registry functions
- Dispatcher calls Skill functions
- Skills call Worker functions
- Skills return structured results to Dispatcher

Use simple TypeScript interfaces and objects, not HTTP.
When a worker is needed, the skill should invoke it through a sandbox abstraction, not by embedding lots of workflow logic in code.

### External communication

HTTP is allowed only for:
- webhook/event intake
- outgoing human notifications requested by an intent
- optional future public API endpoints
- downloading remote resources during ingest

This keeps the architecture coherent without pretending local components are remote services.

---

## Decision Flow

For each incoming message/event:

1. Normalize input
2. Load active intents and relevant memory/context
3. Match existing intent or create a new one
4. Hand control to the relevant intent
5. The intent decides what should happen next
6. The intent invokes selected skills
7. Record skill results back into the intent
8. The intent decides whether human involvement is needed
9. The intent produces the final user-facing response
10. If the intent requests it, the dispatcher sends a human notification
11. Persist updated state

The intent's LLM output should stay structured, but the available actions should remain broad and minimally prescriptive.

---

## Core Data Structures

### Dispatcher routing decision

```ts
interface DispatcherRoutingDecision {
  relevantIntentIds: string[];
  createIntent?: {
    title: string;
    summary: string;
  };
}
```

### Intent decision

```ts
interface IntentDecision {
  actions: Array<
    | { skill: 'memory'; operation: 'remember' | 'recall' | 'search'; input: Record<string, unknown> }
    | { skill: 'ingest'; operation: 'archive-url' | 'archive-attachment'; input: Record<string, unknown> }
    | { skill: 'extract'; operation: 'extract-text' | 'extract-entities'; input: Record<string, unknown> }
  >;
  humanLoop?: {
    needed: boolean;
    reason?: string;
    message?: string;
  };
  replyDraft: string;
}
```

### Intent

```ts
interface IntentRecord {
  id: string;
  title: string;
  summary: string;
  status: 'active' | 'pending' | 'resolved';
  createdAt: string;
  updatedAt: string;
  events: IntentEvent[];
  context: Record<string, unknown>;
  humanLoop?: {
    needed: boolean;
    reason?: string;
    message?: string;
  };
}

interface IntentEvent {
  timestamp: string;
  source: 'user' | 'system' | 'skill' | 'human';
  type: string;
  data: Record<string, unknown>;
}
```

### Skill result

```ts
interface SkillResult {
  skill: 'memory' | 'ingest' | 'extract';
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}
```

### Sandbox abstraction

```ts
interface Sandbox {
  run(command: string, options?: {
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;

  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

interface SandboxFactory {
  createSandbox(input: {
    skill: 'memory' | 'ingest' | 'extract';
    intentId: string;
    workerType: string;
  }): Promise<Sandbox>;
}
```

The runtime should depend on a sandbox abstraction so worker execution can later target:
- a local subprocess sandbox
- a container sandbox
- a VM sandbox
- a mocked sandbox for tests

### Storage abstraction

```ts
interface JaensenStorage {
  intents: IntentStore;
  memory: MemoryStore;
  archive: ArchiveStore;
}

interface IntentStore {
  listActive(): Promise<IntentRecord[]>;
  getById(id: string): Promise<IntentRecord | null>;
  save(intent: IntentRecord): Promise<void>;
}

interface MemoryStore {
  readTopic(topic: string): Promise<string | null>;
  appendTopicNote(topic: string, note: string): Promise<void>;
  search(query: string): Promise<Array<{ topic: string; snippet: string }>>;
}

interface ArchiveStore {
  put(item: {
    key?: string;
    content: Uint8Array;
    contentType?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ key: string }>;
  get(key: string): Promise<{
    content: Uint8Array;
    contentType?: string;
    metadata?: Record<string, unknown>;
  } | null>;
}
```

The runtime should depend on these interfaces, not directly on the local filesystem.

This allows:
- local filesystem storage in development
- in-memory storage in tests
- future blob/object/document storage backends
- easier simulation of edge cases and fixtures

---

## Intents: Simplified Semantics

Intents should be simpler than in the original spec.

### What an intent is
- a durable topic container
- a summary of what matters right now
- an event log
- a small bag of structured context

### What an intent is not
- not a separate server
- not a sandboxed loop by default
- not always “running”

### Intent lifecycle
- **active**: current topic being worked on
- **pending**: waiting on human/external input
- **resolved**: topic is complete but remains queryable

### Human loop ownership

Human escalation belongs to the intent layer, not the dispatcher.

- The dispatcher may route an event into one or more intents.
- Skills may return facts that suggest risk, ambiguity, or blocked progress.
- But only the relevant intent can conclude:
  - whether human review is needed
  - why it is needed
  - what the human should be told

This keeps human escalation grounded in topic-level context instead of one-off task output.

There may be multiple active intents at once. The dispatcher may associate one message/event with one or more relevant intents, and each such intent may update its own state. Human escalation must still come from intent-level judgment, never directly from a raw skill result or dispatcher shortcut.

### Intent matching

Use the LLM primarily.

The matching prompt should consider:
- title similarity
- recent events
- entities and IDs like order/invoice/project names
- sender/source context

Only keep very small helper heuristics if clearly useful, such as recognizing exact invoice/order IDs.

The important split is:
- dispatcher decides **where the event belongs**
- intent decides **what to do about it**

---

## Skills

### Memory Skill

Purpose:
- store durable notes
- retrieve relevant notes
- support intent context

Storage:
- markdown or JSON-backed topic files are fine for the default filesystem-backed store
- but the skill should depend on the `MemoryStore` abstraction rather than raw file APIs

Operations:
- remember(note, topic)
- search(query)
- read(topic)

The Memory Skill should be dumb and reliable. It should not decide *what* matters; the intent decides that.
The memory worker should still execute concrete operations through the sandbox/shell where appropriate.

### Ingest Skill

Purpose:
- archive external material for later use

Operations:
- archiveUrl(url)
- archiveAttachment(blob, metadata)

Responsibilities:
- fetch/store bytes
- assign stable archive paths
- return metadata

It should not try to infer too much domain logic.

It should depend on `ArchiveStore`, not directly on filesystem paths.
Its worker should use the sandbox shell for concrete document-handling steps.

### Extract Skill

Purpose:
- derive text or lightweight structured information from archived material

Operations:
- extractText(path)
- extractEntities(path)

Initially, this can stay minimal:
- text extraction for text-like files
- placeholder/fallback for unsupported binary types

More specialized extraction can be added later.

It should read through `ArchiveStore` so extraction is agnostic to the underlying storage backend.
Its worker should use the sandbox shell tactically, with extraction strategy guided by `SKILL.md`.

---

## Workers

Workers should be an implementation detail, not an architecture obsession.

Suggested rule:
- use a worker when a task has a clear unit of execution and result
- otherwise use a direct skill function

Examples:
- `IngestWorker(url)`
- `ExtractWorker(filePath)`
- `MemoryWriteWorker(note, topic)`

No worker pool management complexity is needed yet unless real concurrency pressure appears.

However, when a worker exists, it should behave like a shell-executing tactical unit rather than a blob of application logic.

---

## Example Flow

### Customer email about delayed order

1. Webhook receives email
2. Dispatcher normalizes the message
3. Dispatcher loads active intents and relevant memory
4. Dispatcher routes the event to the relevant intent, or creates one
5. Intent decides:
   - store a memory note
   - archive provided link if useful
   - whether human involvement is necessary
   - what the customer reply should be
6. Intent invokes Memory and Ingest skills
7. Those skills create workers as needed
8. Workers execute the concrete task in a sandboxed bash environment using the relevant `SKILL.md`
9. Skill results are recorded back into the intent
10. Dispatcher returns the intent's final reply
11. If the intent requested it, Dispatcher sends the human notification

No internal HTTP is involved anywhere in that flow.

---

## Why this is better than the previous spec

The previous spec had a good conceptual hierarchy, but it mixed that with a distributed-systems style execution model too early.

Problems in the old version:
- too much ceremony for local components
- HTTP between agents that live in the same app
- too many explicit lifecycle rules before patterns are known
- too much code dedicated to routing machinery instead of useful behavior

Benefits of this version:
- preserves the agent hierarchy
- removes fake microservice boundaries
- keeps the LLM at the center of decision-making
- keeps code mostly focused on tools and persistence
- remains easy to evolve later into more specialized sub-agents if needed

---

## Implementation Guidance

The next implementation should aim for:

### Required
- one Dispatcher runtime
- one Intent store
- three skills: Memory, Ingest, Extract
- one storage abstraction layer for intents, memory, and archives
- one sandbox abstraction for worker execution
- a default filesystem-backed storage implementation
- an in-memory test storage implementation
- a default local sandbox implementation
- a mocked sandbox for tests
- structured dispatcher outputs for routing
- structured intent outputs for action selection
- structured intent-level outputs for human-loop decisions
- final LLM response synthesis

### Optional
- lightweight worker wrappers
- human notification endpoint
- richer extraction logic

### Not needed yet
- internal HTTP between agents
- multiple running services
- complicated worker pools
- autonomous loops per intent
- lots of hardcoded routing rules

---

## Minimal File Structure

```text
projects/jaensen-bot/
├── SPEC.md
├── app.ts
├── flue.config.ts
├── package.json
├── tsconfig.json
└── .flue/
    ├── agents/
    │   └── jaensen.ts          # Dispatcher entrypoint
    ├── jaensen.ts              # Core runtime/orchestration
    ├── models.ts
    ├── sandbox/
    │   ├── types.ts            # Sandbox interfaces
    │   ├── local-sandbox.ts    # Default bash/subprocess implementation
    │   └── mock-sandbox.ts     # Test implementation
    ├── storage/
    │   ├── types.ts            # Storage interfaces
    │   ├── fs-storage.ts       # Default filesystem-backed implementation
    │   └── memory-storage.ts   # In-memory implementation for tests
    ├── runtime/
    │   ├── dispatcher.ts
    │   ├── intent.ts
    │   ├── worker.ts
    │   └── skills/
    │       ├── memory.ts
    │       ├── ingest.ts
    │       └── extract.ts
    ├── memory/                 # Used by fs-storage backend
    ├── archive/                # Used by fs-storage backend
    └── state/                  # Used by fs-storage backend
```

If separate skill files are added, they should still remain local modules, not network services.
If alternative storage backends are added, they should plug in through the storage interfaces rather than changing skill or intent logic.

---

## Final Summary

Jaensen should remain a **hierarchical agent system**, but implemented as a **simple in-process orchestrator**:

- Dispatcher = router/bootstrapper
- Intents = durable topic threads and the actual decision makers
- Skills = capability modules
- Workers = optional task-scoped helpers

The intent should make the operational decisions.
The code should stay small, durable, and boring.
Internal HTTP should not exist.