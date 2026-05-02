# AvenOS — Architecture Reference

---

## The Organisation

### Aven CEO GmbH

The company behind everything. A German GmbH. Builds and maintains AvenOS and the aven.ceo commercial product.

### AvenOS

The open-source operating system. The architecture described in this document. Anyone can run it, self-host it, and build on top of it. Free forever.

### aven.ceo

The commercial hosted product. AvenOS — fully managed.

aven.ceo is not a layer on top of AvenOS. It *is* AvenOS, plus everything around it:

- Hosted infrastructure — no setup required
- Backup and sync layer — your Aven's memory never lost
- Personalised hands-on training — your Aven learns your life deeply
- Managed updates — always running the latest AvenOS

### °Aven — your personal instance

Every human on aven.ceo gets their own **°Aven** — a personalised, custom-trained Aven instance living at their own subdomain and email:

```
°Aven Ted    →   ted.aven.ceo   /   ted@aven.ceo
°Aven Bob    →   bob.aven.ceo   /   bob@aven.ceo
°Aven Sarah  →   sarah.aven.ceo /   sarah@aven.ceo

```

The ° mark signals a live personalised instance — trained on one specific human's life, work, and preferences. Not a generic AI. Your twin.

### The full hierarchy

```
Aven CEO GmbH
  │
  ├─ AvenOS                        open-source OS — free, self-hostable
  │
  └─ aven.ceo                      commercial product — hosted AvenOS
        │
        ├─ °Aven Ted               ted.aven.ceo / ted@aven.ceo
        ├─ °Aven Bob               bob.aven.ceo / bob@aven.ceo
        └─ °Aven Sarah             sarah.aven.ceo / sarah@aven.ceo

```

---

## What is AvenOS?

You wake up in the morning. Before you even check your phone, your Aven has already reviewed your calendar, flagged a conflict in your afternoon meetings, noticed that the invoice you were waiting on finally arrived, cross-referenced it against your budget, and drafted a response for your approval.

By the time you make coffee, your day is already organised.

**Aven is your personal AI twin.** Not an assistant that waits for instructions. Not a chatbot that answers questions. A twin — an intelligence that knows your life, your work, your goals, and your preferences as deeply as you do. One that operates on your behalf, continuously, across everything.

Every human has their own Aven. It orchestrates your entire life — personal and professional — as a single unified operation.

Your emails. Your finances. Your health. Your projects. Your relationships. Your city simulation. All of it, managed by one intelligence that never sleeps, never forgets, and gets better at understanding you with every passing day.

---

## How does Aven actually do all of this?

Aven does not do everything itself. That would be like a CEO trying to personally handle every task in a company. Instead, Aven thinks strategically — it understands the big picture of your life — and delegates the actual work to specialists.

Those specialists are called **Workers**.

Workers are focused AIs. Each one is an expert at exactly one thing. There is a Worker that handles your calendar. One that monitors your finances. One that manages your project communications. One that runs your city simulation. One that tracks your health data.

Aven knows your life. Workers get things done.

---

## Everything is an Agent

Here is the most important idea in AvenOS:

**Aven and Workers are the same thing under the hood.**

Both are **Agents**. Every single entity in AvenOS — your personal Aven, the Worker managing your inbox, the Worker running your city's water simulation — is an Agent.

What makes them different is not what they *are* — it is what they *know how to do* and what *tools* they have access to.

Your Aven is an Agent whose skill is understanding and orchestrating your entire life. Your calendar Worker is an Agent whose skill is managing scheduling conflicts. Your water-simulation Worker is an Agent whose skill is simulating water flows in Maia City.

Same base. Different configuration.

---

## An Agent is a blackbox

From the outside, every Agent looks identical. It takes one input and produces one output.

```
Seed  →  [ Agent ]  →  Report

```

**Seed** — everything the Agent needs to start its job. The goal it has been given, and any relevant results from prior Agents.

**Report** — the compressed summary of what the Agent did, what it found, and how well it did. One Report per job. Always.

When your Aven asks a Worker to check your finances, it hands it a Seed. The Worker does its job inside the blackbox. Then it hands back a Report. Aven reads the Report and decides what to do next.

---

## Every Agent has six properties

No matter what kind of Agent — your personal Aven, a simple calendar Worker, a complex city-simulation Worker — they all share exactly the same six properties:

```
worker.context    ← what it's thinking about right now
worker.skill      ← what it knows how to do
worker.flow       ← the steps it takes to do it
worker.score      ← how it measures if it did it well
worker.memory     ← everything it has ever learned about you
worker.tools      ← the tools it is permitted to use

```

---

### worker.context — what it's thinking about right now

When an Agent wakes up to do a job, it is loaded with its Seed — the goal and any relevant prior results. All of that lives in the **context**.

The context is temporary. When the Agent finishes and sends its Report, the context is wiped. Next job, fresh start.

Think of it like a focused work session. You clear your desk, lay out everything you need for this specific task, do the work, then pack it away. The desk is empty again.

---

### worker.skill — what it knows how to do

A Skill is the Agent's expertise — how it approaches its specific type of job.

Your finance Worker's Skill describes exactly how to review your accounts: which data to pull, what patterns to look for, how to flag anomalies, what format to report in.

Skills are not fixed. Every time an Agent does its job, it looks for a better way. If it finds one, the Skill is updated. The Skill is always the current best known approach — versioned as a **Generation**.

---

### worker.flow — the steps it takes

The Flow is the Skill in motion — the actual sequence of steps the Agent executes, each step using a specific Tool from `worker.tools`.

```
worker.flow for your finance Worker:
  Step 1: read_accounts()         → current balances
  Step 2: compare_to_budget()     → variance analysis
  Step 3: detect_anomalies()      → flag unusual transactions
  Step 4: score_run()             → measure completeness
  Step 5: emit Report

```

---

### worker.score — how it measures success

Every Agent has exactly **one Score** — a single number that measures how well it did its job. Defined inside the Skill. Computed automatically at the end of every job. Always included in the Report.

```
finance Worker          → anomaly detection coverage    ↑ higher better
calendar Worker         → conflict resolution rate      ↑ higher better
database-write Worker   → write latency ms              ↓ lower better
water-simulation Worker → anomaly detection recall      ↑ higher better

```

This is how your Aven knows which Workers are improving, plateauing, or need a new approach.

---

### worker.memory — everything it has ever learned about you

The Memory is the Agent's permanent knowledge store. Unlike the context — which resets every job — the Memory never resets. It accumulates across your entire relationship with that Agent.

Memory is organised like a personal library:

```
worker.memory
  └─ Type: facts | discoveries | events | preferences | advice
        └─ Concept  (named topic — e.g. "morning-routine", "Q3-budget")
              └─ Summary  (short digest — what gets searched)
                    └─ Source  (the full original — every word, unchanged)

```

**Types** are the categories of knowledge:

- `memory.facts` — things confirmed true right now about you and your world
- `memory.discoveries` — patterns found about how you work and live
- `memory.events` — a log of everything that has happened
- `memory.preferences` — how you like things done
- `memory.advice` — solutions and approaches worth keeping

**Concepts** are named topics — "morning-routine", "invoice-handling", "Q3-budget". The same Concept can appear across multiple Types.

**Summaries** are short, fast, searchable digests. **Sources** are the full verbatim originals — fetched only when exact detail is needed.

Memory loads in four layers:

```
L0  Identity        always loaded   (~50 tokens)   who this Agent is
L1  Facts           always loaded   (~120 tokens)  current ground truth
L2  Concept Recall  on demand       scoped search  recent relevant context
L3  Deep Search     on demand       full scan       anything ever stored

```

---

### worker.tools — what it is permitted to use

The Tools array defines exactly which capabilities this Agent is permitted to call. Nothing outside this list is accessible.

It follows the standard OpenAI / Anthropic function calling schema — a JSON array of tool definitions:

```json
worker.tools = [
  {
    "name": "read_accounts",
    "description": "Read current account balances and transactions",
    "parameters": {
      "type": "object",
      "properties": {
        "account_ids": { "type": "array", "items": { "type": "string" } },
        "date_range":  { "type": "string" }
      }
    }
  }
]

```

`worker.tools` is provisioned by Aven at dispatch time. This is the permission boundary — it is what makes Workers safe, bounded, and predictable. A finance Worker cannot touch your calendar. A calendar Worker cannot read your accounts. Each Agent operates only within the scope Aven has explicitly granted.

---

## Two types of Agent

Every Agent shares the same six properties. The only meaningful distinction is configuration:

**Aven-type Agent** — provisioned with a strategic Skill and orchestration Tools. Thinks about the big picture, decides what needs to happen, dispatches Workers. Never does the work itself.

**Worker-type Agent** — provisioned with a bounded domain Skill and domain-specific Tools. Executes one specific type of task reliably and improves at it over time.

```
Agent type: Aven
  worker.skill  = strategic orchestration
  worker.tools  = [spawn_agent, invoke_agent, read_report, memory_traverse, ...]

Agent type: Worker
  worker.skill  = bounded domain routine
  worker.tools  = [domain-specific tools, memory_write, memory_search, kg_add, ...]

```

An Aven is not a special class — it is just an Agent whose Skill happens to be strategic.

---

## How information flows

Agents do not talk to each other directly. All information flows through Aven.

When a Worker finishes it emits a Report. The Report goes to Aven. Aven reads it, decides what to do next, and dispatches the next Worker — seeding it with the prior Report so it starts with that knowledge already loaded.

```
Aven
  └─► Worker W1
        Seed: []
        → Report R1

  └─► Worker W2
        Seed: [R1]
        → Report R2

  └─► Worker W3
        Seed: [R1]
        → Report R3

Aven reads R1 + R2 + R3 → decides next dispatch

```

Aven can dispatch multiple Workers in parallel. It receives all their Reports and replans. This loop — dispatch, receive Reports, replan, dispatch again — is the heartbeat of AvenOS. No fixed plan upfront. Decomposition emerges from the loop as Reports come in.

---

## Relations — how your life connects

Your life is not a set of isolated domains. Your finances affect your projects. Your health affects your calendar. **Relations** connect these — named directional links between Concepts across different Workers' memories.

```
Worker:finance / Concept:Q3-budget
        "constrains"
Worker:projects / Concept:maia-city-expansion

Worker:health / Concept:sleep-patterns
        "affects"
Worker:calendar / Concept:morning-productivity

```

When your Aven searches deeply across your life, it traverses these Relations — seeing not just isolated facts, but how everything connects.

---

## Intent — you are always in control

AvenOS is not fully autonomous. Aven recognises when it has hit a decision that is yours to make — a strategic tradeoff, an approval, a judgment call that requires your taste.

When that happens, Aven pauses and comes to you. Your input — **Intent** — lands directly in Aven's `worker.context` and shapes everything it does next.

Intent also starts everything. When you tell your Aven what you want, that is Intent. Aven translates your words into action, dispatches the right Workers, and brings back a synthesised result.

```
You → Intent → Aven worker.context → dispatch Workers → Reports → back to you

```

---

## The full picture

```
You
  │ Intent: "How is my week looking?"
  ▼
°Aven Ted  (Agent type: Aven)
  worker.context  ← your goal + incoming Reports
  worker.memory   ← your life — decisions, patterns, history
  worker.tools    ← [spawn_agent, invoke_agent, read_report, ...]
  │
  ├─► Calendar Worker     Seed: [Intent]  →  Report: "3 conflicts, Tuesday overloaded"
  ├─► Finance Worker      Seed: [Intent]  →  Report: "Invoice arrived, Q3 on track"
  ├─► Health Worker       Seed: [Intent]  →  Report: "Sleep average down this week"
  └─► Projects Worker     Seed: [Intent]  →  Report: "Maia City tick 47 ready to run"

°Aven Ted synthesises all four Reports
Writes key findings to own worker.memory
Returns to you:

"Your Tuesday is overloaded — I'd suggest moving the 3pm call.
 The invoice from last month arrived, Q3 budget looks healthy.
 Your sleep has been shorter this week — want me to protect Friday morning?
 Tick 47 is ready whenever you are."

```

---

## Primitive Reference


| Primitive              | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| **Agent**              | The universal base unit — everything is an Agent                        |
| **Agent type: Aven**   | Your personal AI twin — strategic, orchestrates your whole life         |
| **Agent type: Worker** | A specialist Agent — executes one domain reliably and improves          |
| **°Aven [Name]**       | A live personalised Aven instance — [name].aven.ceo / [name]@aven.ceo   |
| **Seed**               | The input to an Agent — goal + any prior Reports                        |
| **Report**             | The output of an Agent — results + Score + new Skill generation         |
| **Intent**             | Your input to Aven — at task start or when Aven needs your judgment     |
| **worker.context**     | Active working memory — resets every dispatch                           |
| **worker.skill**       | Living expertise — evolves across Generations                           |
| **worker.flow**        | Sequential steps executing the Skill                                    |
| **worker.score**       | Single metric measuring job quality — computed every run                |
| **worker.memory**      | Permanent structured knowledge — never resets                           |
| **worker.tools**       | Scoped tool definition array — OpenAI/Anthropic function calling schema |
| **Memory Type**        | facts / discoveries / events / preferences / advice                     |
| **Concept**            | Named topic within a Memory Type                                        |
| **Summary**            | Compressed digest — what gets searched                                  |
| **Source**             | Verbatim original — fetched when exact detail needed                    |
| **Relation**           | Named directional link between Concepts across Workers                  |
| **Generation**         | Versioned Skill snapshot — updated when Agent improves                  |


---

## Maia authoring and migrate runner (MaiaOS monorepo)

Authoritative authored Maia seed JSON (`factories`, `actors`, `brand`, `vibes`, `data`, …) lives in **`libs/universe/src/avens/maia/seed/`**. Applying new environments uses the migrate runner under **`libs/universe/src/avens/maia/`** with this chain: **`001-genesis`** → **`002-factories`** → **`003-sparks`** → **`004-actors`** → **`005-vibes`**. After editing any of those `.json` files, run **`bun run migrate:registry`** from the repo root so the generated registry slices stay aligned.

---

## Product & Brand Reference
|                     |                                                                |
| ------------------- | -------------------------------------------------------------- |
| **Aven CEO GmbH**   | The company — German GmbH                                      |
| **AvenOS**          | Open-source operating system — free, self-hostable             |
| **aven.ceo**        | Commercial hosted product — AvenOS + infrastructure + training |
| **°Aven [Name]**    | Personalised Aven instance on aven.ceo                         |
| **[name].aven.ceo** | Web endpoint for a personalised Aven                           |
| **[name]@aven.ceo** | Email identity for a personalised Aven                         |


