const port = Number(process.env.ARTIFACT_VISION_MOCK_PORT ?? '18080')

interface ModelRequest {
	model?: unknown
	messages?: unknown
	response_format?: { json_schema?: { name?: unknown } }
	tools?: { function?: { name?: unknown } }[]
}

function evidence(target: string, pointer: string, page = 1) {
	return {
		target,
		pointer,
		page,
		x: 50_000,
		y: 50_000,
		width: 900_000,
		height: 80_000,
		quote: pointer
	}
}

function invoiceExtraction() {
	const candidate = {
		supplier: 'ACME GmbH',
		invoiceNumber: 'INV-2026-0815',
		currency: 'EUR',
		netMinor: 10_000,
		taxMinor: 1_900,
		grossMinor: 11_900,
		dueDate: '2026-09-30',
		summary: 'ACME GmbH invoice INV-2026-0815 for EUR 119.00.'
	}
	const details = {
		documentKind: 'invoice',
		category: 'office',
		issueDate: '2026-08-15',
		customerNumber: null,
		orderNumber: null,
		supplier: { name: 'ACME GmbH', vatId: null, address: null, email: null, website: null },
		buyer: { name: null, vatId: null, address: null, email: null, website: null },
		lineItems: [
			{
				description: 'Office chair',
				quantity: '1',
				unit: 'piece',
				unitPriceMinor: 10_000,
				netMinor: 10_000,
				taxRateBps: 1900,
				taxMinor: 1_900,
				grossMinor: 11_900,
				servicePeriod: null
			}
		],
		taxBreakdown: [{ rateBps: 1900, baseMinor: 10_000, taxMinor: 1_900 }],
		payment: {
			iban: null,
			bic: null,
			beneficiary: 'ACME GmbH',
			amountPaidMinor: 0,
			totalOutstandingMinor: 11_900,
			paymentTerms: 'Due 2026-09-30'
		},
		referenceEntries: []
	}
	const candidatePointers = Object.entries(candidate)
		.filter(([, value]) => value !== null)
		.map(([key]) => evidence('candidate', `/${key}`))
	const detailPointers = [
		'/documentKind',
		'/category',
		'/issueDate',
		'/supplier/name',
		'/lineItems/0',
		'/taxBreakdown/0',
		'/payment/beneficiary',
		'/payment/amountPaidMinor',
		'/payment/totalOutstandingMinor',
		'/payment/paymentTerms'
	].map((pointer) => evidence('details', pointer))
	return { candidate, details, evidence: [...candidatePointers, ...detailPointers] }
}

function statementExtraction() {
	const candidate = {
		statementKind: 'monthly-statement',
		currency: 'EUR',
		accountHolder: 'Aven GmbH',
		accountHolderAddress: 'Example Street 1\n10115 Berlin',
		accountIban: 'DE02120300000000202051',
		openingBalanceMinor: 100_000,
		closingBalanceMinor: 88_100,
		periodStart: '2026-08-01',
		periodEnd: '2026-08-31',
		transactions: [
			{
				transactionId: 'TX-1',
				bookingDate: '2026-08-20',
				valueDate: '2026-08-20',
				amountMinor: -11_900,
				counterpartyName: 'ACME GmbH',
				counterpartyIban: null,
				description: 'Invoice INV-2026-0815',
				originalAmountMinor: null,
				originalCurrency: null,
				exchangeRate: null,
				fxSurchargeMinor: null,
				balanceAfterMinor: 88_100,
				sourceRow: 1
			}
		],
		summary: 'August 2026 account statement with one outgoing payment.'
	}
	const header = Object.entries(candidate)
		.filter(([key, value]) => key !== 'transactions' && value !== null)
		.map(([key]) => evidence('candidate', `/${key}`))
	return { candidate, evidence: [...header, evidence('candidate', '/transactions/0')] }
}

function modelResult(name: string, requestText: string) {
	const statement = requestText.toLowerCase().includes('account statement')
	if (name === 'analyze_page') {
		const text = statement
			? 'Aven GmbH Account statement August 2026 Opening EUR 1000.00 ACME -119.00 Closing EUR 881.00'
			: 'ACME GmbH Invoice INV-2026-0815 Net EUR 100.00 Tax EUR 19.00 Gross EUR 119.00 Due 2026-09-30'
		return {
			text,
			language: 'en',
			complete: true,
			blocks: [{ text, x: 50_000, y: 50_000, width: 900_000, height: 300_000 }],
			primaryKind: 'document',
			facets: ['native-text', 'table'],
			confidenceBps: 9900,
			reason: 'Synthetic document fixture.',
			summary: statement ? 'An account statement.' : 'An invoice.',
			topics: statement ? ['banking'] : ['invoice']
		}
	}
	if (name === 'classify_document') {
		return {
			rawKind: statement ? 'bank-statement' : 'invoice',
			resolvedKind: statement ? 'bank-statement' : 'invoice',
			family: statement ? 'statement-family' : 'invoice-family',
			confidenceBps: 9900,
			reason: 'Synthetic document fixture.',
			resolutionMode: 'model',
			alternatives: []
		}
	}
	if (name === 'extract_invoice') return invoiceExtraction()
	if (name === 'extract_account_statement') return statementExtraction()
	throw new Error(`Unsupported synthetic function ${name}`)
}

Bun.serve({
	port,
	hostname: '0.0.0.0',
	async fetch(request) {
		if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/chat/completions') {
			return new Response('not found', { status: 404 })
		}
		const body = (await request.json()) as ModelRequest
		const name = body.response_format?.json_schema?.name ?? body.tools?.[0]?.function?.name
		if (typeof name !== 'string') return new Response('missing contract name', { status: 400 })
		const result = modelResult(name, JSON.stringify(body.messages ?? []))
		const message = body.tools
			? {
					tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(result) } }]
				}
			: { content: JSON.stringify(result) }
		return Response.json({
			id: `mock-${crypto.randomUUID()}`,
			model: body.model,
			usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
			choices: [{ message }]
		})
	}
})

console.log(`Synthetic OpenAI-compatible vision server listening on ${port}`)
