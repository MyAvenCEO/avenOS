// Real workspace components and input routing; model and accepted speech are
// deterministic in-memory fixtures. No microphone, model or stored data is used.
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const browser = await chromium.launch({ headless: true })
try {
	for (const width of [1280, 390]) {
		const page = await browser.newPage({ viewport: { width, height: 844 } })
		const errors = []
		page.on('pageerror', (error) => errors.push(error.message))
		await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1420'}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		await page.evaluate(async () => {
			const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
			chatActor.core.send = async (content) => {
				chatActor.core.turns.push(
					{ id: crypto.randomUUID(), role: 'user', content },
					{ id: crypto.randomUUID(), role: 'assistant', content: 'Fixture reply.' }
				)
			}
		})
		const popup = page.getByRole('region', { name: 'Conversation with Aven' })
		const input = page.getByRole('textbox', { name: 'Message Aven', exact: true })
		const open = () => page.getByRole('button', { name: 'Start conversation', exact: true }).click()
		const switchSurface = (tab) =>
			page.evaluate(async (tab) => {
				const { shell } = await import('/src/lib/intents/talk.svelte.ts')
				shell.tab = tab
			}, tab)
		const partial = (text) =>
			page.evaluate(async (text) => {
				const { voiceController } = await import('/src/lib/voice/controller.svelte.ts')
				voiceController.partial = text
			}, text)

		// Click opens the existing history, including mobile's list-first layout.
		await open()
		await expect(input).toBeVisible()
		await expect(input).toBeFocused()
		await expect(popup).toHaveCount(0)
		await input.fill('A written Intent question')
		await input.press('Enter')
		await expect(page.getByText('Fixture reply.', { exact: true })).toHaveCount(1)
		await expect(popup).toHaveCount(0)

		// Global typing and the live voice draft use the same inline surface.
		await page.locator('body').click({ position: { x: width - 4, y: 5 } })
		await page.keyboard.type('x')
		await expect(input).toHaveValue('x')
		await expect(input).toBeFocused()
		await input.press('Escape')
		await partial('Spoken Intent question')
		await expect(input).toHaveValue('Spoken Intent question')
		await expect(popup).toHaveCount(0)
		await partial('')

		// Studio keeps the selected work on screen and supplies the missing history.
		await switchSurface('skills')
		await expect(popup).toHaveCount(0)
		await open()
		await expect(popup).toBeVisible()
		await expect(input).toBeFocused()
		await input.fill('Keep this draft across surfaces')
		await switchSurface('intents')
		await expect(popup).toHaveCount(0)
		await expect(input).toBeVisible()
		await expect(input).toHaveValue('Keep this draft across surfaces')
		await expect(input).toBeFocused()
		await expect(page.getByText('Fixture reply.', { exact: true })).toHaveCount(1)

		// An inner view has no history: keep the board visible and use the popup.
		await page.getByRole('button', { name: 'Kanban Board', exact: true }).first().click()
		await open()
		await expect(popup).toBeVisible()
		await expect(input).toHaveCount(1)
		await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
		await page.getByRole('button', { name: 'Aktivität', exact: true }).first().click()
		await open()
		await expect(popup).toHaveCount(0)
		await expect(input).toHaveValue('Keep this draft across surfaces')

		await switchSurface('artifacts')
		await open()
		await expect(popup).toBeVisible()
		await input.fill('')
		await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
		await partial('Spoken library question')
		await expect(popup).toBeVisible()
		await expect(input).toHaveValue('Spoken library question')
		await partial('')
		// The same live trace is visible in the popup and the native history.
		await page.evaluate(async () => {
			const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
			const chat = chatActor.core.thread()
			chat.toolSession = chat.session
			chat.routing = 'Inspect the source'
			chat.streaming = true
			chat.toolCalls = [
				{
					id: 'visible-call',
					name: 'workspace_read',
					arguments: '{"id":"source","token":"private-token"}',
					status: 'running',
					result: ''
				}
			]
			chat.turns.push({
				id: 'live-response',
				role: 'assistant',
				content: '',
				pending: true,
				startedAt: Date.now(),
				calls: chat.toolCalls
			})
		})
		const trace = page.getByLabel('Agent tool calls', { exact: true })
		await expect(trace).toBeVisible()
		await expect(trace.locator('summary').first()).toContainText('Eine Quelle nachlesen · running')
		await trace.locator('summary').first().click()
		await trace.locator('ol summary').click()
		await expect(trace).toContainText('[redacted]')
		await expect(trace).not.toContainText('private-token')
		await switchSurface('intents')
		await expect(popup).toHaveCount(0)
		await expect(trace).toBeVisible()
		await page.evaluate(async () => {
			const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
			const chat = chatActor.core.thread()
			chat.toolCalls[0].status = 'failed'
			chat.toolCalls[0].error = 'Text is not available yet'
			const reply = chat.turns.find((t) => t.id === 'live-response')
			reply.pending = false
			reply.durationMs = 25
			chat.routing = null
			chat.streaming = false
		})
		await expect(trace).toHaveCount(1)
		await expect(trace.locator('summary').first()).toContainText('Eine Quelle nachlesen · failed')
		// A later request must not animate an earlier empty, failed reply.
		await switchSurface('skills')
		await open()
		await page.evaluate(async () => {
			const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
			const chat = chatActor.core.thread()
			chat.streaming = true
			chat.routing = 'What happened?'
			chat.toolCalls = []
			chat.turns.push({
				id: 'next-response',
				role: 'assistant',
				content: '',
				pending: true,
				startedAt: Date.now()
			})
		})
		await expect(popup.getByText('Thinking…', { exact: true })).toHaveCount(0)
		await expect(popup.getByText('Working…', { exact: true })).toHaveCount(1)
		await expect(trace.locator('summary').first()).toContainText('Eine Quelle nachlesen · failed')
		await page.evaluate(async () => {
			const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
			const chat = chatActor.core.thread()
			chat.streaming = false
			chat.routing = null
			chat.turns.find((t) => t.id === 'next-response').pending = false
		})
		await expect(popup.getByText('Working…', { exact: true })).toHaveCount(0)
		assert.deepEqual(errors, [])
		await page.close()
	}
	console.log(
		'Conversation surfaces: click, typing, speech drafts, replies, draft handoff, inner views and library passed at desktop and mobile widths.'
	)
} finally {
	await browser.close()
}
