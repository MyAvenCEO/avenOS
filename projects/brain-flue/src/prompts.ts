import type { SkillDefinition } from '@jaensen/skills'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'

export function buildSupervisorPrompt(input: {
	skill: SkillDefinition
	actorState: unknown
	envelope: EnvelopeRecord
	knownWorkers: Record<string, unknown>
	workspaceRoot: string
}): string {
	return [
		'You are the supervisor brain for a Jaensen skill running through Flue.',
		'Return only a structured decision matching the provided schema.',
		'Do not invent extra keys.',
		'',
		`Workspace root: ${input.workspaceRoot}`,
		`Skill id: ${input.skill.id}`,
		'',
		'Skill frontmatter:',
		jsonBlock(input.skill.frontmatter),
		'',
		'SKILL.md body:',
		input.skill.body,
		'',
		'Current supervisor actor state:',
		jsonBlock(input.actorState),
		'',
		'Incoming envelope:',
		jsonBlock(input.envelope),
		'',
		'Known workers:',
		jsonBlock(input.knownWorkers),
		'',
		'Rules:',
		'- state is always required',
		'- messageType must be non-empty',
		'- workerId must be slug-safe lowercase kebab-case',
		'- never send to human',
		'- use reply only to answer the sender when allowed',
		'- use route_worker or spawn_worker for worker activity'
	].join('\n')
}

export function buildWorkerPrompt(input: {
	skill: SkillDefinition
	workerId: string
	actorState: unknown
	envelope: EnvelopeRecord
	workspaceRoot: string
	resourceHints: unknown
	workerPolicy: unknown
}): string {
	return [
		'You are the worker brain for a Jaensen skill running through Flue.',
		'Return only a structured result matching the provided schema.',
		'Do not invent extra keys.',
		'',
		`Workspace root: ${input.workspaceRoot}`,
		`Skill id: ${input.skill.id}`,
		`Worker id: ${input.workerId}`,
		`Worker policy: ${String(input.workerPolicy ?? 'ephemeral')}`,
		'',
		'Skill frontmatter:',
		jsonBlock(input.skill.frontmatter),
		'',
		'SKILL.md body:',
		input.skill.body,
		'',
		'Current worker state:',
		jsonBlock(input.actorState),
		'',
		'Incoming envelope:',
		jsonBlock(input.envelope),
		'',
		'Allowed resource hints:',
		jsonBlock(input.resourceHints),
		'',
		'Rules:',
		'- state is always required',
		'- events are optional',
		'- completed defaults to false if omitted'
	].join('\n')
}

function jsonBlock(value: unknown): string {
	return JSON.stringify(value, null, 2)
}