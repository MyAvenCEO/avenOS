import type { SandboxFactory } from '../sandbox/types.js'
import type { IntentRecord } from '../storage/types.js'

export async function runWorkerTask(args: {
	sandboxFactory: SandboxFactory
	intent: IntentRecord
	skill: 'memory' | 'ingest' | 'extract'
	workerType: string
	skillDoc: string
	task: Record<string, unknown>
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const sandbox = await args.sandboxFactory.createSandbox({
		skill: args.skill,
		intentId: args.intent.id,
		workerType: args.workerType
	})
	await sandbox.writeFile('SKILL.md', args.skillDoc)
	await sandbox.writeFile('intent.json', JSON.stringify(args.intent, null, 2))
	await sandbox.writeFile('task.json', JSON.stringify(args.task, null, 2))
	return sandbox.run(`cat SKILL.md >/dev/null && cat intent.json >/dev/null && cat task.json >/dev/null && echo worker:${args.skill}:${args.workerType}`)
}