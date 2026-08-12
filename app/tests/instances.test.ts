import { describe, expect, test } from 'bun:test'
import { Actor, type Manifest } from '../src/lib/actors/actor'
import { MessageBus } from '../src/lib/actors/bus'
import { instanceWindowIds, instanceWindows } from '../src/lib/actors/instance-windows'
import { RegistryActor } from '../src/lib/actors/registry.actor'

/**
 * The 0133 proof: one manifest = a template, n instances — identified by
 * uuid, discovered by metadata, spawned and disposed by the engine, each
 * with its own sandboxed session and state, each with its own windows.
 */

const TODO_LOGIC = `
	function initState(source) { return { items: [] } }
	function reduce(state, ev) {
		if (ev.send === 'CREATE') {
			var items = state.items.concat([ev.payload.title])
			return {
				state: { items: items },
				said: 'created ' + ev.payload.title,
				record: { ok: true, items: items }
			}
		}
		return state
	}
	function shape() { return null }
`

const TODO_MANIFEST: Manifest = {
	id: 'todo',
	name: 'Todo',
	description: 'Keeps todos.',
	tags: ['test'],
	logic: TODO_LOGIC,
	view: { content: {} },
	style: {},
	views: [{ key: 'board', name: 'Board', view: { content: {} } }],
	methods: [
		{
			name: 'todo_create',
			description: 'Creates one todo.',
			parameters: { type: 'object', properties: { title: { type: 'string' } } },
			produces: ['todo(T)'],
			event: { send: 'CREATE' }
		}
	]
}

function mesh() {
	const bus = new MessageBus()
	bus.spawnable('todo', () => new Actor(TODO_MANIFEST))
	bus.register(new Actor(TODO_MANIFEST))
	bus.register(new RegistryActor(bus))
	return bus
}

describe('identity (0133): uuid is the address, the name is an index', () => {
	test('every instance carries a global uuid; the bus routes by it', () => {
		const a = new Actor(TODO_MANIFEST)
		const b = new Actor(TODO_MANIFEST)
		expect(a.uuid).not.toBe(b.uuid)
		const bus = new MessageBus()
		bus.register(a)
		bus.register(b)
		// uuid resolves each instance; the template name resolves the DEFAULT
		// (first registered) — never the copy
		expect(bus.get(a.uuid)).toBe(a)
		expect(bus.get(b.uuid)).toBe(b)
		expect(bus.get('todo')).toBe(a)
	})

	test('`to` addresses a specific instance; omitted = default', async () => {
		const bus = mesh()
		const spawned = bus.spawn('todo', 'umzug')
		expect(spawned).not.toBeNull()
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		const copy = spawned!
		await bus.dispatch('test', 'todo_create', { title: 'Kisten packen', to: copy.uuid })
		await bus.dispatch('test', 'todo_create', { title: 'Milch kaufen' })
		// the two states DIVERGED — own session, own state
		expect(copy.state.items).toEqual(['Kisten packen'])
		expect(bus.get('todo')?.state.items).toEqual(['Milch kaufen'])
		// the unique instance NAME addresses too — discovery metadata as alias
		await bus.dispatch('test', 'todo_create', { title: 'Transporter', to: 'umzug' })
		expect(copy.state.items).toEqual(['Kisten packen', 'Transporter'])
	})
})

describe('discovery (0133): the registry lists instances by metadata', () => {
	test('registry_list carries uuid, template, name and the default flag', async () => {
		const bus = mesh()
		bus.spawn('todo', 'umzug')
		const result = await bus.dispatch('test', 'registry_list', {})
		const rows = (JSON.parse(result.record) as { actors: Record<string, unknown>[] }).actors
		const todos = rows.filter((r) => r.template === 'todo')
		expect(todos.length).toBe(2)
		const byName = Object.fromEntries(todos.map((r) => [r.name, r]))
		expect(byName.todo?.default).toBe(true)
		expect(byName.umzug?.default).toBe(false)
		expect(typeof byName.umzug?.uuid).toBe('string')
		// uuids in the listing are real addresses, not guesses
		expect(bus.get(String(byName.umzug?.uuid))?.instanceName).toBe('umzug')
	})
})

describe('engine primitives (0133): spawn and dispose are registry entries', () => {
	test('spawn creates a diverging instance through a MESSAGE, dispose removes it', async () => {
		const bus = mesh()
		const spawnedResult = await bus.dispatch('test', 'spawn', {
			template: 'todo',
			name: 'umzug'
		})
		const spawned = JSON.parse(spawnedResult.record) as {
			ok: boolean
			spawned: { uuid: string; name: string }
		}
		expect(spawned.ok).toBe(true)
		expect(spawned.spawned.name).toBe('umzug')
		expect(spawnedResult.wire).toContain('umzug')
		// its own state, provably separate
		await bus.dispatch('test', 'todo_create', { title: 'A', to: spawned.spawned.uuid })
		expect(bus.get(spawned.spawned.uuid)?.state.items).toEqual(['A'])
		expect(bus.get('todo')?.state.items).toEqual([])
		// dispose by message removes it
		const disposed = await bus.dispatch('test', 'dispose', { to: spawned.spawned.uuid })
		expect((JSON.parse(disposed.record) as { ok: boolean }).ok).toBe(true)
		expect(bus.get(spawned.spawned.uuid)).toBeUndefined()
	})

	test('the default instance cannot be disposed; unknown templates cannot spawn', async () => {
		const bus = mesh()
		const denied = await bus.dispatch('test', 'dispose', { to: 'todo' })
		expect((JSON.parse(denied.record) as { ok: boolean }).ok).toBe(false)
		expect(bus.get('todo')).toBeDefined()
		const unknown = await bus.dispatch('test', 'spawn', { template: 'nope' })
		expect((JSON.parse(unknown.record) as { ok: boolean }).ok).toBe(false)
	})
})

describe('windows (0133): a spawned instance brings its views, dispose takes them', () => {
	test('instanceWindows derives one window per view, keyed by instance name', () => {
		const windows = instanceWindows(TODO_MANIFEST, 'umzug')
		expect(windows.map((w) => w.key)).toEqual(['umzug', 'umzug-board'])
		expect(windows.map((w) => w.name)).toEqual(['umzug', 'umzug Board'])
		expect(windows[0]?.view).toBe(TODO_MANIFEST.view)
		expect(instanceWindowIds(TODO_MANIFEST, 'umzug')).toEqual([
			'umzug-window',
			'umzug-board-window'
		])
	})

	test('the spawn hook fires with the instance; dispose hook with the same one', () => {
		const bus = mesh()
		const events: string[] = []
		bus.onSpawned = (actor) => events.push(`spawned:${actor.instanceName}`)
		bus.onDisposed = (actor) => events.push(`disposed:${actor.instanceName}`)
		const spawned = bus.spawn('todo', 'umzug')
		// biome-ignore lint/style/noNonNullAssertion: spawnable is registered
		bus.dispose(spawned!.uuid)
		expect(events).toEqual(['spawned:umzug', 'disposed:umzug'])
	})
})
