import { describe, expect, test } from 'bun:test'
import type { InputRoute } from '@avenos/llm-client/input-decision'
import {
	type InputHost,
	InputInboxController,
	type PendingInput
} from '../src/lib/chat/input-inbox-controller'

// State/transport contract checks supplement, never replace, the live-Qwen journeys.
const intents = [
	{ id: 'pottery', title: 'Pottery workshop' },
	{ id: 'garden', title: 'Community garden' }
]
const choice: InputRoute = {
	fit: false,
	explicit: false,
	responseMode: 'work',
	topic: 'Seed orders',
	target: { kind: 'existing', id: 'garden' }
}
function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((yes) => {
		resolve = yes
	})
	return { promise, resolve }
}
async function until(check: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (check()) return
		await new Promise((r) => setTimeout(r, 1))
	}
	throw Error('State did not settle')
}
function fixture(overrides: Partial<InputHost> = {}) {
	const assigned: PendingInput[] = []
	let saved: PendingInput[] = []
	const controller = new InputInboxController(
		{
			inspect: async () => ({ intents, route: choice }),
			reply: async () => 'accept-suggested',
			assign: async (item) => {
				assigned.push(item)
				return 'garden'
			},
			save: async (items) => {
				saved = items
			},
			...overrides
		},
		() => {}
	)
	return { controller, assigned, saved: () => saved }
}
describe('unassigned input boundary', () => {
	test('rejects a suspended or oversized capture synchronously before taking ownership', async () => {
		const { controller: c } = fixture()
		await c.suspend()
		expect(() => c.submit('Keep these words', 'pottery', 0)).toThrow('workspace is changing')
		expect(c.items).toEqual([])
		c.resume()
		expect(() => c.submit('x'.repeat(8001), 'pottery', 0)).toThrow('8,000')
		expect(c.items).toEqual([])
	})

	test('an unavailable decision releases manual routing and ignores a late model answer', async () => {
		const inspected = deferred<{ intents: typeof intents; route: InputRoute }>()
		const assigned: string[] = []
		const c = new InputInboxController(
			{
				inspect: () => inspected.promise,
				reply: async () => 'clarify',
				assign: async (item) => {
					assigned.push(item.text)
					return 'garden'
				}
			},
			() => {},
			5
		)
		void c.submit('Compare seed orders', 'pottery', 0)
		await until(() => c.active?.stage === 'failed')
		expect(c.active?.error).toContain('taking too long')
		inspected.resolve({ intents, route: { ...choice, explicit: true } })
		await new Promise((r) => setTimeout(r, 5))
		expect(assigned).toEqual([])
		expect(c.active?.text).toBe('Compare seed orders')
		c.addCandidates(c.active!.id, intents)
		c.choose(c.active!.id, choice.target!)
		await until(() => !c.items.length)
		expect(assigned).toEqual(['Compare seed orders'])
	})

	test('a failed old-workspace removal cannot restore its private words into the next workspace', async () => {
		const disk = deferred<void>()
		let pendingSave = false
		const { controller: c } = fixture({
			save: async (items) => {
				if (pendingSave && !items.length) {
					await disk.promise
					throw Error('Old scope ended')
				}
			}
		})
		void c.submit('Private workshop draft', 'pottery', 0)
		await until(() => c.active?.stage === 'choice')
		pendingSave = true
		const discarded = c.discard(c.active!.id)
		c.reset()
		disk.resolve()
		await discarded
		expect(c.items).toEqual([])
	})

	test('private recovery merges older drafts without replacing words typed while it loaded', async () => {
		const { controller: c } = fixture()
		void c.submit('Older draft', 'pottery', 0)
		await until(() => c.active?.stage === 'choice')
		const old = structuredClone(c.items)
		c.reset()
		void c.submit('Just typed now', 'pottery', 0)
		c.restore(old)
		expect(c.items.map((item) => item.text)).toEqual(['Older draft', 'Just typed now'])
		c.reset()
	})
	test('spoken acceptance contributes original words, never the yes', async () => {
		const { controller: c, assigned, saved } = fixture()
		const first = c.submit('Compare seed orders', 'pottery', 0)
		await until(() => c.active?.stage === 'choice')
		await c.submit('Yes', 'pottery', 0)
		await first
		expect(assigned.map((i) => i.text)).toEqual(['Compare seed orders'])
		expect(c.items).toEqual([])
		expect(saved()).toEqual([])
	})
	test('click racing spoken consent admits once and keeps stale reply unsent', async () => {
		const reply = deferred<'accept-suggested'>()
		const { controller: c, assigned } = fixture({ reply: () => reply.promise })
		const first = c.submit('Compare seed orders', 'pottery', 0)
		await until(() => c.active?.stage === 'choice')
		void c.submit('Yes', 'pottery', 0)
		await until(() => c.items.length === 2)
		await c.flush()
		c.choose(c.items[0].id, choice.target!)
		c.choose(c.items[0]?.id, choice.target!)
		await first
		reply.resolve('accept-suggested')
		await until(() => c.active?.stage === 'failed')
		expect(assigned).toHaveLength(1)
		expect(c.active?.text).toBe('Yes')
		c.reset()
	})
	test('independent new request bypasses unresolved choice', async () => {
		const { controller: c, assigned } = fixture({
			reply: async () => 'independent',
			inspect: async (item) => ({
				intents,
				route: item.text.includes('kiln')
					? {
							fit: false,
							explicit: true,
							responseMode: 'clarify',
							topic: 'Kiln repairs',
							target: { kind: 'new', title: 'Kiln repairs' }
						}
					: choice
			})
		})
		void c.submit('Compare seed orders', 'pottery', 0)
		await until(() => c.active?.stage === 'choice')
		await c.submit('New Intent for kiln repairs', 'pottery', 0)
		expect(assigned.map((i) => i.text)).toEqual(['New Intent for kiln repairs'])
		expect(assigned[0].responseMode).toBe('clarify')
		expect(c.active?.text).toBe('Compare seed orders')
		c.reset()
	})
	test('lost admission acknowledgement pins target through recovery', async () => {
		const targets: unknown[] = []
		let calls = 0
		const { controller: c, saved } = fixture({
			assign: async (_, target) => {
				targets.push(target)
				if (!calls++) throw Error('Connection lost')
				return 'garden'
			}
		})
		void c.submit('Compare seed orders', 'pottery', 0)
		await until(() => c.active?.stage === 'choice')
		const id = c.active!.id
		c.choose(id, choice.target!)
		await until(() => c.active?.stage === 'failed')
		expect(await c.discard(id)).toBeNull()
		c.choose(id, { kind: 'new', title: 'Wrong destination' })
		await c.flush()
		const recovered = structuredClone(saved())
		c.reset()
		c.restore(recovered)
		c.retry(id)
		await until(() => !c.items.length)
		expect(targets).toEqual([choice.target, choice.target])
		expect(recovered[0].responseMode).toBe('work')
	})
	test('workspace reset fences late route completion', async () => {
		const inspected = deferred<{ intents: typeof intents; route: InputRoute }>()
		const { controller: c, assigned } = fixture({ inspect: () => inspected.promise })
		void c.submit('Compare seed orders', 'pottery', 0)
		await c.flush()
		c.reset()
		inspected.resolve({ intents, route: { ...choice, explicit: true } })
		await new Promise((r) => setTimeout(r, 5))
		expect(c.items).toEqual([])
		expect(assigned).toEqual([])
	})
	test('failed durable removal does not lose a message or permit retargeting', async () => {
		let fail = true
		const { controller: c, assigned } = fixture({
			save: async (items) => {
				if (fail && items.length === 0) throw Error('Disk unavailable')
			}
		})
		void c.submit('Compare seed orders', 'pottery', 0)
		await until(() => c.active?.stage === 'choice')
		c.choose(c.active!.id, choice.target!)
		await until(() => c.active?.stage === 'failed')
		expect(c.active?.assignment).toEqual(choice.target)
		expect(assigned).toHaveLength(1)
		fail = false
		c.retry(c.active!.id)
		await until(() => !c.items.length)
		expect(assigned[1].id).toBe(assigned[0].id)
		expect(assigned[1].revision).toBe(assigned[0].revision)
	})
})
