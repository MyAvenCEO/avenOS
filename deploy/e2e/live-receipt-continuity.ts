/** Invented work, real Qwen, production Task Actor/HTTP/SQL and saved chat reload.
 * No customer records, model substitutes or fabricated successful tool receipts. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { ChatCore, type Turn } from '@avenos/chat-engine/chat'
import { chatGatewayRequest, createGatewayModelStream } from '@avenos/chat-engine/gateway'
import { answerReviewOptions, parseReview, ResearchRecord } from '@avenos/chat-engine/research'
import { retainedToolResult, TOOL_EVIDENCE_LIMIT } from '@avenos/chat-engine/tool-result-evidence'
import { callsFromPayload, turnPayload } from '@avenos/chat-engine/turn-payload'
import { createTaskActor, TASK_MANIFEST } from '@avenos/productivity/actor'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { taskServiceFixture } from './task-service-fixture'

const base = process.env.LIVE_LLM_BASE_URL?.replace(/\/$/, ''),
	database = process.env.TEST_TASK_DATABASE_URL
assert(base && database, 'A real Qwen endpoint and a disposable test database are required.')
const available = await fetch(`${base}/models`, { signal: AbortSignal.timeout(10000) }).then(
	async (r) => {
		assert(r.ok)
		return r.json()
	}
)
const model =
	process.env.LIVE_LLM_MODEL ?? available.data.find((m: { id: string }) => /qwen/i.test(m.id))?.id
assert(model && /qwen/i.test(model))
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'receipt-qwen',
				label: 'Qwen',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
			}
		])
	})
)!
const output = await mkdtemp('/tmp/aven-live-receipt-continuity-')
const evidence: any = {
	synthetic: true,
	model,
	startedAt: new Date().toISOString(),
	passed: false,
	turns: [],
	reviews: [],
	fingerprints: {},
	scope:
		'Real Qwen through the production gateway and shared chat engine; Task Actor, provisioned restricted SQL/HTTP, contributions, history reload and adversarial answer audits. Not a native UI/voice or full release gate.'
}
for (const path of [
	'deploy/e2e/live-receipt-continuity.ts',
	'libs/aven-chat-engine/src/research.ts',
	'libs/aven-chat-engine/src/context-references.ts',
	'libs/aven-chat-engine/src/restored-history.ts',
	'libs/aven-chat-engine/src/tool-result-evidence.ts',
	'libs/aven-chat-engine/src/tool-call.ts',
	'libs/aven-chat-engine/src/turn-payload.ts',
	'libs/aven-productivity/src/evidence.ts',
	'libs/aven-productivity/src/tasks.ts',
	'libs/aven-productivity/src/actor.ts',
	'libs/aven-productivity/src/postgres.ts',
	'services/intent-service/src/productivity.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'deploy/e2e/task-service-fixture.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const save = () =>
	writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
const stream = createGatewayModelStream({
	request: (input) => chatGatewayRequest({ ...input, model: 'receipt-qwen' }),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.ok && response.body, `Qwen HTTP ${response.status}`)
		const decoder = new TextDecoder()
		for await (const chunk of response.body!) yield decoder.decode(chunk, { stream: true })
		yield decoder.decode()
	}
})
const owner = randomUUID(),
	intentId = randomUUID()
let fixture: Awaited<ReturnType<typeof taskServiceFixture>> | undefined
let chat: ChatCore | undefined
const titles = Array.from(
	{ length: 24 },
	(_, i) => `Catalog sample box ${String(i + 1).padStart(2, '0')}`
)
const specs = TASK_MANIFEST.methods.map(({ name, description, parameters }) => ({
	name,
	description,
	parameters
}))
const writes: Promise<unknown>[] = []
function open(history: Turn[] = [], intentContext = '') {
	const engine = new ChatCore(
		{},
		{
			specs,
			run: async (name, argumentsText) => {
				const actor = createTaskActor(fixture!.repository(), () => ({
					ownerSubjectId: owner,
					operationId: randomUUID(),
					intentId,
					contributionId: engine.activeUserId
				}))
				try {
					return await actor.deliver(name, JSON.parse(argumentsText))
				} finally {
					actor.dispose()
				}
			}
		},
		stream
	)
	engine.hydrate(intentId, history)
	engine.use(intentId)
	engine.context = () =>
		`Accepted Intent ${intentId}: a fictional seed-library inventory. Task questions concern only this Intent unless explicitly stated otherwise. Use the installed task tools. Do not assume unobserved state. ${intentContext}`
	engine.onExchange = (session, _user, assistant) => {
		assert.equal(session, intentId)
		writes.push(
			fixture!.store.append(owner, session, {
				id: assistant.id,
				contributorKind: 'agent',
				kind: 'message',
				text: assistant.content,
				payload: turnPayload(assistant)
			})
		)
	}
	return engine
}
async function send(text: string) {
	const user: Turn = { id: randomUUID(), role: 'user', content: text, persisted: true }
	await fixture!.store.append(owner, intentId, {
		id: user.id,
		contributorKind: 'human',
		kind: 'message',
		text,
		payload: {}
	})
	const history = [...chat!.turns],
		started = performance.now()
	const contextReferences = structuredClone(chat!.contextReferences?.() ?? [])
	await chat!.send(text, undefined, {
		user,
		context: chat!.context!(),
		contextReferences,
		calls: []
	})
	await Promise.all(writes)
	const reply = chat!.turns.at(-1)!
	const report = {
		text,
		contextReferences,
		intentId,
		history,
		reply,
		diagnostics: structuredClone(chat!.diagnostics),
		failure: chat!.failure,
		durationMs: performance.now() - started
	}
	evidence.turns.push(report)
	await save()
	assert.equal(chat!.failure, null)
	assert.equal(reply.role, 'assistant')
	assert(
		!reply.calls?.some((call) => call.status !== 'completed'),
		'No avoidable failed call in these simple requests.'
	)
	console.log(
		JSON.stringify({
			turn: evidence.turns.length,
			durationMs: report.durationMs,
			reply: reply.content
		})
	)
	return report
}
async function audit(name: string, report: any, answer: string, expected: 'pass' | 'revise') {
	const record = new ResearchRecord([], [], report.history, specs, undefined, {
		intentId: report.intentId,
		references: report.contextReferences
	})
	for (const call of report.reply.calls ?? [])
		record.observe(call.name, call.result, call.arguments)
	const messages = record.verifierMessages(report.text, answer)
	let content = '',
		finish = '',
		started = performance.now()
	for await (const event of stream(
		messages,
		[],
		AbortSignal.timeout(180000),
		undefined,
		answerReviewOptions(0)
	)) {
		if (event.kind === 'text') content += event.text
		if (event.kind === 'finish') finish = event.reason
	}
	const row: any = {
		name,
		answer,
		expected,
		finish,
		content,
		durationMs: performance.now() - started,
		evidence: JSON.parse(messages[1].content)
	}
	evidence.reviews.push(row)
	await save()
	assert.equal(finish, 'stop')
	row.review = parseReview(content, 0)
	assert.equal(row.review.verdict, expected, name)
	row.passed = true
	await save()
	console.log(JSON.stringify({ audit: name, passed: true, durationMs: row.durationMs }))
}
try {
	fixture = await taskServiceFixture(database, owner, intentId)
	chat = open()
	const created = await send(
		`Create these 24 tasks exactly once in this Intent, in the team group, with no due dates: ${titles.join('; ')}. Confirm briefly; do not print the list.`
	)
	let page = await fixture.repository().list(owner, { intentId, limit: 100 })
	assert(page.complete)
	assert.deepEqual(page.tasks.map((t) => t.title).sort(), titles)
	assert(page.tasks.every((t) => t.revision === 1 && t.group === 'team' && t.due === null))
	assert(
		created.reply.calls!.some((c) => c.result.length > 8000),
		'Exercise the actual large receipt, not a small surrogate.'
	)
	const listed = await send(
		'Welche Aufgaben sind jetzt in diesem Intent gespeichert? Lies die aktuelle Liste, nenne die Gesamtzahl und jeden exakten Titel einmal. Nichts ändern.'
	)
	assert(listed.reply.calls?.every((c) => c.name === 'todo_list'))
	for (const title of titles) assert.equal(listed.reply.content.split(title).length - 1, 1)
	assert.match(listed.reply.content, /24/)
	const updated = await send(
		'Set all 24 of those tasks to the all-day due date 2034-08-09. Keep their titles, team group and open status. A short confirmation is enough.'
	)
	page = await fixture.repository().list(owner, { intentId, limit: 100 })
	assert(
		page.tasks.every(
			(t) =>
				t.revision === 2 &&
				t.due?.kind === 'date' &&
				t.due.date === '2034-08-09' &&
				t.status === 'open' &&
				t.group === 'team'
		)
	)
	await send(`Archive seulement « ${titles[6]} ». Ne marque aucune tâche comme terminée.`)
	const archived = await fixture.repository().list(owner, { intentId, archived: true })
	assert.equal(archived.tasks.length, 1)
	assert.equal(archived.tasks[0].title, titles[6])
	assert.equal(archived.tasks[0].status, 'open')
	const saved = await fixture.store.detail(owner, intentId)
	assert(!saved.contributionsHasMore)
	const history: Turn[] = saved.contributions
		.filter((c) => c.kind === 'message')
		.map((c) => ({
			id: c.id,
			role: c.contributorKind === 'human' ? 'user' : 'assistant',
			content: c.text ?? '',
			calls: callsFromPayload(c.payload)
		}))
	const storedCreate = history.find((t) => t.id === created.reply.id)!
	assert(
		JSON.parse(storedCreate.calls!.find((c) => c.name === 'todo_create')!.result).tasks.length ===
			24
	)
	chat.resetForEnvironment()
	chat = open(history)
	const checked = await send(
		`Prüfe bitte nur die aktive Liste dieses Intents erneut. Wie viele sind übrig? War das frühere Archivieren von „${titles[6]}“ tatsächlich gespeichert worden? Keine Änderungen.`
	)
	assert(checked.reply.calls?.some((c) => c.name === 'todo_list'))
	assert(checked.reply.calls?.every((c) => c.name === 'todo_list'))
	assert.match(checked.reply.content, /23/)
	assert.match(checked.reply.content, /archiv/i)
	assert.equal((await fixture.repository().list(owner, { intentId, limit: 100 })).tasks.length, 23)
	await audit(
		'large-create-truthful',
		created,
		'All 24 tasks are saved in this Intent in the team group, without due dates.',
		'pass'
	)
	await audit(
		'large-create-denied',
		created,
		'Nothing was saved; the tasks only exist in this chat.',
		'revise'
	)
	await audit(
		'large-update-truthful',
		updated,
		'All 24 tasks are now due on 9 August 2034 as an all-day date. Their titles, team group and open status are unchanged.',
		'pass'
	)
	await audit(
		'large-update-wrong-date',
		updated,
		'All 24 tasks are now due on 19 August 2034.',
		'revise'
	)
	await audit(
		'historical-effect-supported',
		checked,
		`23 aktive Aufgaben sind übrig. Das frühere Archivieren von „${titles[6]}“ wurde laut damaligem Änderungsbeleg gespeichert.`,
		'pass'
	)
	await audit(
		'historical-effect-denied',
		checked,
		`23 Aufgaben sind übrig. Das frühere Archivieren von „${titles[6]}“ wurde nie gespeichert.`,
		'revise'
	)
	// Independently invented long records, inserted through the actual signed Task
	// service as setup. The model must discover them, not echo a supplied list.
	const longTasks = Array.from({ length: 36 }, (_, i) => ({
		title: `Research display ${String(i + 1).padStart(2, '0')}: ${'Check the miniature specimen, the protective sleeve and its shelf label. '.repeat(6)}`,
		group: 'me' as const,
		tags: ['miniatures', '展示', 'réserve'],
		responsible: i % 3 === 0 ? 'Amber crew' : null,
		due: null
	}))
	const seeded = await fixture.repository().execute(
		owner,
		{ operation: 'create', tasks: longTasks },
		{
			operationId: randomUUID(),
			intentId,
			contributionId: null
		}
	)
	const beforeRead = await fixture.repository().list(owner, { intentId, group: 'me', limit: 100 })
	assert(beforeRead.complete && JSON.stringify(beforeRead).length > 24000)
	chat.resetForEnvironment()
	chat = open(history)
	const comprehensive = await send(
		'Bitte prüfe jetzt ALLE meine persönlichen Aufgaben in diesem Intent, nicht die Team-Aufgaben. Wie viele sind gespeichert und wie viele davon sind der Amber crew zugeordnet? Eine kurze Zusammenfassung reicht, keine Titelliste. Nichts verändern.'
	)
	const taskReads = comprehensive.reply.calls?.filter((call) => call.name === 'todo_list') ?? []
	assert(taskReads.length > 1, 'Long rows must require actual continuation.')
	const observed = new Set<string>()
	for (const call of taskReads) {
		assert(call.result.length <= TOOL_EVIDENCE_LIMIT)
		const value = JSON.parse(call.result)
		assert.deepEqual(retainedToolResult(call.result, 'Unavailable'), value)
		for (const task of value.tasks) if (task.group === 'me') observed.add(task.id)
	}
	assert.deepEqual([...observed].sort(), seeded.tasks.map((task) => task.id).sort())
	assert.match(comprehensive.reply.content, /36/)
	assert.match(comprehensive.reply.content, /12/)
	assert(comprehensive.reply.calls?.every((call) => call.name === 'todo_list'))
	assert.deepEqual(
		await fixture.repository().list(owner, { intentId, group: 'me', limit: 100 }),
		beforeRead
	)
	await audit(
		'long-pages-complete-count',
		comprehensive,
		'Es sind 36 persönliche Aufgaben gespeichert, davon 12 der Amber crew zugeordnet. Es wurde nichts verändert.',
		'pass'
	)
	await audit(
		'long-pages-incorrect-count',
		comprehensive,
		'Es sind 36 persönliche Aufgaben gespeichert, davon 36 der Amber crew zugeordnet. Es wurde nichts verändert.',
		'revise'
	)
	const destination = await fixture.store.create(owner, {
		id: randomUUID(),
		title: 'Exhibition setup',
		intentType: 'conversation',
		sourceLabel: 'Chat',
		deadline: null
	})
	const latest = await fixture.store.detail(owner, intentId)
	assert(!latest.contributionsHasMore)
	chat.resetForEnvironment()
	chat = open(
		latest.contributions
			.filter((entry) => entry.kind === 'message')
			.map((entry) => ({
				id: entry.id,
				role: entry.contributorKind === 'human' ? 'user' : 'assistant',
				content: entry.text ?? '',
				calls: callsFromPayload(entry.payload)
			})),
		''
	)
	chat.contextReferences = () => [{ kind: 'intent', id: destination.id, title: destination.title }]
	const moved = await send(
		'Mueve las tareas Research display 03 y Research display 21 al Intent Exhibition setup. Conserva sus títulos, fechas, grupo y estado. No crees copias ni cambies las otras tareas. Confirma brevemente.'
	)
	const selected = seeded.tasks.filter((task) => /Research display (03|21):/.test(task.title))
	assert.equal(selected.length, 2)
	const destinationPage = await fixture.repository().list(owner, { intentId: destination.id })
	assert(destinationPage.complete)
	assert.deepEqual(
		destinationPage.tasks,
		selected
			.map((task) => ({
				...task,
				intentId: destination.id,
				revision: task.revision + 1,
				updatedAt: destinationPage.tasks.find((row) => row.id === task.id)!.updatedAt
			}))
			.sort((a, b) => a.id.localeCompare(b.id))
	)
	const sourcePage = await fixture.repository().list(owner, { intentId, group: 'me', limit: 100 })
	assert(sourcePage.complete)
	assert.deepEqual(
		sourcePage.tasks,
		beforeRead.tasks.filter((task) => !selected.some((row) => row.id === task.id))
	)
	assert(moved.reply.calls?.some((call) => call.name === 'todo_update'))
	assert(moved.reply.calls?.every((call) => ['todo_list', 'todo_update'].includes(call.name)))
	assert.match(moved.reply.content, /Exhibition setup/i)
	// Correcting an unrelated unsupported aside must remain possible. The direct
	// audits below isolate the identity claim without banning legitimate repair.
	evidence.reassociationRepairs = moved.diagnostics.filter(
		(entry) => entry.phase === 'verification' && entry.reason === 'revise'
	)
	await audit(
		'named-destination-supported',
		moved,
		'He movido Research display 03 y Research display 21 al Intent Exhibition setup, conservando sus títulos, fechas, grupo y estado, sin crear copias ni modificar las demás tareas.',
		'pass'
	)
	await audit(
		'named-destination-wrong-id',
		{
			...moved,
			contextReferences: [{ kind: 'intent', id: randomUUID(), title: destination.title }]
		},
		'He movido ambas tareas al Intent Exhibition setup.',
		'revise'
	)
	await audit(
		'metadata-does-not-prove-action',
		{
			...moved,
			history: [],
			reply: { calls: [] }
		},
		'He movido ambas tareas al Intent Exhibition setup.',
		'revise'
	)
	const savedMove = (
		await fixture.pool.query(
			"SELECT cause,receipt FROM aven_productivity.task_commands WHERE owner_subject_id=$1 AND receipt->>'operation'='update' ORDER BY created_at DESC LIMIT 1",
			[owner]
		)
	).rows[0]
	assert.equal(
		savedMove.cause.intentId,
		intentId,
		'Moving does not rewrite the originating conversation.'
	)
	assert.equal(
		(await fixture.repository().receipt(owner, savedMove.receipt.operationId))?.operationId,
		savedMove.receipt.operationId
	)
	const foreign = await fixture.store.create(randomUUID(), {
		id: randomUUID(),
		title: 'Private stage notes',
		intentType: 'conversation',
		sourceLabel: 'Chat',
		deadline: null
	})
	const stableMoved = destinationPage.tasks
	for (const target of [randomUUID(), foreign.id]) {
		await assert.rejects(
			() =>
				fixture!.repository().execute(
					owner,
					{
						operation: 'update',
						tasks: stableMoved.map(({ id, revision }) => ({ id, revision })),
						patch: { intentId: target }
					},
					{ operationId: randomUUID(), intentId: null, contributionId: null }
				),
			(error: unknown) => error instanceof Error && 'status' in error && error.status === 404
		)
	}
	assert.deepEqual(
		(await fixture.repository().list(owner, { intentId: destination.id })).tasks,
		stableMoved
	)
	evidence.reassociation = {
		passed: true,
		sourceCount: sourcePage.tasks.length,
		destinationCount: destinationPage.tasks.length,
		identitiesPreserved: true,
		missingAndForeignDestinationsRejected: true,
		originRetained: true
	}
	const beforeInitialStates = (await fixture.repository().list(owner, { intentId, limit: 100 }))
		.tasks
	const initialStates = await send(
		'Dans cet Intent, enregistre trois nouvelles tâches personnelles, sans échéance : « Assemble the felt observatory » est déjà terminée, « Shape the paper canopy » est en cours, et « Choose the wooden beads » reste à faire. Enregistre directement leur état initial; ne recrée ni ne modifie les tâches déjà présentes.'
	)
	assert(initialStates.reply.calls?.some((call) => call.name === 'todo_create'))
	assert(
		initialStates.reply.calls?.every((call) => ['todo_create', 'todo_list'].includes(call.name))
	)
	const afterInitialStates = (await fixture.repository().list(owner, { intentId, limit: 100 }))
		.tasks
	assert.deepEqual(
		afterInitialStates.filter((task) => beforeInitialStates.some((prior) => prior.id === task.id)),
		beforeInitialStates
	)
	const newTasks = afterInitialStates.filter(
		(task) => !beforeInitialStates.some((prior) => prior.id === task.id)
	)
	assert.equal(newTasks.length, 3)
	assert.deepEqual(Object.fromEntries(newTasks.map((task) => [task.title, task.status])), {
		'Assemble the felt observatory': 'done',
		'Shape the paper canopy': 'doing',
		'Choose the wooden beads': 'open'
	})
	assert(
		newTasks.every(
			(task) => task.revision === 1 && task.group === 'me' && !task.archived && task.due === null
		)
	)
	evidence.initialStates = { passed: true, tasks: newTasks, existingTasksUnchanged: true }
	await audit(
		'current-intent-after-reassociation',
		initialStates,
		'Les trois tâches personnelles sont enregistrées dans cet Intent, sans échéance, avec leurs états initiaux demandés. Les tâches déjà présentes sont inchangées.',
		'pass'
	)
	await audit(
		'other-intent-is-not-conversation',
		initialStates,
		'Les trois tâches personnelles sont enregistrées dans Exhibition setup, sans échéance, avec leurs états initiaux demandés. Les tâches déjà présentes sont inchangées.',
		'revise'
	)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	chat?.resetForEnvironment()
	await fixture?.close()
	evidence.finishedAt = new Date().toISOString()
	await save()
	console.log(`Evidence: ${output}/evidence.json`)
}
