---
title: Frontiers, explained like you're 12
---

# Frontiers, explained like you're 12

avenOS keeps your data alive on many places at once — your phone, your laptop, a
backup server, and even little caches *inside* the app (like the memory "brain").
None of them is the boss. They all have to agree on the truth **without arguing and
without ever losing anything you wrote** — even when they're offline for a while.

The trick that makes this work is called a **frontier**. This page explains it with
no jargon. If you remember one sentence, make it this:

> **A frontier is your bookmark. "What changed?" is just "what's past my bookmark?"**

---

## 1. The sticky-note diary (this is a CRDT)

Imagine everyone keeps a **diary made of sticky notes**. You never erase a note.
When something changes, you write a **new** sticky note that says:

- *what changed* ("todo #7 → done"), and
- *which note(s) came right before it* (its **parents**).

So the notes form a chain — actually a little **tree**, because two people can add a
note after the same earlier note at the same time.

```
        ┌── "buy milk"        (Note A)
A ──────┤
        └── "walk dog"        (Note B)   ← A and B both come after the start
```

Because every note carries *what* + *what-came-before*, any two diaries can be
**stacked together into one** and everyone ends up with the exact same story — no
matter what order the notes arrive in. That "you can always merge cleanly, no
fighting, nothing lost" property is what grown-ups call a **CRDT** (Conflict-free
Replicated Data Type). You don't need a referee. The rules do the refereeing.

In avenOS a "sticky note" is a **batch** (`StoredRowBatch`): it has a `batch_id`
(the note) and `parents` (the notes before it).

---

## 2. The frontier = the newest notes on top

Your **frontier** is the set of notes that have **nothing stacked on top of them
yet** — the *tips* of the tree. The little stack above has two tips: "buy milk" and
"walk dog".

Why care about the tips? Because if I tell you my tips, you instantly know **exactly
which notes I'm missing**: anything you have that doesn't lead down to one of my
tips. That's how two friends catch up fast: *"here are my tips"* → *"oh, you're
missing these three notes, here you go."*

That catch-up math has a name in the code: `frontier_diff` (what's missing) +
`pull_from` (hand them over). It's reliable — notes can arrive out of order, twice,
or after a long offline gap, and you still converge to the same story.

---

## 3. Branching & merging (two phones, no internet)

This is the part people think is scary. It isn't.

You're on a plane (no internet). You add **"call grandma"**. Meanwhile your laptop at
home adds **"pay rent"**. You've each grown your own branch of the tree:

```
phone:   … → "call grandma"
laptop:  … → "pay rent"
```

Plane lands, phone and laptop see each other. They swap the notes they're missing and
**stack both**:

```
both:    … → "call grandma"
              "pay rent"
```

Both todos are there. **Nothing was overwritten.** Neither device had to "win." That's
a **merge**, and it's automatic — just stacking sticky notes whose parents tell you the
order.

> **What if you both edit the *same* thing?** Say both devices rename todo #7. You get
> two notes that both say "#7's title is…". The CRDT rules pick one deterministically
> (so every device agrees on the result) — but **both notes are kept**, so nothing is
> ever silently lost and history is auditable.

---

## 4. The big idea: *every reader is a peer*

Here's the part avenOS leans on hardest.

Your phone catching up with your laptop is one example of "catch up from a bookmark."
But it's the **same move** for things *inside* one device too:

- The **database on disk** (RocksDB) is the one true shelf — the **single source of
  truth (SSOT)**.
- The **screen** (a list you're looking at) is a reader with a bookmark.
- The **memory "brain" cache** is a reader with a bookmark.
- **Another phone** is a reader with a bookmark.

They *all* stay fresh the exact same way: **"what changed since my bookmark?"** One
mechanism, not four. The database doesn't push updates and hope they arrive (that used
to drop messages when things got busy) — instead each reader **pulls** the delta from
its bookmark, so nothing is ever missed.

In the code this is one tiny call:

```
changes_since(my_bookmark)  →  (new_bookmark, [the rows that changed])
```

and a one-line gate to skip work when nothing moved at all:

```
frontier_epoch()  →  a number that ticks up every time anything is committed
```

If the number didn't move since last time, you're already up to date — do nothing.

---

## 5. Worked example: the memory brain (why your chat got fast)

The brain remembers everything you tell it, **encrypted on disk**. Decrypting is the
slow part. The naive way re-decrypted *every* memory on *every* question — that's why
recall once took ~65 seconds.

With the frontier bookmark it works like a librarian who already has the books open on
their desk:

1. **First question** — open (decrypt) all the memories once. Remember the bookmark.
2. **Next question, nothing new written** — `frontier_epoch()` hasn't ticked → serve
   straight from the desk. **Zero decryption.**
3. **You send a new message** — `changes_since(bookmark)` says *"one new memory."* The
   librarian opens **only that one book**, leaves the rest on the desk.

So a quiet turn costs nothing, and a busy turn costs only the *delta*. Same idea scales
to a hundred thousand memories: you never pay for what didn't change.

And crucially — a memory that synced in from your **other phone** ticks the same
`frontier_epoch` and shows up in the same `changes_since` delta. The brain doesn't care
*who* wrote it; it just catches up from its bookmark. **One mechanism for local writes
and synced writes alike.**

---

## 6. The mental model in one picture

```
                  ┌─────────────────────────────────────────┐
                  │   RocksDB on disk — the ONE true shelf    │
                  │   (the sticky-note tree / batch DAG)      │
                  └───────────────┬───────────────────────────┘
                                  │  "what changed since my bookmark?"
        ┌─────────────────┬───────┴────────┬────────────────────┐
        ▼                 ▼                │                     ▼
   the screen        the brain cache       │              another device
   (a list)          (decrypt-once)        │              (your laptop)
   bookmark:42       bookmark:42           │              bookmark:39
                                           ▼
                              every reader is a peer with a bookmark;
                              all catch up the same reliable way
```

- **One truth:** the frontier (the tree of batches on disk).
- **Many bookmarks:** each reader's position. A bookmark is *where you are*, never a
  second "truth."
- **One reconciliation:** `changes_since(bookmark)` → apply the delta → move your
  bookmark. Peers, the screen, and the brain cache all do exactly this.

That's the whole architecture. Sticky notes you never erase, bookmarks that tell you
what's new, and a rule that lets everyone merge without a boss and without losing a
word.

---

## Where this lives in the code

| Idea here | In avenOS |
|-----------|-----------|
| Sticky note (`what` + `parents`) | `StoredRowBatch` (`batch_id`, `parents`) |
| The tree of all notes | the batch DAG / `FrontierDag` |
| Tips of the tree | `FrontierDag::heads()` |
| "what's missing between us" | `frontier_diff` + `pull_from` (peer sync) |
| Your bookmark / "did anything move?" | `AvenDbClient::frontier_epoch()` |
| "what changed since my bookmark" | `AvenDbClient::changes_since(cursor)` |
| A reader applying the delta | the brain's read cache · the UI table drain · a remote peer |

For the nuts-and-bolts of the sync engine itself, see **[aven-db sync layer](01-aven-db-sync)**.
