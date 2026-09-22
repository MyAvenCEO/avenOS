// Render actual live-Qwen receipts and a persisted Skill/result from the isolated
// calculation journey. No fabricated model response or tool result is accepted.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium, expect } from '@playwright/test'

const evidencePath = process.argv[2]
assert(evidencePath, 'Pass the evidence.json from a successful --calculations journey')
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
assert.equal(evidence.synthetic, true, 'Only isolated synthetic test evidence may be replayed')
assert.equal(evidence.passed, true, 'The real-model journey must pass before UI proof')
const proof = evidence.calculations
assert(/qwen/i.test(proof.model))
const samples = proof.turns.filter((t) => t.calls.some((c) => c.name === 'calculate'))
assert(samples.length >= 9)
const output = join(dirname(evidencePath), 'ui')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []
try {
	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 700 }
	]) {
		const page = await browser.newPage({
			viewport,
			permissions: ['clipboard-read', 'clipboard-write']
		})
		const errors = []
		page.on('pageerror', (error) => errors.push(error.message))
		await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1457'}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		// Use the production native-history surface with persisted live-model turns.
		await page.evaluate(async (samples) => {
			const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
			chatActor.core.turns = samples.slice(0, 1).flatMap((turn) => [
				{ id: crypto.randomUUID(), role: 'user', content: turn.question },
				{ id: crypto.randomUUID(), role: 'assistant', content: turn.answer, calls: turn.calls }
			])
		}, samples)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).click()
		const card = page.getByRole('article', { name: 'Calculation result', exact: true })
		await expect(card).toHaveCount(1)
		await expect(card).toContainText('88843152318019.47')
		await card.scrollIntoViewIfNeeded()
		await card.getByText(/^Calculation details/).click()
		await expect(card).toContainText('87654.21')
		await card.getByRole('button', { name: 'Copy message', exact: true }).click()
		const realResult = JSON.parse(samples[0].calls.find((c) => c.name === 'calculate').result)
			.outputs.calculation
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), realResult.text)
		const box = await card.boundingBox()
		assert(box && box.x >= 0 && box.x + box.width <= viewport.width + 1)
		assert.equal(await card.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false)
		await page.screenshot({ path: join(output, `chat-${viewport.width}.png`) })
		assert.equal(proof.labeled.result.value, '167')
		await page.reload()
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		await page.evaluate(async (value) => {
			const { mount } = await import('/@id/svelte')
			const { default: Card } = await import('/src/lib/artifacts/CalculationCard.svelte')
			const target = document.createElement('section')
			target.id = 'labeled-calculation-proof'
			target.style.cssText =
				'position:fixed;inset:0;z-index:100000;background:var(--color-surface-page);overflow:auto;padding:16px'
			document.body.append(target)
			mount(Card, { target, props: { value } })
		}, proof.labeled)
		const labeled = page.locator('#labeled-calculation-proof')
		await expect(labeled).toContainText(proof.labeled.purpose)
		await labeled.getByText(/^Calculation details/).click()
		for (const operand of proof.labeled.operands) {
			await expect(labeled).toContainText(operand.label)
			await expect(labeled).toContainText(operand.source.label)
		}
		await expect(labeled.locator('li')).toHaveCount(6)
		await expect(labeled).toContainText('Quellenangabe ohne gespeicherten Verweis')
		await expect(labeled).toContainText('nicht bestätigt')
		await expect(labeled.getByText('Quelle ansehen', { exact: true })).toHaveCount(0)
		assert.equal(await labeled.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false)
		await page.screenshot({ path: join(output, `labeled-${viewport.width}.png`) })
		// Inspect a real persisted calculation through a new execution of the same
		// Actor. Only the native read transport replays its actual Store envelope.
		await page.evaluate(async (saved) => {
			const { mount } = await import('/@id/svelte')
			const { default: Card } = await import('/src/lib/artifacts/CalculationCard.svelte')
			const { createCalculationActor, MessageBus } = await import('/src/lib/actors/actor.ts')
			window.calculationSourceReads = []
			window.__TAURI_INTERNALS__ = {
				invoke: async (command, args) => {
					if (command !== 'artifact_get' || args.artifactId !== saved.artifactId)
						throw Error('Unrecorded source request')
					window.calculationSourceReads.push(args.artifactId)
					return saved
				}
			}
			const bus = new MessageBus(),
				actor = createCalculationActor()
			bus.register(actor)
			try {
				const response = await bus.dispatch('ui', 'calculate', {
					operation: 'multiply',
					purpose: 'Gespeichertes Ergebnis prüfen',
					operands: [
						{
							...saved.payload.result,
							label: 'Ergebnis des getesteten Skills',
							source: {
								label: 'Gespeicherte Berechnung',
								artifactId: saved.artifactId,
								pointer: '/result/value'
							}
						},
						{ value: '1', unit: '1', label: 'Unveränderter Faktor' }
					]
				})
				const target = document.createElement('section')
				target.id = 'source-calculation-proof'
				document.querySelector('#labeled-calculation-proof').replaceChildren(target)
				mount(Card, { target, props: { value: JSON.parse(response.record).outputs.calculation } })
			} finally {
				actor.dispose()
			}
		}, proof.authored.result)
		const sourceCard = page.locator('#source-calculation-proof')
		await sourceCard.getByText(/^Calculation details/).click()
		assert.deepEqual(await page.evaluate(() => window.calculationSourceReads), [])
		await sourceCard.getByText('Quelle ansehen', { exact: true }).click()
		await expect(sourceCard.locator('details.source p')).toHaveText('164.15')
		assert.deepEqual(await page.evaluate(() => window.calculationSourceReads), [
			proof.authored.result.artifactId
		])
		await page.screenshot({ path: join(output, `source-${viewport.width}.png`) })
		// Close the native-history/dialog surface before mounting the separate
		// artifact preview. Otherwise a top-layer dialog obscures this test surface.
		await page.reload()
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		// The same artifact renderer reads the actual Store payload, not a model's prose.
		await page.evaluate(
			async ({ saved, definition, request }) => {
				const { mount } = await import('/@id/svelte')
				const { default: Viewer } = await import('/src/lib/artifacts/ArtifactSemanticViewer.svelte')
				const { default: Field } = await import('/src/lib/skills/StudioParameterField.svelte')
				const { createCalculationActor, MessageBus } = await import('/src/lib/actors/actor.ts')
				const target = document.createElement('main')
				target.style.cssText =
					'position:fixed;inset:0;z-index:10000;background:var(--color-surface-page);overflow:auto;padding:20px;display:flex;flex-direction:column;gap:16px'
				document.body.append(target)
				mount(Viewer, { target, props: { typeKey: saved.typeKey, payload: saved.payload } })
				const setting = definition.steps[0].parameters.operands.name
				let value = request.parameters[setting]
				const host = document.createElement('section')
				host.setAttribute('aria-label', 'Skill settings')
				target.append(host)
				let field
				const render = () => {
					field = mount(Field, {
						target: host,
						props: {
							name: setting,
							schema: definition.parametersSchema.properties[setting],
							value,
							onchange: async (next) => {
								value = next
								const { unmount } = await import('/@id/svelte')
								await unmount(field)
								render()
							}
						}
					})
				}
				render()
				const button = document.createElement('button')
				button.textContent = 'Calculate these settings'
				button.onclick = async () => {
					const bus = new MessageBus(),
						actor = createCalculationActor()
					bus.register(actor)
					try {
						const response = await bus.dispatch('ui', 'calculate', {
							operation: 'multiply',
							operands: value
						})
						window.calculationUiReceipt = JSON.parse(response.record)
					} finally {
						actor.dispose()
					}
				}
				target.append(button)
			},
			{
				saved: proof.authored.result,
				definition: proof.authored.definition,
				request: proof.authored.request
			}
		)
		const surface = page.locator('main').last()
		assert.notEqual(
			await surface.evaluate((node) => getComputedStyle(node).backgroundColor),
			'rgba(0, 0, 0, 0)'
		)
		const storedCard = surface.getByRole('article', { name: 'Calculation result', exact: true })
		await expect(storedCard).toContainText('164.15')
		await expect(storedCard).toContainText('EUR')
		const settings = page.getByRole('region', { name: 'Skill settings' })
		await settings.getByText('Item 1', { exact: true }).click()
		await settings.getByRole('textbox', { name: 'Setting operands 1 value', exact: true }).fill('9')
		await page.getByRole('button', { name: 'Calculate these settings', exact: true }).click()
		await expect
			.poll(() => page.evaluate(() => window.calculationUiReceipt?.outputs?.calculation?.result))
			.toEqual({ value: '211.05', unit: 'currency:EUR' })
		assert.equal(await surface.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false)
		await page.screenshot({ path: join(output, `artifact-settings-${viewport.width}.png`) })
		assert.deepEqual(errors, [])
		results.push({
			viewport,
			liveModel: proof.model,
			copiedExactEquation: true,
			storedResult: '164.15 EUR',
			editedResult: '211.05 EUR'
		})
		await page.close()
	}
	await writeFile(
		join(output, 'proof.json'),
		JSON.stringify({ passed: true, evidencePath, results }, null, 2)
	)
	console.log(
		'PASS real-Qwen receipt UI, exact copy, stored artifact preview and editable Skill settings',
		output
	)
} finally {
	await browser.close()
}
