import { expect, test } from 'bun:test'
import { currentStep } from '@avenos/chat-engine/current-step'
import { ResearchRecord } from '@avenos/chat-engine/research'
import type { ToolCall } from '@avenos/chat-engine/tool-call'

test('active model work outranks a completed tool; bookkeeping is not verification', () => {
	const call: ToolCall = {
		id: 'record',
		name: 'research_record',
		arguments: '{}',
		result: '{}',
		status: 'completed',
		durationMs: 0.2
	}
	expect(
		currentStep({ id: 'review', phase: 'verification', startedAt: 123 }, [call])
	).toMatchObject({
		kind: 'verification',
		startedAt: 123,
		label: 'Antwort prüfen'
	})
	expect(currentStep(null, [{ ...call, status: 'running', startedAt: 234 }])).toMatchObject({
		kind: 'tool',
		startedAt: 234,
		label: 'Quellenbelege festhalten'
	})
	expect(currentStep(null, [call]).kind).toBe('waiting')
})

test('review retains page continuation separately from original-source completeness', () => {
	const record = new ResearchRecord()
	record.observe(
		'workspace_read',
		JSON.stringify({
			ok: true,
			recordType: 'document',
			sourceId: 'invented-manual',
			content: 'Workshop safety checklist.',
			offset: 0,
			nextOffset: 12000,
			totalChars: 26000,
			complete: false,
			sourceComplete: true
		})
	)
	const evidence = JSON.parse(
		record.verifierMessages('Read the entire manual.', 'Only the first page was read.')[1]!.content
	)
	expect(evidence.sources[0]).toMatchObject({
		complete: false,
		sourceComplete: true,
		nextOffset: 12000,
		totalChars: 26000
	})
})

test('unavailable document indexing does not hide an exhausted capability catalog query', () => {
	const record = new ResearchRecord()
	record.observe(
		'workspace_search',
		JSON.stringify({
			ok: true,
			recordType: 'document',
			searchScope: { kind: 'document', query: 'workshop' },
			unavailable: 7,
			coverage: 'partial',
			hasMore: false
		})
	)
	record.observe(
		'studio_catalog',
		JSON.stringify({ entries: [], nextCursor: null, totalVisibleCount: 0 }),
		'{"search":"vector graphics"}'
	)
	const evidence = JSON.parse(
		record.verifierMessages(
			'Is a vector editor installed?',
			'This catalog query found no match.'
		)[1]!.content
	)
	expect(evidence).not.toHaveProperty('searchMayBeIncomplete')
	expect(evidence.searchCoverage[0].incomplete).toBe(true)
	expect(evidence.observations).toContainEqual(
		expect.objectContaining({
			kind: 'capability-catalog-search',
			search: 'vector graphics',
			hasMore: false
		})
	)
})

test('search review retains every paged title, not just the final page count', () => {
	const record = new ResearchRecord()
	const scope = { kind: 'document', query: 'guide' }
	for (let n = 0; n < 3; n++)
		record.observe(
			'workspace_search',
			JSON.stringify({
				ok: true,
				recordType: 'document',
				searchScope: scope,
				hasMore: n < 2,
				nextCursor: n < 2 ? `page-${n + 1}` : null,
				files: [{ artifactId: `source-${n}`, title: `Guide ${n}` }]
			}),
			JSON.stringify(n ? { cursor: `page-${n}` } : {})
		)
	const evidence = JSON.parse(
		record.verifierMessages('List guide titles.', 'Guide 0, Guide 1, Guide 2.')[1]!.content
	)
	expect(evidence.searchCoverage[0]).toMatchObject({
		lastPageMatches: 1,
		incomplete: false,
		metadataOmitted: false
	})
	expect(evidence.searchCoverage[0].pageMatches).toEqual([1, 1, 1])
	expect(evidence.searchCoverage[0].records.map((r: { title: string }) => r.title)).toEqual([
		'Guide 0',
		'Guide 1',
		'Guide 2'
	])
	// A new search snapshot must not inherit deleted/old matches from an earlier chain.
	record.observe(
		'workspace_search',
		JSON.stringify({
			ok: true,
			recordType: 'document',
			searchScope: scope,
			files: [],
			hasMore: false,
			nextCursor: null
		}),
		'{}'
	)
	expect(
		JSON.parse(record.verifierMessages('Again?', 'No matching titles now.')[1]!.content)
			.searchCoverage[0].records
	).toEqual([])
})

test('observing only a final cursor page does not establish an exhaustive search', () => {
	const record = new ResearchRecord()
	record.observe(
		'workspace_search',
		JSON.stringify({
			ok: true,
			recordType: 'document',
			searchScope: { query: 'guide' },
			files: [],
			hasMore: false,
			nextCursor: null
		}),
		'{"cursor":"unobserved-middle-page"}'
	)
	expect(record.searchIncomplete).toBe(true)
})

test('history metadata retains message identity, role and order without inventing titles or quotation evidence', () => {
	const record = new ResearchRecord()
	const scope = { kind: 'message', intent: 'synthetic-observatory', query: '' }
	const pages = [
		[
			{
				id: 'reply',
				role: 'assistant',
				sequence: '11',
				content: 'A search preview is not a citation.'
			}
		],
		[{ id: 'question', role: 'user', sequence: '7', content: 'An earlier preview.' }],
		[{ id: 'opening', role: 'user', sequence: '2', content: 'The opening preview.' }]
	]
	for (const [index, messages] of pages.entries())
		record.observe(
			'workspace_search',
			JSON.stringify({
				ok: true,
				recordType: 'message',
				searchScope: scope,
				messages,
				hasMore: index < 2,
				nextCursor: index < 2 ? `history-${index + 1}` : null
			}),
			JSON.stringify(index ? { cursor: `history-${index}` } : {})
		)
	const evidence = JSON.parse(
		record.verifierMessages('What was my first message?', 'Read its exact record.')[1]!.content
	)
	expect(evidence.searchCoverage[0]).toMatchObject({
		incomplete: false,
		metadataOmitted: false,
		records: [
			{ id: 'reply', role: 'assistant', sequence: 11 },
			{ id: 'question', role: 'user', sequence: 7 },
			{ id: 'opening', role: 'user', sequence: 2 }
		]
	})
	expect(record.sources.size).toBe(0)
	expect(
		evidence.searchCoverage[0].records.some((row: object) => 'content' in row || 'title' in row)
	).toBe(false)
})
