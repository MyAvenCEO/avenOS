// Responsive rendering of retained real-Qwen admission and query receipts.
// This replays observations; it does not fake a router or an agent response.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium, expect } from '@playwright/test'

const path = process.argv[2]
const evidence = JSON.parse(await readFile(path, 'utf8'))
assert(evidence.synthetic && evidence.completedAt && evidence.stagedNew && evidence.mismatch)
const inventory = evidence.inventory.turns.at(-1).calls.find((c) => c.name === 'knowledge_query')
assert(inventory?.status === 'completed')
const value = JSON.parse(inventory.result).outputs.result
const output = join(dirname(path), 'input-ui')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
	for (const width of [1280, 390]) {
		const page = await browser.newPage({ viewport: { width, height: 850 } })
		const errors = []
		page.on('pageerror', (error) => errors.push(error.message))
		await page.goto(`${process.env.E2E_APP_ORIGIN ?? 'http://127.0.0.1:1451'}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		await page.evaluate(
			async ({ pending, value }) => {
				const { mount } = await import('/@id/svelte')
				const { default: InputRouting } = await import('/src/lib/intents/InputRouting.svelte')
				const { default: KnowledgeCard } = await import('/src/lib/artifacts/KnowledgeCard.svelte')
				const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
				const { toolPreview } = await import('/@id/@avenos/chat-engine/tool-preview')
				const { turnPayload, callsFromPayload } = await import(
					'/@id/@avenos/chat-engine/turn-payload'
				)
				const host = document.createElement('main')
				host.id = 'input-proof'
				host.style.cssText =
					'position:fixed;inset:0;z-index:100000;background:var(--color-surface-page);overflow:auto;padding:16px;display:flex;flex-direction:column;gap:16px'
				document.body.append(host)
				chatActor.core.input.items = [pending]
				mount(InputRouting, { target: host })
				const restored = callsFromPayload(
					turnPayload({ id: 'render-proof', role: 'assistant', content: '', calls: [value] })
				)[0]
				mount(KnowledgeCard, { target: host, props: { value: toolPreview(restored).value } })
			},
			{ pending: evidence.stagedNew, value: inventory }
		)
		const host = page.locator('#input-proof')
		await expect(host.getByRole('region')).toHaveCount(1)
		await expect(host).toContainText('Where should this go?')
		await expect(host).toContainText('Dokumente zählen')
		await expect(host).toContainText(value.query.purpose)
		await expect(host).toContainText('nicht Fundstellen oder extrahierte Werte')
		assert.equal(await host.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
		await page.screenshot({ path: join(output, `routing-and-count-${width}.png`) })
		await host.locator('[data-route-action="choose"]').click()
		await expect(host.getByRole('textbox', { name: 'Search Intents' })).toBeVisible()
		await expect(host.getByRole('textbox', { name: 'New Intent title' })).toBeVisible()
		assert.equal(await host.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
		await page.screenshot({ path: join(output, `destination-picker-${width}.png`) })
		assert.deepEqual(errors, [])
		await page.close()
	}
	await writeFile(
		join(output, 'proof.json'),
		JSON.stringify(
			{
				passed: true,
				synthetic: true,
				evidence: path,
				widths: [1280, 390],
				scope:
					'Responsive rendering of real-Qwen receipts; native interaction proved by source journey'
			},
			null,
			2
		)
	)
	console.log('PASS responsive routing choices and document-inventory explanation', output)
} finally {
	await browser.close()
}
