// Exercises the real library screen and its exact-ID handoff to Skill Studio.
// Only the native IPC boundary is simulated.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const sourceId = '10000000-0000-4000-8000-000000000001'
const detailsId = '10000000-0000-4000-8000-000000000002'
const statementId = '10000000-0000-4000-8000-000000000003'
const source = {
	artifactId: sourceId,
	typeKey: 'core.file',
	typeVersion: 1,
	payload: { originalName: 'invoice.txt' },
	committedAt: '2026-09-15T10:00:00Z'
}
const details = {
	artifactId: detailsId,
	typeKey: 'bookkeeping.invoice-details',
	typeVersion: 1,
	payload: { supplier: { name: 'Example Supplier' }, invoiceNumber: 'INV-7', grossMinor: 12345 },
	committedAt: '2026-09-15T10:01:00Z'
}
const invoice = {
	key: `${sourceId}/invoice`,
	source,
	name: 'invoice.txt',
	mediaType: 'text/plain',
	sizeBytes: 18,
	category: 'invoice',
	status: 'checked',
	artifactType: 'bookkeeping.invoice-details',
	data: {
		supplier: 'Example Supplier',
		invoiceNumber: 'INV-7',
		grossMinor: 12345,
		currency: 'EUR'
	},
	representations: [details]
}
const documents = [
	{
		...invoice,
		key: `${sourceId}/document`,
		artifactType: 'core.file',
		data: { name: 'invoice.txt', category: 'invoice', date: '2026-09-15T10:00:00Z' }
	},
	{
		...invoice,
		key: `${statementId}/document`,
		source: { ...source, artifactId: statementId, payload: { originalName: 'statement.txt' } },
		name: 'statement.txt',
		category: 'statement',
		artifactType: 'core.file',
		representations: [],
		data: { name: 'statement.txt', category: 'statement', date: '2026-09-14T10:00:00Z' }
	}
]

const browser = await chromium.launch({ headless: true })
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	page.setDefaultTimeout(10000)
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto(`${process.env.AVEN_LIBRARY_UI_URL ?? 'http://127.0.0.1:1463'}/dashboard`)
	await page.getByRole('button', { name: 'Artefakte', exact: true }).waitFor()
	await page.evaluate(
		({ documents, invoice, source, details }) => {
			window.isTauri = true
			window.libraryFixture = { calls: [], sourceReads: 0 }
			window.__TAURI_INTERNALS__ = {
				invoke: async (command, args) => {
					window.libraryFixture.calls.push({ command, args: structuredClone(args) })
					if (command === 'artifact_library') {
						const { collection, category, search } = args.query
						let items =
							collection === 'documents' ? documents : collection === 'invoices' ? [invoice] : []
						if (category !== 'all') items = items.filter((row) => row.category === category)
						if (search) items = items.filter((row) => row.name.includes(search))
						return { storeEpoch: 'fixture-epoch', snapshotSequence: 3, items, nextAfter: null }
					}
					if (command === 'artifact_get')
						return args.artifactId === details.artifactId ? details : source
					if (command === 'artifact_evidence_get') return { evidence: [] }
					if (command === 'artifact_content_get') {
						window.libraryFixture.sourceReads++
						return { mediaType: 'text/plain', base64: btoa('Invoice original') }
					}
					if (command === 'studio_request') {
						if (args.command.operation === 'state')
							return {
								scopeId: 'fixture-scope',
								subjectId: 'fixture-subject',
								drafts: [],
								connections: [],
								runs: [],
								files: [source],
								skills: [],
								sources: [],
								artifacts: [source, details],
								deliveries: [],
								catalog: [],
								dispatchMode: 'authorized-session'
							}
						if (args.command.operation === 'explore')
							return {
								source: args.command.data.artifactId === details.artifactId ? details : source,
								opportunities: [],
								next: 'Choose an outcome.'
							}
					}
					return null
				}
			}
		},
		{ documents, invoice, source, details }
	)
	await page.getByRole('button', { name: 'Artefakte', exact: true }).click()
	await page.getByRole('table', { name: 'Dokumente' }).getByText('invoice.txt').waitFor()
	assert.equal(await page.getByRole('table', { name: 'Dokumente' }).locator('tbody tr').count(), 2)
	await page.getByRole('button', { name: 'Rechnungen', exact: true }).click()
	assert.equal(await page.getByRole('table', { name: 'Dokumente' }).locator('tbody tr').count(), 1)
	await page.getByRole('button', { name: 'Alle', exact: true }).click()
	await page.getByRole('button', { name: 'Rechnungen & Belege', exact: true }).click()
	await page
		.getByRole('table', { name: 'Rechnungen & Belege' })
		.getByRole('button', { name: 'Example Supplier' })
		.click()
	await page.getByRole('button', { name: 'Explore possibilities ↗' }).waitFor()
	assert.equal(
		await page.evaluate(() => window.libraryFixture.sourceReads),
		1,
		'source bytes are read only after explicit preview selection'
	)
	await page.screenshot({ path: '/tmp/aven-artifact-library-invoice.png', fullPage: true })
	await page.getByRole('button', { name: 'Explore possibilities ↗' }).click()
	await page.getByRole('button', { name: 'Skills', exact: true }).waitFor()
	await page.waitForFunction(
		(id) =>
			window.libraryFixture.calls.some(
				(call) =>
					call.command === 'studio_request' &&
					call.args.command.operation === 'explore' &&
					call.args.command.data.artifactId === id
			),
		detailsId
	)
	assert.deepEqual(errors, [])
	console.log(JSON.stringify({ passed: true, sourceReads: 1, studioArtifactId: detailsId }))
} finally {
	await browser.close()
}
