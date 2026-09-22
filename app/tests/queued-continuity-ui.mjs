// Render actual saved Qwen conversations in both production chat surfaces.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium, expect, webkit } from '@playwright/test'

const path = process.argv[2]
const evidence = JSON.parse(await readFile(path, 'utf8'))
assert(evidence.synthetic && evidence.passed && /qwen/i.test(evidence.model))
const source = evidence.cases.find((item) => item.id === 'two-outcomes')
assert(source?.passed && source.savedHistory)
const output = join(dirname(path), 'chat-ui')
await mkdir(output, { recursive: true })
const engine = process.env.UI_BROWSER ?? 'chromium'
assert(['chromium', 'webkit'].includes(engine))
const browser = await { chromium, webkit }[engine].launch({ headless: true })
const results = []
try {
	for (const width of [1280, 390])
		for (const surface of ['inline', 'popup']) {
			const page = await browser.newPage({ viewport: { width, height: 800 } })
			const errors = []
			page.on('pageerror', (error) => errors.push(error.message))
			await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1457'}/dashboard`)
			await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
			await page.evaluate(
				async ({ history, surface }) => {
					const { tick } = await import('/@id/svelte')
					const { intents } = await import('/src/lib/intents/intents.svelte.ts')
					const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
					const { composer } = await import('/src/lib/intents/composer.svelte.ts')
					const { shell } = await import('/src/lib/intents/talk.svelte.ts')
					const id = crypto.randomUUID()
					intents.items = [
						{
							id,
							type: 'conversation',
							title: 'Gemeinschaftsgarten · synthetischer Test',
							source: 'UI-Prüfung',
							when: '',
							status: 'done',
							log: [],
							artifacts: [],
							skills: []
						}
					]
					intents.select(id)
					shell.detail = true
					chatActor.core.use(id)
					chatActor.core.hydrate(id, history)
					await tick()
					if (surface === 'popup') {
						shell.tab = 'artifacts'
						await tick()
					}
					composer.focus()
				},
				{ history: source.savedHistory, surface }
			)
			const host =
				surface === 'inline'
					? page.getByRole('main', { name: 'Intent workspace', exact: true })
					: page
							.getByRole('region', { name: 'Conversation with Aven', exact: true })
							.getByRole('log')
			const label = host.getByText('Antwort auf 2 Nachrichten', { exact: true })
			await expect(label).toHaveCount(1)
			for (const text of source.messages) {
				const message = host.getByText(text, { exact: true })
				await expect(message).toHaveCount(1)
				await message.scrollIntoViewIfNeeded()
				await expect(message).toBeInViewport({ ratio: 0.5 })
			}
			await label.scrollIntoViewIfNeeded()
			await expect(label).toBeInViewport()
			const answer = source.replies.at(-1)
			await expect(host.locator(`[data-message-id="${answer.id}"]`)).toHaveCount(1)
			assert.equal(await host.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
			const composer = page.getByRole('textbox', { name: 'Message Aven', exact: true })
			await composer.fill('Ungesendeter Entwurf bleibt erhalten')
			await expect(composer).toBeInViewport({ ratio: 0.95 })
			await page.screenshot({ path: join(output, `${engine}-${surface}-${width}.png`) })
			await expect(composer).toHaveValue('Ungesendeter Entwurf bleibt erhalten')
			assert.deepEqual(errors, [])
			results.push({
				width,
				surface,
				originalsRetained: true,
				replyAssociation: true,
				composerVisible: true
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
					'Production chat surfaces replaying persisted real-Qwen outcomes. Not native authentication, live routing or speech.',
				results
			},
			null,
			2
		)
	)
	console.log('PASS grouped reply presentation', engine, output)
} finally {
	await browser.close()
}
