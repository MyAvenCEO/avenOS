import type { ToolSpec } from './redpill'

const evidence = {
	type: 'object',
	properties: { sourceId: { type: 'string' }, quote: { type: 'string' } },
	required: ['sourceId', 'quote'],
	additionalProperties: false
}
const interval = {
	type: 'object',
	properties: { start: { type: 'string' }, end: { type: 'string' }, evidence },
	required: ['start', 'end', 'evidence'],
	additionalProperties: false
}
export const evidenceCheckSpecs: ToolSpec[] = [
	{
		name: 'check_coverage',
		description:
			'Compare a required time interval with confirmed coverage and return every uncovered gap. Use for journeys versus care, insurance, access or reservations. Intervals are half-open [start,end); use ISO dates for whole days, or timestamps with explicit UTC offsets for all intervals. Include only confirmed coverage; a plan, cancelled booking or deposit without dates is not coverage. Each interval needs an exact source quote. Results validate the supplied intervals, not their interpretation.',
		parameters: {
			type: 'object',
			properties: {
				required: interval,
				covered: { type: 'array', items: interval, maxItems: 100 }
			},
			required: ['required', 'covered']
		}
	},
	{
		name: 'calculate',
		description:
			'Exact money arithmetic. For a simple signed sum supply currency and amounts (integer minor units); for ledger reconciliation supply currency, reference, account and entries instead. Reconcile one order, account and currency from quoted ledger evidence. Posted charges minus posted refunds give net expenditure, NOT an additional amount owed. Pending and authorized amounts are reported separately. Use transaction IDs to deduplicate; do not merge different accounts or allocate an ambiguous credit without evidence. A proforma balance is a claim, not a cash movement. This checks supplied facts, not whether every record has been found.',
		parameters: {
			type: 'object',
			properties: {
				currency: { type: 'string' },
				amounts: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 100 },
				reference: { type: 'string' },
				account: { type: 'string' },
				entries: {
					type: 'array',
					maxItems: 100,
					items: {
						type: 'object',
						properties: {
							transactionId: { type: 'string' },
							reference: { type: 'string' },
							account: { type: 'string' },
							kind: { enum: ['charge', 'refund', 'balance_claim'] },
							status: { enum: ['posted', 'pending', 'authorized'] },
							amountMinor: { type: 'integer' },
							evidence
						},
						required: [
							'transactionId',
							'reference',
							'account',
							'kind',
							'status',
							'amountMinor',
							'evidence'
						],
						additionalProperties: false
					}
				}
			},
			required: ['currency']
		}
	}
]
type Citation = { sourceId: string; quote: string }
type Interval = { start: string; end: string; evidence: Citation }
type Entry = {
	transactionId: string
	reference: string
	account: string
	kind: string
	status: string
	amountMinor: number
	evidence: Citation
}
const record = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v)
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 200
export function checkEvidence(
	name: string,
	args: Record<string, unknown>,
	quoted: (c: Citation) => boolean
): Record<string, unknown> {
	const citation = (v: unknown): v is Citation =>
		record(v) &&
		typeof v.sourceId === 'string' &&
		typeof v.quote === 'string' &&
		v.quote.trim().length >= 8 &&
		quoted(v as Citation)
	if (JSON.stringify(args).length > 32000)
		return { ok: false, error: 'Evidence check exceeds 32000 characters.' }
	if (name === 'check_coverage') {
		const dateOnly =
			record(args.required) &&
			typeof args.required.start === 'string' &&
			/^\d{4}-\d{2}-\d{2}$/.test(args.required.start)
		const timestamp = (s: unknown): s is string => {
			if (typeof s !== 'string') return false
			if (
				!(
					dateOnly
						? /^\d{4}-\d{2}-\d{2}$/
						: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/
				).test(s)
			)
				return false
			const day = s.slice(0, 10),
				time = Date.parse(s)
			return (
				Number.isFinite(time) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
			)
		}
		const valid = (v: unknown): v is Interval =>
			record(v) &&
			timestamp(v.start) &&
			timestamp(v.end) &&
			Date.parse(v.start) < Date.parse(v.end) &&
			citation(v.evidence)
		if (
			!valid(args.required) ||
			!Array.isArray(args.covered) ||
			args.covered.length > 100 ||
			!args.covered.every(valid)
		)
			return {
				ok: false,
				error:
					'Provide valid increasing intervals in one date format, with exact quotes from read sources. Dates use an exclusive end; timestamps require UTC offsets.'
			}
		const required = args.required,
			covered = args.covered as Interval[]
		const end = Date.parse(required.end),
			gaps: Array<{ start: string; end: string }> = []
		let position = Date.parse(required.start)
		const format = (t: number) =>
			dateOnly ? new Date(t).toISOString().slice(0, 10) : new Date(t).toISOString()
		for (const span of covered
			.map((s) => [Date.parse(s.start), Date.parse(s.end)])
			.sort((a, b) => a[0] - b[0])) {
			if (span[1] <= position || span[0] >= end) continue
			if (span[0] > position)
				gaps.push({ start: format(position), end: format(Math.min(end, span[0])) })
			position = Math.max(position, Math.min(end, span[1]))
		}
		if (position < end) gaps.push({ start: format(position), end: format(end) })
		return {
			ok: true,
			fullyCovered: gaps.length === 0,
			gaps,
			notice:
				'Coverage of supplied confirmed intervals only. Quotation existence is checked; interpretation and completeness still require review.'
		}
	}
	if (name !== 'calculate') return { ok: false, error: 'Unknown evidence check.' }
	if (args.amounts !== undefined) {
		if (
			args.entries !== undefined ||
			typeof args.currency !== 'string' ||
			!/^[A-Z]{3}$/.test(args.currency) ||
			!Array.isArray(args.amounts) ||
			!args.amounts.length ||
			args.amounts.length > 100 ||
			!args.amounts.every(Number.isSafeInteger)
		)
			return {
				ok: false,
				error:
					'Use one ISO currency and 1–100 signed safe integers in amounts; do not combine amounts with ledger entries.'
			}
		return {
			ok: true,
			currency: args.currency,
			totalMinor: String(args.amounts.reduce((n: bigint, a: number) => n + BigInt(a), 0n))
		}
	}

	if (
		typeof args.currency !== 'string' ||
		!/^[A-Z]{3}$/.test(args.currency) ||
		!nonempty(args.reference) ||
		!nonempty(args.account) ||
		!Array.isArray(args.entries) ||
		!args.entries.length ||
		args.entries.length > 100
	)
		return { ok: false, error: 'Provide a currency, order reference, account and 1–100 entries.' }
	const unique = new Map<string, Entry>(),
		duplicates: string[] = [],
		excluded: string[] = []
	for (const [index, raw] of args.entries.entries()) {
		if (record(raw) && !citation(raw.evidence))
			return {
				ok: false,
				entry: index,
				error:
					'evidence.quote must be a contiguous exact quote from a read source; do not add list numbers, quotes, ellipses or punctuation.',
				sourceId: record(raw.evidence) ? raw.evidence.sourceId : undefined
			}
		if (
			!record(raw) ||
			!nonempty(raw.transactionId) ||
			!nonempty(raw.reference) ||
			!nonempty(raw.account) ||
			!['charge', 'refund', 'balance_claim'].includes(String(raw.kind)) ||
			!['posted', 'pending', 'authorized'].includes(String(raw.status)) ||
			!Number.isSafeInteger(raw.amountMinor) ||
			Number(raw.amountMinor) < 0 ||
			!citation(raw.evidence)
		)
			return {
				ok: false,
				error:
					'Entries need nonnegative safe integer amounts, identifiers, valid kind/status and exact source quotes.'
			}
		const entry = raw as Entry
		if (entry.reference !== args.reference || entry.account !== args.account) {
			excluded.push(entry.transactionId)
			continue
		}
		const old = unique.get(entry.transactionId)
		if (old) {
			if (
				old.amountMinor !== entry.amountMinor ||
				old.status !== entry.status ||
				old.kind !== entry.kind
			)
				return {
					ok: false,
					error: 'Conflicting versions of one transaction; resolve or report uncertainty.',
					transactionId: entry.transactionId
				}
			duplicates.push(entry.transactionId)
		} else unique.set(entry.transactionId, entry)
	}
	let charges = 0n,
		refunds = 0n
	const nonCash: Entry[] = []
	for (const e of unique.values()) {
		if (e.status !== 'posted' || e.kind === 'balance_claim') nonCash.push(e)
		else if (e.kind === 'charge') charges += BigInt(e.amountMinor)
		else refunds += BigInt(e.amountMinor)
	}
	return {
		ok: true,
		currency: args.currency,
		reference: args.reference,
		account: args.account,
		postedChargesMinor: String(charges),
		postedRefundsMinor: String(refunds),
		netExpenditureMinor: String(charges - refunds),
		additionalAmountOwed: 'not established by cash movements',
		nonCash,
		duplicates,
		excluded,
		notice:
			'Different transaction IDs may still describe the same movement. Do not assign an ambiguous credit or infer a debt without evidence; authorized refunds are not posted cash.'
	}
}
