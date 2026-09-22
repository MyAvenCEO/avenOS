import { expect, test } from 'bun:test'
import { findPastCases, readPastCase } from '../src/lib/skills/case-recall'

test('case recall pages through the shared tools without switching Intent or assuming exhaustive coverage', async () => {
	const calls: string[] = []
	const invoke = async (name: string, args: Record<string, unknown>) => {
		calls.push(name)
		if (name === 'workspace_search') expect(args.cursor).toBe('opaque-server-cursor')
		return {
			record: JSON.stringify(
				name === 'workspace_search'
					? {
							ok: true,
							intents: [{ id: 'old', title: 'Old manual work' }],
							hasMore: true,
							nextCursor: 'next-page'
						}
					: {
							ok: true,
							id: args.id,
							title: 'Old manual work',
							conversation: [{ role: 'user', content: 'Please summarize this email' }],
							activity: [],
							artifacts: []
						}
			)
		}
	}
	const result = await findPastCases('email', 'opaque-server-cursor', invoke)
	expect(result).toMatchObject({
		nextCursor: 'next-page',
		hasMore: true,
		coverage: 'shared-recall'
	})
	expect((await readPastCase('old', invoke)).conversation[0].content).toContain('email')
	expect(calls).toEqual(['workspace_search', 'workspace_read'])
	const native = await findPastCases('archive', null, async () => ({
		record: JSON.stringify({
			intents: [
				{ id: 'stored', title: 'Old email procedure', sourceLabel: 'Email', state: 'archive' }
			],
			nextCursor: null
		})
	}))
	expect(native.items[0]).toEqual({
		id: 'stored',
		title: 'Old email procedure',
		source: 'Email',
		status: 'archive'
	})
	await expect(
		readPastCase('old', async () => ({ record: '{"ok":true,"id":"wrong"}' }))
	).rejects.toThrow()
})
