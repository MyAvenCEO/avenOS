import { describe, expect, test } from 'bun:test'
import { create, query, remove, resolveBind, update } from '../src/engine.js'
import { memStore } from '../src/memstore.js'
import { TODO_SPEC } from '../src/todo-spec.js'

const ctx = { user: 'USER1', now: () => '2026-06-29T12:00:00Z' }

describe('aven-ontology engine (board 0088)', () => {
	test('resolveBind: tokens + conditional truthiness on the raw value', () => {
		const env = { user: 'U', primary: 'P', now: 'N', value: undefined as unknown }
		expect(resolveBind('$user', env)).toBe('U')
		expect(resolveBind('$primary', env)).toBe('P')
		expect(resolveBind('$now', env)).toBe('N')
		expect(resolveBind('literal', env)).toBe('literal')
		expect(resolveBind('$value', { ...env, value: 'x' })).toBe('x')
		expect(resolveBind('$value', { ...env, value: null })).toBe(null)
		// done=true → $now ; done=false → null (NOT the string "false")
		expect(resolveBind('$value?$now:null', { ...env, value: true })).toBe('N')
		expect(resolveBind('$value?$now:null', { ...env, value: false })).toBe(null)
	})

	test('create writes the canonical task/owned_by/due/prioritized rows (board 0092 fidelity)', async () => {
		const store = memStore()
		const id = await create(
			TODO_SPEC,
			store,
			{ title: 'make salad', done: false, due: '2026-07-04', priority: 'high' },
			ctx
		)
		const by = (p: string) => store.dump().find((r) => r.predicate === p)?.cells
		// task ≡ zukte: x1 agent, x2 action
		expect(by('task')).toEqual({ x1: 'USER1', x2: 'make salad' })
		// owned_by ≡ ponse: x1 account, x2 entity — universal ownership, one per entity
		expect(by('owned_by')).toEqual({ x1: 'USER1', x2: id })
		// done ≡ mulno presence: done:false → NO row (still open)
		expect(by('done')).toBeUndefined()
		// due ≡ detri: x1 DATE, x2 task
		expect(by('due')).toEqual({ x1: '2026-07-04', x2: id })
		// prioritized ≡ vajni: x1 task, x2 user, x3 level
		expect(by('prioritized')).toEqual({ x1: id, x2: 'USER1', x3: 'high' })
	})

	test('create with no due/priority/done writes only task + owned_by', async () => {
		const store = memStore()
		await create(TODO_SPEC, store, { title: 'plain', done: false }, ctx)
		expect(store.dump().map((r) => r.predicate).sort()).toEqual(['owned_by', 'task'])
	})

	test('query projects {title,done,due,priority,owner} (matcher parity w/ v_task)', async () => {
		const store = memStore()
		await create(TODO_SPEC, store, { title: 'a', done: true, due: '2026-07-04', priority: 'low' }, ctx)
		await create(TODO_SPEC, store, { title: 'b' }, ctx)
		const list = await query(TODO_SPEC, store)
		expect(list).toEqual([
			{ id: expect.any(String), title: 'a', done: true, due: '2026-07-04', priority: 'low', owner: 'USER1' },
			{ id: expect.any(String), title: 'b', done: false, due: null, priority: null, owner: 'USER1' }
		])
	})

	test('update: done≡mulno presence toggles, due/priority replace, then clear (board 0092)', async () => {
		const store = memStore()
		const id = (await create(TODO_SPEC, store, { title: 'x' }, ctx)) as string
		await update(TODO_SPEC, store, { id, done: true, due: '2026-08-01', priority: 'high' }, ctx)
		expect((await query(TODO_SPEC, store))[0]).toMatchObject({
			done: true,
			due: '2026-08-01',
			priority: 'high'
		})
		// re-open + clear the attributes
		await update(TODO_SPEC, store, { id, done: false, due: null, priority: null }, ctx)
		expect((await query(TODO_SPEC, store))[0]).toMatchObject({
			done: false,
			due: null,
			priority: null
		})
		// no orphan done/due/prioritized rows linger — only task + owned_by remain
		expect(store.dump().map((r) => r.predicate).sort()).toEqual(['owned_by', 'task'])
	})

	test('delete cascades — primary + every linked predication, no orphans', async () => {
		const store = memStore()
		const id = (await create(
			TODO_SPEC,
			store,
			{ title: 'gone', done: true, due: '2026-09-09', priority: 'high' },
			ctx
		)) as string
		await remove(TODO_SPEC, store, id)
		expect(await query(TODO_SPEC, store)).toEqual([])
		expect(store.dump()).toEqual([])
	})
})
