// Run against the worktree Vite server. Only the native IPC boundary is simulated;
// the actual settings component, selection, ingestion adapter and source identity run.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const output = mkdtempSync(join(tmpdir(), 'aven-email-ui-'))
const connector = fileURLToPath(new URL('../../prototypes/imap-pdf/imap_pdf.py', import.meta.url))
const sample = spawnSync('python3', ['-I', connector, '--tauri', output], {
	input: JSON.stringify({ operation: 'demo' }),
	encoding: 'utf8'
})
assert.equal(sample.status, 0)
const result = JSON.parse(sample.stdout).result
result.scope = 'synthetic-account-scope'
const browser = await chromium.launch({ headless: true })
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
	page.setDefaultTimeout(10000)
	await page.goto(`${process.env.AVEN_EMAIL_UI_URL || 'http://127.0.0.1:1437'}/dashboard/settings`)
	await page.getByRole('button', { name: 'Email', exact: true }).waitFor()
	await page.evaluate((fixture) => {
		window.isTauri = true
		window.emailCalls = []
		window.emailHoldProcessing = true
		const intents = new Map()
		window.__TAURI_INTERNALS__ = {
			invoke: async (command, args) => {
				if (command === 'imap_account_scope') return fixture.scope
				if (command === 'imap_scan') {
					window.emailCalls.push({
						command,
						operation: args.request.operation,
						cursor: args.request.cursor
					})
					await new Promise((resolve) => setTimeout(resolve, 150))
					if (args.request.operation === 'start')
						return {
							...fixture,
							attachments: [],
							snapshotId: 'snapshot',
							total: 3,
							cursor: 0,
							phase: 'indexing',
							indexed: 3
						}
					if (args.request.operation === 'batch') {
						const cursor = args.request.cursor
						return {
							...fixture,
							snapshotId: 'snapshot',
							total: 3,
							cursor: cursor + 1,
							done: cursor === 2,
							phase: 'importing',
							attachments: [
								{
									...fixture.attachments[0],
									id: `mail-${cursor}`,
									path: `/tmp/mail-${cursor}.pdf`,
									name: `mail-${cursor}.pdf`
								}
							]
						}
					}
					if (args.request.operation === 'list')
						return { ...fixture, attachments: [], mailboxes: ['INBOX', 'Invoices'] }
					return fixture
				}
				window.emailCalls.push({ command, args })
				if (command === 'intent_create') {
					intents.set(args.intent.id, args.intent)
					return args.intent
				}
				if (command === 'artifact_upload') {
					if (!args.observedAt.endsWith('Z')) throw new Error('ARTIFACT_REQUEST_INVALID')
					return {
						publicationId: args.publicationId,
						intentId: args.intentId,
						intentDeclarationArtifactId: args.intentId,
						artifactId: args.publicationId,
						originalName: 'sample-invoice.pdf',
						mediaType: 'application/pdf',
						sha256: '0'.repeat(64),
						length: 595,
						scopeSequence: 1,
						replayed: false
					}
				}
				if (command === 'intent_get')
					return {
						...intents.get(args.intentId),
						id: args.intentId,
						state: 'active',
						version: 1,
						contributions: [],
						artifacts: [],
						fileSkill: null
					}
				if (command === 'artifact_get')
					return {
						payload: { originalName: 'sample-invoice.pdf', declaredMediaType: 'application/pdf' }
					}
				if (command === 'actor_run_start') {
					if (window.emailHoldProcessing)
						await new Promise((resolve) => {
							window.emailReleaseProcessing = resolve
						})
					throw new Error('Synthetic test stops at document admission.')
				}
				if (command === 'artifact_store_list') return { artifacts: [] }
				if (command === 'intent_list') return []
				return null
			}
		}
	}, result)
	await page.getByRole('button', { name: 'Email', exact: true }).click()
	await page.getByLabel('IMAP hostname').fill('imap.example.test')
	await page.getByLabel('Mailbox login').fill('reader@example.test')
	await page.getByLabel('Password or app password').fill('synthetic-password')
	await page.getByRole('button', { name: 'Connect and list folders' }).click()
	await page.getByText('Connected. 2 folders available.').waitFor()
	await page.getByLabel('Folder', { exact: true }).selectOption('Invoices')
	await page.getByText('Date range and preview', { exact: true }).click()
	await page.getByRole('button', { name: 'Find PDF attachments' }).click()
	await page.getByText('2 PDF attachments found.').waitFor()
	assert.equal(await page.getByLabel('Password or app password').inputValue(), '')
	assert.equal(await page.getByRole('checkbox').count(), 2)
	await page.getByRole('checkbox').nth(1).uncheck()
	await page.getByLabel('Process documents on').selectOption('server')
	await page.evaluate(async () => {
		const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
		const { intents } = await import('/src/lib/intents/intents.svelte.ts')
		window.emailOriginalView = {
			session: chatActor.core.session,
			turns: chatActor.core.turns.length,
			intent: intents.selectedId
		}
	})
	await page.getByRole('button', { name: 'Import selected PDFs' }).click()
	await page.getByRole('link', { name: 'Open workspace' }).waitFor()
	const calls = await page.evaluate(() => window.emailCalls)
	const uploads = calls.filter((call) => call.command === 'artifact_upload')
	assert.equal(uploads.length, 1)
	assert.equal(uploads[0].args.expectedImapScope, result.scope)
	assert.equal(uploads[0].args.executionEnvironment, 'server')
	assert.match(uploads[0].args.path, /staged\/.*\/sample-invoice\.pdf$/)
	const intent = calls.find((call) => call.command === 'intent_create')
	assert.equal(intent.args.intent.sourceLabel, 'Email · Demo attachment')
	assert.match(intent.args.intent.routingSummary, /Subject: Your sample PDF|Subject: Same PDF/)
	await page.waitForFunction(() =>
		window.emailCalls.some((call) => call.command === 'actor_run_start')
	)
	await page.getByText(/Import finished\. 1 PDFs uploaded/).waitFor()
	await page.getByLabel('Password or app password').fill('synthetic-password')
	await page.getByRole('button', { name: 'Import whole folder · oldest first' }).click()
	assert.equal(await page.getByLabel('Password or app password').inputValue(), '')
	// Destroy the Email component while the job is active. It must keep running.
	await page.getByRole('button', { name: 'Models', exact: true }).click()
	await page.waitForFunction(
		() => window.emailCalls.filter((call) => call.command === 'artifact_upload').length === 4
	)
	await page.getByRole('button', { name: 'Email', exact: true }).click()
	await page.getByText(/Import finished\. 3 PDFs uploaded/).waitFor()
	const allCalls = await page.evaluate(() => window.emailCalls)
	assert.deepEqual(
		allCalls
			.filter((call) => call.command === 'artifact_upload')
			.slice(1)
			.map((call) => call.args.path),
		['/tmp/mail-0.pdf', '/tmp/mail-1.pdf', '/tmp/mail-2.pdf']
	)
	assert.equal(allCalls.filter((call) => call.command === 'intent_create').length, 4)
	assert.equal(
		new Set(
			allCalls.filter((call) => call.command === 'intent_create').map((call) => call.args.intent.id)
		).size,
		4
	)
	// The first ingestion is still blocked, but every mailbox upload has committed.
	assert.equal(allCalls.filter((call) => call.command === 'actor_run_start').length, 1)
	await page.getByText(/Document processing continues separately/).waitFor()
	await page.evaluate(() => {
		window.emailHoldProcessing = false
		window.emailReleaseProcessing()
	})
	await page.waitForFunction(
		() => window.emailCalls.filter((call) => call.command === 'actor_run_start').length === 4
	)

	assert.equal(
		await page.evaluate(async () => {
			const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
			const { intents } = await import('/src/lib/intents/intents.svelte.ts')
			return (
				chatActor.core.session === window.emailOriginalView.session &&
				chatActor.core.turns.length === window.emailOriginalView.turns &&
				intents.selectedId === window.emailOriginalView.intent
			)
		}),
		true,
		'background uploads must leave the selected conversation unchanged'
	)
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
	await page.screenshot({
		path: process.env.AVEN_EMAIL_UI_SCREENSHOT || '/tmp/aven-email-settings.png',
		fullPage: true
	})
	console.log(
		'Email UI passed: folder selection, credential clearing, PDF selection, native upload scope, document admission and autonomous chronological import after leaving settings, and uploads continuing while ingestion is blocked.'
	)
} finally {
	await browser.close()
	rmSync(output, { recursive: true, force: true })
}
