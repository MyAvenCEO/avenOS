import path from 'node:path'

import {
	createActorRuntime,
	type ActorDebugTrace,
	type ActorRuntime,
	type RuntimeLogger
} from '@jaensen/actor-runtime'
import {
	createFlueDispatcherBrain,
	createFlueIntentBrain,
	createFlueSkillWorkerBrain,
	type FlueHarnessAdapter,
	type ThinkingLevel
} from '@jaensen/brain-flue'
import {
	createDispatcherHandler,
	createIntentHandler,
	createUserInputEnvelope,
	type DispatcherBrain,
	type IntentBrain,
	type UserAttachment
} from '@jaensen/conversation-actors'
import {
	DISPATCHER_ACTOR_ID,
	HUMAN_ACTOR_ID,
	INTENTS_ACTOR_ID,
	SKILLS_ACTOR_ID,
	SqlitePersistence,
	actorKindFromId,
	actorNameFromId,
	actorParentIdFromId,
	createSkillActorId,
	type Persistence
} from '@jaensen/persistence-sqlite'
import {
	bootstrapSkills,
	createSkillRegistry,
	createSkillSupervisorHandler,
	createSkillWorkerHandler,
	loadSkills,
	type SharedSkillResourceConfig,
	type SkillDefinition,
	type SkillRegistry,
	type SkillWorkerBrain
} from '@jaensen/skills'

import { createSqlitePersistence } from './create-sqlite-persistence'
import {
	createHumanOutboxHandler,
	normalizeHumanOutboxState,
	type HumanOutboxEntry
} from './human-outbox-handler'
import { ensureStartupActors } from './startup-actors'

export interface CreateAppNodeInput {
	persistence?: Persistence
	persistencePath?: string
	workerId?: string
	workspaceRoot?: string
	skillsRoot?: string
	harness: FlueHarnessAdapter
	now?: Date
	logger?: RuntimeLogger
	model?: string
	thinkingLevel?: ThinkingLevel
	dispatcherBrain?: DispatcherBrain
	intentBrain?: IntentBrain
	skillWorkerBrain?: SkillWorkerBrain
	skills?: SkillDefinition[]
	skillRegistry?: SkillRegistry
	sharedSkillResources?: SharedSkillResourceConfig
}

export interface AppNode {
	persistence: Persistence
	runtime: ActorRuntime
	skills: SkillDefinition[]
	skillRegistry: SkillRegistry
	enqueueUserInput(input: {
		text: string
		attachments?: UserAttachment[]
		attachmentScopeId?: string
		intentIdHint?: string
		now?: Date
		id?: string
	}): Promise<{ envelopeId: string; correlationId: string }>
	tick(): Promise<'processed' | 'idle'>
	runUntilIdle(maxTicks?: number): Promise<number>
	readHumanOutbox(): Promise<HumanOutboxEntry[]>
}

export async function createAppNode(input: CreateAppNodeInput): Promise<AppNode> {
	const now = input.now ?? new Date()
	const workspaceRoot = input.workspaceRoot ?? process.cwd()
	const skillsRoot = resolveFromWorkspace(workspaceRoot, input.skillsRoot ?? '.flue/skills')
	const persistencePath = resolveFromWorkspace(workspaceRoot, input.persistencePath ?? '.jaensen/state.db')
	const sharedSkillResources = input.sharedSkillResources ?? { uploadRoot: '.jaensen/uploads' }
	const persistence =
		input.persistence ??
		(await createSqlitePersistence({
			path: persistencePath
		}))

	await persistence.migrate()

	const runtime = createActorRuntime({
		persistence,
		workerId: input.workerId ?? `node-${process.pid}`,
		logger: input.logger
	})
	const harness = instrumentHarness(input.harness, runtime, now)

	const skills = input.skills ?? (await loadSkills({ rootDir: skillsRoot, now }))
	const skillRegistry = input.skillRegistry ?? createSkillRegistry(skills)

	await ensureStartupActors({ persistence })
	await bootstrapSkills({ persistence, skills, now })

	runtime.register(
		createDispatcherHandler({
			brain:
				input.dispatcherBrain ??
				createFlueDispatcherBrain({
					harness,
					model: input.model,
					thinkingLevel: input.thinkingLevel
				})
		})
	)

	runtime.register(
		createIntentHandler({
			brain:
				input.intentBrain ??
				createFlueIntentBrain({
					harness,
					model: input.model,
					thinkingLevel: input.thinkingLevel
				}),
			skillRegistry
		})
	)

	runtime.register(
		createSkillSupervisorHandler({
			registry: skillRegistry
		})
	)

	runtime.register(
		createSkillWorkerHandler({
			registry: skillRegistry,
			brain:
				input.skillWorkerBrain ??
				createFlueSkillWorkerBrain({
					harness,
					workspaceRoot,
					skillsRoot,
					uploadRoot: sharedSkillResources.uploadRoot
						? resolveFromWorkspace(workspaceRoot, sharedSkillResources.uploadRoot)
						: undefined,
					resolveAttachmentScopeId: (envelope) => readAttachmentScopeId(envelope.payload),
					model: input.model,
					thinkingLevel: input.thinkingLevel
				})
		})
	)

	runtime.register(createHumanOutboxHandler())
	runtime.debug.seedActor({ id: DISPATCHER_ACTOR_ID, type: 'dispatcher', name: 'Dispatcher' })
	runtime.debug.seedActor({ id: HUMAN_ACTOR_ID, type: 'human-outbox', name: 'Human outbox' })
	runtime.debug.seedActor({ id: INTENTS_ACTOR_ID, type: 'intents', name: 'Intents' })
	runtime.debug.seedActor({ id: SKILLS_ACTOR_ID, type: 'skills', name: 'Skills' })
	for (const skill of skills) {
		runtime.debug.seedActor({
			id: createSkillActorId(skill.id),
			type: 'skill-supervisor',
			name: skill.id,
			parentId: SKILLS_ACTOR_ID
		})
	}

	return {
		persistence,
		runtime,
		skills,
		skillRegistry,
		async enqueueUserInput(userInput) {
			const envelope = createUserInputEnvelope({
				id: userInput.id,
				text: userInput.text,
				attachments: userInput.attachments,
				attachmentScopeId: userInput.attachmentScopeId,
				intentIdHint: userInput.intentIdHint,
				now: userInput.now ?? new Date()
			})
			await runtime.enqueue(envelope)
			return {
				envelopeId: envelope.id,
				correlationId: envelope.correlationId
			}
		},
		tick() {
			return runtime.tick()
		},
		runUntilIdle(maxTicks = 100) {
			return runtime.runUntilIdle(maxTicks)
		},
		async readHumanOutbox() {
			const actor = await persistence.getActor(HUMAN_ACTOR_ID)
			return normalizeHumanOutboxState(actor?.state).messages
		}
	}
}

export function asSqlitePersistence(persistence: Persistence): SqlitePersistence | null {
	return persistence instanceof SqlitePersistence ? persistence : null
}

function resolveFromWorkspace(workspaceRoot: string, targetPath: string): string {
	return path.isAbsolute(targetPath) ? targetPath : path.resolve(workspaceRoot, targetPath)
}

function instrumentHarness(
	harness: FlueHarnessAdapter,
	runtime: ActorRuntime,
	startupNow: Date
): FlueHarnessAdapter {
	return {
		async session(name, options) {
			const actorId = actorIdFromSessionName(name)
			if (actorId) {
				runtime.debug.seedActor({
					id: actorId,
					type: actorTypeFromActorId(actorId),
					name: actorNameFromActorId(actorId),
					parentId: actorParentId(actorId),
					lastEventAt: startupNow.toISOString()
				})
			}
			const session = await harness.session(name, options)
			return {
				async prompt(text, promptOptions) {
					const result = await session.prompt(text, promptOptions)
					recordTrace(runtime, actorId, {
						kind: 'prompt',
						label: options?.role ?? promptOptions.role ?? name,
						inputSummary: truncate(text),
						outputSummary: truncate(safeJson(result)),
						at: new Date().toISOString()
					})
					return result
				},
				async task(text, taskOptions) {
					const result = await session.task(text, taskOptions)
					recordTrace(runtime, actorId, {
						kind: 'task',
						label: taskOptions.role ?? options?.role ?? name,
						inputSummary: truncate(text),
						outputSummary: truncate(safeJson(result)),
						cwd: taskOptions.cwd,
						at: new Date().toISOString()
					})
					return result
				},
				async shell(command, shellOptions) {
					const result = await session.shell(command, shellOptions)
					recordTrace(runtime, actorId, {
						kind: 'shell',
						label: options?.role ?? name,
						command,
						cwd: shellOptions?.cwd,
						stdout: truncate(result.stdout, 1200),
						stderr: truncate(result.stderr, 1200),
						exitCode: result.exitCode,
						at: new Date().toISOString()
					})
					return result
				}
			}
		}
	}
}

function recordTrace(runtime: ActorRuntime, actorId: string | null, trace: ActorDebugTrace): void {
	if (!actorId) return
	runtime.debug.recordTrace(actorId, trace)
}

function actorIdFromSessionName(name: string): string | null {
	if (name === 'actor/dispatcher') return DISPATCHER_ACTOR_ID
	if (name === 'actor/human') return HUMAN_ACTOR_ID
	if (name === 'actor/intents') return INTENTS_ACTOR_ID
	if (name === 'actor/skills') return SKILLS_ACTOR_ID
	if (name.startsWith('actor/intents/')) return name.slice('actor/'.length)
	if (name.startsWith('actor/skills/')) return name.slice('actor/'.length)
	return null
}

function actorTypeFromActorId(actorId: string): string {
	return actorKindFromId(actorId)
}

function actorNameFromActorId(actorId: string): string {
	return actorNameFromId(actorId)
}

function actorParentId(actorId: string): string | undefined {
	return actorParentIdFromId(actorId)
}

function truncate(value: string, max = 280): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(redactAttachmentSensitiveData(value))
	} catch {
		return String(value)
	}
}

function readAttachmentScopeId(payload: unknown): string | undefined {
	const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}
	const userInput =
		record.userInput && typeof record.userInput === 'object' && !Array.isArray(record.userInput)
			? (record.userInput as Record<string, unknown>)
			: {}
	const value = typeof record.attachmentScopeId === 'string' ? record.attachmentScopeId : userInput.attachmentScopeId
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function redactAttachmentSensitiveData(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => redactAttachmentSensitiveData(item))
	}
	if (!value || typeof value !== 'object') {
		return value
	}

	const result: Record<string, unknown> = {}
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (key === 'path' && typeof entry === 'string') {
			result[key] = '[redacted]'
			continue
		}
		result[key] = redactAttachmentSensitiveData(entry)
	}
	return result
}