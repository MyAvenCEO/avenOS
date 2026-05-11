import { runWorkerTask } from '../worker.js'
import type { IntentRecord } from '../../storage/types.js'
import type { SkillAction, SkillResult } from '../types.js'
import type { RuntimeDependencies } from '../types.js'

export async function runMemorySkill(intent: IntentRecord, action: Extract<SkillAction, { skill: 'memory' }>, deps: RuntimeDependencies): Promise<SkillResult> {
	const input = action.input && typeof action.input === 'object' ? action.input : {}
	const worker = await runWorkerTask({
		sandboxFactory: deps.sandboxFactory,
		intent,
		skill: 'memory',
		workerType: action.operation,
		skillDoc: deps.skillDocs.memory,
		task: input
	})
	if (action.operation === 'remember') {
		const topic = asString(input.topic) ?? intent.title
		const note = asString(input.note) ?? asString(input.content) ?? intent.summary
		await deps.storage.memory.appendTopicNote(topic, note)
		return { skill: 'memory', ok: worker.exitCode === 0, summary: `Stored note in ${topic}`, data: { topic, worker } }
	}
	if (action.operation === 'recall') {
		const topic = asString(input.topic) ?? intent.title
		const content = await deps.storage.memory.readTopic(topic)
		return { skill: 'memory', ok: worker.exitCode === 0, summary: `Read topic ${topic}`, data: { topic, content, worker } }
	}
	const query = asString(input.query) ?? intent.title
	return { skill: 'memory', ok: worker.exitCode === 0, summary: `Searched memory for ${query}`, data: { query, matches: await deps.storage.memory.search(query), worker } }
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}