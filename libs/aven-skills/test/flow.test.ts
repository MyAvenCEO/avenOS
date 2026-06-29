import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import bankTxConfig from '../configs/bank-statement-tx.json'
import {
	currentStepIndex,
	EXAMPLE_FLOWS,
	EXAMPLE_RUNS,
	exampleInstance,
	FLOW_SCHEMA,
	flattenFlow,
	flowDepths,
	isComposite,
	isFanIn,
	isFanOut,
	isLeaf,
	OPEN_ITEM_STATUS,
	RESOURCE_LABEL,
	resourceSchema,
	runStateOf,
	runsForFlow,
	validateFlow
} from '../src/flow.js'
import { createIngestor, textSource } from '../src/index.js'

// board 0083 — the universal flow/recipe schema + our skills as data validate, with fan-out + fan-in.

const ajv = new Ajv({ allErrors: true, strict: false })
const validateSchema = ajv.compile(FLOW_SCHEMA)

describe('flow / recipe schema', () => {
	test('≥4 named skills, each schema-valid + structurally sound', () => {
		expect(EXAMPLE_FLOWS.length).toBeGreaterThanOrEqual(4)
		for (const flow of EXAMPLE_FLOWS) {
			expect(validateSchema(flow)).toBe(true)
			expect(validateFlow(flow)).toEqual([]) // every edge references a real node id
			expect(flow.name).toBeTruthy()
		}
	})

	test('a fan-out node (1 input → ≥2 outputs) exists', () => {
		const fanOut = EXAMPLE_FLOWS.flatMap((f) => f.nodes).filter(isFanOut)
		expect(fanOut.length).toBeGreaterThanOrEqual(1)
		expect(fanOut[0].inputs.length).toBe(1)
		expect(fanOut[0].outputs.length).toBeGreaterThanOrEqual(2)
	})

	test('a fan-in node (≥2 inputs → 1 output) exists', () => {
		const fanIn = EXAMPLE_FLOWS.flatMap((f) => f.nodes).filter(isFanIn)
		expect(fanIn.length).toBeGreaterThanOrEqual(1)
		expect(fanIn[0].inputs.length).toBeGreaterThanOrEqual(2)
		expect(fanIn[0].outputs.length).toBe(1)
	})

	test('a shared entry point branches via guarded (when) edges', () => {
		// the `ingest` composite is the shared entry: one node, ≥2 outgoing edges, each guarded by type.
		const doc = EXAMPLE_FLOWS.find((f) => f.id === 'doc-ingest')
		expect(doc).toBeTruthy()
		if (!doc) return
		const branchEdges = doc.edges.filter((e) => e.from === 'ingest' && e.when)
		expect(branchEdges.length).toBeGreaterThanOrEqual(2)
		expect(branchEdges.every((e) => doc.nodes.some((n) => n.id === e.to))).toBe(true)
	})

	test('flowDepths lays nodes into columns (branches share the entry column)', () => {
		const doc = EXAMPLE_FLOWS.find((f) => f.id === 'doc-ingest')!
		const depth = flowDepths(doc)
		expect(depth.ingest).toBe(0) // shared entry (the Dokument-Ingest composite)
		// the per-type extract branches all sit one column after the entry
		expect(depth['extract-invoice']).toBe(1)
		expect(depth.bank).toBe(1)
		expect(depth['book-open']).toBeGreaterThan(depth['extract-invoice']) // downstream is deeper
	})

	test('actor nodes carry config (system_prompt / llm / tools)', () => {
		const classify = EXAMPLE_FLOWS.flatMap((f) => f.nodes).find((n) => n.id === 'classify')!
		expect(classify.system_prompt).toBeTruthy()
		expect(classify.llm?.model).toBeTruthy()
		expect(classify.tools?.length).toBeGreaterThanOrEqual(1)
	})

	test('the schema is domain-agnostic: a Minecraft glass recipe is a valid flow', () => {
		const glass = EXAMPLE_FLOWS.find((f) => f.id === 'minecraft-glass')
		expect(glass).toBeTruthy()
		if (!glass) return
		expect(validateSchema(glass)).toBe(true)
		expect(validateFlow(glass)).toEqual([])
		// smelt is a recipe: ingredients (sand + fuel) → product (glass) = fan-in
		const smelt = glass.nodes.find((n) => n.id === 'smelt')!
		expect(smelt.inputs).toContain('sand')
		expect(smelt.inputs).toContain('fuel')
		expect(smelt.outputs).toContain('glass')
		expect(glass.resourceLabels?.glass).toBe('Glasblock')
	})

	test('templates (Flow) are separate from instance runs (FlowRun + trace)', () => {
		expect(EXAMPLE_RUNS.length).toBeGreaterThanOrEqual(1)
		const run = EXAMPLE_RUNS.find((r) => r.flowId === 'minecraft-glass')!
		expect(run.trace.length).toBeGreaterThanOrEqual(1)
		// the run drives node state; the template carries none
		expect(runStateOf(run, 'mine')).toBe('done')
		expect(runStateOf(run, 'craft-pane')).toBe('running')
		expect(runStateOf(null, 'mine')).toBe('idle') // no run → template (idle)
		// runsForFlow filters by template id
		expect(runsForFlow('minecraft-glass').every((r) => r.flowId === 'minecraft-glass')).toBe(true)
		// every traced node id exists in its flow template
		const glass = EXAMPLE_FLOWS.find((f) => f.id === 'minecraft-glass')!
		const ids = new Set(glass.nodes.map((n) => n.id))
		expect(run.trace.every((step) => ids.has(step.nodeId))).toBe(true)
	})

	test('flows compose: a composite node (flowRef) reuses another skill', () => {
		const close = EXAMPLE_FLOWS.find((f) => f.id === 'month-close')
		expect(close).toBeTruthy()
		if (!close) return
		expect(validateSchema(close)).toBe(true)
		expect(validateFlow(close)).toEqual([])
		const composites = close.nodes.filter(isComposite)
		expect(composites.length).toBeGreaterThanOrEqual(2) // bank + ingest are sub-skills
		expect(composites.map((n) => n.flowRef)).toContain('doc-ingest')
		// every flowRef resolves to a real flow template
		const ids = new Set(EXAMPLE_FLOWS.map((f) => f.id))
		expect(composites.every((n) => n.flowRef && ids.has(n.flowRef))).toBe(true)
		// at least one leaf (real execution) too
		expect(close.nodes.some(isLeaf)).toBe(true)
	})

	test('flattenFlow inlines NESTED composites into a pure-leaf graph (daisy-chained)', () => {
		const close = EXAMPLE_FLOWS.find((f) => f.id === 'month-close')!
		const flat = flattenFlow(close, EXAMPLE_FLOWS)
		// every node in the flattened graph is a leaf (actual executor)
		expect(flat.nodes.every(isLeaf)).toBe(true)
		// bank-statement(2) + doc-ingest(9: ingest-sub 3 + bank-sub 2 + extract-invoice/contract/enrich/book-open) + report(1) = 12
		expect(flat.nodes.length).toBe(12)
		// nested namespacing: doc-ingest's ingest composite expands the ingest sub-skill's classify
		expect(flat.nodes.some((n) => n.id === 'ingest/ingest/classify')).toBe(true)
		expect(flat.nodes.some((n) => n.id === 'bank/extract-stmt')).toBe(true)
		// the daisy-chain edge bank → ingest joins the sub-flows' terminal → entry
		expect(flat.edges.some((e) => e.from.startsWith('bank/') && e.to.startsWith('ingest/'))).toBe(
			true
		)
	})

	test('flattenFlow throws on a reference cycle', () => {
		const a = {
			id: 'a',
			name: 'A',
			description: '',
			nodes: [{ id: 'n', name: 'N', flowRef: 'b', inputs: ['x'], outputs: ['y'] }],
			edges: []
		}
		const b = {
			id: 'b',
			name: 'B',
			description: '',
			nodes: [{ id: 'm', name: 'M', flowRef: 'a', inputs: ['y'], outputs: ['x'] }],
			edges: []
		}
		expect(() => flattenFlow(a, [a, b])).toThrow(/cycle/)
	})

	test('currentStepIndex points at the running step (else the last)', () => {
		const glass = EXAMPLE_RUNS.find((r) => r.flowId === 'minecraft-glass')!
		// craft-pane is 'running' at index 2
		expect(currentStepIndex(glass)).toBe(2)
		const done = EXAMPLE_RUNS.find((r) => r.id === 'run-tx-import')!
		expect(currentStepIndex(done)).toBe(done.trace.length - 1) // all done → last
		expect(currentStepIndex(null)).toBe(-1)
	})

	test('the invoice run walks ingest → extract → enrich → book-open, each with a vibe', () => {
		const run = EXAMPLE_RUNS.find((r) => r.id === 'run-invoice-open')
		expect(run).toBeTruthy()
		if (!run) return
		const doc = EXAMPLE_FLOWS.find((f) => f.id === 'doc-ingest')!
		const ids = new Set(doc.nodes.map((n) => n.id))
		expect(run.trace.map((s) => s.nodeId)).toEqual([
			'ingest',
			'extract-invoice',
			'enrich',
			'book-open'
		])
		expect(run.trace.every((s) => ids.has(s.nodeId))).toBe(true)
		expect(run.trace.every((s) => typeof s.vibe === 'string' && s.vibe.length > 0)).toBe(true)
		expect(run.trace.every((s) => s.vibeData != null)).toBe(true)
		// it ends OFFEN (Sollstellung), awaiting the payment
		const book = run.trace.find((s) => s.nodeId === 'book-open')!
		expect((book.vibeData as { booking?: { status?: string } }).booking?.status).toBe('offen')
	})

	test('open-item lifecycle: tx-import + open-item-match flows; offen → bezahlt; park = dead-letter', () => {
		const txImport = EXAMPLE_FLOWS.find((f) => f.id === 'tx-import')
		const oim = EXAMPLE_FLOWS.find((f) => f.id === 'open-item-match')
		expect(txImport).toBeTruthy()
		expect(oim).toBeTruthy()
		if (!txImport || !oim) return
		expect(validateSchema(txImport)).toBe(true)
		expect(validateFlow(txImport)).toEqual([])
		expect(validateSchema(oim)).toBe(true)
		expect(validateFlow(oim)).toEqual([])
		// doc-ingest now ends at book-open (offen), not an inline reconcile→book
		const doc = EXAMPLE_FLOWS.find((f) => f.id === 'doc-ingest')!
		expect(doc.nodes.some((n) => n.id === 'book-open')).toBe(true)
		expect(doc.nodes.some((n) => n.id === 'reconcile')).toBe(false)
		// settle fans in (open_item + transaction → booking)
		const settle = oim.nodes.find((n) => n.id === 'settle')!
		expect(isFanIn(settle)).toBe(true)
		expect(settle.inputs).toContain('open_item')
		// offen (run-invoice-open) → bezahlt (run-settle)
		const open = EXAMPLE_RUNS.find((r) => r.id === 'run-invoice-open')!
		const settled = EXAMPLE_RUNS.find((r) => r.id === 'run-settle')!
		const openBooking = open.trace.find((s) => s.nodeId === 'book-open')!.vibeData as {
			booking?: { status?: string }
		}
		const paidBooking = settled.trace.find((s) => s.nodeId === 'settle')!.vibeData as {
			booking?: { status?: string }
		}
		expect(openBooking.booking?.status).toBe('offen')
		expect(paidBooking.booking?.status).toBe('bezahlt')
		// the inverse: a tx with no Beleg is parked (dead-letter)
		const parked = EXAMPLE_RUNS.find((r) => r.id === 'run-tx-unmatched')!
		expect(parked.trace.some((s) => s.state === 'parked')).toBe(true)
		// OPEN_ITEM_STATUS + open_item kind
		expect([...OPEN_ITEM_STATUS]).toEqual(['offen', 'teilbezahlt', 'bezahlt'])
		expect(RESOURCE_LABEL.open_item).toBeTruthy()
	})

	test('tx-import is realized by the aven-skills ingestor (CSV → transactions + provenance + dedup)', async () => {
		const csv = [
			'Buchungstag;Wertstellung;Betrag;Waehrung;Beguenstigter/Zahlungspflichtiger;IBAN;Verwendungszweck;Saldo',
			'12.06.2026;12.06.2026;-119,00;EUR;Müller GmbH;DE89370400440532013000;Rechnung 2026-0815;4.881,00',
			'09.06.2026;09.06.2026;-49,00;EUR;Telekom Deutschland;DE12500105170648489890;Mobilfunk Juni;5.000,00'
		].join('\n')
		const ing = createIngestor(bankTxConfig as unknown as Parameters<typeof createIngestor>[0])
		const r1 = await ing.ingest(textSource('juni.csv', csv))
		expect(r1.duplicateFile).toBe(false)
		const txs = (r1.output as { transactions?: Record<string, unknown>[] }).transactions ?? []
		expect(txs.length).toBe(2)
		// German decimal coercion
		const müller = txs.find((t) => t.description === 'Rechnung 2026-0815')
		expect(müller?.amount).toBe(-119)
		// provenance back to the source doc
		expect((müller?._source as { contentSha256?: string })?.contentSha256).toBeTruthy()
		// idempotent: re-ingesting the same content is a no-op
		const r2 = await ing.ingest(textSource('juni.csv', csv))
		expect(r2.duplicateFile).toBe(true)
	})

	test('persisted resource kinds map to a DB schema name; ephemeral ones do not', () => {
		// invoice/transaction/booking/contact are stored → linkable to the DB schema view
		expect(resourceSchema('invoice')).toBe('invoice')
		expect(resourceSchema('transaction')).toBe('tx')
		expect(resourceSchema('booking')).toBe('booking')
		expect(resourceSchema('contact')).toBe('contact')
		// ephemeral kinds carry no stored schema
		expect(resourceSchema('document')).toBeUndefined()
		expect(resourceSchema('prompt')).toBeUndefined()
		expect(resourceSchema('glass')).toBeUndefined()
	})

	test('exampleInstance assigns a state to every node', () => {
		const f = EXAMPLE_FLOWS[0]
		const inst = exampleInstance(f)
		expect(Object.keys(inst.nodeStates).sort()).toEqual(f.nodes.map((n) => n.id).sort())
		expect(inst.nodeStates[f.nodes[0].id]).toBe('done')
	})
})
