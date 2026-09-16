# Find documents and their extracted information

The **Artefakte** view opens on a document library. Choose a document type, search
within the selected collection, and open a row to compare extracted information with
its original source. The previous artifact history remains under **Herkunft & Details**.
From either view, **Explore possibilities** sends the exact selected artifact to Skill
Studio. A financial table row refers to an immutable representation, while its source
button opens the original file.

The current library has tables for documents, invoices and receipts, account
statements, transactions, and invoice positions. Document categories include invoices,
credit notes, receipts, statements, email and other classified types. Financial tables
show the latest validation-bound extraction for each source. A document with no
validated financial result remains visible in Documents. **Regeln erfüllt** means its
recorded validation rules passed; it is not human approval or a guarantee that the
extracted values are correct. Missing values display as **—**, zero remains zero, and
amounts retain the recorded currency.

This slice does not automatically merge suppliers, accounts, addresses, or contacts
into entity rows. It also does not generate or publish thumbnails when the library is
opened. The original is read only after a person opens a preview; a PDF preview renders
one page at a time. The full source file is still transferred for that preview.
Current Skill Studio artifacts remain accessible through **Herkunft & Details**, which
also retains the exact-artifact handoff to Studio. A visual Skill program preview and
the proposed `studio.skill@2` catalog are future Studio work; this library does not
reinterpret current Skill JSON as a new program format.

## Read boundary and paging

The authenticated facade's `GET /api/artifacts/library` chooses the database and scope
from the verified customer environment. It delegates to the Artifact Store's scoped
`/v1/scopes/{scopeId}/library`. Callers can choose an allowlisted collection, category,
search, sort, direction, source ID, bounded page size, and continuation cursor; they
cannot choose a database. The native client encodes and allowlists those query fields.

The first page captures a publication watermark. Later pages use a cursor bound to
store epoch, scope, filter and sort, so restoring a store or changing a query requires
refresh. Tables request 50 rows at a time. Schema version 4 adds type and source-input
read indexes without changing immutable documents or stored bytes.

The unfiltered document path limits sources before loading representations. Filtered
and financial reads still evaluate projections in PostgreSQL; there is no maintained
search index or million-document latency guarantee. The [build and test handbook](operations/build-and-test.md)
has the synthetic SQL regression and the complete release gate.
