import { beforeAll, expect, test } from 'bun:test'
import type { MessageBus } from '@avenos/actors'

let bus: MessageBus
let hitlQueue: { items: Array<{ id: string }>; saving: number }
let confirmHeld: (id: string) => void
let rejectHeld: (id: string) => void
let suspendHeldForEnvironmentSwitch: () => boolean
let discardHeldForEnvironmentSwitch: () => void
let resumeHeldAfterEnvironmentSwitch: () => void

beforeAll(async () => {
	;(globalThis as typeof globalThis & { $state: <T>(value: T) => T }).$state = <T>(value: T) =>
		value
	const busModule = await import('../src/lib/actors/bus')
	const hitl = await import('../src/lib/actors/hitl.svelte')
	bus = busModule.bus
	hitlQueue = hitl.hitlQueue
	confirmHeld = hitl.confirmHeld
	rejectHeld = hitl.rejectHeld
	suspendHeldForEnvironmentSwitch = hitl.suspendHeldForEnvironmentSwitch
	discardHeldForEnvironmentSwitch = hitl.discardHeldForEnvironmentSwitch
	resumeHeldAfterEnvironmentSwitch = hitl.resumeHeldAfterEnvironmentSwitch
})

test('switching customer environments removes the visible review and its callback', async () => {
	const id = `environment-review-${crypto.randomUUID()}`
	let confirmed = false
	bus.holdAction(
		{ id, actor: 'test', method: 'review', label: 'Customer A review', detail: '{}' },
		{
			confirm: async () => {
				confirmed = true
				return { record: '{"ok":true}', wire: 'saved' }
			}
		}
	)
	expect(hitlQueue.items.some((item) => item.id === id)).toBe(true)

	expect(suspendHeldForEnvironmentSwitch()).toBe(true)
	discardHeldForEnvironmentSwitch()
	resumeHeldAfterEnvironmentSwitch()

	expect(hitlQueue.items.some((item) => item.id === id)).toBe(false)
	expect(JSON.parse((await bus.confirmHeld(id)).record).ok).toBe(false)
	expect(confirmed).toBe(false)
})

for (const action of ['confirm', 'reject'] as const) {
	test(`${action} keeps the environment busy until the physical decision finishes`, async () => {
		const id = `saving-${action}-${crypto.randomUUID()}`
		let finish!: () => void
		const pending = new Promise<void>((resolve) => {
			finish = resolve
		})
		bus.holdAction(
			{ id, actor: 'test', method: 'review', label: 'Save review', detail: '{}' },
			{
				confirm: async () => {
					await pending
					return { record: '{"ok":true}', wire: 'saved' }
				},
				reject: async () => {
					await pending
				}
			}
		)
		try {
			if (action === 'confirm') confirmHeld(id)
			else rejectHeld(id)
			expect(hitlQueue.saving).toBe(1)
			expect(suspendHeldForEnvironmentSwitch()).toBe(false)
		} finally {
			finish()
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(hitlQueue.saving).toBe(0)
		expect(suspendHeldForEnvironmentSwitch()).toBe(true)
		resumeHeldAfterEnvironmentSwitch()
	})
}

test('a failed review save releases the busy state and keeps a retryable review', async () => {
	const id = `failed-review-${crypto.randomUUID()}`
	bus.holdAction(
		{ id, actor: 'test', method: 'review', label: 'Save review', detail: '{}' },
		{
			confirm: async () => {
				throw new Error('synthetic storage failure')
			}
		}
	)
	confirmHeld(id)
	await new Promise((resolve) => setTimeout(resolve, 0))
	expect(hitlQueue.saving).toBe(0)
	expect(hitlQueue.items.some((item) => item.id === id)).toBe(true)
	expect(suspendHeldForEnvironmentSwitch()).toBe(true)
	discardHeldForEnvironmentSwitch()
	resumeHeldAfterEnvironmentSwitch()
})
