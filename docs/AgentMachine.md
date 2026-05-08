# Agent machine — universal resource transformation & composition

This document proposes a **minimal process calculus** for configuring **any** resource flow—physical, biological, digital, or mixed—on top of a **single structural primitive**: the **actor**. It complements [AgentArchitecture.md](./AgentArchitecture.md) (**Inbox · Process · Report** surface and JSON playground) and [AvenOS.md](./AvenOS.md) (product sketch).

**Claim:** “Factory,” “pipeline,” “composer,” and “orchestrator” collapse to the same shape once you strip domain nouns. What varies is **what flows on the wires** (ore, PDF bytes, water), not the **grammar** of coordination.

---

## 1. Single primitive: actor

An **actor** is the only node type:

```text
ACTOR = IN[]  →  FSM { stages[] }  →  OUT[]
```

| Part | Role |
|------|------|
| **`IN[]`** | Named ingress slots (resources, signals, references). |
| **`stages[]`** | Ordered (or guarded) **state machine**: each stage may run an internal mode, then coordinate with others via **ask · tell · hook**. |
| **`OUT[]`** | Named egress slots (products, side effects, reports). |

**Composition is not a separate primitive.** A “blast furnace,” “crafting table,” “OCR worker,” or “garden bed” is an actor. A “steel mill” or “document platform” is an actor whose stages **ask / tell / hook** other actors—those children are not special; they are peers in a graph.

---

## 2. External coordination: three verbs

How actors talk **to each other** (orthogonal to *how* a stage computes internally):

| Verb | Blocking? | Reply? | Typical use |
|------|-----------|--------|-------------|
| **`ask`** | Yes — stage does not advance until replies satisfy the wait policy | Expected | Pull inventory, demand-driven consume, **AND-join** when multiple |
| **`tell`** | No | No | Push product to downstream IN, broadcast, **fan-out** |
| **`hook`** | No — stage continues | Reply **later** triggers a callback / transition | Long sensors, weather, remote jobs, **OR-first** when multiple hooks race |

**Cardinality (`single` \| `multiple`) is not a new primitive:**

- **`ask` × multiple** → wait for all replies (**AND-join**) unless you define a policy variant (e.g. quorum).
- **`tell` × multiple** → **fan-out**; no join.
- **`hook` × multiple** → **race** (first reply wins) or **all** before callback, depending on declared policy—still only hooks, not a separate “OR-join node.”

**Serial vs parallel** falls out naturally:

- **Serial:** stage **`ask`**s B, then advances only when B’s reply arrives.
- **Parallel:** stage **`tell`**s B and C without waiting; a later stage **`hook`**s or **`ask`**s them when results matter.

There is **no special “sub-actor” type**: a parent stage that “spawns” a child is **`tell`** + **`hook`** / **`ask`** the child actor; the child does not need to know it is nested.

---

## 3. Internal execution: tool vs agent

Inside a stage, **two execution modes** cover deterministic and creative work:

| Mode | Meaning |
|------|---------|
| **`tool`** | Pure(ish) function: deterministic, versioned, auditable—**no model reasoning** in the loop. |
| **`agent`** | **LLM-driven loop**: model chooses among registered tools until a stop condition—“creative” path discovery. |

The **same tool definition** may be:

- Invoked **directly** by the FSM (deterministic stage), or  
- Exposed inside an **`agent`** loop for **dynamic** invocation.

So: **external** grammar = ask / tell / hook; **internal** grammar = tool \| agent.

---

## 4. Skill: memory of runs

A **skill** (in this doc’s sense) is **append-only telemetry** for an actor run—not the same word as “skill JSON” in the playground file name, but **aligned in spirit** (“how this actor was exercised”).

```yaml
skill_record:
  run_id: string
  actor_id: string
  trace:
    - stage_id: string
      execution: tool | agent      # which mode ran
      messages: []                  # ask / tell / hook payloads (refs)
      tool_calls: []               # if agent
      duration_ticks: number | null
      result_ref: string | null
  outcome: success | error | partial
```

**Why it matters:** captures **agent → pattern → tool** lifecycle: repeated traces show stable tool order and arguments → offline **eval** can promote a loop to a single **`tool`** stage. **Creative is early lifecycle; deterministic is hardened lifecycle**—not “better,” just **later**.

---

## 5. Time: tick

A **tick** is the **smallest time quantum the actor cares about**. It is **not necessarily global** across the graph; the runtime may convert at boundaries.

```yaml
tick:
  mode: realtime | simulated | event
  duration: number | null       # null → event-only / instant stage
  unit: ms | s | min | h | day | cycle | null
```

| Mode | Meaning |
|------|---------|
| **`realtime`** | Wall clock (sensors, SLA-bound APIs). |
| **`simulated`** | Game / fast-forward (e.g. Minecraft tick, “one tick = one game day”). |
| **`event`** | No clock; stage advances on **messages** only (typical digital pipelines). |

**`duration_ticks: null`** on a stage ⇒ completes in the **same** tick it started (instant transform).

---

## 6. End-to-end config recipe (canonical JSON shape)

Below is a **recommended top-level shape** for a universal **actor graph** config. Field names are illustrative; version and enforce validation in your control plane.

```json
{
  "version": "agent-machine/0.1-draft",
  "actors": {
    "window_assembler": {
      "id": "window_assembler",
      "in": ["glass_pane_slot", "iron_bar_slot", "craft_signal"],
      "out": ["window_item", "scrap"],
      "tick": { "mode": "simulated", "duration": 50, "unit": "ms" },
      "stages": [
        {
          "id": "gather_inputs",
          "run": { "tool": "recipe_match", "args": { "recipe_id": "minecraft:window" } },
          "coordination": {
            "ask": [{ "actor": "glass_pipeline", "slot": "pane_out", "cardinality": "single" }],
            "hook": [
              { "actor": "iron_pipeline", "slot": "bar_out", "policy": "first" }
            ]
          }
        },
        {
          "id": "assemble",
          "run": { "tool": "craft_emit", "args": { "recipe_id": "minecraft:window" } },
          "coordination": { "tell": [{ "actor": "output_chest", "in": "deposit" }] }
        }
      ]
    }
  },
  "edges": []
}
```

Notes:

- **`coordination`** per stage holds only **ask \| tell \| hook** (and policies for multiple).
- **`run.tool`** vs **`run.agent`** selects internal mode; **`run.agent`** includes `tools_allowed`, `stop_when`, etc., in a full schema.
- **`/board`** preset today is a **thin serial slice** of this: **Process** rows ≈ **tool** stages; **creative** rows ≈ **agent** or delegated **tell** to **child actor**; **Report** ≈ egress envelope to parent—see [AgentArchitecture.md](./AgentArchitecture.md).

---

## 7. Examples (same grammar, different resources)

### 7.1 Minecraft — **window** as higher-order composition

**Insight:** Minecraft is compositional crafting, not only smelting.

**Flow (conceptual):**

- **Parallel pipelines:** sand → glass → glass pane ║ iron ore → ingot → iron bar.  
- **AND-join:** both **pane** and **bar** at **window_assembler**.  
- **Universal crafting table actor:** same actor, **`recipe_id`** switches behavior—recipe rows are **data**, not new code.

Same shape as Aven’s recipe-driven resource graph: **actor = engine**, **recipe = config row**.

---

### 7.2 Real factory — steel line (abbreviated)

| Actor | Role |
|-------|------|
| **Stockyard** | Holds ore/coke inventories; answers **`ask`** for batch size. |
| **Blast_furnace** | **`hook`** temperature / coke quality; **`tool`** smelt ticks over **simulated** long duration; **`tell`** pig iron downstream. |
| **BOF / caster** | Serial **`ask`** for hot metal; **`tell`** slab |

**Consumed-at semantics** (physical fidelity): distinguish **batch** inputs (gone at stage start) from **flow** inputs (electricity/water each tick)—model as **slot metadata** on `IN[]`, not a new primitive.

---

### 7.3 Garden — grows with hooks

| Verb | Example |
|------|---------|
| **`hook`** | Weather actor, bee pollination **`OR`** wind—first satisfying reply advances fruiting stage. |
| **`ask`** | Irrigation valve when soil moisture threshold crossed (blocking planner). |

**Stages** may blend **`tool`** (sensor read) and **`agent`** (season planner LLM early; later distilled to **`tool`** from **skill** logs).

---

### 7.4 Digital — document digitalization pipeline

Stages (mostly **`event`** tick, **`duration_ticks: null`** for pure transforms):

1. Intake **`tell`** normalized queue.  
2. Serialize **`tool`** (convert → PDF/A).  
3. Clean / deskew **`tool`**.  
4. **`hook`** OCR (long-running); when callback arrives, **`tell`** classify + **`hook`** entity extract (**parallel**).  
5. **`ask`** DB mapper when both branches complete (**AND**).

Structurally analogous to steel: preprocessing chain → parallel enrichment → join → persist + **`tell`** notifier actors.

---

## 8. Mapping to AvenOS today (bridge, not contradiction)

| Agent machine | Playground / IPR ([AgentArchitecture](./AgentArchitecture.md)) |
|---------------|------------------------------------------------------------------|
| Actor | One **_sprite / agent boundary** + IPR shells |
| Stage `tool` | **deterministic** Process row (`toolName`) |
| Stage `agent` | **creative** row (inline LLM and/or delegated child) |
| `tell` to child `actor` | **`delegatesToChild`** / Report **tell→child** |
| `hook` join-back | **`join`** edge semantics / worker completion |
| `ask` to parent | **Report ask→parent** (up to Human root) |
| **Skill trace** | Future: persisted run logs; playground today is **static JSON + simulated lifecycle** |

---

## 9. Design rules to keep the schema honest

1. **No “composer” type** — only actors and typed **IN/OUT**.  
2. **No dedicated sub-actor** — graph + wait policies only.  
3. **Composition patterns are emergent** from **ask \| tell \| hook** + cardinality + policies.  
4. **Optimization path is named:** **agent discovers → skill records → eval promotes → tool crystallizes.**

---

## 10. Relation to exploratory HTML demos

Standalone HTML explorers (for example iterated “Actor v\*” demos) are **pedagogical UIs**. This file is the **normative condensation**: if a demo introduces a fourth coordination verb or a “special” composer node, treat it as **sugar** unless it folds back into **ask · tell · hook**.

---

### Open work (explicitly out of scope here)

- Schema **versioning** and **migration** from current `skill-playground-config`.  
- **Eval** pipeline that reads **skill** logs and emits **tool** patches.  
- **Policy algebra** for `ask` quorum / partial replies.  

When those land, extend **`version`** in section 6 and add a short **changelog** subsection.
