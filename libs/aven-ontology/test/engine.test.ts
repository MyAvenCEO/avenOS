import { describe, expect, test } from 'bun:test'
import { create, query, remove, resolveBind, update } from '../src/engine.js'
import { memStore } from '../src/memstore.js'
import type { TypeSpec } from '../src/types.js'

const ctx = { user: 'USER1', now: () => '2026-06-29T12:00:00Z' }

// board 0102 — the engine is domain-free; aven-ontology no longer ships bundle specs. These two are INLINE
// TEST FIXTURES exercising the full engine: create/project, presence-toggle + replace + clear (TODO_SPEC,
// which also mirrors the live `todos` bundle for the projection-parity check), and the discriminated
// `replace`/`match` where several channels share ONE `address`/`identifier` predicate (COMPANY_SPEC).
const TODO_SPEC: TypeSpec = {
	type: 'todos',
	parts: [
		{
			pred: 'task',
			kind: 'primary',
			field: 'title',
			create: { x1: '$user', x2: '$value' },
			set: { x2: '$value' }
		},
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'done', kind: 'replace', link: 'x1', field: 'done', set: { x1: '$primary' } },
		{
			pred: 'due',
			kind: 'replace',
			link: 'x2',
			field: 'due',
			set: { x1: '$value', x2: '$primary' }
		},
		{
			pred: 'prioritized',
			kind: 'replace',
			link: 'x1',
			field: 'priority',
			set: { x1: '$primary', x2: '$user', x3: '$value' }
		}
	],
	project: {
		title: { pred: 'task', place: 'x2' },
		done: { pred: 'done', notNull: 'x1' },
		due: { pred: 'due', place: 'x1' },
		priority: { pred: 'prioritized', place: 'x3' },
		owner: { pred: 'owned_by', place: 'x1' }
	}
}
const channel = (field: string, sys: string): TypeSpec['parts'][number] => ({
	pred: 'address',
	kind: 'replace',
	link: 'x2',
	field,
	match: { x3: sys },
	set: { x1: '$value', x2: '$primary' }
})
const idpart = (field: string, kind: string): TypeSpec['parts'][number] => ({
	pred: 'identifier',
	kind: 'replace',
	link: 'x2',
	field,
	match: { x1: kind },
	set: { x2: '$primary', x3: '$value' }
})
const COMPANY_SPEC: TypeSpec = {
	type: 'company',
	parts: [
		{ pred: 'company', kind: 'primary', field: 'name', create: {}, set: {} },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{
			pred: 'name',
			kind: 'replace',
			link: 'x2',
			field: 'name',
			set: { x1: '$value', x2: '$primary' }
		},
		channel('email', 'addrsys-email'),
		channel('phone', 'addrsys-phone'),
		channel('iban', 'addrsys-iban'),
		channel('postal', 'addrsys-postal'),
		idpart('vat_id', 'idkind-vat_id'),
		idpart('tax_number', 'idkind-tax_number')
	],
	project: {
		name: { pred: 'name', place: 'x1' },
		email: { pred: 'address', place: 'x1', match: { x3: 'addrsys-email' } },
		phone: { pred: 'address', place: 'x1', match: { x3: 'addrsys-phone' } },
		iban: { pred: 'address', place: 'x1', match: { x3: 'addrsys-iban' } },
		postal: { pred: 'address', place: 'x1', match: { x3: 'addrsys-postal' } },
		vat_id: { pred: 'identifier', place: 'x3', match: { x1: 'idkind-vat_id' } },
		tax_number: { pred: 'identifier', place: 'x3', match: { x1: 'idkind-tax_number' } },
		owner: { pred: 'owned_by', place: 'x1' }
	}
}

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
		expect(
			store
				.dump()
				.map((r) => r.predicate)
				.sort()
		).toEqual(['owned_by', 'task'])
	})

	test('query projects {title,done,due,priority,owner} (matcher parity w/ v_task)', async () => {
		const store = memStore()
		await create(
			TODO_SPEC,
			store,
			{ title: 'a', done: true, due: '2026-07-04', priority: 'low' },
			ctx
		)
		await create(TODO_SPEC, store, { title: 'b' }, ctx)
		const list = await query(TODO_SPEC, store)
		expect(list).toEqual([
			{
				id: expect.any(String),
				title: 'a',
				done: true,
				due: '2026-07-04',
				priority: 'low',
				owner: 'USER1'
			},
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
		expect(
			store
				.dump()
				.map((r) => r.predicate)
				.sort()
		).toEqual(['owned_by', 'task'])
	})

	test('children: a parent with N child sub-entities round-trips as a nested array (board 0092)', async () => {
		const store = memStore()
		// a line is its OWN sub-entity (its own primary + attribute); the order projects them as an array
		const lineSpec: TypeSpec = {
			type: 'line',
			parts: [
				{ pred: 'line', kind: 'primary', field: 'desc', create: { x1: '$value', x2: '$parent' } },
				{
					pred: 'lineamt',
					kind: 'replace',
					link: 'x2',
					field: 'amount',
					set: { x1: '$value', x2: '$primary' }
				}
			],
			project: { desc: { pred: 'line', place: 'x1' }, amount: { pred: 'lineamt', place: 'x1' } }
		}
		const orderSpec: TypeSpec = {
			type: 'order',
			parts: [
				{ pred: 'order', kind: 'primary', field: 'ref', create: { x2: '$value' } },
				{ pred: 'line', kind: 'children', field: 'lines', link: 'x2', childSpec: lineSpec }
			],
			project: { ref: { pred: 'order', place: 'x2' }, lines: { pred: 'line', children: true } }
		}
		const id = (await create(
			orderSpec,
			store,
			{
				ref: 'PO-1',
				lines: [
					{ desc: 'Widget', amount: '10.00' },
					{ desc: 'Gadget', amount: '5.50' }
				]
			},
			ctx
		)) as string
		const list = await query(orderSpec, store)
		expect(list).toHaveLength(1)
		expect(list[0]).toMatchObject({ ref: 'PO-1' })
		expect(list[0].lines).toEqual([
			{ id: expect.any(String), desc: 'Widget', amount: '10.00' },
			{ id: expect.any(String), desc: 'Gadget', amount: '5.50' }
		])
		// update replaces the children wholesale, no orphans
		await update(orderSpec, store, { id, lines: [{ desc: 'Only', amount: '1.00' }] }, ctx)
		expect((await query(orderSpec, store))[0].lines).toEqual([
			{ id: expect.any(String), desc: 'Only', amount: '1.00' }
		])
		expect(
			store
				.dump()
				.map((r) => r.predicate)
				.sort()
		).toEqual(['line', 'lineamt', 'order'])
		// delete cascades every child + its sub-predications
		await remove(orderSpec, store, id)
		expect(store.dump()).toEqual([])
	})

	// board 0097 — the discriminated `replace`: several channels share ONE `address`≡judri (keyed by
	// x3 = the addressing system) and several identifiers share ONE `identifier`≡tcita (keyed by x1 =
	// the id kind), yet each replaces + projects independently and the projected record stays flat.
	test('consolidation: one address/identifier predicate, discriminated by x3/x1', async () => {
		const store = memStore()
		const id = (await create(
			COMPANY_SPEC,
			store,
			{
				name: 'Fly.io',
				email: 'billing@fly.io',
				phone: '+1 555',
				iban: 'DE89',
				vat_id: 'DE12345',
				tax_number: '151/815'
			},
			ctx
		)) as string
		const addrs = store.dump().filter((r) => r.predicate === 'address')
		const ids = store.dump().filter((r) => r.predicate === 'identifier')
		// three given channels → three `address` rows, each carrying its system in x3 (the channel TYPE)
		expect(addrs.length).toBe(3)
		expect(new Set(addrs.map((r) => r.cells.x3))).toEqual(
			new Set(['addrsys-email', 'addrsys-phone', 'addrsys-iban'])
		)
		expect(addrs.find((r) => r.cells.x3 === 'addrsys-email')?.cells).toEqual({
			x1: 'billing@fly.io',
			x2: id,
			x3: 'addrsys-email'
		})
		// two identifiers → two `identifier` rows, each carrying its kind in x1 (the id KIND), value x3
		expect(ids.length).toBe(2)
		expect(ids.find((r) => r.cells.x1 === 'idkind-vat_id')?.cells).toEqual({
			x1: 'idkind-vat_id',
			x2: id,
			x3: 'DE12345'
		})
		// the projection stays flat — every channel/identifier reads back at its own field
		const [co] = await query(COMPANY_SPEC, store)
		expect(co).toMatchObject({
			name: 'Fly.io',
			email: 'billing@fly.io',
			phone: '+1 555',
			iban: 'DE89',
			vat_id: 'DE12345',
			tax_number: '151/815'
		})
		// update ONE channel — only its discriminated row is replaced, the others untouched
		await update(COMPANY_SPEC, store, { id, email: 'new@fly.io' }, ctx)
		const after = store.dump().filter((r) => r.predicate === 'address')
		expect(after.length).toBe(3)
		expect(after.find((r) => r.cells.x3 === 'addrsys-email')?.cells.x1).toBe('new@fly.io')
		expect(after.find((r) => r.cells.x3 === 'addrsys-phone')?.cells.x1).toBe('+1 555')
		// delete cascades every linked address/identifier — no orphans
		await remove(COMPANY_SPEC, store, id)
		expect(store.dump()).toEqual([])
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
