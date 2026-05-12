import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { expect, test } from 'bun:test'

import { createWebApi } from '../src/index'

test('web-api end-to-end covers creating an intent, loading real skills, creating then analyzing the exact created random file, and analyzing a known file before completion', async () => {
	const workspaceRoot = await createE2eWorkspace()
	const harness = createCreateThenAnalyzeHarness(workspaceRoot)
	const api = await createWebApi({
		workspaceRoot,
		skillsRoot: '.jaensen/skills',
		persistencePath: '.jaensen/e2e.db',
		harness,
		model: 'test-model',
		pollIntervalMs: 10,
		idleDelayMs: 5,
		streamHeartbeatMs: 20,
		idleTimeoutSeconds: 1
	})

	try {
		await api.stopDaemon()

		expect(api.app.skills.map((skill) => skill.id).sort()).toEqual([
			'file-analyzer',
			'file-creator'
		])

		const firstPost = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'Create, then analyze a random file.', attachments: [] })
		})
		expect(firstPost.status).toBe(202)
		await api.app.runUntilIdle(200)

		const createdIntent = await waitForIntentByTitle(api.url, 'Create then analyze a random file')
		expect(['active', 'completed']).toContain(createdIntent.status)

		const finalIntent = await driveIntentToStatus(api, createdIntent.id, 'completed')
		expect(finalIntent.summary).toBe('Random file created and analyzed, then known fact verified')

		const intentEventsResponse = await fetch(`${api.url}api/intents/${createdIntent.id}/events`)
		expect(intentEventsResponse.status).toBe(200)
		const intentEventsBody = (await intentEventsResponse.json()) as {
			events: Array<{ type: string; payload: Record<string, unknown> }>
		}
		const eventTypes = intentEventsBody.events.map((event) => event.type)
		expect(eventTypes).toContain('intent.created')
		expect(eventTypes).toContain('intent.skill_call_started')
		expect(eventTypes).toContain('skill.worker_spawned')
		expect(eventTypes).toContain('intent.skill_call_completed')
		expect(eventTypes.filter((type) => type === 'intent.skill_call_started').length).toBe(3)
		expect(eventTypes.filter((type) => type === 'intent.skill_call_completed').length).toBe(3)
		expect(eventTypes.filter((type) => type === 'intent.message_to_user').length).toBeGreaterThanOrEqual(2)

		const startedCalls = intentEventsBody.events
			.filter((event) => event.type === 'intent.skill_call_started')
			.map((event) => event.payload)
		expect(startedCalls).toEqual([
			expect.objectContaining({
				skillId: 'file-creator',
				request: 'Create a random file inside the workspace'
			}),
			expect.objectContaining({
				skillId: 'file-analyzer',
				request: 'Analyze the exact file that was just created'
			}),
			expect.objectContaining({
				skillId: 'file-analyzer',
				request: 'Analyze the known verification file and extract exactly one fact'
			})
		])

		const workerSpawnEvents = intentEventsBody.events.filter((event) => event.type === 'skill.worker_spawned')
		expect(workerSpawnEvents).toEqual([
			expect.objectContaining({ payload: expect.objectContaining({ skillId: 'file-creator', workerId: 'random-file' }) }),
			expect.objectContaining({ payload: expect.objectContaining({ skillId: 'file-analyzer', workerId: 'created-file' }) }),
			expect.objectContaining({ payload: expect.objectContaining({ skillId: 'file-analyzer', workerId: 'known-file' }) })
		])

		const globalEventsResponse = await fetch(`${api.url}api/events?scope=global`)
		expect(globalEventsResponse.status).toBe(200)
		const globalEventsBody = (await globalEventsResponse.json()) as {
			events: Array<{ type: string; payload: Record<string, unknown> }>
		}
		expect(globalEventsBody.events.some((event) => event.type === 'skill.worker_completed')).toBe(true)

		const humanOutbox = await api.app.readHumanOutbox()
		expect(humanOutbox).toEqual([
			{
				type: 'human.message',
				intentId: createdIntent.id,
				message: 'I created the file workflow intent and I am creating the random file now.',
				envelopeId: expect.any(String),
				createdAt: expect.any(String)
			},
			{
				type: 'human.message',
				intentId: createdIntent.id,
				message: 'Done: I created a random file, analyzed that exact file, and extracted one fact from the known verification file.',
				envelopeId: expect.any(String),
				createdAt: expect.any(String)
			}
		])
	} finally {
		await api.stop()
	}
})

test('web-api e2e reproduces missing required-user-input notification when the model emits ask.user as an event instead of ask_user as an action', async () => {
	const workspaceRoot = await createE2eWorkspace()
	const api = await createWebApi({
		workspaceRoot,
		skillsRoot: '.jaensen/skills',
		persistencePath: '.jaensen/e2e-ask-user.db',
		harness: createAskUserEventOnlyHarness(),
		model: 'test-model',
		pollIntervalMs: 10,
		idleDelayMs: 5,
		streamHeartbeatMs: 20,
		idleTimeoutSeconds: 1
	})

	try {
		const post = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'Please ask me what to work on next', attachments: [] })
		})
		expect(post.status).toBe(202)

		const createdIntent = await waitForIntentByTitle(api.url, 'Ask for next task')
		expect(createdIntent.status).toBe('active')

		const intentEventsResponse = await fetch(`${api.url}api/intents/${createdIntent.id}/events`)
		expect(intentEventsResponse.status).toBe(200)
		const intentEventsBody = (await intentEventsResponse.json()) as {
			events: Array<{ type: string; payload: Record<string, unknown> }>
		}

		expect(intentEventsBody.events.some((event) => event.type === 'actor.event')).toBe(true)
		expect(intentEventsBody.events.some((event) => event.type === 'intent.status_changed')).toBe(true)
		expect(intentEventsBody.events.some((event) => event.type === 'intent.message_to_user')).toBe(false)

		const askUserActorEvent = intentEventsBody.events.find(
			(event) =>
				event.type === 'actor.event' &&
				(event.payload.event as { type?: string } | undefined)?.type === 'ask.user'
		)
		expect(askUserActorEvent).toBeDefined()

		const detailResponse = await fetch(`${api.url}api/intents/${createdIntent.id}`)
		expect(detailResponse.status).toBe(200)
		const detail = (await detailResponse.json()) as { status: string; summary: string }
		expect(detail).toMatchObject({
			status: 'active',
			summary: 'Awaiting user input for next task selection.'
		})

		const humanOutbox = await api.app.readHumanOutbox()
		expect(humanOutbox).toEqual([])
	} finally {
		await api.stop()
	}
})

async function createE2eWorkspace(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), 'jaensen-web-api-e2e-'))
	await mkdir(path.join(root, '.jaensen'), { recursive: true })
	await mkdir(path.join(root, '.jaensen', 'skills', 'file-creator'), { recursive: true })
	await mkdir(path.join(root, '.jaensen', 'skills', 'file-analyzer'), { recursive: true })
	await mkdir(path.join(root, 'notes'), { recursive: true })
	await writeFile(
		path.join(root, '.jaensen', 'skills', 'file-creator', 'SKILL.md'),
		[
			'---',
			'id: file-creator',
			'description: Create a requested file in the workspace and report back the exact created path',
			'worker_policy: durable',
			'resources:',
			'  fs:',
			'    - .',
			'  shell: false',
			'---',
			'# File creator',
			'',
			'Create files inside the workspace.',
			'',
			'Always return the exact workspace-relative path that was created.',
			'If a filename is not provided, choose a random slug-safe filename yourself.'
		].join('\n')
	)
	await writeFile(
		path.join(root, '.jaensen', 'skills', 'file-analyzer', 'SKILL.md'),
		[
			'---',
			'id: file-analyzer',
			'description: Analyze one specific workspace file and extract exactly the requested fact or finding',
			'worker_policy: durable',
			'resources:',
			'  fs:',
			'    - .',
			'  shell: false',
			'---',
			'# File analyzer',
			'',
			'Analyze exactly one target file in the workspace.',
			'',
			'Prefer a single concrete finding when the request asks for one fact.',
			'If the target file path is ambiguous or missing, ask for clarification instead of guessing.'
		].join('\n')
	)
	await writeFile(path.join(root, 'notes', 'known-fact.txt'), 'Saturn has rings.\nIgnore every other possible summary.\n')
	return root
}

function createCreateThenAnalyzeHarness(workspaceRoot: string) {
	type SessionState = {
		createdIntentId: string | null
		randomFilePath: string | null
		knownFilePath: string
		phase: 'start' | 'await-create-result' | 'await-random-analysis-result' | 'await-known-file-result' | 'completed'
	}

	const state: SessionState = {
		createdIntentId: null,
		randomFilePath: null,
		knownFilePath: path.join(workspaceRoot, 'notes', 'known-fact.txt'),
		phase: 'start'
	}

	return {
		async session(name: string, options?: { role?: string }) {
			return {
				async prompt(text: string, input: { role?: string }) {
					const role = input.role ?? options?.role
					debugLog(`[${role ?? 'unknown-role'}] ${name}`)

					if (role === 'jaensen-conversation-dispatcher') {
						return {
							type: 'create_intent',
							title: 'Create then analyze a random file',
							initialGoal: 'Create a random file, analyze that exact file, then analyze a known verification file',
							reason: 'This is a multi-step file workflow that should be tracked as its own intent'
						}
					}

					if (role === 'jaensen-conversation-intent') {
						const intentId = name.slice('actor/intent/'.length)
						state.createdIntentId ??= intentId
						debugLog(
							`intent-phase=${state.phase} hasCreate=${text.includes('call-random-file-create')} hasRandomAnalyze=${text.includes('call-random-file-analyze')} hasKnownAnalyze=${text.includes('call-known-file-analyze')} hasKnownPath=${text.includes('known-fact.txt')} hasSaturn=${text.includes('Saturn has rings.')}`
						)

						if (text.includes('intent.start')) {
							state.phase = 'await-create-result'
							return {
								state: {
									intentId,
									title: 'Create then analyze a random file',
									goal: 'Create a random file, analyze that exact file, then analyze a known verification file',
									status: 'active',
									summary: 'Creating a random file before analysis begins',
									pendingSkillCalls: {
										'call-random-file-create': {
											callId: 'call-random-file-create',
											skillId: 'file-creator',
											request: 'Create a random file inside the workspace',
											createdAt: '2026-05-12T00:00:00.000Z'
										}
									}
								},
								actions: [
									{
										type: 'reply_user',
										message: 'I created the file workflow intent and I am creating the random file now.'
									},
									{
										type: 'call_skill',
										skillId: 'file-creator',
										callId: 'call-random-file-create',
										request: 'Create a random file inside the workspace',
										payload: {
											directory: 'generated',
											content: 'This random file was generated during the web-api e2e test.'
										}
									}
								]
							}
						}

						if (text.includes('skill.result') && state.phase === 'await-create-result') {
							state.phase = 'await-random-analysis-result'
							expect(state.randomFilePath).not.toBeNull()
							expect(text).toContain('file-creator')
							expect(text).toContain(state.randomFilePath as string)
							expect(text).toContain('Available skills (id + description only):')
							return {
								state: {
									intentId,
									title: 'Create then analyze a random file',
									goal: 'Create a random file, analyze that exact file, then analyze a known verification file',
									status: 'active',
									summary: 'Analyzing the exact random file that was created',
									pendingSkillCalls: {
										'call-random-file-analyze': {
											callId: 'call-random-file-analyze',
											skillId: 'file-analyzer',
											request: 'Analyze the exact file that was just created',
											createdAt: '2026-05-12T00:00:00.000Z'
										}
									}
								},
								actions: [
									{
										type: 'call_skill',
										skillId: 'file-analyzer',
										callId: 'call-random-file-analyze',
										request: 'Analyze the exact file that was just created',
										payload: {
											analyzePath: state.randomFilePath,
											extract: 'exactly one fact'
										}
									}
								]
							}
						}

						if (text.includes('skill.result') && state.phase === 'await-known-file-result') {
							state.phase = 'completed'
							expect(text).toContain('call-known-file-analyze')
							return {
								state: {
									intentId,
									title: 'Create then analyze a random file',
									goal: 'Create a random file, analyze that exact file, then analyze a known verification file',
									status: 'completed',
									summary: 'Random file created and analyzed, then known fact verified',
									pendingSkillCalls: {}
								},
								actions: [
									{
										type: 'complete',
										summary: 'Random file created and analyzed, then known fact verified',
										message:
											'Done: I created a random file, analyzed that exact file, and extracted one fact from the known verification file.'
									}
								]
							}
						}

						if (text.includes('skill.result') && state.phase === 'await-random-analysis-result') {
							state.phase = 'await-known-file-result'
							expect(text).toContain(state.randomFilePath as string)
							return {
								state: {
									intentId,
									title: 'Create then analyze a random file',
									goal: 'Create a random file, analyze that exact file, then analyze a known verification file',
									status: 'active',
									summary: 'Analyzing the known verification file for one exact fact',
									pendingSkillCalls: {
										'call-known-file-analyze': {
											callId: 'call-known-file-analyze',
											skillId: 'file-analyzer',
											request: 'Analyze the known verification file and extract exactly one fact',
											createdAt: '2026-05-12T00:00:00.000Z'
										}
									}
								},
								actions: [
									{
										type: 'call_skill',
										skillId: 'file-analyzer',
										callId: 'call-known-file-analyze',
										request: 'Analyze the known verification file and extract exactly one fact',
										payload: {
											analyzePath: path.relative(workspaceRoot, state.knownFilePath).split(path.sep).join('/'),
											extract: 'exactly one fact'
										}
									}
								]
							}
						}

					}

					if (role === 'jaensen-skill-supervisor') {
						const skillId = name.slice('actor/skill/'.length)
						if (text.includes('skill.bootstrap')) {
							return {
								state: {
									skillId,
									workers: {}
								}
							}
						}

						if (text.includes('skill.request')) {
							const workerId =
								skillId === 'file-creator'
									? 'random-file'
									: text.includes('call-known-file-analyze')
										? 'known-file'
										: 'created-file'
							const request =
								skillId === 'file-creator'
									? 'Create a random file inside the workspace'
									: text.includes('call-known-file-analyze')
										? 'Analyze the known verification file and extract exactly one fact'
										: 'Analyze the exact file that was just created'
							const callId =
								skillId === 'file-creator'
									? 'call-random-file-create'
									: text.includes('call-known-file-analyze')
										? 'call-known-file-analyze'
										: 'call-random-file-analyze'
							return {
								state: {
									skillId,
									workers: {
										[workerId]: {
											status: 'running',
											intentActorId: `intent/${state.createdIntentId}`
										}
									}
								},
								actions: [
									{
										type: 'spawn_worker',
										workerId,
										messageType: `${skillId}.run`,
										initialState: { attempts: 0 },
										payload: {
											intentId: state.createdIntentId,
											callId,
											request,
											...(skillId === 'file-analyzer'
												? {
													analyzePath: text.includes('call-known-file-analyze')
														? path.relative(workspaceRoot, state.knownFilePath).split(path.sep).join('/')
														: state.randomFilePath
												}
												: {})
										}
									}
								]
							}
						}

						if (text.includes('skill.worker.result')) {
							const workerId =
								skillId === 'file-creator'
									? 'random-file'
									: text.includes('call-known-file-analyze')
										? 'known-file'
										: 'created-file'
							const outgoingResult =
								skillId === 'file-creator'
									? {
										path: state.randomFilePath,
										fact: 'generated marker present'
									}
									: text.includes('call-known-file-analyze')
										? {
											path: path.relative(workspaceRoot, state.knownFilePath).split(path.sep).join('/'),
											fact: 'Saturn has rings.'
										}
										: {
											path: state.randomFilePath,
											fact: 'This random file was generated during the web-api e2e test.'
										}
							return {
								state: {
									skillId,
									workers: {
										[workerId]: {
											status: 'completed',
											intentActorId: `intent/${state.createdIntentId}`
										}
									}
								},
								actions: [
									{
										type: 'send',
										to: `intent/${state.createdIntentId}`,
										messageType: 'skill.result',
										payload: {
											intentId: state.createdIntentId,
											callId:
												skillId === 'file-creator'
													? 'call-random-file-create'
													: text.includes('call-known-file-analyze')
														? 'call-known-file-analyze'
														: 'call-random-file-analyze',
											result: outgoingResult
										}
									}
								]
							}
						}
					}

					if (role === 'jaensen-skill-worker') {
						const [, , skillId, workerId] = name.split('/')

						if (skillId === 'file-creator') {
							const randomSlug = 'random-7f3a'
							const relativePath = `generated/${randomSlug}.txt`
							const absolutePath = path.join(workspaceRoot, relativePath)
							await mkdir(path.dirname(absolutePath), { recursive: true })
							await writeFile(
								absolutePath,
								'This random file was generated during the web-api e2e test.\nExact fact: generated marker present.\n'
							)
							state.randomFilePath = relativePath
							return {
								state: { drafted: true, relativePath },
								result: {
									path: relativePath,
									fact: 'generated marker present'
								},
								completed: true
							}
						}

						if (skillId === 'file-analyzer') {
							const targetPath = extractPromptField(text, 'analyzePath')
							if (!targetPath) {
								throw new Error('expected analyzePath in file-analyzer worker prompt')
							}

							const normalizedTargetPath = targetPath.split(path.sep).join('/')
							if (workerId === 'created-file' && normalizedTargetPath !== state.randomFilePath) {
								throw new Error(`expected created-file analyzer to inspect ${state.randomFilePath}, received ${normalizedTargetPath}`)
							}

							if (
								workerId === 'known-file' &&
								normalizedTargetPath !== path.relative(workspaceRoot, state.knownFilePath).split(path.sep).join('/')
							) {
								throw new Error(`expected known-file analyzer to inspect the verification file, received ${normalizedTargetPath}`)
							}

							const content = await readFile(path.join(workspaceRoot, normalizedTargetPath), 'utf8')
							const fact = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? 'No fact found.'
							return {
								state: { analyzedPath: normalizedTargetPath },
								result: {
									path: normalizedTargetPath,
									fact
								},
								completed: true
							}
						}

						throw new Error(`Unexpected worker skill ${skillId}`)
					}

					throw new Error(`Unexpected prompt role ${String(role)}`)
				},
				async task() {
					throw new Error('unexpected task call in durable worker scenario')
				}
			}
		}
	}
}

function createAskUserEventOnlyHarness() {
	return {
		async session(name: string, options?: { role?: string }) {
			return {
				async prompt(text: string, input: { role?: string }) {
					const role = input.role ?? options?.role
					debugLog(`[${role ?? 'unknown-role'}] ${name}`)

					if (role === 'jaensen-conversation-dispatcher') {
						return {
							type: 'create_intent',
							title: 'Ask for next task',
							initialGoal: 'Ask the user what they want to work on next',
							reason: 'The user explicitly asked to be prompted for their next task'
						}
					}

					if (role === 'jaensen-conversation-intent') {
						const intentId = name.slice('actor/intent/'.length)
						if (text.includes('intent.start')) {
							return {
								state: {
									intentId,
									title: 'Ask for next task',
									goal: 'Ask the user what they want to work on next',
									status: 'active',
									summary: 'Awaiting user input for next task selection.',
									pendingSkillCalls: {}
								},
								events: [
									{
										eventType: 'event',
										event: {
											type: 'ask.user',
											correlationId: 'test-correlation-id',
											payload: {
												question: 'What task would you like to work on next?',
												context: null,
												options: []
											}
										}
									}
								]
							}
						}
					}

					if (role === 'jaensen-skill-supervisor' || role === 'jaensen-skill-worker') {
						throw new Error(`Unexpected ${String(role)} prompt in ask-user reproduction test`)
					}

					throw new Error(`Unexpected prompt role ${String(role)}`)
				},
				async task() {
					throw new Error('unexpected task')
				}
			}
		}
	}
}

function debugLog(message: string): void {
	console.log(`[web-api.e2e] ${message}`)
}

function extractPromptField(prompt: string, fieldName: string): string | null {
	const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const pattern = new RegExp(`"${escapedFieldName}"\\s*:\\s*"([^"]+)"`)
	const match = prompt.match(pattern)
	return match?.[1] ?? null
}

async function driveIntentToStatus(
	api: Awaited<ReturnType<typeof createWebApi>>,
	intentId: string,
	status: IntentSummary['status'],
	maxPasses = 20
): Promise<IntentSummary> {
	for (let index = 0; index < maxPasses; index += 1) {
		await api.app.runUntilIdle(50)
		const response = await fetch(`${api.url}api/intents/${intentId}`)
		if (!response.ok) {
			continue
		}
		const body = (await response.json()) as IntentSummary
		if (body.status === status) {
			return body
		}
	}

	throw new Error(`Intent ${intentId} did not reach status ${String(status)} after ${maxPasses} passes`)
}

async function waitForIntentByTitle(apiUrl: string, title: string, timeoutMs = 3_000): Promise<IntentSummary> {
	return waitFor(async () => {
		const response = await fetch(`${apiUrl}api/intents`)
		const body = (await response.json()) as { intents: IntentSummary[] }
		return body.intents.find((intent) => intent.title === title) ?? null
	}, timeoutMs)
}

async function waitForIntentStatus(
	apiUrl: string,
	intentId: string,
	status: IntentSummary['status'],
	timeoutMs = 3_000
): Promise<IntentSummary> {
	return waitFor(async () => {
		const response = await fetch(`${apiUrl}api/intents/${intentId}`)
		if (!response.ok) {
			return null
		}
		const body = (await response.json()) as IntentSummary
		return body.status === status ? body : null
	}, timeoutMs)
}

async function waitFor<T>(callback: () => Promise<T | null>, timeoutMs = 2_000): Promise<T> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const value = await callback()
		if (value !== null) {
			return value
		}
		await new Promise((resolve) => setTimeout(resolve, 25))
	}
	throw new Error('Timed out waiting for condition')
}

type IntentSummary = {
	id: string
	title: string | null
	summary: string | null
	status: 'active' | 'waiting_for_user' | 'completed' | 'failed' | null
}