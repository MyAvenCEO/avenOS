import { beforeAll, expect, test } from 'bun:test'
import type { ChatMessage, StreamEvent } from '../src/lib/chat/redpill'

let Chat: typeof import('../src/lib/chat/chat.svelte').Chat
beforeAll(async () => {
	;(globalThis as unknown as { $state: <T>(value: T) => T }).$state = (value) => value
	Chat = (await import('../src/lib/chat/chat.svelte')).Chat
})
const source = {
	ok: true,
	recordType: 'document',
	sourceId: 'parcel',
	title: 'Synthetic parcel notice',
	content: 'Fictional parcel TEST-PARCEL-42 was scanned at Cedar depot. No recipient was recorded.',
	offset: 0,
	complete: true
}
const items = [
	{
		requirement: 'Identify the parcel depot',
		finding: 'Cedar depot',
		status: 'supported',
		sources: [
			{ sourceId: 'parcel', quote: 'Fictional parcel TEST-PARCEL-42 was scanned at Cedar depot.' }
		]
	},
	{
		requirement: 'Identify the parcel recipient',
		finding: 'Unknown',
		status: 'unresolved',
		sources: []
	}
]
const checked = {
	verdict: 'pass',
	requestChecks: Object.fromEntries(
		['language', 'timeScope', 'outcome', 'presentation'].map((key) => [
			key,
			{ verdict: 'pass', reason: 'The answer satisfies the explicit request.' }
		])
	),
	issues: [],
	checks: items.map((_, item) => ({
		item,
		verdict: 'pass',
		reason: 'The source supports the stated fact or explicit uncertainty.'
	}))
}
const answer = 'The fictional parcel was scanned at Cedar depot; its recipient is unknown.'

test('one retryable model admission failure does not replay a completed tool', async () => {
	let requests = 0,
		writes = 0
	const chat = new Chat(
		{},
		{
			specs: [{ name: 'save_note', description: 'Save the requested note', parameters: {} }],
			run: () => {
				writes++
				return { record: '{"ok":true}', wire: '{"ok":true}' }
			}
		},
		async function* (): AsyncGenerator<StreamEvent> {
			requests++
			if (requests === 1) {
				yield { kind: 'tool', index: 0, id: 'save', name: 'save_note', args: '{}' }
				yield { kind: 'finish', reason: 'tool_calls' }
			} else if (requests === 2)
				throw Error(
					JSON.stringify({
						code: 'LLM_TRANSPORT',
						status: 503,
						retryable: true,
						message: 'Temporarily unavailable'
					})
				)
			else {
				yield { kind: 'text', text: 'The note was saved.' }
				yield { kind: 'finish', reason: 'stop' }
			}
		}
	)
	await chat.send('Save this note')
	expect(chat.failure).toBeNull()
	expect(requests).toBe(3)
	expect(writes).toBe(1)
	expect(chat.diagnostics.some((d) => d.reason === 'retry-model-availability')).toBe(true)
})

test('persistent model unavailability is bounded, and stopping the backoff prevents a retry', async () => {
	for (const stop of [false, true]) {
		let requests = 0
		const chat = new Chat(
			{},
			{
				specs: [],
				run: () => {
					throw Error('No tools expected')
				}
			},
			async function* (): AsyncGenerator<StreamEvent> {
				requests++
				if (stop) setTimeout(() => chat.stop(), 10)
				throw Error(
					JSON.stringify({
						code: 'LLM_TRANSPORT',
						status: 503,
						retryable: true,
						message: 'Temporarily unavailable'
					})
				)
			}
		)
		await chat.send('Hello')
		expect(requests).toBe(stop ? 1 : 2)
		if (!stop) expect(chat.failure).toBe('Temporarily unavailable')
	}
})

test('malformed tool arguments cannot poison later requests or execute as an empty action', async () => {
	let rounds = 0,
		executions = 0
	const chat = new Chat(
		{},
		{
			specs: [{ name: 'studio_edit_definition', description: 'Edit', parameters: {} }],
			run: () => {
				executions++
				return { record: '{"ok":true}', wire: '{"ok":true}' }
			}
		},
		async function* (messages): AsyncGenerator<StreamEvent> {
			// Qwen's actual rejection: Assistant tool call function.arguments must be valid JSON.
			for (const message of messages)
				for (const call of message.tool_calls ?? []) JSON.parse(call.function.arguments)
			if (++rounds === 1)
				yield {
					kind: 'tool',
					index: 0,
					id: 'bad',
					name: 'studio_edit_definition',
					args: '{"definition":'
				}
			else yield { kind: 'text', text: 'The edit was not executed; please correct the definition.' }
			yield { kind: 'finish', reason: rounds === 1 ? 'tool_calls' : 'stop' }
		}
	)
	await chat.send('Build it')
	expect(chat.failure).toBeNull()
	expect(executions).toBe(0)
	expect(chat.turns.at(-1)?.calls?.[0]).toMatchObject({
		status: 'failed',
		arguments: '{"definition":'
	})
	await chat.send('Hello')
	expect(chat.failure).toBeNull()
	expect(rounds).toBe(3)
})

test.each(['omitted-item', 'duplicate-item', 'invalid-json', 'truncated'])(
	'reviewer protocol failure (%s) retries verification only, never the write',
	async (failure) => {
		let rounds = 0,
			reviews = 0,
			writes = 0
		const spoken: string[] = []
		const reviewRequests: ChatMessage[][] = []
		const chat = new Chat(
			{ onDelta: (text) => spoken.push(text) },
			{
				specs: ['workspace_read', 'markdown_write'].map((name) => ({
					name,
					description: name,
					parameters: {}
				})),
				run: (name) => {
					if (name === 'markdown_write') writes++
					const record = JSON.stringify(
						name === 'workspace_read' ? source : { ok: true, artifactId: 'markdown-result' }
					)
					return { record, wire: record }
				}
			},
			async function* (messages): AsyncGenerator<StreamEvent> {
				if (
					messages[1]?.role === 'user' &&
					messages[1].content.startsWith('{') &&
					'draft' in JSON.parse(messages[1].content)
				) {
					reviewRequests.push(messages)
					reviews++
					const broken =
						failure === 'duplicate-item'
							? { ...checked, checks: [checked.checks[0], checked.checks[0]] }
							: { ...checked, checks: [checked.checks[0]] }
					yield {
						kind: 'text',
						text:
							reviews === 1 && failure === 'invalid-json'
								? 'invalid review'
								: JSON.stringify(reviews === 1 ? broken : checked)
					}
					yield {
						kind: 'finish',
						reason: reviews === 1 && failure === 'truncated' ? 'length' : 'stop'
					}
					return
				}
				rounds++
				if (rounds <= 3)
					yield {
						kind: 'tool',
						index: 0,
						id: `c${rounds}`,
						name: ['workspace_read', 'research_record', 'markdown_write'][rounds - 1],
						args: rounds === 2 ? JSON.stringify({ items }) : '{}'
					}
				else yield { kind: 'text', text: answer }
				yield { kind: 'finish', reason: rounds <= 3 ? 'tool_calls' : 'stop' }
			}
		)
		await chat.send('Write the evidenced parcel details to Markdown; distinguish unknowns.')
		expect(chat.failure).toBeNull()
		expect(reviews).toBe(2)
		expect(rounds).toBe(4)
		expect(writes).toBe(1)
		expect(spoken).toEqual([answer])
		expect(reviewRequests[1].at(-1)?.content).toContain('[0,1]')
	}
)

test('exhausted review leaves a durable failure outcome for What happened, not the rejected draft', async () => {
	let rounds = 0,
		reviews = 0
	let saved = ''
	const chat = new Chat(
		{},
		{
			specs: [{ name: 'workspace_read', description: 'Read', parameters: {} }],
			run: () => ({ record: JSON.stringify(source), wire: JSON.stringify(source) })
		},
		async function* (messages): AsyncGenerator<StreamEvent> {
			if (
				messages[1]?.role === 'user' &&
				messages[1].content.startsWith('{') &&
				'draft' in JSON.parse(messages[1].content)
			) {
				reviews++
				yield { kind: 'text', text: JSON.stringify({ ...checked, checks: [] }) }
			} else if (++rounds <= 2) {
				yield {
					kind: 'tool',
					index: 0,
					id: `c${rounds}`,
					name: rounds === 1 ? 'workspace_read' : 'research_record',
					args: rounds === 1 ? '{}' : JSON.stringify({ items })
				}
			} else yield { kind: 'text', text: 'UNVERIFIED DRAFT' }
			yield { kind: 'finish', reason: 'stop' }
		}
	)
	chat.onExchange = (_session, _user, reply) => {
		saved = reply.content
	}
	await chat.send('List parcel details')
	expect(reviews).toBe(2)
	expect(saved).toContain('verification')
	expect(saved).not.toContain('UNVERIFIED DRAFT')
	expect(chat.turns.at(-1)?.content).toBe(saved)
	const wire = (chat.export() as { wire: ChatMessage[] }).wire
	expect(wire.at(-1)?.content).toBe(saved)
	let followUp: ChatMessage[] = []
	const restored = new Chat({}, undefined, async function* (messages) {
		followUp = messages
		yield { kind: 'text', text: 'Verification could not complete.' }
	})
	restored.hydrate('parcel', chat.turns)
	restored.use('parcel')
	await restored.send('What happened?')
	expect(followUp.some((message) => message.content === saved)).toBe(true)
})

test('stopping verification does not retry it or accept a late passing result', async () => {
	let rounds = 0,
		reviews = 0
	const spoken: string[] = []
	const chat = new Chat(
		{ onDelta: (text) => spoken.push(text) },
		{
			specs: [{ name: 'workspace_read', description: 'Read', parameters: {} }],
			run: () => ({ record: JSON.stringify(source), wire: JSON.stringify(source) })
		},
		async function* (messages): AsyncGenerator<StreamEvent> {
			if (
				messages[1]?.role === 'user' &&
				messages[1].content.startsWith('{') &&
				'draft' in JSON.parse(messages[1].content)
			) {
				reviews++
				expect(chat.verifying).toBe(true)
				chat.stop()
				yield { kind: 'text', text: JSON.stringify(checked) }
			} else if (++rounds <= 2) {
				yield {
					kind: 'tool',
					index: 0,
					id: `c${rounds}`,
					name: rounds === 1 ? 'workspace_read' : 'research_record',
					args: rounds === 1 ? '{}' : JSON.stringify({ items })
				}
			} else yield { kind: 'text', text: 'UNVERIFIED DRAFT' }
			yield { kind: 'finish', reason: 'stop' }
		}
	)
	await chat.send('Read the parcel notice')
	expect(reviews).toBe(1)
	expect(chat.verifying).toBe(false)
	expect(spoken).toEqual([])
	expect(chat.turns.some((turn) => turn.content.includes('UNVERIFIED DRAFT'))).toBe(false)
})
