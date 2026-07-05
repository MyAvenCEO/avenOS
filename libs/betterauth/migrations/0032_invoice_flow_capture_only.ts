import { type Kysely, sql } from 'kysely'

// board 0093 fix — Invoice Processing is the single canonical invoice flow, but its `book` step
// (matchInvoiceAgainstTx / bookInvoice) + `humanReview` have no runner actors yet (book = follow-on),
// so the runner errored there. Scope it to CAPTURE-ONLY now: ingest → capture (extract + enrich). The
// book + review nodes are re-added when the book actors land. This unbreaks chat run_skill('invoice').

const NODES = [
	{
		id: 'ingest-doc',
		name: 'Document Ingest',
		flowRef: 'doc-ingest',
		inputs: ['file', 'image'],
		outputs: ['document'],
		supervision: { strategy: 'resume' }
	},
	{
		id: 'capture',
		name: 'Map Brain (Invoice)',
		flowRef: 'capture',
		inputs: ['document'],
		outputs: ['invoice'],
		vibe: 'invoice',
		supervision: { strategy: 'resume' }
	}
]
const EDGES = [{ from: 'ingest-doc', to: 'capture', resource: 'document', kind: 'data', message: 'document' }]

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE flow
		SET nodes = ${JSON.stringify(NODES)}::jsonb,
		    edges = ${JSON.stringify(EDGES)}::jsonb,
		    description = 'Ingest a document (store + classify), then capture: extract the invoice from the node-config doctype + enrich (match/create the vendor company + Ansprechpartner) and persist the ontology invoice. Booking (match + SKR04) is a follow-on.'
		WHERE id = 'invoice'
	`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only; the book + review nodes are re-introduced by the book follow-on card.
}
