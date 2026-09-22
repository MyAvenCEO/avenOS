/** Small held-out conversations: moving records must not move the conversation.
 * Actual Qwen, installed Task Actor, signed HTTP and isolated customer SQL. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { ChatCore, type Turn } from '@avenos/chat-engine/chat'
import { chatGatewayRequest, createGatewayModelStream } from '@avenos/chat-engine/gateway'
import { callsFromPayload, turnPayload } from '@avenos/chat-engine/turn-payload'
import { createTaskActor, TASK_MANIFEST } from '@avenos/productivity/actor'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { taskServiceFixture } from './task-service-fixture'

const base = process.env.LIVE_LLM_BASE_URL,
	database = process.env.TEST_TASK_DATABASE_URL
const model = process.env.LIVE_LLM_MODEL
assert(
	base && database && model && /qwen/i.test(model),
	'Use real Qwen and an owned disposable database server.'
)
const directory = await mkdtemp('/tmp/aven-live-intent-references-')
const evidence: any = {
	synthetic: true,
	passed: false,
	model,
	turns: [],
	fingerprints: {},
	scope: 'Shared Chat, real Task Actor/SQL and history reload; not native or voice qualification.'
}
for (const file of [
	'deploy/e2e/live-intent-references.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/research.ts',
	'libs/aven-chat-engine/src/context-references.ts',
	'libs/aven-productivity/src/actor.ts'
])
	evidence.fingerprints[file] = createHash('sha256')
		.update(await readFile(file))
		.digest('hex')
const save = () =>
	writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'reference-qwen',
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
const stream = createGatewayModelStream({
	request: (input) => chatGatewayRequest({ ...input, model: 'reference-qwen' }),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.ok && response.body, `Qwen HTTP ${response.status}`)
		const decoder = new TextDecoder()
		for await (const chunk of response.body) yield decoder.decode(chunk, { stream: true })
		yield decoder.decode()
	}
})
try {
	for (const scenario of [
		{
			destination: 'Fictional lantern workshop',
			move: 'Fold the purple map',
			keep: 'Sort the acorn stamps',
			next: 'Cut the felt pennants',
			create:
				'Create two personal tasks here, with no due date: "Fold the purple map" and "Sort the acorn stamps".',
			reassign:
				'Verschiebe nur „Fold the purple map“ nach „Fictional lantern workshop“. Keine Kopie; Titel, Zustand und Datum unverändert lassen. Kurz bestätigen.',
			followup:
				'Ajoute maintenant ici « Cut the felt pennants », tâche personnelle sans échéance. Ne change rien aux tâches existantes.'
		},
		{
			destination: 'Fictional puppet exhibition',
			move: 'Paint the cardboard arch',
			keep: 'Weave the sample ribbon',
			next: 'Count the wooden stars',
			create:
				'Enregistre ici deux tâches personnelles sans échéance : « Paint the cardboard arch » et « Weave the sample ribbon ».',
			reassign:
				'Mueve solo "Paint the cardboard arch" a "Fictional puppet exhibition". Conserva título, estado y fecha; no hagas una copia. Confirma brevemente.',
			followup:
				'add "Count the wooden stars" here too pls, personal task, no due date. leave everything else alone.'
		}
	]) {
		const owner = randomUUID(),
			intentId = randomUUID()
		const fixture = await taskServiceFixture(database, owner, intentId)
		let chat: ChatCore | undefined
		try {
			const destination = await fixture.store.create(owner, {
				id: randomUUID(),
				title: scenario.destination,
				intentType: 'conversation',
				sourceLabel: 'Chat',
				deadline: null
			})
			const open = async () => {
				const stored = await fixture.store.detail(owner, intentId)
				assert(!stored.contributionsHasMore)
				const history: Turn[] = stored.contributions
					.filter((c) => c.kind === 'message')
					.map((c) => ({
						id: c.id,
						role: c.contributorKind === 'human' ? 'user' : 'assistant',
						content: c.text ?? '',
						calls: callsFromPayload(c.payload)
					}))
				const engine = new ChatCore(
					{},
					{
						specs: TASK_MANIFEST.methods,
						run: async (name, args) => {
							const actor = createTaskActor(fixture.repository(), () => ({
								ownerSubjectId: owner,
								operationId: randomUUID(),
								intentId,
								contributionId: engine.activeUserId
							}))
							try {
								return await actor.deliver(name, JSON.parse(args))
							} finally {
								actor.dispose()
							}
						}
					},
					stream
				)
				engine.hydrate(intentId, history)
				engine.use(intentId)
				// Only the other Intent is in the display index. The accepted conversation
				// comes from the engine, never by guessing the most recently named record.
				engine.contextReferences = () => [
					{ kind: 'intent', id: destination.id, title: destination.title }
				]
				return engine
			}
			chat = await open()
			const original = new Map<string, { id: string; revision: number }>()
			for (const [index, text] of [
				scenario.create,
				scenario.reassign,
				scenario.followup
			].entries()) {
				if (index === 2) {
					chat.resetForEnvironment()
					chat = await open()
				}
				const user: Turn = { id: randomUUID(), role: 'user', content: text }
				await fixture.store.append(owner, intentId, {
					id: user.id,
					contributorKind: 'human',
					kind: 'message',
					text,
					payload: {}
				})
				const began = performance.now()
				await chat.send(text, undefined, {
					user,
					context: '',
					contextReferences: chat.contextReferences!(),
					calls: []
				})
				const reply = structuredClone(chat.turns.at(-1)!)
				const row = {
					text,
					reply,
					failure: chat.failure,
					diagnostics: structuredClone(chat.diagnostics),
					durationMs: performance.now() - began
				}
				evidence.turns.push(row)
				await save()
				assert.equal(chat.failure, null)
				assert(reply.calls?.length && reply.calls.every((call) => call.status === 'completed'))
				assert(
					!reply.modelRequests?.some((request) => request.phase === 'repair'),
					'These short operational replies should not require repair.'
				)
				await fixture.store.append(owner, intentId, {
					id: reply.id,
					contributorKind: 'agent',
					kind: 'message',
					text: reply.content,
					payload: turnPayload(reply)
				})
				const here = await fixture.repository().list(owner, { intentId, limit: 100 })
				const there = await fixture
					.repository()
					.list(owner, { intentId: destination.id, limit: 100 })
				assert(here.complete && there.complete)
				assert.deepEqual(
					here.tasks.map((task) => task.title).sort(),
					(index === 0
						? [scenario.move, scenario.keep]
						: index === 1
							? [scenario.keep]
							: [scenario.keep, scenario.next]
					).sort()
				)
				assert.deepEqual(
					there.tasks.map((task) => task.title),
					index === 0 ? [] : [scenario.move]
				)
				assert(
					[...here.tasks, ...there.tasks].every(
						(task) => task.due === null && task.status === 'open' && task.group === 'me'
					)
				)
				for (const task of [...here.tasks, ...there.tasks]) {
					const saved = original.get(task.title)
					if (saved) {
						assert.equal(
							task.id,
							saved.id,
							'Reassociation must preserve the original task identity'
						)
						assert.equal(task.revision, saved.revision + (task.title === scenario.move ? 1 : 0))
					} else original.set(task.title, { id: task.id, revision: task.revision })
				}
				Object.assign(row, { stored: { here: here.tasks, there: there.tasks } })
				await save()
				console.log(
					JSON.stringify({
						scenario: scenario.destination,
						step: index + 1,
						text: reply.content,
						durationMs: row.durationMs
					})
				)
			}
		} finally {
			chat?.resetForEnvironment()
			await fixture.close()
		}
	}
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await save()
	console.log(`Evidence: ${directory}/evidence.json`)
}
