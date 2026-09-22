// Render actual real-Qwen/Store results. Publication is proved by the live service
// journey, not faked in this browser-only layout and interaction check.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium, expect } from '@playwright/test'

const path = process.argv[2]
const evidence = JSON.parse(await readFile(path, 'utf8'))
assert.equal(evidence.passed, true)
assert.equal(evidence.csvMapping.cases.length, 3)
assert(evidence.csvMapping.confirmed.transactionIds.length)
const output = join(dirname(path), 'csv-ui')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
	for (const width of [1280, 390]) {
		const page = await browser.newPage({ viewport: { width, height: 800 } })
		const errors = []
		page.on('pageerror', (e) => errors.push(e.message))
		await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1457'}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		await page.evaluate(async ({ result, detectionId, mapping }) => {
			const { mount } = await import('/@id/svelte')
			const { default: Viewer } = await import('/src/lib/artifacts/CsvMappingReview.svelte')
			const target = document.createElement('main')
			target.style.cssText =
				'position:fixed;inset:0;z-index:10000;overflow:auto;background:var(--color-surface-page)'
			document.body.append(target)
			mount(Viewer, {
				target,
				props: {
					artifactId: detectionId,
					detection: result,
					initialMapping: mapping
				}
			})
		}, evidence.csvMapping.cases[0])
		const review = page.getByRole('region', { name: 'CSV mapping review' })
		await expect(review.getByRole('row')).toHaveCount(3)
		await expect(review).toContainText('Bürobedarf')
		await expect(review).toContainText('-19.95')
		const approve = review.getByRole('button', { name: 'Zuordnung bestätigen' })
		await expect(approve).toBeDisabled()
		await review.getByRole('checkbox').check()
		await expect(approve).toBeEnabled()
		// Do not submit: this preview has no native authenticated service bridge.
		await page.screenshot({ path: join(output, `review-${width}.png`), fullPage: true })
		await review.locator('summary').filter({ hasText: 'Spaltenzuordnung' }).click()
		await expect(review).toContainText('Eingangstag')
		await expect(review).toContainText('Umgekehrt (+ ↔ −)')
		await review.locator('summary').filter({ hasText: 'Nicht übernommen' }).click()
		await review.getByText('Herkunft & Grenzen', { exact: true }).click()
		await expect(review).toContainText('Nicht nachgewiesen')
		await expect(review).not.toContainText(evidence.csvMapping.cases[0].result.statement.notes)
		assert.equal(await review.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
		await page.screenshot({ path: join(output, `review-expanded-${width}.png`), fullPage: true })
		await page.close()
		assert.deepEqual(errors, [])
	}
	await writeFile(
		join(output, 'proof.json'),
		JSON.stringify(
			{
				passed: true,
				evidence: path,
				widths: [1280, 390],
				publicationTest: 'live service journey; not simulated here'
			},
			null,
			2
		)
	)
	console.log('PASS CSV mapping review on desktop and narrow screens:', output)
} finally {
	await browser.close()
}
