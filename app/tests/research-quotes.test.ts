import { expect, test } from 'bun:test'
import { ResearchRecord } from '@avenos/chat-engine/research'

// Fictional source with the same line layout and seven-character codes as the
// observed failing flight turn. No model responses are substituted here.
const content =
	'ZX1234*\nFlight / Flug\n14MAR25\nDate / Datum\n16:20\nDeparture / Abflug\nBerlin/BER\nFrom / von\nOslo/OSL\nTo / nach'
function record() {
	const r = new ResearchRecord()
	r.observe(
		'workspace_read',
		JSON.stringify({
			ok: true,
			recordType: 'document',
			sourceId: 'flight',
			content,
			offset: 0,
			complete: true
		})
	)
	return r
}
function items(quotes: string[], sourceId = 'flight') {
	return [
		{
			requirement: 'Where did the trip go?',
			finding: 'Berlin to Oslo',
			status: 'supported',
			sources: quotes.map((quote) => ({ sourceId, quote }))
		}
	]
}

test('PDF whitespace is restored to the exact retained source, without editing caller arguments', () => {
	const r = record()
	const args = {
		items: items([
			'Berlin/BER From / von Oslo/OSL To / nach',
			'ZX1234* Flight / Flug 14MAR25 Date / Datum 16:20 Departure / Abflug'
		])
	}
	expect(r.run('research_record', args).ok).toBe(true)
	for (const citation of r.items[0]!.sources) expect(content.includes(citation.quote)).toBe(true)
	expect(r.items[0]!.sources[0]!.quote).toBe('Berlin/BER\nFrom / von\nOslo/OSL\nTo / nach')
	expect(args.items[0]!.sources[0]!.quote).not.toContain('\n')
})

test('short exact codes are valid evidence; invalid replacements leave the prior checklist intact', () => {
	const r = record()
	expect(
		r.run('research_record', { items: items(['Oslo/OSL', 'Berlin/BER', 'ZX1234*', '14MAR25']) }).ok
	).toBe(true)
	const saved = structuredClone(r.items)
	for (const quote of [
		'',
		' ',
		'ZX1234.',
		'14MAR23',
		'berlin/ber',
		'Berlin/BER Oslo/OSL',
		'Berlin/BER … Oslo/OSL',
		'Berlin/BER From / von Rome/FCO'
	]) {
		const result = r.run('research_record', { items: items(['Oslo/OSL', quote]) })
		expect(result.ok).toBe(false)
		expect(result.citation).toBe(1)
		expect(r.items).toEqual(saved)
	}
	expect(r.run('research_record', { items: items(['Oslo/OSL'], 'not-read') }).ok).toBe(false)
})

test('whitespace matching never stitches two retained pages', () => {
	const r = new ResearchRecord()
	r.observe(
		'workspace_read',
		JSON.stringify({
			ok: true,
			recordType: 'document',
			sourceId: 'flight',
			content: 'Berlin/BER\nFrom / von',
			offset: 0
		})
	)
	r.observe(
		'workspace_read',
		JSON.stringify({
			ok: true,
			recordType: 'document',
			sourceId: 'flight',
			content: 'Oslo/OSL\nTo / nach',
			offset: 30
		})
	)
	expect(r.run('research_record', { items: items(['Berlin/BER From / von Oslo/OSL']) }).ok).toBe(
		false
	)
})

test('selecting a supplied passage retains its exact text without retyping or paraphrase', () => {
	const r = record()
	const option = r.quoteOptions[0]!
	expect(
		r.run('research_record', {
			items: [
				{ ...items([])[0], sources: [{ sourceId: option.sourceId, quoteRef: option.quoteRef }] }
			]
		}).ok
	).toBe(true)
	expect(r.items[0]!.sources).toEqual([{ sourceId: 'flight', quote: content }])
	for (const citation of [
		{ sourceId: 'unread', quoteRef: option.quoteRef },
		{ sourceId: 'flight', quoteRef: 'invented' },
		{ ...option, quote: 'changed text' }
	])
		expect(r.run('research_record', { items: [{ ...items([])[0], sources: [citation] }] }).ok).toBe(
			false
		)
	expect(JSON.stringify(r.compact([]))).toContain(option.quoteRef)
	expect(r.checklistMessages('Where?')[1]!.content).toContain('quoteOptions')
})

test('an unmarked search preview remains navigation until its exact page has been read', () => {
	const research = new ResearchRecord()
	const sourceId = 'workshop-note',
		matching = 'The kiln checkpoint is at the blue cabinet.'
	research.observe(
		'workspace_read',
		JSON.stringify({
			ok: true,
			recordType: 'message',
			sourceId,
			content: '🏺 First planning page.',
			offset: 0,
			complete: false,
			nextOffset: 22
		})
	)
	research.observe(
		'workspace_search',
		JSON.stringify({
			messages: [{ id: sourceId, content: matching, readOffset: 31000 }],
			hasMore: false
		}),
		JSON.stringify({ kind: 'message', query: 'kiln checkpoint' })
	)
	const request = {
		items: [
			{
				requirement: 'Where is the checkpoint?',
				finding: 'At the blue cabinet.',
				status: 'supported',
				sources: [{ sourceId, quote: matching }]
			}
		]
	}
	const missing = research.run('research_record', request)
	expect(missing.ok).toBe(false)
	expect(missing.notice).toContain('readOffset')
	expect(missing.retainedPages).toEqual([
		{ offset: 0, endOffset: Array.from('🏺 First planning page.').length }
	])
	research.observe(
		'workspace_read',
		JSON.stringify({
			ok: true,
			recordType: 'message',
			sourceId,
			content: matching,
			offset: 31000,
			complete: false
		})
	)
	expect(research.run('research_record', request).ok).toBe(true)
})

test('exact message search ranges retain quotations without a redundant source fetch', () => {
	const research = new ResearchRecord()
	const content = '🏺 The kiln checkpoint is at the blue cabinet.'
	const row = {
		id: 'kiln-message',
		sourceId: 'kiln-message',
		content,
		offset: 41,
		nextOffset: 41 + Array.from(content).length,
		totalChars: 300,
		role: 'user',
		intentId: 'pottery-workshop'
	}
	const result = { ok: true, recordType: 'message', messages: [row], hasMore: true }
	research.observe('workspace_search', JSON.stringify(result))
	expect(research.sources.size).toBe(1)
	expect(research.sources.get('kiln-message:41')).toMatchObject({
		content,
		offset: 41,
		nextOffset: row.nextOffset,
		complete: false,
		role: 'user'
	})
	expect(research.run('research_record', { items: items([content], row.sourceId) }).ok).toBe(true)
	expect(
		research.run('research_record', {
			items: items([content + ' Extra conclusion.'], row.sourceId)
		}).ok
	).toBe(false)
	expect([...research.searches.values()][0]?.incomplete).toBe(true)
	// Partial ranges never permit quoting a missing page, even from the same source.
	expect(
		research.run('research_record', { items: items(['The furnace is ready.'], row.sourceId) }).ok
	).toBe(false)
	for (const invalid of [
		{ ...result, ok: false },
		{ ...result, recordType: 'document' },
		...[
			{ ...row, sourceId: 'another-message' },
			{ ...row, offset: -1 },
			{ ...row, nextOffset: null },
			{ ...row, nextOffset: row.offset + content.length },
			{ ...row, totalChars: 4 },
			{ ...row, sourceId: undefined }
		].map((bad) => ({ ...result, messages: [bad] }))
	]) {
		const rejected = new ResearchRecord()
		rejected.observe('workspace_search', JSON.stringify(invalid))
		expect(rejected.sources.size).toBe(0)
	}
	const complete = new ResearchRecord()
	complete.observe(
		'workspace_search',
		JSON.stringify({
			...result,
			hasMore: false,
			messages: [{ ...row, offset: 0, nextOffset: null, totalChars: Array.from(content).length }]
		})
	)
	expect(complete.sources.get('kiln-message:0')?.complete).toBe(true)
})
