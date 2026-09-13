# Invoice validation and facade memory proof

These follow-up fixes address the two severe issues verified after PR #254.
The source baseline is `98d9f108`; the tests use synthetic data only.

- Invoice validation previously reported `consistent` after a seventh row was
  copied into a six-row invoice. The new operation receives details, records
  `invoice-core-v2`, and requires review for a line-net discrepancy or missing
  amounts. It preserves legitimate repeated rows and signed credit/adjustment rows.
- Eight simultaneous 54,526,260-byte JSON requests killed the baseline facade
  inside its production 768 MiB container limit. The fixed facade completed two,
  returned 503 to six, and accepted six subsequent large requests. Peak container
  memory in the sustained proof was 457,908,224 bytes, with no OOM kill.

The memory files record the before/after container results. The fixture uses the
production HTTP handler and body reader with a deliberately stalled model transport;
it does not send synthetic image-sized strings to a provider. Reproduction commands
and prerequisites belong to the [build/test handbook](../../docs/operations/build-and-test.md).

The real-model files record `qwen3.8-flash-next` through the authenticated facade and
production document gateway on 2026-09-13. The two-page invoice passed in 39 seconds:
six items, net 600, tax 114, gross 714 minor units, and the new line-net check passed.
Adding a duplicate to that same provider result produced `insufficient-coverage`
with a failed line-net check. The detailed 5,346,422-byte PNG passed in 13 seconds. While the first real model
call was active, an overlapping request was rejected with 503. The next real call
was admitted after capacity was released.
As in the original proof, redundant request-key hashes are omitted from receipts;
provider IDs, input/implementation digests and usage remain. Publication storage in
these provider tests is in memory; the complete platform gate proves real-store
publication and application journeys separately.

Local regression results: document 110 passed (28 opt-in skipped), app 183 passed,
API 44 passed, customer-platform suites passed with opt-in persistence/live cases
skipped. Document, app, API and customer-platform type checks passed; documentation,
deployment checks and source/history secret scans passed. The follow-up PR carries
the complete CI result at the exact committed revision.

The memory budget bounds admitted request input, not every allocation made by the
process. The stress result proves this workload; it is not a universal heap bound.
Invoice row reconciliation detects monetary discrepancies, not every possible OCR
error or offsetting omission/duplication.
