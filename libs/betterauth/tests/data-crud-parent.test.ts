import { describe, expect, test } from 'bun:test'
import { TOOL_ACTORS, type ToolCtx } from '@avenos/skills/tools'

// board 0112 — SUB-TASK id resolution (the live battle-test finding): the model passes `parent` as an
// 8-char short id (all it sees in CURRENT TODOS) or even smuggles the parent's TITLE. The data_crud actor
// must resolve BOTH against the live rows before the write, so part_of.x2 always carries a real task row
// id and the card nests correctly. Pure unit test — ctx.data is stubbed, no DB.

const PARENT_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111'
const LIVE = [
	{ id: PARENT_ID, title: 'file taxes', done: false },
	{ id: '99998888-7777-6666-5555-444433332222', title: 'water plants', done: false }
]

function ctxCapturing(created: Record<string, unknown>[][]): ToolCtx {
	return {
		userId: 'u1',
		data: async (args) => {
			if (args.action === 'list') return { items: LIVE }
			if (args.action === 'create') {
				created.push(args.items ?? [])
				return { ok: true, action: 'create', created: ['new-id'], errors: [] }
			}
			return { ok: true }
		}
	}
}

describe('board 0112 — data_crud resolves sub-task parents against the live rows', () => {
	test('an 8-char short parent id resolves to the full row id', async () => {
		const created: Record<string, unknown>[][] = []
		await TOOL_ACTORS.data_crud.handle(ctxCapturing(created), {
			schema: 'todos',
			action: 'create',
			items: [{ title: 'collect receipts', parent: PARENT_ID.slice(0, 8) }]
		})
		expect(created[0]?.[0]?.parent).toBe(PARENT_ID)
	})

	test('a smuggled parent TITLE resolves to that task\'s id', async () => {
		const created: Record<string, unknown>[][] = []
		await TOOL_ACTORS.data_crud.handle(ctxCapturing(created), {
			schema: 'todos',
			action: 'create',
			items: [{ title: 'scan invoices', parent: 'File Taxes' }]
		})
		expect(created[0]?.[0]?.parent).toBe(PARENT_ID)
	})

	test('a create WITHOUT parent does not fetch/rewrite anything', async () => {
		const created: Record<string, unknown>[][] = []
		await TOOL_ACTORS.data_crud.handle(ctxCapturing(created), {
			schema: 'todos',
			action: 'create',
			items: [{ title: 'free floater' }]
		})
		expect(created[0]?.[0]).toEqual({ title: 'free floater' })
	})
})
