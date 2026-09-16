import { beforeAll, describe, expect, test } from 'bun:test'
import { type ChatMessage, eventsFromFrame, type StreamEvent } from '../src/lib/chat/redpill'
import { parseReview, ResearchRecord, repetitiveTail } from '../src/lib/chat/research'

let Chat: typeof import('../src/lib/chat/chat.svelte').Chat
beforeAll(async () => {
	;(globalThis as unknown as { $state: <T>(v: T) => T }).$state = (v) => v
	Chat = (await import('../src/lib/chat/chat.svelte')).Chat
})
const textSpec = { name: 'workspace_read', description: 'read', parameters: { type: 'object' } }
const source = {
	ok: true,
	recordType: 'document',
	sourceId: 'file',
	title: 'Statement',
	content: 'A credit of 150 EUR is pending.',
	offset: 0,
	complete: true
}
const item = {
	requirement: 'Refund status',
	finding: 'Pending, not settled',
	status: 'supported',
	sources: [{ sourceId: 'file', quote: 'A credit of 150 EUR is pending.' }]
}
test('stream preserves finish, usage, structured content and multilingual Unicode', () => {
	expect(
		eventsFromFrame(
			`data: ${JSON.stringify({ choices: [{ delta: { content: '{"importe":"150 €","备注":"待定"}' }, finish_reason: 'length' }], usage: { completion_tokens: 2400 } })}`
		)
	).toEqual([
		{ kind: 'usage', usage: { completion_tokens: 2400 } },
		{ kind: 'text', text: '{"importe":"150 €","备注":"待定"}' },
		{ kind: 'finish', reason: 'length' }
	])
})
test('repetition detection preserves repeated references but stops sustained loops', () => {
	expect(
		repetitiveTail(
			'Supplier reference is MA-2026-0510. The order is confirmed. Supplier reference is MA-2026-0510. Refund pending. Supplier reference is MA-2026-0510. Invoice separate.'
		)
	).toBe(false)
	expect(repetitiveTail('I will check the requested source document. '.repeat(30))).toBe(true)
})
test('working record refuses invented sources and quotes; retains uncertainty', () => {
	const r = new ResearchRecord()
	r.observe('workspace_read', JSON.stringify(source))
	expect(r.run('research_record', { items: [item] }).ok).toBe(true)
	expect(
		r.run('research_record', {
			items: [{ ...item, sources: [{ sourceId: 'file', quote: '150 EUR was paid.' }] }]
		}).ok
	).toBe(false)
	expect(
		r.run('research_record', {
			items: [
				{
					requirement: 'Missing allocation',
					finding: 'Order association unconfirmed',
					status: 'unresolved',
					sources: []
				}
			]
		}).ok
	).toBe(true)
	r.run('research_record', { items: [item] })
	const messages = r.verifierMessages('Audit it', 'It is paid')
	expect(messages[0].content).not.toContain(source.content)
	expect(messages[1].content).toContain(source.content)
	expect(messages[1].content).not.toContain(item.finding)
	expect(messages[1].content).toContain(item.requirement)
	expect(JSON.parse(messages[1].content).checklist[0].item).toBe(0)
})
test('calculator uses exact signed integers without code execution or currency mixing', () => {
	const r = new ResearchRecord()
	expect(r.run('calculate', { currency: 'EUR', amounts: [32000, -18000, -18000] })).toEqual({
		ok: true,
		currency: 'EUR',
		totalMinor: '-4000'
	})
	expect(r.run('calculate', { currency: 'EUR', amounts: [1.5] }).ok).toBe(false)
	expect(r.run('calculate', { currency: 'EUR/USD', amounts: [1] }).ok).toBe(false)
	expect(
		r.run('calculate', {
			currency: 'EUR',
			amounts: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
		}).totalMinor
	).toBe('18014398509481982')
	expect(() => parseReview('{"verdict":"pass","issues":["wrong"]}')).toThrow()
})
describe('completion and answer verification', () => {
	test('truncated tool arguments never execute; retry is bounded', async () => {
		let executions = 0,
			requests = 0
		const chat = new Chat(
			{},
			{
				specs: [{ name: 'write', description: 'write', parameters: {} }],
				run: () => {
					executions++
					return { record: '', wire: '' }
				}
			},
			async function* () {
				requests++
				yield { kind: 'tool', index: 0, name: 'write', args: '{"value":' }
				yield { kind: 'finish', reason: 'length' }
			}
		)
		await chat.send('Write')
		expect(executions).toBe(0)
		expect(requests).toBe(2)
		expect(chat.failure).toContain('length')
	})
	test('simple conversation still streams immediately without review', async () => {
		const spoken: string[] = []
		const chat = new Chat(
			{ onDelta: (t) => spoken.push(t) },
			{ specs: [textSpec], run: () => ({ record: '', wire: '' }) },
			async function* () {
				yield { kind: 'text', text: 'Hello.' }
				yield { kind: 'finish', reason: 'stop' }
			}
		)
		await chat.send('Hi')
		expect(spoken).toEqual(['Hello.'])
		expect(chat.failure).toBeNull()
		const savedWire = (chat.export() as { wire: ChatMessage[] }).wire
		expect(savedWire.some((m) => m.role === 'assistant' && m.content === 'It is paid.')).toBe(false)
	})
	test('incorrect research draft is withheld, repaired and checked again', async () => {
		const spoken: string[] = []
		let step = 0,
			checks = 0
		const chat = new Chat(
			{ onDelta: (t) => spoken.push(t) },
			{
				specs: [textSpec],
				run: () => ({ record: JSON.stringify(source), wire: JSON.stringify(source) })
			},
			async function* (messages: ChatMessage[]): AsyncGenerator<StreamEvent> {
				if (messages[0].content.startsWith('You verify')) {
					checks++
					yield {
						kind: 'text',
						text: JSON.stringify(
							checks === 1
								? {
										verdict: 'revise',
										issues: ['Credit is pending, not paid.'],
										checks: [
											{ item: 0, verdict: 'revise', reason: 'Source says the credit is pending.' }
										]
									}
								: {
										verdict: 'pass',
										issues: [],
										checks: [
											{ item: 0, verdict: 'pass', reason: 'Source and answer both say pending.' }
										]
									}
						)
					}
					yield { kind: 'finish', reason: 'stop' }
					return
				}
				step++
				if (step === 1)
					yield {
						kind: 'tool',
						index: 0,
						id: 'r',
						name: 'workspace_read',
						args: '{"artifact":"file"}'
					}
				else if (step === 2)
					yield {
						kind: 'tool',
						index: 0,
						id: 'n',
						name: 'research_record',
						args: JSON.stringify({ items: [item] })
					}
				else
					yield {
						kind: 'text',
						text: step === 3 ? 'It is paid.' : 'The 150 EUR credit is pending, not settled.'
					}
				yield { kind: 'finish', reason: step < 3 ? 'tool_calls' : 'stop' }
			}
		)
		await chat.send('What is the refund status?')
		expect(checks).toBe(2)
		expect(spoken).toEqual(['The 150 EUR credit is pending, not settled.'])
		expect(chat.failure).toBeNull()
	})
	test.each(['invalid-json', 'missing-finish'])(
		'failed verification (%s) does not persist or speak an unverified draft',
		async (failure) => {
			let n = 0
			const spoken: string[] = []
			const saved: string[] = []
			const chat = new Chat(
				{ onDelta: (t) => spoken.push(t) },
				{
					specs: [textSpec],
					run: () => ({ record: JSON.stringify(source), wire: JSON.stringify(source) })
				},
				async function* (messages): AsyncGenerator<StreamEvent> {
					if (messages[0].content.startsWith('You verify')) {
						yield {
							kind: 'text',
							text:
								failure === 'invalid-json'
									? 'invalid review'
									: JSON.stringify({
											verdict: 'pass',
											issues: [],
											checks: [
												{ item: 0, verdict: 'pass', reason: 'The source supports the answer.' }
											]
										})
						}
						if (failure !== 'missing-finish') yield { kind: 'finish', reason: 'stop' }
						return
					}
					n++
					if (n === 1)
						yield {
							kind: 'tool',
							index: 0,
							id: 'r',
							name: 'workspace_read',
							args: '{"artifact":"file"}'
						}
					else if (n === 2)
						yield {
							kind: 'tool',
							index: 0,
							id: 'n',
							name: 'research_record',
							args: JSON.stringify({ items: [item] })
						}
					else yield { kind: 'text', text: 'Paid.' }
					yield { kind: 'finish', reason: n < 3 ? 'tool_calls' : 'stop' }
				}
			)
			chat.onExchange = (_s, _u, a) => saved.push(a.content)
			await chat.send('Refund?')
			expect(chat.failure).toContain('verification failed')
			expect(spoken).toEqual([])
			expect(saved.every((t) => !t.includes('Paid'))).toBe(true)
		}
	)
	test('tool exhaustion is explicit and does not keep executing in recovery rounds', async () => {
		let executions = 0
		const chat = new Chat(
			{},
			{
				specs: [{ name: 'probe', description: 'read', parameters: {} }],
				run: () => {
					executions++
					return { record: '{}', wire: '{}' }
				}
			},
			async function* () {
				yield { kind: 'tool', index: 0, id: 'p', name: 'probe', args: '{}' }
				yield { kind: 'finish', reason: 'tool_calls' }
			}
		)
		await chat.send('Continue')
		expect(executions).toBe(32)
		expect(chat.failure).toContain('budget exhausted')
		const wire = (chat.export() as { wire: ChatMessage[] }).wire
		expect(wire.at(-1)?.role).toBe('tool')
		expect(wire.at(-1)?.content).toContain('Execution status is unconfirmed')
	})
})

test('compaction retains each distinct source once so cross-source reasoning does not reread in a loop', () => {
	const r = new ResearchRecord(),
		wire: ChatMessage[] = []
	for (let repeat = 0; repeat < 5; repeat++)
		for (let i = 0; i < 8; i++) {
			const id = `call-${repeat}-${i}`,
				record = {
					...source,
					sourceId: `file-${i}`,
					content: `Unique source ${i}. ${'Evidence paragraph. '.repeat(100)}`
				}
			r.observe('workspace_read', JSON.stringify(record))
			wire.push(
				{
					role: 'assistant',
					content: '',
					tool_calls: [
						{
							id,
							type: 'function',
							function: {
								name: 'workspace_read',
								arguments: JSON.stringify({ artifact: record.sourceId })
							}
						}
					]
				},
				{ role: 'tool', tool_call_id: id, content: JSON.stringify(record) }
			)
		}
	const compact = r.compact(wire)
	expect(compact.length).toBe(wire.length)
	const full = compact
		.filter((m) => m.role === 'tool')
		.map((m) => JSON.parse(m.content))
		.filter((d) => d.content)
	expect(full).toHaveLength(8)
	for (let i = 0; i < 8; i++) expect(full.some((d) => d.sourceId === `file-${i}`)).toBe(true)
	expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(wire).length / 2)
})

test('SSE stream detects missing completion metadata and handles every split boundary', async () => {
	const { streamEvents } = await import('../src/lib/chat/redpill')
	async function* parts(...text: string[]) {
		yield* text
	}
	async function collect(source: AsyncIterable<string>) {
		const events = []
		for await (const e of streamEvents(source)) events.push(e)
		return events
	}
	const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Complete.' }, finish_reason: 'stop' }] })}\r\n\r\ndata: [DONE]\r\n\r\n`
	for (let i = 0; i < frame.length; i++)
		expect(await collect(parts(frame.slice(0, i), frame.slice(i)))).toEqual([
			{ kind: 'text', text: 'Complete.' },
			{ kind: 'finish', reason: 'stop' }
		])
	await expect(
		collect(parts('data: {"choices":[{"delta":{"content":"Unfinished"}}]}\n\ndata: [DONE]\n\n'))
	).rejects.toThrow('without completion status')
})

test('rejected conclusions cannot override correction feedback in the next research round', () => {
	const r = new ResearchRecord()
	r.observe('workspace_read', JSON.stringify(source))
	expect(
		r.run('research_record', { items: [{ ...item, finding: 'The refund has been paid.' }] }).ok
	).toBe(true)
	r.rejectDraft()
	expect(r.items[0]).toMatchObject({
		requirement: item.requirement,
		sources: item.sources,
		status: 'unresolved'
	})
	expect(JSON.stringify(r.items)).not.toContain('has been paid')
	expect(r.sources.get('file:0')?.content).toBe(source.content)
})

test('search completeness follows each query and clears when its remaining pages are read', () => {
	const r = new ResearchRecord()
	const page = (query: string, hasMore: boolean, intent = '') =>
		r.observe(
			'workspace_search',
			JSON.stringify({
				ok: true,
				recordType: 'document',
				searchScope: { kind: 'document', query, intent },
				hasMore
			})
		)
	page('invoice', true)
	page('invoice', false, 'another-task')
	expect(r.searchIncomplete).toBe(true)
	page('invoice', false)
	expect(r.searchIncomplete).toBe(false)
	const coverage = JSON.parse(r.verifierMessages('Status?', 'Answer')[1].content).searchCoverage
	expect(coverage).toHaveLength(2)
})

test('optional stronger repair runs only after the initial draft and first repair fail review', async () => {
	let writes = 0,
		repairs = 0,
		reviews = 0
	const spoken: string[] = []
	const chat = new Chat(
		{ onDelta: (text) => spoken.push(text) },
		{
			specs: [textSpec],
			run: () => ({ record: JSON.stringify(source), wire: JSON.stringify(source) })
		},
		async function* (): AsyncGenerator<StreamEvent> {
			writes++
			if (writes === 1)
				yield {
					kind: 'tool',
					index: 0,
					id: 'read',
					name: 'workspace_read',
					args: '{"artifact":"file"}'
				}
			else if (writes === 2)
				yield {
					kind: 'tool',
					index: 0,
					id: 'checklist',
					name: 'research_record',
					args: JSON.stringify({ items: [item] })
				}
			else yield { kind: 'text', text: 'Paid.' }
			yield { kind: 'finish', reason: writes < 3 ? 'tool_calls' : 'stop' }
		},
		async function* (messages): AsyncGenerator<StreamEvent> {
			reviews++
			const correct = JSON.parse(messages[1].content).draft === 'The credit is pending.'
			yield {
				kind: 'text',
				text: JSON.stringify({
					verdict: correct ? 'pass' : 'revise',
					issues: correct ? [] : ['The credit is pending, not paid.'],
					checks: [
						{
							item: 0,
							verdict: correct ? 'pass' : 'revise',
							reason: 'The source explicitly says the credit is pending.'
						}
					]
				})
			}
			yield { kind: 'finish', reason: 'stop' }
		},
		async function* (messages): AsyncGenerator<StreamEvent> {
			repairs++
			expect(JSON.stringify(messages)).toContain('Re-evaluate this requirement')
			yield { kind: 'text', text: 'The credit is pending.' }
			yield { kind: 'finish', reason: 'stop' }
		}
	)
	await chat.send('What is the refund status?')
	expect(writes).toBe(4)
	expect(repairs).toBe(1)
	expect(reviews).toBe(3)
	expect(spoken).toEqual(['The credit is pending.'])
	expect(chat.failure).toBeNull()
	expect(chat.diagnostics.filter((d) => d.reason === 'escalated')).toHaveLength(1)
})
