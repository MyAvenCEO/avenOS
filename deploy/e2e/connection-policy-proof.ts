/** Policy composition proof on the management fixture's exclusively synthetic DB.
 * Uses actual admission, review SQL, HTTP boundaries and Store; no protocol I/O.
 * Called only after the accompanying management journey used the real Qwen model. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import pg from 'pg'
import {
	ACTOR_RUN_PROTOCOL,
	Actor,
	ActorRegistry,
	authorizeRegistryForPlanning,
	definitionFromManifest,
	invokeActorCapability,
	type PlanRunExecutor,
	resourceId
} from '../../libs/aven-actors/src'
import { credentialUseVerifier } from '../../libs/aven-credential-storage/src/authority'
import { customerComponentCatalog } from '../../libs/aven-customer-contracts/src'
import { parseHttpRequestArtifact } from '../../libs/aven-http-resources/src/contracts'
import {
	AdmittedInvocations,
	admittedInvocationId
} from '../../services/actor-runner/src/admitted-invocations'
import { stablePublicationUuid } from '../../services/actor-runner/src/artifact-store-port'
import { createActorRunnerHandler } from '../../services/actor-runner/src/handler'
import { installedFactory } from '../../services/actor-runner/src/installed-runtime'
import { createInvocationGuardHandler } from '../../services/actor-runner/src/invocation-guard-handler'
import {
	ReviewStore,
	requestRunReview,
	reviewContinuation,
	WaitingForReview
} from '../../services/actor-runner/src/reviews'
import { SqlPlanRunner } from '../../services/actor-runner/src/sql-runner'
import { createConnectionPolicyHandler } from '../../services/aven-api/src/connections/handler'
import type { ConnectionPolicyConfig } from '../../services/aven-api/src/connections/policy'
import { connectionPolicyPorts } from '../../services/aven-api/src/connections/ports'
import { loadCatalog } from '../../services/platform-provisioner/src/catalog'
import { grantRuntimeAccess } from '../../services/platform-provisioner/src/runtime-grants'
import { connectionArtifactFixture } from './connection-artifact-fixture'
import type { credentialManagementFixture } from './credential-management-fixture'

export interface ConnectionPolicyHarness {
	artifacts: Awaited<ReturnType<typeof connectionArtifactFixture>>
	admissions: AdmittedInvocations
	api: pg.Pool
	worker: pg.Pool
	policyUrl: string
	runnerToken: string
	executorToken: string
	keys: CryptoKeyPair
	startRunner(execute: PlanRunExecutor): SqlPlanRunner
	actorCall(path: string, body?: unknown): Promise<Response>
}

export async function proveConnectionPolicies(
	f: Awaited<ReturnType<typeof credentialManagementFixture>>,
	bindings: { http: string; imap: string },
	options?: {
		policy: ConnectionPolicyConfig
		exercise: (harness: ConnectionPolicyHarness) => Promise<string>
	}
) {
	const originalCwd = process.cwd()
	let entry: Awaited<ReturnType<typeof loadCatalog>> extends Map<string, infer V> ? V : never
	try {
		process.chdir(resolve(import.meta.dir, '../../services/platform-provisioner'))
		entry = (await loadCatalog()).get('os.aven:component:actors:run-repository@1')!
	} finally {
		process.chdir(originalCwd)
	}
	const roles = ['owner', 'api', 'worker'].map(
		(kind) => `connection_${kind}_${randomUUID().replaceAll('-', '')}`
	)
	let api: pg.Pool | undefined, worker: pg.Pool | undefined, runner: SqlPlanRunner | undefined
	let artifacts: Awaited<ReturnType<typeof connectionArtifactFixture>> | undefined
	const servers: Array<ReturnType<typeof Bun.serve>> = []
	const scope = { environmentId: f.environmentId, subjectId: f.subjectId, generation: 1 }
	const runnerToken = randomUUID() + randomUUID(),
		executorToken = randomUUID() + randomUUID(),
		serviceToken = randomUUID() + randomUUID()
	const issuer = f.policyIssuer
	let allowed = 0,
		latestAuthority = '',
		latestProtocol: 'http' | 'imap' = 'http'
	try {
		await f.root.query(`CREATE ROLE ${roles[0]} NOLOGIN; CREATE SCHEMA aven_actor_runs AUTHORIZATION ${roles[0]};
		 GRANT USAGE ON SCHEMA aven_platform TO ${roles[0]}; GRANT SELECT,UPDATE(execution_unsettled) ON aven_platform.environment_identity TO ${roles[0]}`)
		const owner = await f.root.connect()
		try {
			await owner.query(`SET ROLE ${roles[0]}`)
			for (const migration of entry.migrations) await owner.query(migration.sql)
		} finally {
			await owner.query('RESET ROLE')
			owner.release()
		}
		for (const [index, kind] of ['api', 'worker'].entries()) {
			const role = roles[index + 1]!,
				password = randomUUID()
			await f.root.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'; GRANT USAGE ON SCHEMA aven_actor_runs,aven_platform TO ${role};
			 GRANT SELECT ON aven_platform.environment_identity TO ${role}`)
			await grantRuntimeAccess(
				f.root,
				'aven_actor_runs',
				role,
				entry.grants[`os.aven:db-role:actors:${kind}@1`]!
			)
			if (kind === 'worker')
				await f.root.query(
					`GRANT UPDATE(execution_unsettled) ON aven_platform.environment_identity TO ${role}`
				)
			const login = new URL(f.database.databaseUrl)
			login.username = role
			login.password = password
			const pool = new pg.Pool({
				connectionString: login.toString(),
				options: '-c search_path=aven_actor_runs,pg_catalog'
			})
			if (kind === 'api') api = pool
			else worker = pool
		}
		for (const ref of [
			'os.aven:component:actors:run-repository@1',
			'ceo.aven:component:data:artifacts@1'
		]) {
			const component = customerComponentCatalog.find((c) => c.componentRef === ref)!
			await f.root.query(
				`INSERT INTO customer_environment_components(environment_id,component_ref,desired_state,observed_state,target_schema_version,migration_set_digest,routing_generation)
			 VALUES($1,$2,'ready','ready',$3,$4,1)`,
				[f.environmentId, ref, component.targetSchemaVersion, component.migrationSetDigest]
			)
		}
		artifacts = await connectionArtifactFixture(f.database.databaseUrl, f.environmentId)
		const admissions = new AdmittedInvocations(
			{ environmentId: f.environmentId, generation: 1 },
			worker!
		)
		const guard = createInvocationGuardHandler(
			{ serviceToken, issuer, key: f.signing.publicKey },
			f.verifier,
			async () => admissions
		)
		const actorHandler = createActorRunnerHandler(
			{ forGrant: async () => runner!, reviewsForGrant: async () => new ReviewStore(api!, scope) },
			f.verifier,
			{ serviceToken, tenantGrantIssuer: issuer, tenantGrantPublicKey: f.signing.publicKey }
		)
		const actorServer = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: (request) =>
				new URL(request.url).pathname.startsWith('/internal/')
					? guard(request)
					: actorHandler(request)
		})
		servers.push(actorServer)
		const config = {
			...f.config,
			API_PUBLIC_BASE_URL: issuer,
			ARTIFACT_STORE_BASE_URL: artifacts.baseUrl,
			ARTIFACT_STORE_BEARER_TOKEN: artifacts.bearerToken,
			CUSTOMER_DOWNSTREAMS_JSON: [
				...f.config.CUSTOMER_DOWNSTREAMS_JSON,
				{
					segment: 'actor-runs',
					componentRef: 'os.aven:component:actors:run-repository@1',
					baseUrl: `http://127.0.0.1:${actorServer.port}`,
					targetPrefix: '/api/actor-runs',
					bearerToken: serviceToken,
					readAction: 'actor-runs:read',
					writeAction: 'actor-runs:write',
					roles: ['user' as const]
				},
				{
					segment: 'artifacts',
					componentRef: 'ceo.aven:component:data:artifacts@1',
					baseUrl: artifacts.baseUrl,
					targetPrefix: '/api/artifacts',
					bearerToken: artifacts.bearerToken,
					readAction: 'artifacts:read',
					writeAction: 'artifacts:write',
					roles: ['user' as const]
				}
			]
		}
		const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])
		const policyHandler = createConnectionPolicyHandler(
			config,
			{
				runnerToken,
				executorToken,
				issuer,
				...keys,
				tenantPublicKey: f.signing.publicKey,
				policy: options?.policy ?? {
					revision: 1,
					maximumBytes: 1048576,
					maximumSeconds: 30,
					httpTargets: [
						{ origin: 'https://reports.paper-orchard.example.test', pathPrefix: '/measurements' }
					],
					imapOrigins: ['https://mail.paper-orchard.example.test:993']
				}
			},
			f.verifier,
			f.customers
		)
		const policyServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: policyHandler })
		servers.push(policyServer)
		async function policy(
			operation: string,
			body: unknown,
			token = operation === 'verify' ? executorToken : runnerToken
		) {
			return fetch(`http://127.0.0.1:${policyServer.port}/internal/v1/connections/${operation}`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'x-aven-identity-token': f.token,
					'content-type': 'application/json'
				},
				body: JSON.stringify(body)
			})
		}
		async function actorCall(path: string, body?: unknown) {
			const component = 'os.aven:component:actors:run-repository@1'
			const identity = await f.verifier.verify(f.token)
			const grant = await f.customers.grant({
				claims: identity,
				environmentId: f.environmentId,
				componentRef: component,
				actions: [body === undefined ? 'actor-runs:read' : 'actor-runs:write']
			})
			return fetch(`http://127.0.0.1:${actorServer.port}/api/actor-runs${path}`, {
				method: body === undefined ? 'GET' : 'POST',
				headers: {
					authorization: `Bearer ${serviceToken}`,
					'x-aven-identity-token': f.token,
					'x-aven-tenant-grant': grant.token,
					'x-aven-subject': identity.sub,
					'x-aven-role': identity.role,
					'x-aven-session': identity.sid,
					'content-type': 'application/json'
				},
				...(body !== undefined && { body: JSON.stringify(body) })
			})
		}
		if (options)
			return await options.exercise({
				artifacts,
				admissions,
				api: api!,
				worker: worker!,
				policyUrl: `http://127.0.0.1:${policyServer.port}`,
				runnerToken,
				executorToken,
				keys,
				actorCall,
				startRunner(execute) {
					if (runner) throw Error('Only one owned runner per proof')
					runner = new SqlPlanRunner(api!, worker!, execute, true)
					return runner
				}
			})
		runner = new SqlPlanRunner(
			api!,
			worker!,
			async (request, context) => {
				const protocol = request.parameters.protocol as 'http' | 'imap'
				const source = await artifacts!.store.get(String(request.parameters.source))
				const method = protocol === 'http' ? 'http_fetch_authenticated' : 'imap_query'
				const schema = resourceId({
					authority: 'ceo.aven',
					kind: 'schema',
					namespace: protocol === 'http' ? 'web' : 'mail',
					name: protocol === 'http' ? 'http-request' : 'imap-query',
					version: '1'
				})
				const manifest = {
					id: protocol === 'http' ? 'http-fetch' : 'imap-mailbox',
					namespace: protocol === 'http' ? 'web' : 'mail',
					authority: 'ceo.aven',
					version: '1',
					name: 'Synthetic policy consumer',
					description: 'Tests policy, not protocol transport.',
					tags: [],
					methods: [
						{
							name: method,
							description: 'Resolve reviewed use authority.',
							parameters: { type: 'object' as const },
							requires: ['request(R)'],
							produces: [],
							inputSlots: [
								{
									name: 'request',
									role: 'request',
									predicate: 'request(R)',
									schema,
									cardinality: 'one' as const
								}
							],
							outputSlots: []
						}
					]
				}
				const stepId = 'root.capture',
					invocationId = await admittedInvocationId(context!.lease!.runId, stepId)
				const selection = {
					environmentId: f.environmentId,
					runId: context!.lease!.runId,
					invocationId,
					requestId: source.artifactId,
					bindingRef: bindings[protocol]
				}
				const factory = installedFactory(manifest, f.environmentId, () => {
					const actor = new Actor(manifest, {
						[method]: async () => {
							const issueInput = {
								selection,
								reviewId: stablePublicationUuid(`review:${selection.runId}:${invocationId}`)
							}
							assert.equal((await policy('issue', issueInput, executorToken)).status, 403)
							const response = await policy('issue', issueInput)
							assert.equal(response.status, 200, await response.clone().text())
							const issued = (await response.json()) as {
								authorization: string
								tenantGrant: string
							}
							const use = await credentialUseVerifier(
								issuer,
								keys.publicKey,
								protocol
							)(issued.authorization)
							assert.equal(use.requestArtifactDigest, source.artifactSha256)
							assert.equal(use.leaseOwnerId, context!.lease!.ownerId)
							assert.equal(
								(await policy('verify', { protocol, authorization: issued.authorization })).status,
								204
							)
							assert.equal(
								(
									await policy(
										'verify',
										{ protocol, authorization: issued.authorization },
										runnerToken
									)
								).status,
								403
							)
							latestAuthority = issued.authorization
							latestProtocol = protocol
							allowed++
							return {
								record: JSON.stringify({ ok: true, outputs: {} }),
								wire: 'Verified policy authority only; no network capture performed.'
							}
						}
					})
					return { actor, dispose: () => actor.dispose() }
				})
				const registry = new ActorRegistry()
				registry.registerDefinition(definitionFromManifest(manifest))
				registry.publishOffer(factory.offer)
				const snapshot = registry.snapshot(),
					capability = snapshot.definitions[0]!.capabilities[0]!
				const authorizer = {
					decide: () => ({ allow: true as const, decisionId: 'synthetic-installed-actor' })
				}
				const view = await authorizeRegistryForPlanning(
					snapshot,
					request.security.principal,
					authorizer,
					{ access: request.security.access }
				)
				try {
					const result = await invokeActorCapability(
						{
							runId: request.idempotencyKey,
							registry: snapshot,
							principal: request.security.principal,
							access: request.security.access,
							authorizer,
							factories: {
								resolve: (key) => (key === factory.offer.factoryId ? factory : undefined)
							},
							signal: context?.signal,
							invocationHost: admissions.host(request, context, async () => {
								const ports = connectionPolicyPorts(
									config,
									f.verifier,
									f.customers,
									f.signing.publicKey,
									f.token
								)
								const checkedScope = await ports.scope(f.token, f.environmentId)
								await ports.execution(checkedScope, selection)
								await ports.request(checkedScope, selection.requestId)
								await ports.metadata(checkedScope)
								const response = await policy('prepare', selection)
								assert.equal(response.status, 200, await response.clone().text())
								const proposal = (await response.json()) as {
									subjectSchema: string
									title: string
									subject: Record<string, unknown>
								}
								await requestRunReview(new ReviewStore(worker!, scope), context, {
									invocationId,
									...proposal
								})
							}),
							artifacts: {
								resolve: async () => null,
								publish: async () => {
									throw Error('No result publication in policy proof')
								}
							},
							program: {
								goals: [],
								steps: [],
								results: [],
								totalCost: 0,
								registryRevision: snapshot.revision,
								plannedFor: { subjectId: f.subjectId, tenantId: f.environmentId },
								executionEnvironment: 'server'
							}
						},
						{
							id: stepId,
							capability: capability.id,
							actor: capability.actor,
							method,
							target: view.capabilities[0]!.targets[0]!,
							inputs: [],
							outputs: [],
							dependsOn: [],
							cost: 1,
							parameters: protocol === 'http' ? { binding_ref: bindings.http } : {}
						},
						capability,
						[
							{
								slot: 'request',
								role: 'request',
								artifact: {
									artifactId: source.artifactId,
									schema,
									typeKey: source.typeKey,
									schemaVersion: 1,
									contentDigest: source.artifactSha256,
									predicate: 'request(source)',
									value: source.payload
								}
							}
						],
						new Set()
					)
					assert.equal(JSON.parse(result.record).ok, true)
					return { artifactIds: [], remainingGoals: [] }
				} catch (error) {
					if (!(error instanceof WaitingForReview)) throw error
					return { remainingGoals: request.goals, continuation: reviewContinuation(error.record) }
				}
			},
			true
		)
		async function settled(runId: string, previous = 0) {
			for (let i = 0; i < 600; i++) {
				const record = await runner!.status(runId)
				if (
					record &&
					record.revision > previous &&
					!['accepted', 'planning', 'running'].includes(record.state)
				)
					return record
				await Bun.sleep(50)
			}
			throw Error('Policy run did not settle')
		}
		for (const protocol of ['http', 'imap'] as const) {
			const payload =
				protocol === 'http'
					? parseHttpRequestArtifact({
							url: 'https://reports.paper-orchard.example.test/measurements/today',
							method: 'GET',
							authentication: { mode: 'mapped-required', purpose: 'report-read' },
							redirects: { mode: 'manual', maximumHops: 0 },
							freshness: 'new-capture'
						})
					: { bindingRef: bindings.imap, mailbox: 'Projects', purpose: 'project-mail' }
			const [source] = await artifacts.store.publish({
				id: randomUUID(),
				principal: f.subjectId,
				procedure: 'connection.request',
				inputs: [],
				parameters: {},
				artifacts: [
					{
						key: 'request',
						type: protocol === 'http' ? 'web.http-request' : 'mail.imap-query',
						payload
					}
				]
			})
			const response = await actorCall('', {
				protocol: ACTOR_RUN_PROTOCOL,
				requestId: randomUUID(),
				idempotencyKey: randomUUID(),
				requestedAt: new Date().toISOString(),
				skillRef: resourceId({
					authority: 'example',
					kind: 'skill',
					namespace: 'orchard',
					name: 'connection-proof',
					version: '1'
				}),
				executionEnvironment: 'server',
				ingredients: [],
				goals: ['example.orchard.connection(verified)'],
				parameters: { protocol, source: source!.artifactId }
			})
			assert.equal(response.status, 202, await response.clone().text())
			let record = await settled(((await response.json()) as { runId: string }).runId)
			assert.equal(record.state, 'waiting_for_input', JSON.stringify(record.failure))
			const continuation = record.continuations.find((c) => c.state === 'open')!
			const review = await new ReviewStore(api!, scope).read(record.runId, continuation.review!.id)
			const decision = await actorCall(`/${record.runId}/reviews/${review.id}`, {
				id: randomUUID(),
				revision: review.revision,
				subjectDigest: review.subjectDigest,
				expectedEventVersion: review.eventVersion,
				outcome: 'approve'
			})
			assert.equal(decision.status, 200, await decision.clone().text())
			const resume = await actorCall(
				`/${record.runId}/continuations/${continuation.continuationId}`,
				{
					requestId: randomUUID(),
					continuationId: continuation.continuationId,
					action: 'submit',
					kind: 'approval',
					value: true
				}
			)
			assert.equal(resume.status, 202, await resume.clone().text())
			record = await settled(record.runId, record.revision)
			assert.equal(record.state, 'succeeded', JSON.stringify(record.failure))
			assert.equal(
				(await policy('verify', { protocol: latestProtocol, authorization: latestAuthority }))
					.status,
				403
			)
		}
		assert.equal(allowed, 2)
		return 'HTTP/IMAP policy: actual owner review, live admitted invocation, current entitlement, exact Store input, signed use and rejection after run completion'
	} finally {
		await runner?.close()
		await Promise.all(servers.map((server) => server.stop(true)))
		await artifacts?.close()
		await Promise.all([api?.end(), worker?.end()])
		await f.root.query('DROP SCHEMA IF EXISTS aven_actor_runs CASCADE')
		for (const role of roles) {
			// Only these freshly generated fixture roles; remove their owned grants first.
			const exists = await f.root.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])
			if (exists.rowCount) await f.root.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`)
		}
	}
}
