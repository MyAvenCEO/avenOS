import path from 'node:path'

import { createActorRuntime, type ActorRuntime, type RuntimeLogger } from '@jaensen/actor-runtime'
import {
	createFlueDispatcherBrain,
	createFlueIntentBrain,
	createFlueSkillSupervisorBrain,
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
import { SqlitePersistence, type Persistence } from '@jaensen/persistence-sqlite'
import {
	bootstrapSkills,
	createSkillRegistry,
	createSkillSupervisorHandler,
	createSkillWorkerHandler,
	loadSkills,
	type SkillDefinition,
	type SkillRegistry,
	type SkillSupervisorBrain,
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
	skillSupervisorBrain?: SkillSupervisorBrain
	skillWorkerBrain?: SkillWorkerBrain
	skills?: SkillDefinition[]
	skillRegistry?: SkillRegistry
}

export interface AppNode {
	persistence: Persistence
	runtime: ActorRuntime
	skills: SkillDefinition[]
	skillRegistry: SkillRegistry
	enqueueUserInput(input: {
		text: string
		attachments?: UserAttachment[]
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

	const skills = input.skills ?? (await loadSkills({ rootDir: skillsRoot, now }))
	const skillRegistry = input.skillRegistry ?? createSkillRegistry(skills)

	await ensureStartupActors({ persistence })
	await bootstrapSkills({ persistence, skills, now })

	runtime.register(
		createDispatcherHandler({
			brain:
				input.dispatcherBrain ??
				createFlueDispatcherBrain({
					harness: input.harness,
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
					harness: input.harness,
					model: input.model,
					thinkingLevel: input.thinkingLevel
				}),
			skillRegistry
		})
	)

	runtime.register(
		createSkillSupervisorHandler({
			registry: skillRegistry,
			brain:
				input.skillSupervisorBrain ??
				createFlueSkillSupervisorBrain({
					harness: input.harness,
					workspaceRoot,
					model: input.model,
					thinkingLevel: input.thinkingLevel
				})
		})
	)

	runtime.register(
		createSkillWorkerHandler({
			registry: skillRegistry,
			brain:
				input.skillWorkerBrain ??
				createFlueSkillWorkerBrain({
					harness: input.harness,
					workspaceRoot,
					model: input.model,
					thinkingLevel: input.thinkingLevel
				})
		})
	)

	runtime.register(createHumanOutboxHandler())

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
			const actor = await persistence.getActor('human')
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