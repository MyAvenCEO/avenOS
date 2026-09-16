import { beforeAll, expect, test } from 'bun:test'
import type { MessageBus } from '@avenos/actors'

let bus: MessageBus
let hitlQueue: { items: Array<{ id: string }> }
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
