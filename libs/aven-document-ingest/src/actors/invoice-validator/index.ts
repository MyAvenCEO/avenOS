import { Actor } from '@avenos/actors'
import { artifact, failure, manifest, object, success, wholeArtifact } from '../../shared'

function lineNetCheck(details: Record<string, unknown> | undefined, net: unknown) {
	const rows = details?.lineItems
	if (!Number.isSafeInteger(net) || !Array.isArray(rows) || rows.length === 0) return 'UNKNOWN'
	let sum = 0n
	for (const row of rows) {
		if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.netMinor)) return 'UNKNOWN'
		sum += BigInt(row.netMinor)
	}
	const difference = sum - BigInt(net as number)
	return difference >= -2n && difference <= 2n ? 'PASS' : 'FAIL'
}

export function createInvoiceValidatorActor(): Actor {
	return new Actor(
		manifest(
			'invoice-validator',
			'Invoice validator',
			'Checks invoice totals, identity and line-item net reconciliation.',
			'document_validate_invoice',
			[
				'ceo.aven.bookkeeping.invoice_candidate(F, I)',
				'ceo.aven.bookkeeping.invoice_details(F, D)'
			],
			['ceo.aven.bookkeeping.invoice_validation(I, V)']
		),
		{
			document_validate_invoice: (payload) => {
				try {
					const candidate = object(payload.candidate, 'invoice candidate')
					const details =
						payload.details == null ? undefined : object(payload.details, 'invoice details')
					const net = candidate.netMinor
					const tax = candidate.taxMinor
					const gross = candidate.grossMinor
					const arithmetic =
						typeof net === 'number' && typeof tax === 'number' && typeof gross === 'number'
							? Math.abs(net + tax - gross) <= 2
								? 'PASS'
								: 'FAIL'
							: 'UNKNOWN'
					const identity =
						typeof candidate.supplier === 'string' &&
						candidate.supplier.trim() !== '' &&
						typeof candidate.invoiceNumber === 'string' &&
						candidate.invoiceNumber.trim() !== ''
							? 'PASS'
							: 'FAIL'
					const lineNet = lineNetCheck(details, net)
					const outcomes = [arithmetic, identity, lineNet]
					const status = [candidate.chunkCoverage, details?.chunkCoverage].some(
						(coverage) => coverage && (coverage as { complete?: boolean }).complete !== true
					)
						? 'insufficient-coverage'
						: [arithmetic, identity].includes('FAIL')
							? 'inconsistent'
							: outcomes.includes('UNKNOWN') || lineNet === 'FAIL'
								? 'insufficient-coverage'
								: 'consistent'
					const validation = {
						rulesetVersion: 'invoice-core-v2',
						status,
						coverageBps: Math.floor(
							(outcomes.filter((outcome) => outcome !== 'UNKNOWN').length * 10000) / outcomes.length
						),
						checks: [
							{
								ruleId: 'invoice.net-plus-tax-equals-gross',
								outcome: arithmetic,
								severity: 'hard',
								paths: ['/netMinor', '/taxMinor', '/grossMinor'],
								message:
									'Known net plus tax must agree with gross within two minor units. Review separately documented adjustments when totals disagree.'
							},
							{
								ruleId: 'invoice.identity-present',
								outcome: identity,
								severity: 'hard',
								paths: ['/supplier', '/invoiceNumber'],
								message: 'Supplier and invoice number must both be present.'
							},
							{
								ruleId: 'invoice.line-net-equals-net',
								outcome: lineNet,
								severity: 'warning',
								paths: ['/lineItems', '/netMinor'],
								message:
									'Printed line net amounts must sum to document net within two minor units. Review missing amounts, duplicated or omitted rows, discounts, charges and rounding when this cannot be established; no adjustment is inferred.'
							}
						]
					}
					return success(
						{
							ok: true,
							procedureKey: 'client.validate-invoice',
							artifacts: [
								artifact('validation', 'bookkeeping.invoice-validation', validation, 'validation')
							],
							evidence: [
								{
									ordinal: 0,
									outputLocalKey: 'validation',
									outputLocator: wholeArtifact(),
									inputRole: 'candidate',
									inputOrdinal: 0,
									inputLocator: wholeArtifact()
								},
								...(details
									? [
											{
												ordinal: 1,
												outputLocalKey: 'validation',
												outputLocator: wholeArtifact(),
												inputRole: 'details',
												inputOrdinal: 0,
												inputLocator: wholeArtifact()
											}
										]
									: [])
							]
						},
						`Invoice validation is ${status}.`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)
}
