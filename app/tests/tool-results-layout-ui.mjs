// Replay actual, independently synthetic Qwen outcomes in the production chat
// surfaces. No replacement model answer, native transport or customer DB is used.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium, expect, webkit } from '@playwright/test'

const path = process.argv[2]
const evidence = JSON.parse(await readFile(path, 'utf8'))
assert(evidence.synthetic && evidence.passed)
assert.match(evidence.calculations.model, /qwen/i)
const calls = evidence.calculations.turns.flatMap((t) => t.calls)
const output = join(dirname(path), 'result-layout')
await mkdir(output, { recursive: true })
const engine = process.env.UI_BROWSER ?? 'chromium'
assert(['chromium', 'webkit'].includes(engine))
const browser = await { chromium, webkit }[engine].launch({ headless: true })
const results = []
async function expectComposerInView(composer) {
	// WebKit includes rounded ancestor clipping in intersectionRatio (99.6% on
	// desktop), although the entire field is on screen. Check every rectangular
	// clipping boundary explicitly; allow only the intentionally rounded corners.
	const clipped = await composer.evaluate((el) => {
		const r = el.getBoundingClientRect()
		const contains = (b) =>
			r.left >= b.left - 1 &&
			r.right <= b.right + 1 &&
			r.top >= b.top - 1 &&
			r.bottom <= b.bottom + 1
		if (!contains({ left: 0, top: 0, right: innerWidth, bottom: innerHeight })) return true
		for (let parent = el.parentElement; parent; parent = parent.parentElement) {
			if (
				/(hidden|clip|auto|scroll)/.test(getComputedStyle(parent).overflow) &&
				!contains(parent.getBoundingClientRect())
			)
				return true
		}
		return false
	})
	assert.equal(
		clipped,
		false,
		'The full input rectangle must stay inside the viewport and clipping ancestors'
	)
	await expect(composer).toBeInViewport({ ratio: 0.95 })
}
try {
	for (const width of [1864, 1280, 390])
		for (const surface of ['inline', 'popup']) {
			const page = await browser.newPage({ viewport: { width, height: 800 } })
			const errors = []
			page.on('pageerror', (e) => errors.push(e.message))
			await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1457'}/dashboard`)
			await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
			const count = await page.evaluate(
				async ({ calls, surface }) => {
					const { tick } = await import('/@id/svelte')
					const { intents } = await import('/src/lib/intents/intents.svelte.ts')
					const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
					const { composer } = await import('/src/lib/intents/composer.svelte.ts')
					const { shell } = await import('/src/lib/intents/talk.svelte.ts')
					const { turnPayload, callsFromPayload } = await import(
						'/@id/@avenos/chat-engine/turn-payload'
					)
					const { toolPreviews } = await import('/@id/@avenos/chat-engine/tool-preview')
					const id = crypto.randomUUID()
					intents.items = [
						{
							id,
							type: 'conversation',
							title: 'Synthetischer Ergebnisverlauf',
							source: 'UI-Prüfung',
							when: '',
							status: 'working',
							log: [],
							artifacts: [],
							skills: []
						}
					]
					intents.select(id)
					shell.detail = true
					chatActor.core.use(id)
					// Deliberately collect several real turns into a crowded presentation only.
					// Do not claim that these separate operations were one agent execution.
					const saved = callsFromPayload(
						turnPayload({ id: 'layout-proof', role: 'assistant', content: '', calls })
					)
					chatActor.core.hydrate(id, [
						{ id: 'layout-proof', role: 'assistant', content: '', calls: saved }
					])
					await tick()
					if (surface === 'popup') {
						shell.tab = 'artifacts'
						await tick()
					}
					composer.focus()
					return toolPreviews(saved).length
				},
				{ calls, surface }
			)
			assert(count >= 15, `Need a genuinely crowded set, got ${count}`)
			const host =
				surface === 'inline'
					? page.getByRole('main', { name: 'Intent workspace', exact: true })
					: page
							.getByRole('region', { name: 'Conversation with Aven', exact: true })
							.getByRole('log')
			const composer = page.getByRole('textbox', { name: 'Message Aven', exact: true })
			await expect(composer).toBeVisible()
			await expect(host.getByRole('article').filter({ visible: true })).toHaveCount(0)
			const toggle = host.locator('details.tool-calls > summary')
			await toggle.click()
			const cards = host.getByRole('article').filter({ visible: true })
			await expect(cards).toHaveCount(count)
			const bottomGap = () =>
				host.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
			await expect
				.poll(bottomGap, { message: `${surface}/${width}: opening results follows bottom` })
				.toBeLessThanOrEqual(4)
			const regionForFollow = await host.boundingBox()
			await page.mouse.move(
				regionForFollow.x + regionForFollow.width / 2,
				regionForFollow.y + regionForFollow.height / 2
			)
			await page.mouse.wheel(0, -350)
			await expect.poll(bottomGap).toBeGreaterThan(100)
			// Let the real wheel settle before changing layout, including WebKit inertia.
			await page.waitForTimeout(300)
			const parked = await host.evaluate((el) => el.scrollTop)
			// Geometry-only stimulus: no forged agent answer or tool outcome.
			await host.evaluate((el) => {
				const spacer = document.createElement('div')
				spacer.dataset.layoutProbe = 'true'
				spacer.style.cssText = 'height:230px;flex:0 0 230px'
				el.append(spacer)
			})
			await page.waitForTimeout(150)
			assert(
				Math.abs((await host.evaluate((el) => el.scrollTop)) - parked) <= 2,
				'Growth must preserve the reading position'
			)
			await page.mouse.wheel(0, 100000)
			await page.waitForTimeout(300)
			await page.mouse.wheel(0, 100000)
			await expect
				.poll(bottomGap, { message: `${surface}/${width}: wheel returns to bottom` })
				.toBeLessThanOrEqual(4)
			await host.evaluate((el) => {
				el.querySelector('[data-layout-probe]').style.height = '410px'
				el.querySelector('[data-layout-probe]').style.flexBasis = '410px'
			})
			await expect
				.poll(bottomGap, { message: `${surface}/${width}: growth after reengaging follows bottom` })
				.toBeLessThanOrEqual(4)
			await host.evaluate((el) => el.querySelector('[data-layout-probe]').remove())
			await expect
				.poll(bottomGap, {
					message: `${surface}/${width}: shrinking while following stays at bottom`
				})
				.toBeLessThanOrEqual(4)
			const boxes = await cards.evaluateAll((nodes) =>
				nodes.map((el) => {
					const r = el.getBoundingClientRect()
					return {
						x: r.x,
						width: r.width,
						height: r.height,
						overflow: el.scrollWidth > el.clientWidth + 1
					}
				})
			)
			assert(
				Math.max(...boxes.map((b) => b.width)) - Math.min(...boxes.map((b) => b.width)) <= 1,
				`All result kinds must share one width: ${JSON.stringify(boxes)}`
			)
			assert(
				boxes.every((b) => b.height > 50 && !b.overflow),
				'Cards must not shrink or overflow'
			)
			assert.equal(await host.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
			assert(
				await host.evaluate((el) => el.scrollHeight > el.clientHeight + 200),
				'History must own vertical overflow'
			)
			await host.evaluate((el) => {
				el.scrollTop = 0
			})
			const region = await host.boundingBox()
			await page.mouse.move(region.x + region.width / 2, region.y + region.height / 2)
			await page.mouse.wheel(0, 550)
			await expect.poll(() => host.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
			await page.screenshot({ path: join(output, `${engine}-${surface}-${width}.png`) })
			// Every card, including the final item, must be reachable in the real surface.
			for (const card of await cards.all()) {
				await card.scrollIntoViewIfNeeded()
				await expect(card).toBeInViewport({ ratio: 0.5 })
			}
			await expectComposerInView(composer)
			await composer.fill('Entwurf bleibt beim Lesen erhalten')
			await toggle.scrollIntoViewIfNeeded()
			await toggle.focus()
			await page.keyboard.press('Enter')
			await expect(host.getByRole('article').filter({ visible: true })).toHaveCount(0)
			await expect(composer).toHaveValue('Entwurf bleibt beim Lesen erhalten')
			await expectComposerInView(composer)
			assert.deepEqual(errors, [])
			results.push({
				width,
				surface,
				count,
				consistentWidths: true,
				wheel: true,
				bottomFollow: true,
				readingPositionPreserved: true,
				followReengaged: true,
				allReachable: true,
				draftPreserved: true
			})
			await page.close()
		}
	await writeFile(
		join(output, `${engine}.json`),
		JSON.stringify(
			{
				passed: true,
				synthetic: true,
				evidence: path,
				scope:
					'Production chat layouts with persisted real-Qwen outcomes; browser replay, not native authentication',
				results
			},
			null,
			2
		)
	)
	console.log('PASS scroll, consistent result widths and unobstructed composer', engine, output)
} finally {
	await browser.close()
}
