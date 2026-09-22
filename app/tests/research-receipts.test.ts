import { expect, test } from 'bun:test'
import { ResearchRecord } from '@avenos/chat-engine/research'
import { historicalToolEvidence, historicalToolResult } from '@avenos/chat-engine/restored-history'
import { retainedToolResult } from '@avenos/chat-engine/tool-result-evidence'
import { callsFromPayload, turnPayload } from '@avenos/chat-engine/turn-payload'
import { changedTasks, taskPage } from '@avenos/productivity/tasks'

test('long workflow conditions survive independently of generic receipt/display limits', () => {
	const record = new ResearchRecord()
	const plan = {
		title: 'Fictional specimen register',
		steps: Array.from({ length: 18 }, (_, index) => ({
			id: `step-${index}`,
			kind: 'ideal',
			needs: 'An unavailable specimen capture capability. '.repeat(10),
			acceptance:
				index === 17
					? 'A recorded review is required, even if the reviewer leaves a result unresolved.'
					: 'Retain each original sample reference. '.repeat(10)
		}))
	}
	expect(JSON.stringify(plan).length).toBeGreaterThan(8000)
	record.observe(
		'studio_case_revise',
		JSON.stringify({
			artifactId: 'case-proof',
			typeKey: 'studio.case',
			payload: { status: 'proposed', case: plan }
		})
	)
	record.observe(
		'studio_case_what_if',
		JSON.stringify({ mode: 'structural-what-if', executes: false, ...plan })
	)
	const messages = record.verifierMessages('Require review.', 'All conditions are preserved.')
	const evidence = JSON.parse(messages[1].content)
	expect(evidence.workflowPlans[0].payload.case).toEqual(plan)
	expect(evidence.workflowPlans[1].steps).toEqual(plan.steps)
	expect(evidence.workflowPlansOmitted).toBe(0)
	expect(messages[0].content).toContain('does not fulfill a required human check')
	expect(new ResearchRecord().verifierMessages('Hello', 'Hello')[0].content).not.toContain(
		'Inspect the retained workflowPlans'
	)
})

test('workflow retention is bounded without partial plans or invisible omissions', () => {
	const record = new ResearchRecord()
	for (let i = 0; i < 4; i++)
		record.observe(
			'studio_case_propose',
			JSON.stringify({
				artifactId: `case-${i}`,
				typeKey: 'studio.case',
				payload: { conditions: 'x'.repeat(90_000) }
			})
		)
	const evidence = JSON.parse(record.verifierMessages('Inspect plans', 'Saved')[1].content)
	expect(evidence.workflowPlansOmitted).toBe(2)
	expect(evidence.workflowPlans).toHaveLength(2)
	expect(evidence.workflowPlans[1].payload.conditions).toHaveLength(90_000)
	record.observe('studio_case_what_if', JSON.stringify({ conditions: 'x'.repeat(110_001) }))
	const oversized = JSON.parse(record.verifierMessages('Inspect', 'Cannot verify')[1].content)
	expect(oversized.workflowPlans.at(-1)).toMatchObject({ planRetained: false })
})

test('read-only case inspection still requires review of the actual retained conditions', () => {
	const record = new ResearchRecord()
	record.observe(
		'studio_case_what_if',
		JSON.stringify({
			mode: 'structural-what-if',
			executes: false,
			steps: [
				{ id: 'review', kind: 'ideal', acceptance: 'Record a human review before proceeding.' }
			]
		})
	)
	expect(record.needsReview).toBe(true)
	expect(record.workflowPlans.size).toBe(1)
})

const owner = crypto.randomUUID(),
	intentId = crypto.randomUUID()
const tasks = changedTasks(
	owner,
	{
		operation: 'create',
		tasks: Array.from({ length: 24 }, (_, i) => ({
			title: `Inspect pottery shelf ${i + 1}`,
			tags: [],
			due: null,
			responsible: null,
			group: 'team' as const
		}))
	},
	{ operationId: crypto.randomUUID(), intentId, contributionId: null },
	[],
	'2033-02-14T11:00:00Z'
)
const result = JSON.stringify({
	ok: true,
	mode: 'production',
	...taskPage(tasks, owner, { intentId, limit: 100 })
})

test('a host can require review for a new tool without adding a tool-name branch', () => {
	for (const outcome of ['{"ok":true,"count":23}', '{"ok":false,"code":"ACCESS_DENIED"}']) {
		const record = new ResearchRecord(
			[],
			[],
			[],
			[
				{
					name: 'external_resource_read',
					description: 'Read an authorized resource.',
					parameters: { type: 'object' },
					answerReview: 'required'
				}
			]
		)
		expect(record.needsReview).toBe(false)
		record.observe('view_open', '{"ok":true}')
		expect(record.needsReview).toBe(false)
		record.observe('external_resource_read', outcome)
		expect(record.needsReview).toBe(true)
		const evidence = JSON.parse(record.verifierMessages('Read the resource.', 'Read.')[1].content)
		expect(evidence.toolOutcomes.at(-1).receipt).toEqual(JSON.parse(outcome))
		expect(JSON.stringify(evidence.availableTools)).not.toContain('answerReview')
	}
})

test('omitting a host policy cannot disable mandatory verification', () => {
	const record = new ResearchRecord(
		[],
		[],
		[],
		[
			{
				name: 'todo_create',
				description: 'Save a task.',
				parameters: { type: 'object' }
			}
		]
	)
	record.observe('todo_create', '{"ok":true}')
	expect(record.needsReview).toBe(true)
})

test('required review survives malformed results and bounded receipt eviction', () => {
	const record = new ResearchRecord(
		[],
		[],
		[],
		[
			{
				name: 'resource_capture',
				description: 'Read an authorized resource.',
				parameters: { type: 'object' },
				answerReview: 'required'
			}
		]
	)
	record.observe('resource_capture', 'not a valid result')
	expect(record.needsReview).toBe(true)
	for (let index = 0; index < 140; index++) record.observe('view_open', '{"ok":true}')
	expect(record.needsReview).toBe(true)
	const undeclared = new ResearchRecord()
	undeclared.observe('view_open', '{"ok":true,"answerReview":"required"}')
	expect(undeclared.needsReview).toBe(false)
})

test('successful, failed and unfamiliar UI tool receipts reach the reviewer without a name allowlist', () => {
	const record = new ResearchRecord()
	record.observe(
		'list_window_toggle',
		'{"ok":true,"window":"list-window","open":true}',
		'{"open":true}'
	)
	record.observe('stream_show', '{"ok":false,"error":"View changed; not applied"}')
	record.observe('another_surface', '{"accepted":true,"state":"pending"}')
	const evidence = JSON.parse(
		record.verifierMessages('Show the list.', 'The list is shown.')[1].content
	)
	expect(evidence.toolOutcomes).toHaveLength(3)
	expect(evidence.toolOutcomes[0].receipt).toEqual({ ok: true, window: 'list-window', open: true })
	expect(evidence.toolOutcomes[1].ok).toBe(false)
	expect(evidence.toolOutcomes[2].ok).toBeUndefined()
	// Retaining a UI receipt should not by itself introduce another slow model review.
	expect(record.needsReview).toBe(false)
})

test('large task pages retain task identities, values and selection for verification and saved history', () => {
	expect(result.length).toBeGreaterThan(8000)
	const record = new ResearchRecord()
	record.observe('todo_list', result, JSON.stringify({ intentId, limit: 100 }))
	const current = JSON.parse(
		record.verifierMessages('Which shelves?', 'Here is the list.')[1].content
	).toolOutcomes[0].receipt
	expect(current.tasks).toHaveLength(tasks.length)
	expect(current.selection.intentId).toBe(intentId)
	expect(current.complete).toBe(true)
	expect(current.retention.complete).toBe(true)
	expect(
		current.tasks.map((task: any) => [task.id, task.title, task.revision, task.archived])
	).toEqual(
		JSON.parse(result).tasks.map((task: any) => [task.id, task.title, task.revision, task.archived])
	)
	const payload = turnPayload({
		id: 'synthetic-reply',
		role: 'assistant',
		content: 'Read.',
		calls: [
			{
				id: 'synthetic-list',
				name: 'todo_list',
				arguments: '{}',
				status: 'completed',
				result
			}
		]
	})
	const saved = JSON.parse(callsFromPayload(payload)[0].result)
	expect(saved).toEqual(current)
	expect(JSON.parse(historicalToolResult(callsFromPayload(payload)[0]))).toEqual(saved)
})

test('oversized receipts expose retention gaps without confusing them with search exhaustion', () => {
	const large = {
		ok: true,
		mode: 'production',
		...taskPage(
			tasks.map((task) => ({ ...task, title: '陶芸'.repeat(240) })),
			owner,
			{ limit: 100 }
		)
	}
	const record = new ResearchRecord()
	record.observe('todo_list', JSON.stringify(large))
	const receipt = record.toolOutcomes[0].receipt as any
	expect(receipt.complete).toBe(true)
	expect(receipt.retention.complete).toBe(false)
	expect(receipt.retention.returnedTasks).toBe(tasks.length)
	expect(receipt.retention.omittedTasks).toBe(tasks.length - receipt.tasks.length)
	expect(JSON.stringify(receipt).length).toBeLessThanOrEqual(8000)
	expect(receipt.tasks.every((t: any) => t.title === large.tasks[0].title)).toBe(true)
})

test('a model-authored checklist never becomes an independent action receipt', () => {
	const record = new ResearchRecord()
	const args = {
		items: [
			{
				requirement: 'Which glaze?',
				finding: 'UNTRUSTED_INTERPRETATION',
				status: 'unresolved',
				sources: []
			}
		]
	}
	const result = record.run('research_record', args)
	record.observe('research_record', JSON.stringify(result), JSON.stringify(args))
	const evidence = record.verifierMessages('Which glaze?', 'Unknown.')[1].content
	expect(record.observedTools.has('research_record')).toBe(true)
	expect(record.toolOutcomes).toHaveLength(0)
	expect(evidence).not.toContain('UNTRUSTED_INTERPRETATION')
})

test('past receipts remain separate from this turn and uncertain outcomes never become success', () => {
	const prior = {
		id: 'past-reply',
		role: 'assistant' as const,
		content: 'Closed.',
		calls: [
			{
				id: 'prior-action',
				name: 'list_window_toggle',
				arguments: '{}',
				status: 'completed' as const,
				startedAt: 123,
				result: '{"ok":true,"open":false}'
			}
		]
	}
	const record = new ResearchRecord([], [], [prior])
	record.observe('list_window_toggle', '{"ok":true,"open":true}')
	const evidence = JSON.parse(record.verifierMessages('Open it.', 'Open.')[1].content)
	expect(evidence.priorToolOutcomes.observations[0].receipt.open).toBe(false)
	expect(evidence.toolOutcomes[0].receipt.open).toBe(true)
	expect(evidence.priorToolOutcomes.observations[0].observedAt).toBe(123)
	expect(
		JSON.parse(historicalToolResult({ status: 'interrupted', result: '{"ok":true}' }))
			.resultRetained
	).toBe(false)
	const bounded = historicalToolEvidence(
		Array.from({ length: 12 }, (_, i) => ({ ...prior, id: `reply-${i}` }))
	)
	expect(bounded.observations).toHaveLength(8)
	expect(bounded.omitted).toBe(4)
})

test('malformed or oversized unvalidated results stay unknown; credential fields are redacted', () => {
	const notice = 'Inspect the original receipt.'
	expect(retainedToolResult('{"ok":true', notice)).toEqual({ resultRetained: false, notice })
	const invalidTaskResult = { ...JSON.parse(result), unexpected: 'not a valid domain page' }
	expect(retainedToolResult(JSON.stringify(invalidTaskResult), notice)).toEqual({
		resultRetained: false,
		notice
	})
	expect(
		retainedToolResult('{"ok":true,"nested":{"authorization":"fictional-token"}}', notice)
	).toEqual({ ok: true, nested: { authorization: '[redacted]' } })
})

test('current receipt eviction is explicit instead of silently implying there were no other actions', () => {
	const record = new ResearchRecord()
	for (let i = 0; i < 130; i++)
		record.observe('surface_status', JSON.stringify({ ok: true, index: i }))
	const evidence = JSON.parse(record.verifierMessages('Status?', 'Ready.')[1].content)
	expect(evidence.toolOutcomes).toHaveLength(128)
	expect(evidence.toolOutcomesOmitted).toBe(2)
})
