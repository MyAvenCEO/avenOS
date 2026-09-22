import { expect, test } from 'bun:test'
import {
	cleanRetrievalChatTools,
	cleanRetrievalSpecs,
	createRetrievalActor,
	retrievalSpecs
} from '@avenos/actors/retrieval'
import { pageMessages } from '@avenos/chat-engine/history-selection'
import { ResearchRecord } from '@avenos/chat-engine/research'
import { toolPurpose } from '@avenos/chat-engine/tool-call'
import {
	historySearchSchema,
	intentHistoryPreview,
	intentRetrievalSchema,
	messageRetrievalSchema
} from '@avenos/intents/retrieval'

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
test('unsupported retrieval fields are rejected before storage on every adapter', async () => {
	const calls: Record<string, unknown>[] = []
	const storage = (p: Record<string, unknown>) => {
		calls.push(p)
		return { record: '{"ok":true}', wire: '{"ok":true}' }
	}
	const actor = createRetrievalActor(Object.fromEntries(names.map((name) => [name, storage])))
	try {
		for (const method of ['workspace_search', 'workspace_read']) {
			for (const kind of ['intent', 'message', 'document']) {
				const args = { kind, ...(method === 'workspace_read' && { id: 'exact-id' }) }
				for (const extra of ['extraFilter', 'explanation', 'unexpectedSort']) {
					const response = await actor.deliver(method, {
						...args,
						[extra]: 'synthetic-private-value-not-for-diagnostics'
					})
					const result = JSON.parse(response.record)
					expect(result).toMatchObject({
						ok: false,
						code: 'COMMAND_INVALID',
						performed: false,
						unknownFields: [extra],
						unknownFieldCount: 1
					})
					expect(result.allowedFields).toEqual(
						Object.keys(
							retrievalSpecs.find((s) => s.name === method)!.parameters.properties as object
						)
					)
					expect(response.record).not.toContain('synthetic-private-value')
					expect(response.wire).toBe(response.record)
				}
			}
		}
		expect(calls).toHaveLength(0)
		const bounded = JSON.parse(
			(
				await actor.deliver('workspace_search', {
					kind: 'message',
					...Object.fromEntries(
						Array.from({ length: 20 }, (_, i) => ['x'.repeat(100) + i, 'private'])
					)
				})
			).record
		)
		expect(bounded.unknownFields).toHaveLength(8)
		expect(bounded.unknownFields.every((key: string) => key.length === 80)).toBe(true)
		expect(bounded.unknownFieldCount).toBe(20)
		const corrected = await actor.deliver('workspace_search', { kind: 'message', query: 'garden' })
		expect(JSON.parse(corrected.record).ok).toBe(true)
		expect(calls).toEqual([{ query: 'garden', limit: 20 }])
		for (const limit of [1, 7, 20]) {
			const result = await actor.deliver('workspace_search', { kind: 'message', limit })
			expect(JSON.parse(result.record).ok).toBe(true)
			expect(calls.at(-1)?.limit).toBe(limit)
		}
		const count = calls.length
		for (const limit of [0, 21, 1.5, '20', null, {}, []])
			expect(
				JSON.parse((await actor.deliver('workspace_search', { kind: 'message', limit })).record).ok
			).toBe(false)
		expect(calls.length).toBe(count)
	} finally {
		actor.dispose()
	}
})
test('filters for the wrong operation are not silently discarded', async () => {
	let calls = 0
	const storage = () => {
		calls++
		return { record: '{}', wire: '{}' }
	}
	const actor = createRetrievalActor(Object.fromEntries(names.map((name) => [name, storage])))
	try {
		for (const [method, args] of [
			['workspace_read', { kind: 'message', id: 'exact-id', query: 'garden' }],
			['workspace_read', { kind: 'message', id: 'exact-id', role: 'user' }],
			['workspace_search', { kind: 'intent', before: '2026-03-02' }],
			['workspace_search', { kind: 'document', order: 'oldest' }]
		] as const)
			expect(JSON.parse((await actor.deliver(method, args)).record).ok).toBe(false)
		expect(calls).toBe(0)
	} finally {
		actor.dispose()
	}
})
test('message ordering and speaker selection use the same contract on local and delegated paths', async () => {
	expect(
		retrievalSpecs.find((spec) => spec.name === 'workspace_search')!.parameters.dependentRequired
	).toEqual({ order: ['intent'] })
	const messages = Array.from({ length: 8 }, (_, i) => ({
		id: String(i),
		role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
		content: `Synthetic note ${i}`
	}))
	expect(
		pageMessages(messages, '', 0, 2, { role: 'user', order: 'oldest' }).rows.map((m) => m.id)
	).toEqual(['0', '2'])
	expect(
		pageMessages(messages, 'note', 0, 2, { role: 'assistant', order: 'newest' }).rows.map(
			(m) => m.id
		)
	).toEqual(['7', '5'])
	const intent = '12345678-1234-4234-8234-123456789012'
	const input = { intent, role: 'user', order: 'oldest' }
	expect(messageRetrievalSchema.parse(input)).toEqual(input)
	expect(historySearchSchema.parse({ kind: 'search', recordKind: 'message', input }).input).toEqual(
		input
	)
	expect(() => historySearchSchema.parse({ kind: 'search', recordKind: 'intent', input })).toThrow()
	expect(() => messageRetrievalSchema.parse({ order: 'oldest' })).toThrow()
	const actor = createRetrievalActor({
		intent_messages: (p) => ({
			record: JSON.stringify({
				messages: [],
				hasMore: true,
				nextCursor: 'opaque',
				received: messageRetrievalSchema.parse(p)
			}),
			wire: ''
		}),
		message_detail: () => ({ record: '{}', wire: '' })
	})
	try {
		const result = JSON.parse(
			(await actor.deliver('workspace_search', { kind: 'message', ...input })).record
		)
		expect(result.continuation.arguments).toEqual({ kind: 'message', ...input, cursor: 'opaque' })
		expect(result.ordering).toContain('Oldest first')
		expect(result.received).toEqual({ ...input, limit: 20 })
	} finally {
		actor.dispose()
	}
})
test('lookup purpose stays in presentation and never becomes a storage filter', async () => {
	const parameters: Record<string, unknown>[] = []
	const actor = createRetrievalActor({
		intent_list: (p) => {
			parameters.push(intentRetrievalSchema.parse(p))
			return { record: '{}', wire: '{}' }
		},
		intent_detail: () => ({ record: '{}', wire: '{}' })
	})
	try {
		for (const purpose of [undefined, 'Find the agreed storage location']) {
			const args = { kind: 'intent', query: 'equipment storage', ...(purpose && { purpose }) }
			const result = await actor.deliver('workspace_search', args)
			expect(JSON.parse(result.record).ok).toBe(true)
			if (purpose)
				expect(
					toolPurpose({
						id: 'lookup',
						name: 'workspace_search',
						arguments: JSON.stringify(args),
						status: 'completed',
						result: result.record
					})
				).toBe(purpose)
		}
		expect(parameters).toEqual(Array(2).fill({ query: 'equipment storage', limit: 20 }))
	} finally {
		actor.dispose()
	}
})
test('preview exposes omitted recent messages and keeps feedback without tool payloads', () => {
	const detail = {
		id: 'preview',
		title: 'Synthetic archive',
		state: 'archive',
		sourceLabel: 'Proof',
		contributionsHasMore: false,
		contributions: Array.from({ length: 15 }, (_, i) => ({
			id: String(i),
			contributorKind: 'agent',
			kind: 'message',
			text: 'Synthetic planning notes. '.repeat(80),
			createdAt: '2026-04-08T09:15:00Z',
			feedback: { vote: 'down', reason: 'Later corrected.' }
		}))
	}
	const preview = intentHistoryPreview(detail)
	expect(preview.olderMessagesAvailable).toBe(true)
	expect(preview.conversation).toHaveLength(10)
	expect(preview.conversation[0]).toMatchObject({
		id: '5',
		hasMoreText: true,
		feedback: { vote: 'down' }
	})
	expect(preview.conversation[0].content).toHaveLength(700)
})
test('Intent excerpts retain exact message evidence with Unicode-safe continuation, not search snippets', () => {
	const content = '🔭'.repeat(695) + 'amber' + ' locker'
	const preview = intentHistoryPreview({
		id: 'intent-proof',
		title: 'Invented store',
		state: 'archive',
		sourceLabel: 'Test',
		contributions: [
			{
				id: 'short',
				contributorKind: 'human',
				kind: 'message',
				text: 'Use the amber locker.',
				createdAt: '2026-04-08T09:15:00Z'
			},
			{
				id: 'long',
				contributorKind: 'human',
				kind: 'message',
				text: content,
				createdAt: '2026-04-08T09:16:00Z'
			}
		]
	})
	expect(preview.conversation[0]).toMatchObject({
		sourceId: 'short',
		offset: 0,
		nextOffset: null,
		complete: true
	})
	expect(preview.conversation[1]).toMatchObject({
		sourceId: 'long',
		offset: 0,
		nextOffset: 700,
		complete: false,
		totalChars: 707
	})
	expect(preview.conversation[1].content).toBe('🔭'.repeat(695) + 'amber')
	const record = new ResearchRecord()
	record.observe('workspace_read', JSON.stringify({ ...preview, recordType: 'intent' }))
	expect(record.sources.get('short:0')).toMatchObject({
		sourceId: 'short',
		intentId: 'intent-proof',
		complete: true
	})
	expect(record.sources.get('long:0')).toMatchObject({
		complete: false,
		content: preview.conversation[1].content
	})
	const cite = (sourceId: string, quote: string) =>
		record.run('research_record', {
			items: [
				{
					requirement: 'Storage',
					finding: 'Amber',
					status: 'supported',
					sources: [{ sourceId, quote }]
				}
			]
		})
	expect(cite('short', 'Use the amber locker.').ok).toBe(true)
	expect(cite('long', 'amber').ok).toBe(true)
	expect(cite('long', 'amber locker').ok).toBe(false)
	expect(cite('intent-proof', 'Use the amber locker.').ok).toBe(false)
	const bounded = intentHistoryPreview({
		id: 'i',
		title: 'Bounded SQL',
		state: 'archive',
		sourceLabel: 'Test',
		contributions: [
			{
				id: 'long',
				contributorKind: 'human',
				kind: 'message',
				text: preview.conversation[1].content,
				totalChars: 707,
				createdAt: '2026-04-08T09:16:00Z'
			}
		]
	})
	expect(bounded.conversation[0]).toEqual(preview.conversation[1])
})
test('shared retrieval advertises installed kinds and preserves host cancellation', async () => {
	let called = 0
	const read = () => {
		called++
		return { record: '{}', wire: '{}' }
	}
	const actor = createRetrievalActor({ intent_list: read, intent_detail: read })
	const controller = new AbortController()
	controller.abort()
	try {
		for (const spec of actor.manifest.methods)
			expect((spec.parameters.properties as any).kind.enum).toEqual(['intent'])
		const result = await actor.deliver(
			'workspace_search',
			{ kind: 'intent' },
			{ signal: controller.signal }
		)
		expect(JSON.parse(result.record).ok).toBe(false)
		expect(called).toBe(0)
	} finally {
		actor.dispose()
	}
})
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

test('history continuation preserves filters and does not confuse relevance order with chronology', async () => {
	const actor = createRetrievalActor({
		intent_messages: (args) => {
			const result = JSON.stringify({
				messages: [],
				hasMore: !args.cursor,
				nextCursor: args.cursor ? null : 'opaque-page-two',
				matchMode: args.query ? 'full-text' : 'recent'
			})
			return { record: result, wire: result }
		},
		message_detail: () => {
			throw new Error('A search must not read message content.')
		}
	})
	try {
		for (const query of [undefined, 'shelf']) {
			const args = {
				kind: 'message',
				intent: 'invented-observatory',
				...(query && { query }),
				purpose: 'Find the original discussion'
			}
			const result = JSON.parse((await actor.deliver('workspace_search', args)).record)
			expect(Boolean(result.ordering)).toBe(!query)
			expect(result.continuation.arguments).toEqual({
				kind: 'message',
				intent: args.intent,
				...(query && { query }),
				cursor: 'opaque-page-two'
			})
			const final = JSON.parse(
				(await actor.deliver('workspace_search', result.continuation.arguments)).record
			)
			expect(final.continuation).toBeUndefined()
		}
	} finally {
		actor.dispose()
	}
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
