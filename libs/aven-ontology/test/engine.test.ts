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

	test('create writes the canonical task/valid/due/prioritized rows (mutator parity w/ 0087)', async () => {
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
		// valid ≡ ranji: x1 task, x2 from, x3 to (null = open)
		expect(by('valid')).toEqual({ x2: '2026-06-29T12:00:00Z', x3: null, x1: id })
		// due ≡ detri: x1 DATE, x2 task
		expect(by('due')).toEqual({ x1: '2026-07-04', x2: id })
		// prioritized ≡ vajni: x1 task, x2 user, x3 level
		expect(by('prioritized')).toEqual({ x1: id, x2: 'USER1', x3: 'high' })
	})

	test('create with no due/priority writes only task + valid', async () => {
		const store = memStore()
		await create(TODO_SPEC, store, { title: 'plain', done: false }, ctx)
		expect(store.dump().map((r) => r.predicate).sort()).toEqual(['task', 'valid'])
	})

	test('query projects {title,done,due,priority} (matcher parity w/ v_task)', async () => {
		const store = memStore()
		await create(TODO_SPEC, store, { title: 'a', done: true, due: '2026-07-04', priority: 'low' }, ctx)
		await create(TODO_SPEC, store, { title: 'b' }, ctx)
		const list = await query(TODO_SPEC, store)
		expect(list).toEqual([
			{ id: expect.any(String), title: 'a', done: true, due: '2026-07-04', priority: 'low' },
			{ id: expect.any(String), title: 'b', done: false, due: null, priority: null }
		])
	})

	test('update: done closes the interval, due/priority replace, then clear', async () => {
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
		// no orphan due/prioritized rows linger after clearing
		expect(store.dump().map((r) => r.predicate).sort()).toEqual(['task', 'valid'])
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
