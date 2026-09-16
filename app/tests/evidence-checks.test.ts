import { describe, expect, test } from 'bun:test'
import { checkEvidence, evidenceCheckSpecs } from '../src/lib/chat/evidence-checks'

const evidence = { sourceId: 'read-document', quote: 'Confirmed dates and posted amounts' }
const quoted = (c: typeof evidence) =>
	c.sourceId === evidence.sourceId && c.quote === evidence.quote
const interval = (start: string, end: string) => ({ start, end, evidence })
const coverage = (start: string, end: string, covered: ReturnType<typeof interval>[]) =>
	checkEvidence('check_coverage', { required: interval(start, end), covered }, quoted)
describe('evidence-backed time coverage', () => {
	test('finds first night and internal gaps despite overlapping bookings', () => {
		expect(
			coverage('2026-05-21', '2026-05-27', [
				interval('2026-05-22', '2026-05-24'),
				interval('2026-05-23', '2026-05-25'),
				interval('2026-05-26', '2026-05-28')
			])
		).toMatchObject({
			ok: true,
			fullyCovered: false,
			gaps: [
				{ start: '2026-05-21', end: '2026-05-22' },
				{ start: '2026-05-25', end: '2026-05-26' }
			]
		})
	})
	test('continuous adjacent bookings cover exactly, irrelevant bookings do not', () => {
		expect(
			coverage('2026-05-21', '2026-05-24', [
				interval('2026-05-20', '2026-05-22'),
				interval('2026-05-22', '2026-05-25')
			])
		).toMatchObject({ fullyCovered: true, gaps: [] })
		expect(
			coverage('2026-05-21', '2026-05-24', [interval('2026-04-28', '2026-04-29')])
		).toMatchObject({ fullyCovered: false, gaps: [{ start: '2026-05-21', end: '2026-05-24' }] })
	})
	test('compares instants across offsets, rejects ambiguous and impossible dates', () => {
		expect(
			coverage('2026-03-29T00:00:00Z', '2026-03-29T03:00:00Z', [
				interval('2026-03-29T01:00:00+01:00', '2026-03-29T05:00:00+02:00')
			])
		).toMatchObject({ fullyCovered: true })
		for (const start of ['2026-02-30', '2026-05-21T12:00:00', '2026-05-24'])
			expect(coverage(start, '2026-05-24', []).ok).toBe(false)
	})
	test('rejects invented citations', () => {
		const result = checkEvidence(
			'check_coverage',
			{ required: interval('2026-05-21', '2026-05-24'), covered: [] },
			() => false
		)
		expect(result.ok).toBe(false)
	})
})
const entry = (
	transactionId: string,
	amountMinor: number,
	kind = 'charge',
	status = 'posted',
	reference = 'ORDER-A',
	account = 'VISA-12'
) => ({ transactionId, amountMinor, kind, status, reference, account, evidence })
const reconcile = (entries: ReturnType<typeof entry>[]) =>
	checkEvidence(
		'calculate',
		{ currency: 'EUR', reference: 'ORDER-A', account: 'VISA-12', entries },
		quoted
	)
describe('cash reconciliation', () => {
	test('separates net expenditure from debt, pending cash and proforma claims', () => {
		expect(
			reconcile([
				entry('c', 32000),
				entry('r', 18000, 'refund'),
				entry('p', 45000, 'refund', 'authorized'),
				entry('b', 14000, 'balance_claim')
			])
		).toMatchObject({
			ok: true,
			netExpenditureMinor: '14000',
			additionalAmountOwed: 'not established by cash movements',
			nonCash: [{ transactionId: 'p' }, { transactionId: 'b' }]
		})
	})
	test('does not cross-allocate orders/accounts or double-count repeated records', () => {
		expect(
			reconcile([
				entry('c', 32000),
				entry('r', 18000, 'refund'),
				entry('r', 18000, 'refund'),
				entry('other', 18000, 'refund', 'posted', 'ORDER-B'),
				entry('bank', 18000, 'refund', 'posted', 'ORDER-A', 'BANK')
			])
		).toMatchObject({
			netExpenditureMinor: '14000',
			duplicates: ['r'],
			excluded: ['other', 'bank']
		})
	})
	test('rejects conflicting transactions and unsafe arithmetic inputs; sums beyond safe integer range exactly', () => {
		expect(reconcile([entry('c', 32000), entry('c', 33000)]).ok).toBe(false)
		expect(reconcile([entry('c', 0.1)]).ok).toBe(false)
		expect(
			reconcile([entry('c', Number.MAX_SAFE_INTEGER), entry('d', Number.MAX_SAFE_INTEGER)])
		).toMatchObject({ netExpenditureMinor: '18014398509481982' })
	})
})

// OpenAI's function-call contract rejects composition at the schema root.
test('evidence tool schemas have provider-compatible object roots', () => {
	for (const spec of evidenceCheckSpecs) {
		expect(spec.parameters.type).toBe('object')
		for (const keyword of ['oneOf', 'anyOf', 'allOf', 'enum', 'const', 'not'])
			expect(spec.parameters).not.toHaveProperty(keyword)
	}
})
