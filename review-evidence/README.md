> Historical baseline evidence: these probes assert defects at `1dc2cdc0` and are
> retained to explain the original verification. They are not the regression gate
> for the fixed worktree. See `DOCUMENT-INGEST-FIXES.md` at the repository root for
> the maintained regression tests and current validation results.

# Evidence for document ingest verification

These files support [the verification report](../DOCUMENT-INGEST-VERIFICATION.md)
at revision `1dc2cdc05f85b368aa89cf44355e441afc8f1091`. They are review artifacts,
not additions to the production test gate.

- [Reproduction source](reproduce.ts) and [observed output](reproductions.log).
- [Ingest tests](ingest-tests.log) and [TypeScript check](ingest-check.log).
- [App document tests](app-tests.log).
- [Facade artifact tests](facade-tests.log).
- [Runner tests](runner-tests.log); unconfigured persistence/live integrations skip.

After the repository dependencies and app generated configuration are prepared, run
the probes from the worktree root with `bun review-evidence/reproduce.ts`.
They assert the observed defects as well as repaired behavior, so they intentionally
need updating when fixes land. They use real source components and a fake Artifact
Store transport. The browser JPEG probe mocks only the unused browser PDF loader;
the oversized inspection probe supplies synthetic rendered images. They do not call
a model provider or deployed customer service.

The maintained build/test procedures remain in the
[operations handbook](../docs/operations/build-and-test.md).

## Chunking provider proof

The `real-model` directory contains synthetic fixture results and request receipts from
`qwen3.8-flash-next` through the production Qwen gateway on 2026-09-13. All four
provider cases passed: 160 exact statement rows across four pages (12 calls), six
invoice items with 19% VAT across two pages (6 calls), and all 70 manual markers including scanned
pages 67–70 in a PDF larger than 25 MiB (140 calls), and a 5,346,422-byte detailed
PNG through the authenticated facade (2 calls). Statement replay used a fresh
runtime and made no new calls. The manual remains `needs_review` because its kind is
outside finance; no chunk failed or went missing. The facade proof exercises the request reader as well as the real provider. All cases
use an in-memory
publication store. The separate platform gate includes a real-store chunking test
for 70 pages, 160 transactions, both publication adapters and replay.

An earlier statement run exposed two model-transcription duplicates. Extraction now
uses native PDF text where present; repeated explicit transaction IDs also block
complete chunk coverage. Equal-looking legitimate rows are retained.

Committed provider receipts omit the redundant `requestKey` hash, which the generic
secret scanner mistakes for an API credential. Provider request IDs, input digests,
implementation digests and usage remain available. No scanner rule is suppressed.

A repeated invoice run correctly held conflicting paraphrased payment terms for
review. The prompt now requires verbatim printed payment conditions; the final
fixture includes explicit terms and 19% VAT. Matching document-wide tax summaries
are retained once, while differing summaries remain a coverage conflict.
