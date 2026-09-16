import { expect, test } from 'bun:test'
import { ResearchRecord } from '../src/lib/chat/research'
import {
	cleanRetrievalChatTools,
	cleanRetrievalSpecs,
	retrievalSpecs
} from '../src/lib/intents/retrieval-tools'

const names = [
	'artifact_list',
	'artifact_search',
	'artifact_detail',
	'intent_list',
	'intent_detail',
	'intent_messages',
	'message_detail',
	'intent_switch'
]
const specs = names.map((name) => ({ name, description: name, parameters: { type: 'object' } }))
test('seven overlapping lookups reduce to search/read without keeping callable aliases', async () => {
	const calls: Array<{ name: string; args: Record<string, unknown> }> = []
	const tools = cleanRetrievalChatTools({
		specs,
		run: (name, raw) => {
			const args = JSON.parse(raw)
			calls.push({ name, args })
			const text = JSON.stringify({
				ok: true,
				id: 'message-id',
				artifactId: 'file-id',
				content: 'Original content'
			})
			return { record: text, wire: text }
		}
	})
	expect(tools.specs.map((s) => s.name).sort()).toEqual([
		'intent_switch',
		'workspace_read',
		'workspace_search'
	])
	for (const name of names.filter((n) => n !== 'intent_switch'))
		expect(JSON.parse((await tools.run(name, '{}')).record).ok).toBe(false)
	for (const kind of ['intent', 'message', 'document'])
		await tools.run('workspace_search', JSON.stringify({ kind, query: 'older reference' }))
	for (const kind of ['intent', 'message', 'document']) {
		const result = JSON.parse(
			(await tools.run('workspace_read', JSON.stringify({ kind, id: 'exact-id' }))).record
		)
		expect(result.recordType).toBe(kind)
		if (kind !== 'intent') expect(result.sourceId).toBeDefined()
	}
	expect(calls.map((c) => c.name)).toEqual([
		'intent_list',
		'intent_messages',
		'artifact_search',
		'intent_detail',
		'message_detail',
		'artifact_detail'
	])
	expect(calls[5].args).toEqual({ artifact: 'exact-id', offset: 0 })
})
test('persistent cursors pass through; local cursors bind to query, scope and kind', async () => {
	const calls: Record<string, unknown>[] = []
	const tools = cleanRetrievalChatTools({
		specs,
		run: (_name, raw) => {
			calls.push(JSON.parse(raw))
			const text = JSON.stringify({ messages: [{ id: 'm' }], hasMore: true, offset: 0 })
			return { record: text, wire: text }
		}
	})
	const a = JSON.parse(
		(await tools.run('workspace_search', '{"kind":"message","query":"old"}')).record
	)
	await tools.run(
		'workspace_search',
		JSON.stringify({ kind: 'message', query: 'old', cursor: a.nextCursor })
	)
	expect(calls[1].offset).toBe(1)
	const bad = await tools.run(
		'workspace_search',
		JSON.stringify({ kind: 'message', query: 'new', cursor: a.nextCursor })
	)
	expect(JSON.parse(bad.record).ok).toBe(false)
	await tools.run('workspace_search', '{"kind":"message","cursor":"server-opaque"}')
	expect(calls[2].cursor).toBe('server-opaque')
	expect(retrievalSpecs).toHaveLength(2)
	expect(cleanRetrievalSpecs(cleanRetrievalSpecs(specs))).toEqual(cleanRetrievalSpecs(specs))
})

test('native message response enters evidence with its exact ID and timestamp', async () => {
	const tools = cleanRetrievalChatTools({
		specs,
		run: () => {
			const text = JSON.stringify({
				id: 'message-1',
				intentId: 'task-1',
				createdAt: '2026-06-11T10:00:00Z',
				role: 'user',
				content: 'The refund is still pending.',
				offset: 0,
				nextOffset: null
			})
			return { record: text, wire: text }
		}
	})
	const response = await tools.run(
		'workspace_read',
		JSON.stringify({ kind: 'message', id: 'message-1' })
	)
	const research = new ResearchRecord()
	research.observe('workspace_read', response.record)
	expect(research.sources.get('message-1:0')).toMatchObject({
		sourceId: 'message-1',
		createdAt: '2026-06-11T10:00:00Z',
		complete: true
	})
	expect(
		research.run('research_record', {
			items: [
				{
					requirement: 'Refund status',
					finding: 'Pending',
					status: 'supported',
					sources: [{ sourceId: 'message-1', quote: 'The refund is still pending.' }]
				}
			]
		}).ok
	).toBe(true)
})
