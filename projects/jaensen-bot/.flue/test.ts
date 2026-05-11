import { readFile, rm } from 'fs/promises'
import { createFsStorage, createMemoryStorage, loadSkillRegistry, LocalSandboxFactory, MockSandboxFactory, runJaensenTurn } from './jaensen.js'

async function runTests() {
	console.log('🧪 Testing Jaensen skill dispatch harness\n')

	const testDir = '/tmp/jaensen-test'
	await rm(testDir, { recursive: true, force: true })
	const storage = createMemoryStorage()
	const skillRegistry = await loadSkillRegistry('/home/daniel/src/oMaiaCity/AvenOS/projects/jaensen-bot')
	console.log('Registered skills:', Object.keys(skillRegistry).join(', '))

	const localSandboxFactory = new LocalSandboxFactory(`${testDir}/sandboxes`)
	const localSandbox = await localSandboxFactory.createSandbox({
		skill: 'memory',
		intentId: 'sandbox-check',
		workerType: 'remember'
	})
	await localSandbox.writeFile('inside.txt', 'sandbox-ok')
	const sandboxRun = await localSandbox.run('pwd && test -f inside.txt && cat inside.txt && (test -f /etc/passwd && echo ETC_VISIBLE || true)')
	let pathEscapeBlocked = false
	try {
		await localSandbox.writeFile('../escape.txt', 'blocked')
	} catch {
		pathEscapeBlocked = true
	}

	const prompts: string[] = []
	const unsupportedSkillResult = await runJaensenTurn(
		{
			from: 'owner@aven.ceo',
			message: "Write that builder guy that I'm not interested"
		},
		{
			storage,
			sandboxFactory: new MockSandboxFactory(() => ({ stdout: 'ok', exitCode: 0 })),
			skillRegistry,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({
						relevantIntentIds: [],
						createIntent: {
							title: 'Email builder - not interested',
							summary: "User wants to send an email to a 'builder' declining interest"
						}
					})
				}
				if (prompt.includes('INTENT_DECISION')) {
					return JSON.stringify({
						summary: "User wants to send an email to a 'builder' declining interest",
						status: 'active',
						replyDraft: 'I can help with that.',
						contextUpdates: {},
						actions: [
							{
								skill: 'email',
								operation: 'draft-reply',
								input: { tone: 'brief' }
							}
						],
						humanLoop: { needed: false }
					})
				}
				return JSON.stringify({ reply: 'I can help with that.' })
			}
		}
	)

	const supportedSkillResult = await runJaensenTurn(
		{
			from: 'customer@client.com',
			message:
				'Customer says order #12345 is delayed. Please remember the case and review https://example.com/orders/12345.'
		},
		{
			storage,
			sandboxFactory: new MockSandboxFactory(() => ({ stdout: 'ok', exitCode: 0 })),
			skillRegistry,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({
						relevantIntentIds: [],
						createIntent: {
							title: 'Order #12345 support case',
							summary: 'Customer asked about a delayed shipment for order #12345.'
						}
					})
				}
				if (prompt.includes('INTENT_DECISION')) {
					return JSON.stringify({
						summary: 'Customer asked about a delayed shipment for order #12345.',
						status: 'pending',
						replyDraft: 'I will review the order and keep track of the case.',
						contextUpdates: { orderId: '12345' },
						actions: [
							{
								skill: 'memory',
								operation: 'remember',
								input: { topic: 'Order #12345 support case', note: 'Customer reported a delayed shipment for order #12345.' }
							}
						],
						humanLoop: {
							needed: true,
							reason: 'shipment delayed',
							message: 'Human follow-up may be needed if the shipment remains delayed.'
						}
					})
				}

				return JSON.stringify({
					reply:
						'I have logged the delayed-shipment case for order #12345 and noted that human follow-up may be needed.'
				})
			}
		}
	)

	const hitlClarificationResult = await runJaensenTurn(
		{
			from: 'owner@aven.ceo',
			message: 'Should I proceed with this ambiguous request?'
		},
		{
			storage,
			sandboxFactory: new MockSandboxFactory(() => ({ stdout: 'ok', exitCode: 0 })),
			skillRegistry,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({
						relevantIntentIds: [],
						createIntent: {
							title: 'Ambiguous request',
							summary: 'Need clarification before proceeding'
						}
					})
				}
				if (prompt.includes('INTENT_DECISION')) {
					return JSON.stringify({
						summary: 'Need clarification before proceeding',
						status: 'pending',
						contextUpdates: {},
						actions: [],
						humanLoop: {
							needed: true,
							reason: 'Clarification required',
							message: 'Please confirm what outcome you want before I continue.'
						},
						replyDraft: 'I need your clarification before I continue.'
					})
				}
				return JSON.stringify({ reply: 'I need your clarification before I continue.' })
			}
		}
	)

	const fsStorage = await createFsStorage(testDir)
	const uploaded = await fsStorage.archive.put({
		key: 'upload-contract.txt',
		content: new TextEncoder().encode('signed contract draft'),
		contentType: 'text/plain',
		metadata: { name: 'contract.txt', source: 'upload-test' }
	})
	const attachmentArchiveResult = await runJaensenTurn(
		{
			from: 'owner@aven.ceo',
			message: 'Please ingest the uploaded contract.',
			attachment: {
				name: 'contract.txt',
				contentType: 'text/plain',
				base64: Buffer.from('signed contract draft').toString('base64'),
				archiveKey: uploaded.key
			}
		},
		{
			storage: fsStorage,
			sandboxFactory: new MockSandboxFactory(() => ({ stdout: 'ok', exitCode: 0 })),
			skillRegistry,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({
						relevantIntentIds: [],
						createIntent: {
							title: 'Contract ingest',
							summary: 'Ingest uploaded contract'
						}
					})
				}
				if (prompt.includes('INTENT_DECISION')) {
					return JSON.stringify({
						summary: 'Ingest uploaded contract',
						status: 'active',
						contextUpdates: {},
						actions: [
							{ skill: 'ingest', operation: 'archive-attachment', input: {} }
						],
						humanLoop: { needed: false },
						replyDraft: 'I have access to the uploaded file.'
					})
				}
				return JSON.stringify({ reply: 'I have access to the uploaded file.' })
			}
		}
	)

	const ingestThenExtractResult = await runJaensenTurn(
		{
			from: 'owner@aven.ceo',
			message: 'Process the uploaded invoice.',
			attachment: {
				name: 'invoice.txt',
				contentType: 'text/plain',
				base64: Buffer.from('Invoice INVCZ11145921\nAmount 123.45 EUR').toString('base64'),
				archiveKey: 'upload-contract.txt'
			}
		},
		{
			storage: fsStorage,
			sandboxFactory: new MockSandboxFactory(() => ({ stdout: 'ok', exitCode: 0 })),
			skillRegistry,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({
						relevantIntentIds: [],
						createIntent: {
							title: 'Invoice processing',
							summary: 'Process uploaded invoice'
						}
					})
				}
				if (prompt.includes('INTENT_DECISION')) {
					return JSON.stringify({
						summary: 'Process uploaded invoice',
						status: 'active',
						contextUpdates: {},
						actions: [
							{ skill: 'ingest', operation: 'archive-attachment', input: { name: 'invoice.txt', contentType: 'text/plain' } }
						],
						humanLoop: { needed: false },
						replyDraft: 'Processing invoice.'
					})
				}
				return JSON.stringify({ reply: 'Processing invoice.' })
			}
		}
	)

	const toolCallParsingResult = await runJaensenTurn(
		{
			from: 'owner@aven.ceo',
			message: 'Extract the archived invoice data.'
		},
		{
			storage: fsStorage,
			sandboxFactory: new MockSandboxFactory(() => ({ stdout: 'Invoice INVCZ11145921\nAmount 123.45 EUR', exitCode: 0 })),
			skillRegistry,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({
						relevantIntentIds: [],
						createIntent: { title: 'Tool call invoice', summary: 'Extract archived invoice' }
					})
				}
				if (prompt.includes('INTENT_DECISION')) {
					return `The invoice PDF is already archived.\n[TOOL_CALL]\n{tool => "extract", args => {\n  --operation "extract-text"\n  --input {"key": "upload-contract.txt", "contentType": "text/plain"}\n}}\n[/TOOL_CALL]`
				}
				return JSON.stringify({ reply: 'Extracting archived invoice.' })
			}
		}
	)

	const sourceAliasResult = await runJaensenTurn(
		{
			from: 'owner@aven.ceo',
			message: 'Process pdf using source alias.'
		},
		{
			storage: fsStorage,
			sandboxFactory: new MockSandboxFactory(() => ({ stdout: 'Invoice from source alias', exitCode: 0 })),
			skillRegistry,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({ relevantIntentIds: [], createIntent: { title: 'Source alias invoice', summary: 'Use source alias' } })
				}
				if (prompt.includes('INTENT_DECISION')) {
					return JSON.stringify({
						summary: 'Extracting invoice data from archived PDF at upload-contract.txt',
						status: 'active',
						contextUpdates: {},
						actions: [{ skill: 'extract', operation: 'extract-text', input: { source: 'upload-contract.txt', contentType: 'application/pdf' } }],
						humanLoop: { needed: true, reason: 'awaiting_extraction_result', message: 'Extracting invoice data...' },
						replyDraft: 'Extracting invoice data from archived PDF at upload-contract.txt'
					})
				}
				return JSON.stringify({ reply: 'Extracting invoice data from archived PDF at upload-contract.txt' })
			}
		}
	)

	const realPdfBytes = new Uint8Array(await readFile('/home/daniel/Downloads/Invoice_INVCZ11145921.pdf'))
	await fsStorage.archive.put({
		key: 'Invoice_INVCZ11145921.pdf',
		content: realPdfBytes,
		contentType: 'application/pdf',
		metadata: { name: 'Invoice_INVCZ11145921.pdf', source: 'downloads-fixture' }
	})
	const sandboxPdfExtractResult = await runJaensenTurn(
		{
			from: 'owner@aven.ceo',
			message: 'Extract what you can from the archived JetBrains invoice PDF.'
		},
		{
			storage: fsStorage,
			sandboxFactory: new LocalSandboxFactory(`${testDir}/sandboxes-pdf`, '/home/daniel/Downloads'),
			skillRegistry,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({
						relevantIntentIds: [],
						createIntent: { title: 'PDF invoice extraction', summary: 'Extract the archived JetBrains invoice PDF' }
					})
				}
				if (prompt.includes('INTENT_DECISION')) {
					return JSON.stringify({
						summary: 'Extract text from the archived JetBrains invoice PDF using the extractor sandbox worker.',
						status: 'active',
						contextUpdates: {},
						actions: [{ skill: 'extract', operation: 'extract-text', input: { key: 'Invoice_INVCZ11145921.pdf', contentType: 'application/pdf' } }],
						humanLoop: { needed: false },
						replyDraft: 'Running the extractor against the archived invoice PDF.'
					})
				}
				return JSON.stringify({ reply: 'Running the extractor against the archived invoice PDF.' })
			}
		}
	)
	const sandboxPdfExtractText = sandboxPdfExtractResult.skillResults.find((result) => result.skill === 'extract')?.data?.text
	const sandboxPdfWorkerStdout = sandboxPdfExtractResult.skillResults.find((result) => result.skill === 'extract')?.data?.worker?.stdout ?? ''
	const sandboxPdfWorkerStderr = sandboxPdfExtractResult.skillResults.find((result) => result.skill === 'extract')?.data?.worker?.stderr ?? ''

	const realPngPath = '/home/daniel/Downloads/image (3).png'
	const realPngBytes = new Uint8Array(await readFile(realPngPath))
	await fsStorage.archive.put({
		key: 'image-3.png',
		content: realPngBytes,
		contentType: 'image/png',
		metadata: { name: 'image (3).png', source: 'downloads-fixture' }
	})
	const sandboxImageExtractResult = await runJaensenTurn(
		{
			from: 'owner@aven.ceo',
			message: 'Extract what you can from the archived PNG screenshot.'
		},
		{
			storage: fsStorage,
			sandboxFactory: new LocalSandboxFactory(`${testDir}/sandboxes-images`, '/home/daniel/Downloads'),
			skillRegistry,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({
						relevantIntentIds: [],
						createIntent: { title: 'PNG OCR extraction', summary: 'Extract text from the archived PNG screenshot' }
					})
				}
				if (prompt.includes('INTENT_DECISION')) {
					return JSON.stringify({
						summary: 'Extract text from the archived PNG screenshot using OCR in the extractor sandbox worker.',
						status: 'active',
						contextUpdates: {},
						actions: [{ skill: 'extract', operation: 'extract-text', input: { key: 'image-3.png', contentType: 'image/png' } }],
						humanLoop: { needed: false },
						replyDraft: 'Running OCR against the archived PNG screenshot.'
					})
				}
				return JSON.stringify({ reply: 'Running OCR against the archived PNG screenshot.' })
			}
		}
	)
	const sandboxImageExtractText = sandboxImageExtractResult.skillResults.find((result) => result.skill === 'extract')?.data?.text ?? ''
	const sandboxImageWorkerStderr = sandboxImageExtractResult.skillResults.find((result) => result.skill === 'extract')?.data?.worker?.stderr ?? ''

	const memoryContent = (await storage.memory.readTopic('Order #12345 support case')) ?? ''
	const availableSkillsPrompt = prompts.find((prompt) => prompt.includes('Available skills')) ?? ''
	const promptBlob = prompts.join('\n\n')
	const availableSkillsSection = availableSkillsPrompt.match(/Available skills:\n([\s\S]*?)\n\nIntent:/)?.[1] ?? '[]'
	const availableSkillIds = (() => {
		try {
			return (JSON.parse(availableSkillsSection) as Array<{ skill?: string }>).map((entry) => entry.skill).filter((value): value is string => typeof value === 'string')
		} catch {
			return []
		}
	})()

	console.log('Unsupported skill filtered:', unsupportedSkillResult.intentDecision.actions.length === 0 ? '✅' : '❌')
	console.log('Intent prompt constrained to registered skills:', availableSkillIds.includes('memory') && availableSkillIds.includes('ingest') && availableSkillIds.includes('extract') && !availableSkillIds.includes('email') ? '✅' : '❌')
	console.log('Sandbox cwd isolated:', sandboxRun.stdout.includes('/workspace') ? '✅' : '❌')
	console.log('Sandbox file access works:', sandboxRun.stdout.includes('sandbox-ok') ? '✅' : '❌')
	console.log('Sandbox path escape blocked:', pathEscapeBlocked ? '✅' : '❌')
	console.log('Intent-only human notification:', hitlClarificationResult.humanNotification === 'Please confirm what outcome you want before I continue.' && hitlClarificationResult.skillResults.length === 0 ? '✅' : '❌')
	console.log('Uploaded file reused from virtual fs:', attachmentArchiveResult.skillResults.some((result) => result.summary === 'Attachment already archived' && result.data?.key === uploaded.key) ? '✅' : '❌')
	console.log('Raw attachment omitted from LLM prompts:', !promptBlob.includes(Buffer.from('signed contract draft').toString('base64')) ? '✅' : '❌')
	console.log('Ingest triggers extract follow-up:', ingestThenExtractResult.skillResults.some((result) => result.skill === 'extract' && result.summary.includes('Extracted text from upload-contract.txt')) ? '✅' : '❌')
	console.log('TOOL_CALL action parsing works:', toolCallParsingResult.skillResults.some((result) => result.skill === 'extract' && result.summary.includes('Extracted text from upload-contract.txt')) ? '✅' : '❌')
	console.log('Extract source alias works:', sourceAliasResult.skillResults.some((result) => result.skill === 'extract' && result.summary.includes('Extracted text from upload-contract.txt')) ? '✅' : '❌')
	console.log('PDF extractor shell loop works in sandbox:', typeof sandboxPdfExtractText === 'string' && sandboxPdfExtractText.includes('Invoice INVCZ11145921') && sandboxPdfExtractText.includes('JetBrains AI') && sandboxPdfWorkerStdout.includes('Invoice INVCZ11145921') ? '✅' : '❌')
	console.log('Extractor analyzes files before acting:', sandboxPdfWorkerStderr.includes('ANALYSIS mime=application/pdf') && sandboxImageWorkerStderr.includes('ANALYSIS mime=image/png') ? '✅' : '❌')
	console.log('PNG OCR works in sandbox:', sandboxImageExtractText.includes('Request Payload') && sandboxImageExtractText.includes('OrderItem') && !sandboxImageExtractText.includes('IHDR') ? '✅' : '❌')
	console.log('Extractor truncates oversized/binary-ish output safely:', !sandboxImageExtractText.includes('79255 more characters') && !sandboxImageExtractText.includes('IHDR\x00\x00') ? '✅' : '❌')
	console.log('No premature human loop during active extraction:', sourceAliasResult.humanNotification ? '❌' : '✅')
	console.log('Response:', supportedSkillResult.response)
	console.log('Primary intent:', supportedSkillResult.primaryIntent.title)
	console.log('Prompts used:', prompts.length)
	console.log('Memory written:', memoryContent.includes('delayed shipment') ? '✅' : '❌')
	console.log('Human notify:', supportedSkillResult.humanNotification ? '✅' : '❌')

	await rm(testDir, { recursive: true, force: true })
	console.log('\n🎉 Jaensen skill dispatch harness completed!')
}

runTests().catch((error) => {
	console.error(error)
	process.exitCode = 1
})