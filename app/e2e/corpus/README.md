# Fictional 180-day, three-person retrieval corpus

This is a synthetic test environment, not customer data. Lena Weber runs a ceramics studio in Berlin, Sofía Morales runs an event-floristry business in Valencia, and Rowan Chen consults on data migration in Bristol. Their personal and business lives span 2026-01-01 through 2026-06-29. Each has a recurring circle of family, staff, customers, suppliers, lawyers, friends, and support employees. Contacts have roles, languages, relationships, and different writing habits. Informal messages may use a first name, surname, initials, fragments, slang, or minor spelling mistakes; formal financial and legal records remain precise.

The deterministic scaffold in [`persona-model.ts`](./persona-model.ts) supplies 180 daily snapshots per person, crowded Intent and chat histories, routine records, and protected dated decisions and corrections. Its routine entries are deliberately lighter than the model-written sources. [`enrich-with-qwen.ts`](./enrich-with-qwen.ts) writes five connected episodes per fortnight per person, 180 total. Each request gives Qwen the person's household and business canon, payments and providers, contact profiles and writing styles, the relevant Intent's dated conversation and linked sources as of that episode, recent events elsewhere in the person's life, and a continuity ledger from previous fortnights. The generator fixes dates, target Intents, source kinds, and follow-up dates before model generation. It validates the JSON shape, source kind, answer grounding, language, synthetic addresses, selected future-fact leaks, and weekday/date consistency. Its checkpoints permit a failed long run to resume; changing the prompt version invalidates them.

The 18 model-written source kinds cover emails, working documents, calendar entries, tasks, receipts, rail/event tickets, vouchers, bookings, posted transactions, online orders, returns, support conversations, legal drafts, invoices, payments, card statements, and bank statements. They include card last-four digits, online payment services, refunds, carrier claims, deposits, terms, references, and open issues. English, German, Spanish, and a Portuguese source appear in the corpus. Service brands may be real; people, their businesses, records, account labels, references, and email addresses are fictional. The files are clearly marked synthetic and have no purchasing, admission, payment, or legal effect.

From the repository root, use a trusted OpenAI-compatible endpoint and its exact `/v1/models` model ID:

```sh
LIVE_LLM_BASE_URL='http://model-host:8000' \
LIVE_LLM_MODEL='exact-model-id' \
bun app/e2e/corpus/enrich-with-qwen.ts
LIVE_LLM_BASE_URL='http://model-host:8000' \
LIVE_LLM_MODEL='exact-model-id' \
bun app/e2e/corpus/revise-with-qwen.ts
bun app/e2e/corpus/materialize-assets.ts
bun app/e2e/corpus/build.ts
bun test app/tests/persona-corpus.test.ts app/tests/enriched-persona-corpus.test.ts
```

Set `QWEN_PERIOD_COUNT=1` for a five-episode-per-person pilot. A full run stores 36 validated fortnight packets under `generated/qwen-packets/` and 180 episodes in `generated/qwen-episodes.jsonl`. `materialize-assets.ts` writes one native file per episode (`.eml`, `.ics`, `.md`, or `.html`), with relative paths and SHA-256 hashes in `asset-manifest.jsonl`. It also writes `financial-events.csv` as an index to the complete fictional financial source texts. `render-sample-pdfs.py` renders three selected legal records as PDF samples; render and inspect them before treating them as document artifacts.

`revise-with-qwen.ts` is a connected editorial pass over selected timeline contradictions and recycled sources. It gives Qwen a fixed dated story canon, the recurring contacts' writing styles, and adjacent records, while withholding the flawed target text. It validates required facts, prohibits known contradictions and future terms, checks answer spans against the source, and rejects repeated source prose. It checkpoints accepted groups and writes `qwen-revisions.jsonl`; the asset and corpus builders overlay these revisions on the original 180 episodes. This pass repairs identified arcs, not every possible documentary inconsistency.

`build.ts` merges model episodes with the scaffold and writes JSONL files for Intents, contacts, messages, artifacts, and daily snapshots, plus `manifest.json`. Messages and artifacts link to an Intent and date; snapshots show the selected Intent, eight recently touched Intents, new files, and active/waiting counts. Each episode adds a natural follow-up probe asked after its source date. The probe question is held out of the chat history. Its literal answer is in a source available by that day. Curated scaffold probes cover older and archived work, superseded prices or terms, cross-language emails, and explicit unknowns; `supersedesId` links old and revised documents.

For live-model checks, `LIVE_LLM_CORPUS=personas` asks six curated German, Spanish, and English source questions. `LIVE_LLM_CORPUS=persona-temporal` asks nine model-written follow-ups at their simulated dates, with later chat and documents withheld. `LIVE_LLM_CORPUS=persona-hard` asks eight adversarial but natural questions that combine dated cutoffs, superseded facts, negative evidence, similar people and references, and multi-document answers. The hard cases require up to three source reads and reject specific tempting future or unrelated facts. All modes run the application's chat turn loop against synthetic lookup tools. They do not load anything into a customer workspace or exercise production storage. Review model answers, tool calls, and failures in the evidence JSON. Model-generated records are checked for structure and selected contradictions, but human review is still needed before claiming documentary realism across every 180-day thread.

`LIVE_LLM_CORPUS=persona-breaking` adds a twelve-case breaking-point ladder with three cases each at hard, very-hard, extreme, and breaking difficulty. The ladder uses only facts already present in the dated corpus. It escalates from three-document reconciliation to repeated identical amounts, explicit source contradictions, arithmetic across billing periods, temporal authority decisions, and seven-document travel/entity alignment. The regression grader checks successful retrieval and a minimum number of distinct source documents. All twelve cases require a separate model assessment against fixed factual criteria withheld from the answering agent, alongside retrieval and forbidden-conclusion checks. Use the optional independent evaluator to avoid having Qwen grade itself. The judge records per-criterion evidence and reasoning. These checks can miss semantic errors or reject valid paraphrases; a passing count alone is not a correctness claim. Inspect the saved answers and source results, especially conflicting amounts, document status, and authority.

Set `LIVE_LLM_REPLAY_PATH` to an earlier evidence JSON to rerun grading over its exact model answers and tool traces without rerunning the answering agent. By default this reuses only rubric judgments bound to the exact question, answer, rubric, evaluator model and evaluator version. Set `LIVE_LLM_REGRADE_MODEL=true` to obtain fresh model judgments; missing or stale judgments cannot pass rubric-gated cases. This is useful when making the evaluator accept harmless formatting variants such as Unicode hyphens or amounts written without trailing decimals. The replay retains the original latency, tool results, completion diagnostics, and successful-source identities when present; older traces without those identities fail the updated evidence gate. It marks the evidence as `regraded-live-output`; it must not be used to change a missing or incorrect fact into a pass.

`live-hard-results-16-rounds.json` and `live-hard-results-32-rounds.json` are controlled comparisons using the same eight hard cases and model. They record strict answer checks and complete tool-call traces so completion gains can be separated from factual errors. The application ceiling is now 32 rounds; the older files retain the 8- and 16-round baselines.

The current document research harness shares exact source resolution, paged full text and indexed content search with the application. It records a source-checked working checklist and separately reviews the final answer. Truncation and failed verification remain explicit failures. Historical result files predate these controls and must not be compared as if they used the same rubric. See [build and test](../../../docs/operations/build-and-test.md) for bounds, cache behavior, live-run options and the browser scale benchmark.

## Independent and counterfactual checks

The optional independent fixture audit examines every documentary source for a persona
without seeing Qwen's answer. It checks both solvability and rubric fairness and verifies
its quotations against the source bodies. This caught an expectation that confused a
scheduled delivery window with proof of completed delivery; the rubric now preserves that
distinction.

`heldout-retrieval.ts` adds 27 hand-authored records and three frozen questions in English,
German and Spanish, embedded in the existing crowded persona archive. The cases reverse
important earlier outcomes: adjacent care bookings really do cover the trip after timezone
conversion; an explained card/voucher split really does reconcile the entire refund; and
an executed amendment really does replace the earlier wedding date while a separate capacity
permit remains pending. Contacts use first names, initials and varying levels of formality.
These records are deterministic challenge fixtures, separate from the generated life corpus.

The live runner exposes the production `workspace_search`/`workspace_read` surface and
retains the underlying adapter trace separately for regression grading. It checkpoints after
each case. Procedure and optional credential settings belong to the
[build-and-test handbook](../../../docs/operations/build-and-test.md).
