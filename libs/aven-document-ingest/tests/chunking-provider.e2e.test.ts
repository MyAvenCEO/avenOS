import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import type { LlmCompletionRequest, LlmCompletionResponse } from '@avenos/llm-client'
import { expect, test } from 'vitest'
import { createFacadeHandler } from '../../../services/aven-api/src/facade'
import { LlmGatewayService } from '../../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../../services/aven-api/tests/helpers'
import { createDocumentActors } from '../src/actors/registry'
import { LlmDocumentModelGateway } from '../src/llm-gateway'
import { DocumentProcessingRuntime } from '../src/runtime'
import { ServerDocumentDecoder } from '../src/server'
import { documentSource, textPdf } from './support/chunk-fixtures'
import { CsvMemoryGateway } from './support/csv-corpus'

async function completeThroughFacade(
	service: LlmGatewayService,
	request: LlmCompletionRequest
): Promise<LlmCompletionResponse> {
	const token = 'chunk-proof-internal-bearer'.padEnd(32, '-')
	const handler = createFacadeHandler(
		testConfig({ LLM_GATEWAY_ACTOR_RUNNER_BEARER_TOKEN: token }),
		{
			verify: async () => {
				throw new Error('Internal proof must use service authentication')
			}
		},
		undefined,
		undefined,
		undefined,
		undefined,
		service
	)
	const response = await handler(
		new Request('http://facade.test/internal/v1/llm/completions', {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(request)
		})
	)
	if (!response.ok) throw new Error(`Facade returned ${response.status}: ${await response.text()}`)
	return response.json() as Promise<LlmCompletionResponse>
}

const endpoint = process.env.TEST_CHUNK_LLM_URL
const live = endpoint ? test : test.skip
live(
	'real model extracts and validates every row of a 160-transaction statement across source pages',
	async () => {
		const modelId = process.env.TEST_CHUNK_MODEL_ID ?? 'qwen3.8-flash-next'
		const service = LlmGatewayService.fromConfig(
			testConfig({
				LLM_GATEWAY_ENABLED: 'true',
				LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
				LLM_GATEWAY_MODELS_JSON: JSON.stringify([
					{
						id: modelId,
						label: modelId,
						capabilities: ['text-generation', 'vision', 'structured-output'],
						baseUrl: endpoint,
						upstreamModel: modelId,
						profile: 'qwen-tools',
						authMode: 'none',
						timeoutSeconds: 900
					}
				])
			})
		)!
		let calls = 0
		const receipts: unknown[] = []
		const model = new LlmDocumentModelGateway(
			{
				discover: async (caps) => service.models(caps),
				complete: async (request) => {
					await appendFile(
						'/tmp/ingest-chunk-live-progress.log',
						`${new Date().toISOString()} request ${calls + 1}\n`
					)
					console.log(
						`Live chunk request ${++calls}: ${request.output.format === 'json' ? request.output.name : 'text'}`
					)
					const response = await completeThroughFacade(service, request)
					await appendFile(
						'/tmp/ingest-chunk-live-progress.log',
						`${new Date().toISOString()} completed ${calls}\n`
					)
					receipts.push(response.receipt)
					return response
				}
			},
			modelId
		)
		const pages = Array.from({ length: 4 }, (_, page) => [
			'EXAMPLE BANK - MONTHLY BANK STATEMENT',
			'Account holder: Chunk Proof Ltd',
			'Account IBAN: DE89370400440532013000',
			'Currency: EUR. Statement period: 2026-08-01 to 2026-08-31.',
			'Document opening balance: EUR 200.00. Document closing balance: EUR 40.00.',
			`Page ${page + 1} of 4. Transactions ${page * 40 + 1} through ${(page + 1) * 40}.`,
			'Transaction ID | Booking date | Value date | Title | Amount EUR',
			...Array.from(
				{ length: 40 },
				(_, row) =>
					`TX-${String(page * 40 + row + 1).padStart(4, '0')} | 2026-08-15 | 2026-08-15 | Fee | -1.00`
			)
		])
		const source = documentSource(textPdf(pages), 'statement-160.pdf')
		const gateway = new CsvMemoryGateway(),
			actors = createDocumentActors(new ServerDocumentDecoder(), model)
		const runtime = new DocumentProcessingRuntime(actors, gateway, () => model.status())
		const result = await runtime.start(source)
		const merged = gateway.runs.find((run) => run.procedureKey === 'client.merge-statement-chunks')
			?.artifacts[0]?.payload
		const transactions = merged?.transactions as Record<string, unknown>[] | undefined
		const outputDirectory = process.env.TEST_CHUNK_EVIDENCE_DIR ?? '/tmp/aven-chunk-real'
		await mkdir(outputDirectory, { recursive: true })
		await writeFile(
			`${outputDirectory}/statement-160.json`,
			JSON.stringify(
				{
					result,
					merged,
					receipts,
					calls,
					parts: gateway.runs
						.filter((run) => run.procedureKey === 'client.extract-statement-model')
						.map((run) => run.artifacts[0]?.payload)
				},
				null,
				2
			)
		)
		expect(merged, JSON.stringify(result)).toBeDefined()
		expect(transactions).toHaveLength(160)
		expect(transactions?.map((row) => row.transactionId)).toEqual(
			Array.from({ length: 160 }, (_, i) => `TX-${String(i + 1).padStart(4, '0')}`)
		)
		expect(transactions?.every((row) => row.amountMinor === -100)).toBe(true)
		expect(merged).toMatchObject({
			openingBalanceMinor: 20000,
			closingBalanceMinor: 4000,
			chunkCoverage: { complete: true, total: 4 }
		})
		expect(result.metadata.validationStatus).toBe('consistent')
		expect(result.state, JSON.stringify(result.warnings)).toBe('succeeded')
		const before = calls
		for (const actor of actors.all) actor.dispose()
		const replayActors = createDocumentActors(
			{
				decode: async () => {
					throw new Error('Replay decoded committed source')
				}
			},
			model
		)
		const replay = await new DocumentProcessingRuntime(replayActors, gateway, () =>
			model.status()
		).start(source)
		for (const actor of replayActors.all) actor.dispose()
		expect(calls).toBe(before)
		expect(replay.state).toBe('succeeded')
		for (const actor of actors.all) actor.dispose()
	},
	1_200_000
)

live(
	'real model reads a 70-page manual including scanned pages beyond the old page limit',
	async () => {
		const { createCanvas } = await import('@napi-rs/canvas')
		const { mixedPdf } = await import('./support/chunk-fixtures')
		const modelId = process.env.TEST_CHUNK_MODEL_ID ?? 'qwen3.8-flash-next'
		const service = LlmGatewayService.fromConfig(
			testConfig({
				LLM_GATEWAY_ENABLED: 'true',
				LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
				LLM_GATEWAY_MODELS_JSON: JSON.stringify([
					{
						id: modelId,
						label: modelId,
						capabilities: ['text-generation', 'vision', 'structured-output'],
						baseUrl: endpoint,
						upstreamModel: modelId,
						profile: 'qwen-tools',
						authMode: 'none',
						timeoutSeconds: 900
					}
				])
			})
		)!
		let calls = 0
		const receipts: unknown[] = []
		const model = new LlmDocumentModelGateway(
			{
				discover: async (caps) => service.models(caps),
				complete: async (request) => {
					await appendFile(
						'/tmp/ingest-chunk-live-progress.log',
						`${new Date().toISOString()} manual request ${++calls}\n`
					)
					const response = await completeThroughFacade(service, request)
					receipts.push(response.receipt)
					return response
				}
			},
			modelId
		)
		const pages = Array.from({ length: 70 }, (_, index) => {
			const lines = [
				'WORKSHOP OPERATIONS MANUAL',
				`SECTION ${String(index + 1).padStart(3, '0')}`,
				`Safety marker ALPHA${String(index + 1).padStart(3, '0')}`,
				'Inspect the machine before starting work.'
			]
			if (index < 66) return lines
			const canvas = createCanvas(1190, 1684),
				context = canvas.getContext('2d')
			context.fillStyle = 'white'
			context.fillRect(0, 0, 1190, 1684)
			context.fillStyle = 'black'
			context.font = '30px sans-serif'
			lines.forEach((line, row) => {
				context.fillText(line, 80, 110 + row * 60)
			})
			return { jpeg: new Uint8Array(canvas.toBuffer('image/jpeg')), width: 1190, height: 1684 }
		})
		const pdf = mixedPdf(pages)
		// Valid trailing PDF comment data exercises admission above the former 25 MiB cap.
		const bytes = new Uint8Array(
			Buffer.concat([
				Buffer.from(pdf),
				Buffer.from('%'),
				Buffer.alloc(26 * 1024 * 1024, 32),
				Buffer.from('\n')
			])
		)
		const source = documentSource(bytes, 'workshop-manual-70.pdf')
		const gateway = new CsvMemoryGateway(),
			actors = createDocumentActors(new ServerDocumentDecoder(), model)
		const result = await new DocumentProcessingRuntime(actors, gateway, () => model.status()).start(
			source
		)
		const analyzed = gateway.runs.filter((run) => run.procedureKey === 'client.analyze-page-model')
		const outputDirectory = process.env.TEST_CHUNK_EVIDENCE_DIR ?? '/tmp/aven-chunk-real'
		await mkdir(outputDirectory, { recursive: true })
		await writeFile(
			`${outputDirectory}/manual-70.json`,
			JSON.stringify(
				{
					result,
					calls,
					receipts,
					analyzed: analyzed.map((run) => ({
						page: run.parameters.page,
						text: Buffer.from(run.artifacts[0]?.blob?.base64, 'base64').toString()
					}))
				},
				null,
				2
			)
		)
		expect(result.metadata.completedChunks).toBe(70)
		expect(analyzed, JSON.stringify(result.warnings)).toHaveLength(70)
		for (const run of analyzed) {
			const page = Number(run.parameters.page)
			expect(Buffer.from(run.artifacts[0]?.blob?.base64, 'base64').toString()).toContain(
				`ALPHA${String(page).padStart(3, '0')}`
			)
		}
		expect(result.stages.filter((stage) => stage.state === 'failed')).toHaveLength(0)
		for (const actor of actors.all) actor.dispose()
	},
	1_800_000
)

live(
	'real model combines invoice line items across pages without adding document totals twice',
	async () => {
		const modelId = process.env.TEST_CHUNK_MODEL_ID ?? 'qwen3.8-flash-next'
		const service = LlmGatewayService.fromConfig(
			testConfig({
				LLM_GATEWAY_ENABLED: 'true',
				LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
				LLM_GATEWAY_MODELS_JSON: JSON.stringify([
					{
						id: modelId,
						label: modelId,
						capabilities: ['text-generation', 'vision', 'structured-output'],
						baseUrl: endpoint,
						upstreamModel: modelId,
						profile: 'qwen-tools',
						authMode: 'none',
						timeoutSeconds: 900
					}
				])
			})
		)!
		const receipts: unknown[] = []
		const model = new LlmDocumentModelGateway(
			{
				discover: async (caps) => service.models(caps),
				complete: async (request) => {
					const response = await completeThroughFacade(service, request)
					receipts.push(response.receipt)
					return response
				}
			},
			modelId
		)
		const source = documentSource(
			textPdf(
				Array.from({ length: 2 }, (_, page) => [
					'INVOICE INV-CHUNK-006',
					'Supplier: Example Office Supplies Ltd',
					'Buyer: Chunk Proof Ltd',
					'Issue date: 2026-08-15. Due date: 2026-09-15. Currency: EUR.',
					'DOCUMENT TOTALS (all 2 pages): Net EUR 6.00. VAT EUR 1.14. Gross EUR 7.14. Amount due EUR 7.14.',
					'All items are taxable at 19% VAT. No payments received. No discounts or additional charges.',
					'Payment terms: Payment by bank transfer.',
					`Page ${page + 1} of 2. This page contains only the following 3 invoice line items:`,
					'Item | Quantity | Unit price EUR | Net amount EUR | VAT EUR | Gross amount EUR',
					...Array.from(
						{ length: 3 },
						(_, i) => `Item ${page * 3 + i + 1} | 1 | 1.00 | 1.00 | 0.19 | 1.19`
					)
				])
			),
			'invoice-six-items.pdf'
		)
		const gateway = new CsvMemoryGateway(),
			actors = createDocumentActors(new ServerDocumentDecoder(), model)
		const result = await new DocumentProcessingRuntime(actors, gateway, () => model.status()).start(
			source
		)
		const merged = gateway.runs.find((run) => run.procedureKey === 'client.merge-invoice-chunks')
		const candidate = merged?.artifacts[0]?.payload,
			details = merged?.artifacts[1]?.payload
		const outputDirectory = process.env.TEST_CHUNK_EVIDENCE_DIR ?? '/tmp/aven-chunk-real'
		await mkdir(outputDirectory, { recursive: true })
		await writeFile(
			`${outputDirectory}/invoice-six-items.json`,
			JSON.stringify(
				{
					result,
					candidate,
					details,
					receipts,
					parts: gateway.runs
						.filter((run) => run.procedureKey === 'client.extract-invoice-model')
						.map((run) => run.artifacts.map((artifact) => artifact.payload))
				},
				null,
				2
			)
		)
		expect(details?.lineItems, JSON.stringify(result)).toHaveLength(6)
		expect(candidate).toMatchObject({
			invoiceNumber: 'INV-CHUNK-006',
			netMinor: 600,
			taxMinor: 114,
			grossMinor: 714,
			chunkCoverage: { complete: true, total: 2 }
		})
		expect(result.metadata.validationStatus).toBe('consistent')
		expect(result.state, JSON.stringify(result.warnings)).toBe('succeeded')
		actors.all.forEach((actor) => {
			actor.dispose()
		})
	},
	600000
)

live(
	'real model reads a detailed PNG whose request exceeds the former facade body limit',
	async () => {
		const { createCanvas } = await import('@napi-rs/canvas')
		const canvas = createCanvas(1190, 1684),
			context = canvas.getContext('2d')
		const pixels = context.createImageData(1190, 1684)
		let seed = 12345
		for (let i = 0; i < pixels.data.length; i++) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			pixels.data[i] = i % 4 === 3 ? 255 : seed >>> 24
		}
		context.putImageData(pixels, 0, 0)
		context.fillStyle = 'white'
		context.fillRect(0, 0, 1190, 400)
		context.fillStyle = 'black'
		context.font = '36px sans-serif'
		context.fillText('WORKSHOP OPERATIONS MANUAL', 60, 90)
		context.fillText('Safety marker ALPHA-LARGE-IMAGE', 60, 160)
		context.fillText('Inspect the machine before starting work.', 60, 230)
		const bytes = new Uint8Array(canvas.toBuffer('image/png'))
		expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024)
		const modelId = process.env.TEST_CHUNK_MODEL_ID ?? 'qwen3.8-flash-next'
		const service = LlmGatewayService.fromConfig(
			testConfig({
				LLM_GATEWAY_ENABLED: 'true',
				LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
				LLM_GATEWAY_MODELS_JSON: JSON.stringify([
					{
						id: modelId,
						label: modelId,
						capabilities: ['text-generation', 'vision', 'structured-output'],
						baseUrl: endpoint,
						upstreamModel: modelId,
						profile: 'qwen-tools',
						authMode: 'none',
						timeoutSeconds: 900
					}
				])
			})
		)!
		const receipts: unknown[] = []
		const model = new LlmDocumentModelGateway(
			{
				discover: async (caps) => service.models(caps),
				complete: async (request) => {
					const response = await completeThroughFacade(service, request)
					receipts.push(response.receipt)
					return response
				}
			},
			modelId
		)
		const source = documentSource(bytes, 'detailed-manual.png'),
			gateway = new CsvMemoryGateway(),
			actors = createDocumentActors(new ServerDocumentDecoder(), model)
		const result = await new DocumentProcessingRuntime(actors, gateway, () => model.status()).start(
			source
		)
		const analyzed = gateway.runs.find((run) => run.procedureKey === 'client.analyze-page-model')
		const text = analyzed?.artifacts[0]?.blob
			? Buffer.from(analyzed.artifacts[0].blob.base64, 'base64').toString()
			: ''
		const outputDirectory = process.env.TEST_CHUNK_EVIDENCE_DIR ?? '/tmp/aven-chunk-real'
		await mkdir(outputDirectory, { recursive: true })
		await writeFile(
			`${outputDirectory}/detailed-image.json`,
			JSON.stringify({ result, sourceBytes: bytes.length, text, receipts }, null, 2)
		)
		expect(text, JSON.stringify(result)).toContain('ALPHA-LARGE-IMAGE')
		expect(result.stages.filter((stage) => stage.state === 'failed')).toHaveLength(0)
		expect(receipts).toHaveLength(2)
		actors.all.forEach((actor) => {
			actor.dispose()
		})
	},
	300000
)
