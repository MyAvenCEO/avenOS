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
		'Direct actor access:',
		jsonBlock(input.skill.directActors),
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
		'- use route_worker or spawn_worker for worker activity',
		'- You may call another skill only with action type call_skill.',
		'- The target must be listed in Direct actor access.',
		'- Do not send to human, dispatcher, intent actors, or skill-worker actors.',
		'- Direct skill calls return later as skill.result.',
		'',
		'Return JSON only. Use this exact shape:',
		jsonBlock({ state: {}, events: [], actions: [] }),
		'',
		'Example direct skill call action:',
		jsonBlock({
			type: 'call_skill',
			to: 'skills/memory',
			callId: 'remember-file-greeting-txt',
			request: 'store',
			payload: {
				topic: 'files',
				text: 'Created greeting.txt'
			}
		}),
		'',
		'If no action is needed, return:',
		jsonBlock({ state: {}, actions: [] })
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
		'Direct actor access:',
		jsonBlock(input.skill.directActors),
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
		'- Use tools for all external actions.',
		'- Available tools may include shell, read_file, write_file, inspect_attachment, call_skill, and finish.',
		'- Use call_skill to delegate to another skill.',
		'- Use finish when the requested work is complete.',
		'- Do not manually emit worker result JSON unless explicitly asked by the runtime.',
		`- Never call your own skill actor (${`skills/${input.skill.id}`}). Do same-skill work directly and return result/completed instead.`,
		'- The target must be listed in Direct actor access.',
		'- Do not send to human, dispatcher, intent actors, or skill-worker actors.',
		'- Direct skill calls return later as skill.result.',
		'',
		'Return JSON only as tool calls.',
		'Use this exact shape for completion:',
		jsonBlock({ tool: 'finish', args: { result: { ok: true }, state: {} } }),
		'',
		'Example with a direct skill call to memory:',
		jsonBlock({
			tool: 'call_skill',
			args: {
				to: 'skills/memory',
				callId: 'remember-file-greeting-txt',
				request: 'store',
				payload: {
					topic: 'files',
					text: 'Created greeting.txt'
				},
				state: {}
			}
		}),
		'',
		'Example of direct completion without any skill call:',
		jsonBlock({
			tool: 'finish',
			args: {
				result: {
					ok: true
				},
				state: {}
			}
		}),
		'',
		'If you call another skill, every call_skill tool call must include exactly: to, callId, request, payload.'
	].join('\n')
}

function jsonBlock(value: unknown): string {
	return JSON.stringify(value, null, 2)
}