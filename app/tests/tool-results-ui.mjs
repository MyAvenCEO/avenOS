// Component interaction with recorded real-Qwen calls; no model outputs fabricated.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium, expect } from '@playwright/test'

const path = process.argv[2],
	evidence = JSON.parse(await readFile(path, 'utf8'))
assert.equal(evidence.synthetic, true, 'Only isolated synthetic test evidence may be replayed')
const cases = !evidence.calculations && evidence.csvMapping
assert(
	/qwen/i.test(evidence.calculations?.model ?? evidence.csvMapping?.model ?? evidence.upstreamModel)
)
const turns = (cases ? evidence.csvMapping : evidence.calculations).turns
const calls = turns.flatMap((t) => t.calls ?? [])
const durationMs = turns.findLast((t) => t.durationMs > 0)?.durationMs
assert(
	calls.some(
		(c) => c.name === (cases ? 'studio_case_propose' : 'studio_publish') && c.status === 'completed'
	)
)
assert(
	calls.some(
		(c) => c.name === (cases ? 'studio_case_what_if' : 'calculate') && c.status === 'completed'
	)
)
const directory = join(dirname(path), 'tool-results')
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
	for (const width of [1280, 390]) {
		const page = await browser.newPage({ viewport: { width, height: 850 } }),
			errors = []
		page.on('pageerror', (e) => errors.push(e.message))
		await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1457'}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		const counts = await page.evaluate(
			async ({ calls, durationMs }) => {
				const { mount } = await import('/@id/svelte')
				const { default: View } = await import('/src/lib/chat/ToolCalls.svelte')
				const { turnPayload, callsFromPayload } = await import(
					'/@id/@avenos/chat-engine/turn-payload'
				)
				const { toolPreviews } = await import('/@id/@avenos/chat-engine/tool-preview')
				const host = document.createElement('main')
				host.id = 'tool-results-proof'
				host.style.cssText =
					'position:fixed;inset:0;z-index:100000;background:var(--color-surface-page);overflow:auto;padding:16px;display:flex;flex-direction:column;gap:8px'
				document.body.append(host)
				// Replay the persisted representation, including compact previews where full
				// trace text is intentionally bounded. No fake execution is initiated.
				const saved = callsFromPayload(
					turnPayload({ id: 'proof', role: 'assistant', content: '', calls, durationMs })
				)
				mount(View, { target: host, props: { calls: saved, durationMs } })
				return {
					cards: toolPreviews(saved).length,
					maxMs: Math.max(...saved.map((c) => c.durationMs ?? 0))
				}
			},
			{ calls, durationMs }
		)
		const host = page.locator('#tool-results-proof')
		assert(counts.cards > 2)
		await expect(host.getByRole('article').filter({ visible: true })).toHaveCount(0)
		await page.screenshot({ path: join(directory, `compact-${width}.png`) })
		await host.locator('details.tool-calls > summary').click()
		await expect(host.getByRole('article').filter({ visible: true })).toHaveCount(counts.cards)
		await expect(host).toContainText(
			cases ? 'Hypothetischer Ablauf · nicht ausgeführt' : 'Veröffentlicht · nicht ausgeführt'
		)
		await expect(host).toContainText(cases ? 'Plan gespeichert' : 'Entwurf gespeichert')
		if (durationMs) await expect(host.locator('.timing')).toContainText('Gesamt')
		await expect(host.locator('details.tool-calls')).toContainText(' ms')
		await expect(host.locator('details.tool-calls')).not.toContainText('0.0s')
		await expect(host.locator('details.tool-calls')).toContainText('Verfügbare Bausteine prüfen')
		assert.equal(await host.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
		await page.screenshot({ path: join(directory, `results-${width}.png`) })
		assert.deepEqual(errors, [])
		await page.close()
	}
	await writeFile(
		join(directory, 'proof.json'),
		JSON.stringify(
			{
				passed: true,
				evidence: path,
				widths: [1280, 390],
				scope: 'Recorded real-Qwen results, persisted preview rendering; not native authentication'
			},
			null,
			2
		)
	)
	console.log(
		'PASS real-Qwen result cards, persisted previews, progressive disclosure, timing and purpose',
		directory
	)
} finally {
	await browser.close()
}
