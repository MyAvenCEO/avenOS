/** Real Qwen + PostgreSQL + production Store + durable Studio runner. No model substitutes. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'
import { discoverIntentAttachments } from '../../app/src/lib/intents/persistent-artifact-projection'
import {
	newStudioSkillV2,
	type PlanRunSecurityContext,
	type StudioCatalogEntry,
	type StudioSkillPort,
	type StudioSkillV2,
	StudioSkillV2Error,
	TrustedActorInstallations
} from '../../libs/aven-actors/src'
import { ArtifactStoreClient } from '../../libs/aven-artifact-store/src'
import { HttpLlmGatewayClient } from '../../libs/aven-llm-client/src/http'
import {
	createCalculationRuntimeFactory,
	installCalculationRuntimeActor
} from '../../services/actor-runner/src/calculation-runtime'
import { createDocumentCatalogSource } from '../../services/actor-runner/src/document-catalog'
import {
	createDocumentRuntimeFactories,
	installDocumentRuntimeActors
} from '../../services/actor-runner/src/document-runtime'
import {
	installedAuthorizer,
	installedRegistry
} from '../../services/actor-runner/src/installed-runtime'
import {
	createIntentArtifactRuntimeFactory,
	installIntentArtifactRuntimeActor
} from '../../services/actor-runner/src/intent-artifact-runtime'
import {
	createKnowledgeRuntimeFactory,
	installKnowledgeRuntimeActor
} from '../../services/actor-runner/src/knowledge-runtime'
import {
	createLlmRuntimeFactory,
	installLlmRuntimeActor
} from '../../services/actor-runner/src/llm-runtime'
import {
	createMarkdownRuntimeFactory,
	installMarkdownRuntimeActor
} from '../../services/actor-runner/src/markdown-runtime'
import { SqlPlanRunner } from '../../services/actor-runner/src/sql-runner'
import { StudioArtifacts } from '../../services/actor-runner/src/studio-artifacts'
import { StudioService } from '../../services/actor-runner/src/studio-service'
import { createStudioV2Executor } from '../../services/actor-runner/src/studio-v2-executor'
import { loadCatalog } from '../../services/platform-provisioner/src/catalog'
import { liveCalculationScenarios } from './live-calculation-scenarios'
import { liveCsvMappingScenarios } from './live-csv-mapping-scenarios'
import { liveIntakeScenarios } from './live-intake-scenarios'
import { liveKnowledgeScenarios } from './live-knowledge-scenarios'
import { livePagePreview } from './live-page-preview'

const id = randomUUID().replaceAll('-', '')
const container = 'aven-llm-proof-' + id.slice(0, 12)
const scope = randomUUID(),
	subject = randomUUID()
const directory = '/tmp/aven-live-llm-skills/' + new Date().toISOString().replaceAll(':', '-')
await mkdir(directory, { recursive: true })
const evidence: Record<string, any> = {
	synthetic: true,
	scope,
	scenarios: [],
	startedAt: new Date().toISOString()
}
function command(args: string[], env?: Record<string, string>) {
	const result = Bun.spawnSync(args, {
		env: { ...process.env, ...env },
		stdout: 'pipe',
		stderr: 'pipe'
	})
	assert.equal(result.exitCode, 0, `${args[0]} ${args[1]} failed: ${result.stderr.toString()}`)
	return result.stdout.toString().trim()
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let server: ReturnType<typeof Bun.spawn> | undefined,
	pool: pg.Pool | undefined,
	runner: SqlPlanRunner | undefined
try {
	const runtime = JSON.parse(command(['docker', 'inspect', 'aven-local-actor-runner-1']))[0]
	const local = Object.fromEntries(
		runtime.Config.Env.map((s: string) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)])
	)
	assert(local.LLM_GATEWAY_BEARER_TOKEN, 'The local Qwen gateway must be configured')
	const gateway = new HttpLlmGatewayClient({
		baseUrl: 'http://localhost:13000/internal/v1/llm',
		bearerToken: local.LLM_GATEWAY_BEARER_TOKEN
	})
	const models = await gateway.discover(['text-generation', 'structured-output'])
	const model = models.find((m) => /qwen/i.test(m.id + m.label))
	assert(model, 'A real Qwen model with structured output is required')
	evidence.model = model.id
	const apiRuntime = JSON.parse(command(['docker', 'inspect', 'aven-local-api-1']))[0]
	const catalogSetting = apiRuntime.Config.Env.find((s: string) =>
		s.startsWith('LLM_GATEWAY_MODELS_JSON=')
	)
	const upstream = JSON.parse(catalogSetting.slice(catalogSetting.indexOf('=') + 1)).find(
		(m: any) => m.id === model.id
	)
	assert(
		upstream && /qwen/i.test(upstream.upstreamModel),
		'The selected gateway alias must actually route to Qwen'
	)
	evidence.upstreamModel = upstream.upstreamModel
	const password = randomUUID()
	command([
		'docker',
		'run',
		'--detach',
		'--rm',
		'--name',
		container,
		'-e',
		`POSTGRES_PASSWORD=${password}`,
		'-p',
		'127.0.0.1::5432',
		'aven-e2e-database:local'
	])
	const port = command(['docker', 'port', container, '5432/tcp']).split(':').at(-1)
	const database = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`
	pool = new pg.Pool({ connectionString: database, max: 8 })
	for (let i = 0; ; i++) {
		try {
			await pool.query('SELECT 1')
			break
		} catch (e) {
			if (i >= 60) throw e
			await sleep(250)
		}
	}
	await pool.query('CREATE SCHEMA artifact_store; CREATE SCHEMA aven_actor_runs')
	const listener = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
	const storePort = listener.port!
	listener.stop(true)
	const token = randomUUID() + randomUUID()
	const environment = {
		ARTIFACT_STORE_DATABASE_URL: database,
		ARTIFACT_STORE_SCOPE_ID: scope,
		ARTIFACT_STORE_BEARER_TOKEN: token,
		ARTIFACT_STORE_PUBLISHER_ISSUER: 'os.aven',
		ARTIFACT_STORE_PUBLISHER_SUBJECT: 'service:actor-runner',
		ARTIFACT_STORE_LISTEN: `127.0.0.1:${storePort}`
	}
	command(['./target/rust/debug/aven-artifact-store', 'migrate'], environment)
	server = Bun.spawn(['./target/rust/debug/aven-artifact-store', 'serve'], {
		env: { ...process.env, ...environment },
		stdout: 'ignore',
		stderr: 'inherit'
	})
	const client = new ArtifactStoreClient({
		baseUrl: `http://127.0.0.1:${storePort}`,
		bearerToken: () => token
	})
	for (let i = 0; ; i++) {
		try {
			await client.context()
			break
		} catch (e) {
			if (server.exitCode !== null || i >= 300) throw e
			await sleep(100)
		}
	}
	const artifacts = new StudioArtifacts(client, scope)
	if (process.argv.includes('--calculations')) {
		try {
			await client.type('values.calculation', 2)
		} catch {
			throw Error(
				'Rebuild the Artifact Store executable before this journey: values.calculation@2 is required.'
			)
		}
	}
	if (process.argv.includes('--intake'))
		await liveIntakeScenarios({
			environment,
			client,
			scope,
			subject,
			evidence,
			pool
		})
	// Use the pinned production migration inventory, not a stale copied list.
	const previousCwd = process.cwd()
	let componentCatalog: Awaited<ReturnType<typeof loadCatalog>>
	try {
		process.chdir(resolve(import.meta.dir, '../../services/platform-provisioner'))
		componentCatalog = await loadCatalog()
	} finally {
		process.chdir(previousCwd)
	}
	for (const migration of componentCatalog.get('os.aven:component:actors:run-repository@1')!
		.migrations)
		await pool.query(migration.sql)
	await pool.query('SET search_path=aven_actor_runs,pg_catalog')
	// Use a dedicated pool so every connection has the same schema, including runner recovery.
	await pool.end()
	pool = new pg.Pool({
		connectionString: database,
		options: '-c search_path=aven_actor_runs,pg_catalog',
		max: 8
	})
	const installations = new TrustedActorInstallations()
	await installLlmRuntimeActor(installations)
	await installCalculationRuntimeActor(installations)
	await installKnowledgeRuntimeActor(installations)
	await installMarkdownRuntimeActor(installations)
	await installIntentArtifactRuntimeActor(installations)
	if (process.argv.includes('--csv-mapping')) await installDocumentRuntimeActors(installations)
	let completions = 0
	const countedGateway = {
		discover: gateway.discover.bind(gateway),
		complete: async (...args: Parameters<typeof gateway.complete>) => {
			completions++
			const result = await gateway.complete(...args)
			evidence.receipts ??= []
			evidence.receipts.push(result.receipt)
			evidence.modelOutputs ??= []
			evidence.modelOutputs.push(result.output)
			return result
		}
	}
	const factories = [
		...(process.argv.includes('--csv-mapping') ? createDocumentRuntimeFactories(artifacts) : []),
		createCalculationRuntimeFactory(artifacts),
		createKnowledgeRuntimeFactory(artifacts),
		createLlmRuntimeFactory(artifacts, countedGateway, model.id),
		createMarkdownRuntimeFactory(artifacts),
		createIntentArtifactRuntimeFactory(artifacts)
	]
	const offers = factories.map((f) => f.offer)
	const registry = installedRegistry(installations, offers)
	runner = new SqlPlanRunner(
		pool,
		pool,
		createStudioV2Executor(artifacts, {
			registryFor: () => registry.snapshot(),
			authorizerFor: () => installedAuthorizer(scope, installations),
			factoriesFor: () => ({ resolve: (id) => factories.find((f) => f.offer.factoryId === id) }),
			installations
		})
	)
	const service = new StudioService(
		pool,
		artifacts,
		runner,
		createDocumentCatalogSource(scope, installations, offers),
		installations
	)
	const security: PlanRunSecurityContext = {
		principal: { subjectId: subject, kind: 'user', assurance: ['passkey'] },
		access: { tenantId: scope },
		establishedBy: 'isolated-live-proof',
		authorizedAt: new Date().toISOString()
	}
	const call = (operation: string, data: Record<string, unknown> = {}): Promise<any> =>
		service.call({ operation, data }, security, {})
	const catalog = await call('catalog', { limit: 100 })
	evidence.catalog = catalog.entries.filter((e: StudioCatalogEntry) =>
		/:(llm|markdown|intent-documents)@/.test(e.actorId)
	)
	const operation = (actor: string, method: string): StudioCatalogEntry => {
		const e = catalog.entries.find(
			(e: StudioCatalogEntry) =>
				e.actorId.includes(`:${actor}@`) && e.capabilityId.includes(`:${method}@`)
		)
		assert(e?.canAuthor && e.canPlan, JSON.stringify(e ?? { missing: actor, method }))
		assert.equal(e.invocationStatus, 'not-evaluated')
		return e
	}
	const llm = operation('llm', 'llm_complete'),
		markdown = operation('markdown', 'write'),
		attach = operation('intent-documents', 'attach')
	const asPort = (p: any): StudioSkillPort => ({
		schema: p.schema,
		type: p.type,
		predicate: p.predicate,
		role: p.role,
		cardinality: p.cardinality
	})
	const file = asPort(attach.inputs[0]),
		completion = asPort(llm.outputs[0]),
		document = asPort(markdown.outputs[0]),
		attachment = asPort(attach.outputs[0])
	const publish = async (definition: StudioSkillV2) => {
		const d = await call('draft', { id: randomUUID(), revision: 0, definition })
		return (await call('publish', { id: d.id, revision: d.revision })).artifact
	}
	if (process.argv.includes('--csv-mapping'))
		await liveCsvMappingScenarios({
			call,
			artifacts,
			runner,
			subject,
			publish,
			operation,
			evidence,
			gateway: countedGateway,
			modelId: model.id,
			environment
		})
	if (process.argv.includes('--calculations')) {
		await liveCalculationScenarios({
			call,
			artifacts,
			runner,
			publish,
			operation,
			evidence,
			subject
		})
	}
	if (process.argv.includes('--knowledge'))
		await liveKnowledgeScenarios({
			artifacts,
			subject,
			evidence,
			call,
			gateway: countedGateway,
			modelId: model.id
		})
	if (process.argv.includes('--focused')) {
		if (process.argv.includes('--page-preview'))
			await livePagePreview({
				artifacts,
				subject,
				gateway: countedGateway,
				modelId: model.id,
				evidence,
				directory
			})
		assert(
			process.argv.some((arg) =>
				['--csv-mapping', '--calculations', '--knowledge', '--page-preview'].includes(arg)
			),
			'--focused needs a selected feature suite'
		)
		evidence.baseTravelScenariosSkipped = true
	} else {
		const literal = (value: unknown) => ({ kind: 'literal' as const, value })
		const schema = {
			type: 'object',
			additionalProperties: false,
			maxProperties: 5,
			properties: {
				destination: { type: 'string', maxLength: 100 },
				date: { type: 'string', maxLength: 20 },
				eligible: { type: 'boolean' },
				reason: { type: 'string', maxLength: 200 },
				markdown: { type: 'string', maxLength: 3000 }
			},
			required: ['destination', 'date', 'eligible', 'reason', 'markdown']
		}
		const extract: StudioSkillV2 = {
			...newStudioSkillV2('Read a travel case'),
			inputs: { source: file },
			steps: [
				{
					id: 'extract',
					label: 'Identify destination and date',
					kind: 'invoke',
					capabilityId: llm.capabilityId,
					inputs: {
						files: { kind: 'input', port: 'source' },
						sources: { kind: 'none' },
						context: { kind: 'none' }
					},
					parameters: {
						question: literal(
							'Extract the actual arrival destination and travel date, never billing address, departure or issuance date. eligible only when destination and travel date are unambiguous and destination is neither Paris nor Madrid. If missing or conflicting, eligible=false; leave missing values empty. markdown is a short German summary of these source facts; no invented facts.'
						),
						response_schema: literal(JSON.stringify(schema)),
						knowledge_mode: literal('source-only')
					},
					outputs: { completion }
				}
			],
			outputs: {
				completion: { ...completion, from: { kind: 'step', stepId: 'extract', port: 'completion' } }
			}
		}
		extract.policy.allowModel = true
		const child = await publish(extract)
		assert(child.artifactId)
		const definition: StudioSkillV2 = {
			...newStudioSkillV2('Travel dossier in its original Intent'),
			inputs: { source: file },
			steps: [
				{
					kind: 'skill',
					id: 'facts',
					label: 'Read the real case',
					skillArtifactId: child.artifactId,
					skillVersion: 2,
					inputs: { source: { kind: 'input', port: 'source' } },
					parameters: {},
					outputs: { completion }
				},
				{
					kind: 'when',
					id: 'eligible',
					label: 'Only clear destinations outside Paris and Madrid',
					condition: {
						kind: 'observation',
						from: { kind: 'step', stepId: 'facts', port: 'completion' },
						path: '/data/eligible',
						equals: true,
						caseId: 'yes'
					},
					branches: {
						yes: {
							steps: [
								{
									kind: 'invoke',
									id: 'dossier',
									label: 'Draft a model-knowledge dossier',
									capabilityId: llm.capabilityId,
									inputs: {
										context: { kind: 'step', stepId: 'facts', port: 'completion' },
										files: { kind: 'none' },
										sources: { kind: 'none' }
									},
									parameters: {
										question: literal(
											'Write a concise German Markdown place dossier for this destination: brief orientation and two activity ideas. Label source travel facts separately from unverified general model knowledge. No live event, weather or opening-hours claims. Do not create tasks. Under 500 words.'
										),
										knowledge_mode: literal('model-knowledge')
									},
									outputs: { completion }
								},
								{
									kind: 'invoke',
									id: 'save',
									label: 'Save the dossier',
									capabilityId: markdown.capabilityId,
									inputs: { source: { kind: 'step', stepId: 'dossier', port: 'completion' } },
									parameters: {
										title: literal('Travel dossier'),
										content: { kind: 'input-field', port: 'source', path: '/text' }
									},
									outputs: { document }
								},
								{
									kind: 'invoke',
									id: 'attach',
									label: 'Return it to its Intent',
									capabilityId: attach.capabilityId,
									inputs: {
										source: { kind: 'input', port: 'source' },
										document: { kind: 'step', stepId: 'save', port: 'document' }
									},
									parameters: {},
									outputs: { attachment }
								}
							],
							outputs: { attachment: { kind: 'step', stepId: 'attach', port: 'attachment' } }
						},
						otherwise: { steps: [], outputs: { attachment: { kind: 'none' } } }
					},
					outputs: { attachment: { ...attachment, cardinality: 'optional' } }
				}
			],
			outputs: {
				attachment: {
					...attachment,
					cardinality: 'optional',
					from: { kind: 'step', stepId: 'eligible', port: 'attachment' }
				}
			}
		}
		definition.policy.allowModel = true
		const skill = await publish(definition)
		evidence.skillId = skill.artifactId
		for (const scenario of [
			{
				label: 'Madrid departure, Helsinki arrival; issuance is not travel',
				source:
					'FICTIONAL TEST. Issued in Paris on 2026-01-04. Depart Madrid/MAD 2026-10-22, arrive Helsinki/HEL 2026-10-22. Billing address Madrid.',
				eligible: true,
				destination: /Helsinki/i
			},
			{
				label: 'Paris destination excluded',
				source: 'FICTIONAL TEST. Depart Helsinki on 2026-10-23, arrive Paris/CDG 2026-10-23.',
				eligible: false
			},
			{
				label: 'Madrid destination excluded',
				source: 'FICTIONAL TEST. Depart Vienna on 2026-10-23, arrive Madrid/MAD 2026-10-23.',
				eligible: false
			},
			{
				label: 'Missing travel date must not use invoice date',
				source:
					'FICTIONAL TEST. Invoice issued 2026-09-18. Proposed trip to Lisbon. Travel date has not been agreed.',
				eligible: false
			}
		]) {
			const intentId = randomUUID()
			const source = (
				await artifacts.publish({
					id: randomUUID(),
					procedure: 'test.travel-input',
					principal: subject,
					inputs: [],
					parameters: {},
					artifacts: [
						{
							key: 'file',
							type: 'core.file',
							payload: {
								originalName: 'fictional-travel.txt',
								declaredMediaType: 'text/plain',
								sourceKind: 'test'
							},
							bytes: new TextEncoder().encode(scenario.source),
							mediaType: 'text/plain'
						},
						{
							key: 'intent',
							type: 'intent.declaration',
							payload: {
								intentId,
								title: 'Fictional travel',
								triggerKind: 'file-upload',
								observedAt: new Date().toISOString()
							}
						}
					]
				})
			)[0]!
			const request = {
				requestId: randomUUID(),
				skillArtifactId: skill.artifactId,
				inputs: { source: source.artifactId },
				parameters: {}
			}
			const handle = await call('start', request)
			let run: any
			const deadline = Date.now() + 240000
			while (Date.now() < deadline) {
				run = await runner.status(handle.runId)
				if (['failed', 'succeeded'].includes(run?.state)) break
				await sleep(300)
			}
			assert.equal(run?.state, 'succeeded', JSON.stringify(run))
			const output = run.checkpoints.at(-1).output
			const ids = output.outputs.attachment
			assert.equal(ids.length, scenario.eligible ? 1 : 0, scenario.label)
			const beforeReplay = completions
			assert.equal((await call('start', request)).runId, handle.runId)
			assert.equal(completions, beforeReplay, 'Replay must not call the model again')
			if (scenario.eligible) {
				const disabled = structuredClone(extract)
				disabled.policy.allowModel = false
				await assert.rejects(
					publish(disabled),
					(error: unknown) =>
						error instanceof StudioSkillV2Error &&
						error.issues.some((issue) => issue.code === 'MODEL_POLICY_REQUIRED')
				)
				assert.equal(
					completions,
					beforeReplay,
					'Disabled model policy must prevent gateway invocation'
				)
				evidence.modelPolicyBlocked = true
				evidence.modelPolicyBlockedAt = 'publication'
			}
			const record: any = {
				label: scenario.label,
				runId: handle.runId,
				intentId,
				eligible: scenario.eligible,
				replayWithoutModel: true
			}
			if (ids.length) {
				const link = await artifacts.get(ids[0])
				assert.equal(link.payload.intentId, intentId)
				const saved = await artifacts.get(String(link.payload.documentArtifactId))
				const text = new TextDecoder().decode(await client.content(scope, saved.artifactId))
				assert.match(text, scenario.destination!)
				assert.match(
					text,
					/Modell|allgemein|nicht.*verifiz|Wissen|unverified general model knowledge/i
				)
				const lineage: any = await client.producerInputs(scope, saved.artifactId)
				assert(lineage.inputs.some((i: any) => i.role === 'source'))
				const generated = await artifacts.get(
					lineage.inputs.find((i: any) => i.role === 'source').artifactId
				)
				assert.equal(generated.typeKey, 'ai.completion')
				assert.equal(generated.payload.text, text)
				const projected = await discoverIntentAttachments(
					[
						{
							artifactId: link.artifactId,
							typeKey: link.typeKey,
							localKey: 'attachment',
							publicationId: link.publicationId,
							scopeSequence: link.scopeSequence,
							publicationOrdinal: 0
						}
					],
					(id) => artifacts.get(id)
				)
				assert.deepEqual(projected, [
					{ intentId, artifactId: saved.artifactId, title: 'Travel dossier.md' }
				])
				record.documentId = saved.artifactId
				record.markdown = text
				record.lineage = lineage
				record.projection = projected
			}
			evidence.scenarios.push(record)
			console.log('PASS', scenario.label)
		}
	}
	evidence.modelCalls = completions
	evidence.passed = true
} catch (error) {
	evidence.passed = false
	evidence.error = String(error)
	throw error
} finally {
	evidence.finishedAt = new Date().toISOString()
	await Bun.write(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
	await runner?.close()
	await pool?.end()
	server?.kill()
	if (server) await server.exited
	Bun.spawnSync(['docker', 'rm', '--force', container], { stdout: 'ignore', stderr: 'ignore' })
	console.log('Evidence:', directory + '/evidence.json')
}
