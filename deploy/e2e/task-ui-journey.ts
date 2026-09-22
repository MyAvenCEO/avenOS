import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { Turn } from '@avenos/chat-engine/chat'
import { chromium, expect } from '@playwright/test'
import type { taskServiceFixture } from './task-service-fixture'

/** Real component UI over the actual signed HTTP service. No replacement task reducer. */
export async function taskUiJourney(
	fixture: Awaited<ReturnType<typeof taskServiceFixture>>,
	origin: string,
	out: string,
	turns: Turn[]
) {
	const browser = await chromium.launch({ headless: true })
	const errors: string[] = []
	let loseNextResponse = false
	let malformedNextReceipt = false
	try {
		const page = await browser.newPage({ viewport: { width: 1180, height: 850 } })
		page.on('pageerror', (error) => errors.push(error.message))
		await page.exposeFunction(
			'__taskProofRequest',
			async (method: 'GET' | 'POST', path: string, body?: unknown) => {
				const response = await fixture.request(path, { method, body })
				if (loseNextResponse && method === 'POST' && response.ok) {
					loseNextResponse = false
					await response.arrayBuffer()
					return {
						status: 503,
						value: {
							code: 'TASKS_UNAVAILABLE',
							message: 'The connection was interrupted after saving.'
						}
					}
				}
				if (malformedNextReceipt && method === 'POST' && response.ok) {
					malformedNextReceipt = false
					await response.arrayBuffer()
					return { status: 200, value: { invalidReceipt: true } }
				}
				return { status: response.status, value: await response.json() }
			}
		)
		const mount = async (board = false) => {
			await page.evaluate(
				async ({ owner, board }) => {
					const { mount, unmount } = await import('/@id/svelte')
					const { default: TaskWindow } = await import('/src/lib/actors/TaskWindow.svelte')
					const { TaskActor } = await import('/src/lib/actors/todo.svelte.ts')
					const { RemoteTaskRepository, TaskRequestError } = await import(
						'/@id/@avenos/productivity/remote'
					)
					const target = window as any
					if (target.__tasksMounted) unmount(target.__tasksMounted)
					target.__tasksActor?.dispose()
					document.querySelector('#tasks-proof')?.remove()
					const host = document.createElement('main')
					host.id = 'tasks-proof'
					host.style.cssText =
						'position:fixed;inset:0;z-index:100000;background:var(--color-surface-page,white);overflow:auto'
					document.body.append(host)
					const repository = new RemoteTaskRepository(
						owner,
						async (method: string, path: string, body: unknown) => {
							const response = await target.__taskProofRequest(method, path, body)
							if (response.status === 404 && response.value.code === 'TASK_RECEIPT_NOT_FOUND')
								return null
							if (response.status !== 200)
								throw new TaskRequestError(
									response.value.message,
									response.value.code,
									response.status
								)
							return response.value
						}
					)
					target.__tasksActor = new TaskActor(async () => ({
						scope: 'synthetic-service-scope',
						subjectId: owner,
						repository
					}))
					target.__tasksMounted = mount(TaskWindow, {
						target: host,
						props: { actor: target.__tasksActor, board }
					})
				},
				{ owner: fixture.owner, board }
			)
		}
		await page.goto(`${origin}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		await mount()
		let host = page.locator('#tasks-proof')
		await expect(
			host.getByText('Order replacement magnifier lenses', { exact: true })
		).toBeVisible()
		const newTitle = 'Label the insulated repair mats'
		await host.getByRole('textbox', { name: 'New task…' }).fill(newTitle)
		await host.getByRole('button', { name: 'Add', exact: true }).click()
		await expect(host.getByText(newTitle, { exact: true })).toBeVisible()
		await expect(host.getByRole('textbox', { name: 'New task…' })).toHaveValue('')
		await page.evaluate(() => (window as any).__tasksActor.reset())
		await expect(host.getByText(newTitle, { exact: true })).toBeVisible()
		const retriedTitle = 'Sort the donated connector trays'
		loseNextResponse = true
		await host.getByRole('textbox', { name: 'New task…' }).fill(retriedTitle)
		await host.getByRole('button', { name: 'Add', exact: true }).click()
		await expect(host.getByRole('alert')).toContainText('connection was interrupted')
		await host.getByRole('button', { name: 'Retry this same change', exact: true }).click()
		await expect(host.getByText(retriedTitle, { exact: true })).toBeVisible()
		assert.equal(
			(await fixture.repository().list(fixture.owner, {})).tasks.filter(
				(task) => task.title === retriedTitle
			).length,
			1
		)
		await expect(host.getByRole('textbox', { name: 'New task…' })).toHaveValue('')
		malformedNextReceipt = true
		await host.getByRole('checkbox', { name: `Done: ${newTitle}`, exact: true }).check()
		await host.getByRole('button', { name: 'Retry this same change', exact: true }).click()
		await expect
			.poll(
				async () =>
					(await fixture.repository().list(fixture.owner, {})).tasks.find(
						(task) => task.title === newTitle
					)?.status
			)
			.toBe('done')
		await page.reload()
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		await mount(true)
		host = page.locator('#tasks-proof')
		await expect(host.getByRole('combobox', { name: `${newTitle}: status` })).toHaveValue('done')
		await host.getByRole('combobox', { name: `${newTitle}: status` }).selectOption('doing')
		await expect
			.poll(
				async () =>
					(await fixture.repository().list(fixture.owner, {})).tasks.find(
						(task) => task.title === newTitle
					)?.status
			)
			.toBe('doing')
		await page.screenshot({ path: join(out, 'tasks-board-1180.png') })
		await page.setViewportSize({ width: 390, height: 850 })
		await page.screenshot({ path: join(out, 'tasks-board-390.png') })
		assert.equal(await host.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
		await mount()
		host = page.locator('#tasks-proof')
		await expect(host.getByText(newTitle, { exact: true })).toBeVisible()
		const item = host.getByRole('listitem').filter({ hasText: newTitle })
		await item.getByText('Details', { exact: true }).click()
		await item.getByRole('button', { name: 'Archive', exact: true }).click()
		await expect(host.getByText(newTitle, { exact: true })).toHaveCount(0)
		await host.getByRole('checkbox', { name: 'Archive', exact: true }).check()
		await expect(host.getByText(newTitle, { exact: true })).toBeVisible()
		await host.getByRole('listitem').getByText('Details', { exact: true }).click()
		await host.getByRole('button', { name: 'Restore', exact: true }).click()
		await expect(host.getByText('No archived tasks.', { exact: true })).toBeVisible()
		await host.getByRole('checkbox', { name: 'Archive', exact: true }).uncheck()
		await expect(host.getByText(newTitle, { exact: true })).toBeVisible()
		await page.screenshot({ path: join(out, 'tasks-list-390.png') })
		assert.equal(await host.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
		// Replay real-Qwen receipts in the actual chat component, both while the
		// answer is being checked and after transcript persistence bounded the trace.
		for (const persisted of [false, true]) {
			for (const width of [390, 1180]) {
				await page.setViewportSize({ width, height: 850 })
				await page.evaluate(
					async ({ turns, persisted }) => {
						const { mount, unmount } = await import('/@id/svelte')
						const { default: ToolCalls } = await import('/src/lib/chat/ToolCalls.svelte')
						const { turnPayload, callsFromPayload } = await import(
							'/@id/@avenos/chat-engine/turn-payload'
						)
						const target = window as any
						for (const component of target.__receiptProof ?? []) unmount(component)
						document.querySelector('#task-receipts-proof')?.remove()
						const panel = document.createElement('main')
						panel.id = 'task-receipts-proof'
						panel.style.cssText =
							'position:fixed;inset:0;z-index:100001;background:var(--color-surface-page,white);overflow:auto;padding:16px;display:grid;align-content:start;gap:12px'
						document.body.append(panel)
						target.__receiptProof = turns.map((turn) => {
							const section = document.createElement('section')
							panel.append(section)
							const calls = persisted
								? callsFromPayload(turnPayload(turn)).map((call) => ({
										...call,
										result: '… Saved detail truncated'
									}))
								: (turn.calls ?? [])
							return mount(ToolCalls, {
								target: section,
								props: {
									calls,
									active: !persisted,
									// Replay actual measured time, not a new 0-ms turn at mount time.
									...(persisted
										? { durationMs: turn.durationMs }
										: { startedAt: Date.now() - (turn.durationMs ?? 0) })
								}
							})
						})
					},
					{ turns, persisted }
				)
				const receipts = page.locator('#task-receipts-proof')
				for (const summary of await receipts.locator('details.tool-calls > summary').all())
					await summary.click()
				await expect(receipts.getByRole('article', { name: 'Aufgabenergebnis' })).toHaveCount(4)
				await expect(receipts).toContainText('2 Aufgaben angelegt')
				await expect(receipts).toContainText('1 Aufgabe aktualisiert')
				await expect(receipts).toContainText('Test · nicht gespeichert')
				await expect(receipts).toContainText('12.04.2031')
				await expect(receipts).toContainText(persisted ? 'Gesamt' : 'Bisher')
				assert.equal(await receipts.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
				await page.screenshot({
					path: join(out, `task-receipts-${persisted ? 'history' : 'checking'}-${width}.png`)
				})
			}
		}
		assert.deepEqual(errors, [])
		return {
			scope:
				'Actual Svelte UI, real HTTP service and real-Qwen-created starting tasks; not native transport',
			create: true,
			statusChange: true,
			reload: true,
			resetWhileMounted: true,
			lostAcknowledgementRetry: true,
			malformedReceiptRecovery: true,
			board: true,
			archiveRestore: true,
			receiptBeforeAnswer: true,
			persistedReceipts: true,
			trialReceipt: true,
			widths: [390, 1180]
		}
	} finally {
		await browser.close()
	}
}
