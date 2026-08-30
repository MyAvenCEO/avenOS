export type ValidationStatus =
	| 'consistent'
	| 'inconsistent'
	| 'incomplete'
	| 'insufficient-coverage'

export interface OpenItem {
	businessKey: string
	businessKeyBasis: 'supplier-invoice-number' | 'document-fallback'
	documentKind: string
	direction: 'payable' | 'receivable' | 'unknown'
	supplierName: string
	supplierIbans: string[]
	invoiceNumber: string
	orderNumber: string | null
	issueDate: string | null
	dueDate: string | null
	currency: string
	grossMinor: number
	amountDueMinor: number
	amountPaidMinor: number | null
	references: string[]
	validationStatus: ValidationStatus
	summary: string
}

export interface StatementTransaction {
	dedupKey: string
	dedupBasis: 'provider-id' | 'fingerprint'
	accountRef: string
	providerTransactionId: string | null
	bookingDate: string | null
	valueDate: string | null
	title: string | null
	amountMinor: number | null
	currency: string | null
	counterpartyName: string | null
	counterpartyIban: string | null
	description: string | null
	originalAmountMinor: number | null
	originalCurrency: string | null
	exchangeRate: string | null
	fxSurchargeMinor: number | null
	foreignExchangeFeeBps: number | null
	balanceAfterMinor: number | null
	sourceRow: number | null
	sourceOrdinal: number
	statementValidationStatus: ValidationStatus
	statementCoverage: 'verified' | 'unverified' | 'row-limit-reached'
}

export interface ReconciliationMatchCandidate {
	matcherVersion: 'invoice-transaction-v1'
	openItemBusinessKey: string
	transactionDedupKey: string
	rank: number
	rankScore: number
	amountMatchBasis: 'account' | 'original' | null
	amountDistanceMinor: number | null
	matchedTransactionAmountMinor: number | null
	matchedTransactionCurrency: string | null
	issueDateDistanceDays: number | null
	dueDateDistanceDays: number | null
	referenceMatch: 'exact' | 'none'
	counterpartyMatch: 'exact' | 'token-overlap' | 'none'
	ibanMatch: boolean
	signMatch: 'match' | 'conflict' | 'unknown'
	duplicateCount: number
	reasons: string[]
	blockers: string[]
	pairEligible: boolean
	recommendation: 'review' | 'reject' | 'eligible-for-assignment'
}

const DAY_MS = 86_400_000

function folded(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
}

function compact(value: string | null | undefined): string {
	return folded(value).replaceAll(' ', '')
}

function dateDistance(left: string | null, right: string | null): number | null {
	if (!left || !right) return null
	const leftTime = Date.parse(`${left.slice(0, 10)}T00:00:00Z`)
	const rightTime = Date.parse(`${right.slice(0, 10)}T00:00:00Z`)
	if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null
	return Math.round(Math.abs(leftTime - rightTime) / DAY_MS)
}

function referenceMatches(reference: string, haystack: string): boolean {
	const needle = folded(reference)
	if (!needle) return false
	return ` ${folded(haystack)} `.includes(` ${needle} `)
}

function tokenOverlap(left: string, right: string): number {
	const leftTokens = new Set(
		folded(left)
			.split(' ')
			.filter((token) => token.length >= 2)
	)
	const rightTokens = new Set(
		folded(right)
			.split(' ')
			.filter((token) => token.length >= 2)
	)
	if (leftTokens.size === 0 || rightTokens.size === 0) return 0
	const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length
	return shared / Math.max(leftTokens.size, rightTokens.size)
}

function amountComparison(
	openItem: OpenItem,
	transaction: StatementTransaction
): Pick<
	ReconciliationMatchCandidate,
	| 'amountMatchBasis'
	| 'amountDistanceMinor'
	| 'matchedTransactionAmountMinor'
	| 'matchedTransactionCurrency'
> {
	const candidates: Array<{
		basis: 'account' | 'original'
		amount: number
		currency: string
		distance: number
	}> = []
	if (
		transaction.amountMinor !== null &&
		transaction.currency?.toUpperCase() === openItem.currency.toUpperCase()
	) {
		candidates.push({
			basis: 'account',
			amount: transaction.amountMinor,
			currency: transaction.currency,
			distance: Math.abs(Math.abs(transaction.amountMinor) - Math.abs(openItem.amountDueMinor))
		})
	}
	if (
		transaction.originalAmountMinor !== null &&
		transaction.originalCurrency?.toUpperCase() === openItem.currency.toUpperCase()
	) {
		candidates.push({
			basis: 'original',
			amount: transaction.originalAmountMinor,
			currency: transaction.originalCurrency,
			distance: Math.abs(
				Math.abs(transaction.originalAmountMinor) - Math.abs(openItem.amountDueMinor)
			)
		})
	}
	const best = candidates.sort(
		(left, right) => left.distance - right.distance || (left.basis === 'account' ? -1 : 1)
	)[0]
	return best
		? {
				amountMatchBasis: best.basis,
				amountDistanceMinor: best.distance,
				matchedTransactionAmountMinor: best.amount,
				matchedTransactionCurrency: best.currency
			}
		: {
				amountMatchBasis: null,
				amountDistanceMinor: null,
				matchedTransactionAmountMinor: null,
				matchedTransactionCurrency: null
			}
}

function signComparison(
	direction: OpenItem['direction'],
	amountMinor: number | null
): ReconciliationMatchCandidate['signMatch'] {
	if (direction === 'unknown' || amountMinor === null || amountMinor === 0) return 'unknown'
	return direction === 'payable'
		? amountMinor < 0
			? 'match'
			: 'conflict'
		: amountMinor > 0
			? 'match'
			: 'conflict'
}

function rejectBlockers(
	openItem: OpenItem,
	transaction: StatementTransaction,
	amountDistanceMinor: number | null,
	strongReferenceMatch: boolean,
	signMatch: ReconciliationMatchCandidate['signMatch']
): string[] {
	const blockers: string[] = []
	if (openItem.validationStatus !== 'consistent') blockers.push('open-item-not-validated')
	if (transaction.statementValidationStatus !== 'consistent')
		blockers.push('statement-not-validated')
	if (transaction.statementCoverage !== 'verified') blockers.push('statement-coverage-unverified')
	if (openItem.direction === 'unknown') blockers.push('open-item-direction-unknown')
	if (amountDistanceMinor !== 0) blockers.push('amount-or-currency-not-exact')
	if (!strongReferenceMatch) blockers.push('invoice-specific-evidence-missing')
	if (signMatch !== 'match') blockers.push('transaction-sign-not-confirmed')
	return blockers
}

/**
 * Rank one invoice open item against statement transactions. This deliberately returns
 * explainable ranking scores, not calibrated probabilities or reconciliation decisions.
 */
export function rankInvoiceTransactions(
	openItem: OpenItem,
	transactions: StatementTransaction[]
): ReconciliationMatchCandidate[] {
	const duplicateCounts = new Map<string, number>()
	const representatives = new Map<string, StatementTransaction>()
	for (const transaction of transactions) {
		duplicateCounts.set(transaction.dedupKey, (duplicateCounts.get(transaction.dedupKey) ?? 0) + 1)
		const current = representatives.get(transaction.dedupKey)
		if (
			!current ||
			(transaction.dedupBasis === 'provider-id' && current.dedupBasis !== 'provider-id') ||
			transaction.sourceOrdinal < current.sourceOrdinal
		) {
			representatives.set(transaction.dedupKey, transaction)
		}
	}

	const candidates = [...representatives.values()].map((transaction) => {
		const amount = amountComparison(openItem, transaction)
		const purpose = [transaction.title, transaction.description, transaction.providerTransactionId]
			.filter((value): value is string => Boolean(value))
			.join(' ')
		const referenceMatch: ReconciliationMatchCandidate['referenceMatch'] = openItem.references.some(
			(reference) => referenceMatches(reference, purpose)
		)
			? 'exact'
			: 'none'
		const strongReferenceMatch = openItem.references.some((reference) => {
			const normalized = compact(reference)
			const sufficientlySpecific =
				normalized.length >= 6 ||
				(normalized.length >= 4 && /[a-z]/.test(normalized) && /\d/.test(normalized))
			return sufficientlySpecific && referenceMatches(reference, purpose)
		})
		const ibanMatch = openItem.supplierIbans.some(
			(iban) => compact(iban) !== '' && compact(iban) === compact(transaction.counterpartyIban)
		)
		const overlap = tokenOverlap(openItem.supplierName, transaction.counterpartyName ?? '')
		const counterpartyMatch: ReconciliationMatchCandidate['counterpartyMatch'] =
			compact(openItem.supplierName) !== '' &&
			compact(openItem.supplierName) === compact(transaction.counterpartyName)
				? 'exact'
				: overlap >= 0.5
					? 'token-overlap'
					: 'none'
		const issueDateDistanceDays = dateDistance(openItem.issueDate, transaction.bookingDate)
		const dueDateDistanceDays = dateDistance(openItem.dueDate, transaction.bookingDate)
		const signMatch = signComparison(openItem.direction, amount.matchedTransactionAmountMinor)
		const blockers = rejectBlockers(
			openItem,
			transaction,
			amount.amountDistanceMinor,
			strongReferenceMatch,
			signMatch
		)

		let rankScore = 0
		const reasons: string[] = []
		if (amount.amountDistanceMinor === 0) {
			rankScore += 4000
			reasons.push(`exact-${amount.amountMatchBasis}-amount`)
		} else if (amount.amountDistanceMinor !== null) {
			const allowance = Math.max(100, Math.round(Math.abs(openItem.amountDueMinor) * 0.02))
			rankScore += Math.max(0, 2500 - Math.round((amount.amountDistanceMinor / allowance) * 2500))
			reasons.push(`${amount.amountMatchBasis}-amount-distance:${amount.amountDistanceMinor}`)
		}
		if (referenceMatch === 'exact') {
			rankScore += 2500
			reasons.push('exact-reference')
		}
		if (ibanMatch) {
			rankScore += 1500
			reasons.push('counterparty-iban')
		}
		if (counterpartyMatch === 'exact') {
			rankScore += 1000
			reasons.push('exact-counterparty')
		} else if (counterpartyMatch === 'token-overlap') {
			rankScore += 600
			reasons.push('counterparty-token-overlap')
		}
		const nearestDate = [issueDateDistanceDays, dueDateDistanceDays]
			.filter((value): value is number => value !== null)
			.sort((left, right) => left - right)[0]
		if (nearestDate !== undefined) {
			rankScore += Math.max(0, 750 - nearestDate * 25)
			reasons.push(`date-distance:${nearestDate}`)
		}
		if (signMatch === 'match') {
			rankScore += 250
			reasons.push('expected-sign')
		} else if (signMatch === 'conflict') {
			rankScore = Math.max(0, rankScore - 2000)
			reasons.push('conflicting-sign')
		}

		return {
			matcherVersion: 'invoice-transaction-v1' as const,
			openItemBusinessKey: openItem.businessKey,
			transactionDedupKey: transaction.dedupKey,
			rank: 0,
			rankScore: Math.min(10_000, rankScore),
			...amount,
			issueDateDistanceDays,
			dueDateDistanceDays,
			referenceMatch,
			counterpartyMatch,
			ibanMatch,
			signMatch,
			duplicateCount: duplicateCounts.get(transaction.dedupKey) ?? 1,
			reasons,
			blockers,
			pairEligible: blockers.length === 0,
			recommendation:
				blockers.length === 0 ? ('eligible-for-assignment' as const) : ('review' as const)
		}
	})

	return candidates
		.sort(
			(left, right) =>
				right.rankScore - left.rankScore ||
				(left.amountDistanceMinor ?? Number.MAX_SAFE_INTEGER) -
					(right.amountDistanceMinor ?? Number.MAX_SAFE_INTEGER) ||
				(left.issueDateDistanceDays ?? Number.MAX_SAFE_INTEGER) -
					(right.issueDateDistanceDays ?? Number.MAX_SAFE_INTEGER) ||
				(left.transactionDedupKey < right.transactionDedupKey
					? -1
					: left.transactionDedupKey > right.transactionDedupKey
						? 1
						: 0)
		)
		.map((candidate, index) => ({ ...candidate, rank: index + 1 }))
}
