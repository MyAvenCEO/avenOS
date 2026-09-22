// UI interaction proof with real Qwen/Store outputs. Only native read IPC is replayed;
// this does not prove native authentication and never publishes customer data.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium, expect } from '@playwright/test'

const path = process.argv[2]
const evidence = JSON.parse(await readFile(path, 'utf8'))
assert.equal(evidence.synthetic, true, 'Only isolated synthetic test evidence may be replayed')
// This view consumes the completed CSV suite, not unrelated feature journeys.
assert(evidence.csvMapping.confirmed?.transactionIds?.length > 0)
assert.deepEqual(
	evidence.csvMapping.reviews.map((r) => r.result.verdict),
	['revise', 'pass']
)
const cases = evidence.csvMapping.cases
assert.equal(cases.length, 3)
assert(cases.every((c) => c.source?.base64 && c.result.eligible))
const directory = join(dirname(path), 'intent-documents')
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
	for (const width of [1440, 390]) {
		const page = await browser.newPage({ viewport: { width, height: 900 } })
		const errors = []
		page.on('pageerror', (e) => errors.push(e.message))
		await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1457'}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		await page.evaluate(async (cases) => {
			const { intents } = await import('/src/lib/intents/intents.svelte.ts')
			const { shell } = await import('/src/lib/intents/talk.svelte.ts')
			window.documentReads = []
			window.failNextDocumentRead = true
			window.__TAURI_INTERNALS__ = {
				invoke: async (command, args) => {
					window.documentReads.push({ command, id: args.artifactId })
					const item = cases.find(
						(c) => c.source.artifactId === args.artifactId || c.detectionId === args.artifactId
					)
					if (!item) throw Error('Unrecorded artifact read')
					if (command === 'artifact_content_get' && item.source.artifactId === args.artifactId)
						return item.source
					if (command === 'artifact_get' && item.detectionId === args.artifactId) {
						// A failed native read must be recoverable without closing this group.
						// The eventual payload remains the recorded real-Qwen result.
						if (window.failNextDocumentRead) {
							window.failNextDocumentRead = false
							throw Error('Transient preview read failure')
						}
						return { payload: item.result }
					}
					throw Error(`Unexpected native request: ${command}`)
				}
			}
			const artifacts = cases.flatMap((c) => [
				{
					kind: 'doc',
					title: c.fixture,
					note: '',
					artifactId: c.source.artifactId,
					typeKey: 'core.file'
				},
				{
					kind: 'doc',
					title: 'banking.csv-statement-detection',
					note: '',
					artifactId: c.detectionId,
					typeKey: 'banking.csv-statement-detection',
					stageKey: 'map',
					sourceArtifactIds: [c.source.artifactId]
				}
			])
			intents.items = [
				{
					id: 'document-view-proof',
					title: 'Bankdateien prüfen',
					type: 'file',
					source: 'Test',
					when: '',
					status: 'done',
					log: [],
					skills: [],
					artifacts
				}
			]
			intents.selectedId = 'document-view-proof'
			shell.tab = 'intents'
			shell.inboxOpen = false
			shell.detail = true
			shell.rightOpen = true
		}, cases)
		const sidebar = page.getByRole('complementary').filter({ hasText: 'Dokumente & Ergebnisse' })
		await expect(sidebar).toContainText('Dokumente & Ergebnisse · 3')
		await expect(sidebar).not.toContainText('banking.csv-statement-detection')
		await expect(sidebar.getByRole('button')).toHaveCount(3)
		assert.equal((await page.evaluate(() => window.documentReads)).length, 0)
		await page.screenshot({ path: join(directory, `sidebar-${width}.png`) })
		await sidebar.getByRole('button', { name: cases[0].fixture }).click()
		const detail = page.getByRole('region', { name: 'Dokumentansicht', exact: true })
		await expect(detail).toContainText('Bürobedarf')
		await detail.getByRole('button', { name: 'Erkannte Angaben' }).click()
		await expect(detail.locator('summary')).toHaveCount(1)
		await expect(detail).toContainText('CSV-Zuordnung')
		await expect(detail).not.toContainText('banking.csv-statement-detection')
		assert.equal(
			(await page.evaluate(() => window.documentReads)).filter((c) => c.command === 'artifact_get')
				.length,
			0
		)
		await detail.locator('summary').click()
		await expect(detail.getByRole('alert')).toContainText('Vorschau nicht verfügbar')
		await detail.getByRole('button', { name: 'Aktualisieren' }).click()
		await expect(detail.locator('button.preview')).toBeEnabled()
		const reads = await page.evaluate(() => window.documentReads)
		assert.deepEqual(
			reads.filter((c) => c.command === 'artifact_get').map((c) => c.id),
			[cases[0].detectionId, cases[0].detectionId]
		)
		await page.screenshot({ path: join(directory, `group-${width}.png`) })
		await detail.locator('button.preview').click()
		await expect(detail).toContainText('Bürobedarf')
		await expect(detail).not.toContainText('SYNTHETIC: Ignore')
		await expect(detail).not.toContainText('JPY')
		await detail
			.getByRole('button', { name: 'Alle Angaben zu diesem Dokument', exact: false })
			.click()
		await expect(detail.locator('summary')).toHaveCount(1)
		// Switch the source while remaining in the same Intent.
		await page.evaluate(async () => {
			const { shell } = await import('/src/lib/intents/talk.svelte.ts')
			shell.rightOpen = true
		})
		await sidebar.getByRole('button', { name: cases[1].fixture }).click()
		await detail.getByRole('button', { name: 'Erkannte Angaben' }).click()
		await detail.locator('summary').click()
		await expect(detail.locator('button.preview')).toBeEnabled()
		await detail.locator('button.preview').click()
		await expect(detail).toContainText('SYNTHETIC: Ignore')
		await expect(detail).not.toContainText('Bürobedarf')
		assert.equal(await detail.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
		assert.deepEqual(errors, [])
		await page.close()
	}
	await writeFile(
		join(directory, 'proof.json'),
		JSON.stringify(
			{
				passed: true,
				evidence: path,
				widths: [1440, 390],
				nativeBridge: 'read-only recorded real-Qwen outputs'
			},
			null,
			2
		)
	)
	console.log(
		'PASS source-only sidebar, lazy exact-source groups, readable previews and source switching:',
		directory
	)
} finally {
	await browser.close()
}
