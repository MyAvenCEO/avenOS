/** Disposable real component provisioning and signed HTTP authority; no customer records. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { SqlTaskRepository } from '@avenos/productivity/postgres'
import { RemoteTaskRepository, TaskRequestError } from '@avenos/productivity/remote'
import { PRODUCTIVITY_COMPONENT } from '@avenos/productivity/tasks'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import pg from 'pg'
import type { PlanRunner, TrustedActorInstallations } from '../../libs/aven-actors/src'
import { ArtifactStoreClient } from '../../libs/aven-artifact-store/src'
import {
	databaseNameForEnvironment,
	databaseRoleName,
	signTenantGrant,
	type TenantGrantClaims,
	verifyTenantGrant,
	verifyWorkerPlacement,
	verifyWorkGrant,
	workAllows
} from '../../libs/aven-customer-contracts/src/index'
import {
	createWorkGuardHandler,
	TenantPoolProvider,
	WorkAuthorizationError,
	WorkerPlacementClient,
	WorkGrantClient
} from '../../libs/aven-customer-runtime/src/index'
import { IdentityVerifier } from '../../libs/aven-identity/src/index'
import { readChatProgress } from '../../services/actor-runner/src/chat-progress'
import { createActorRunnerHandler } from '../../services/actor-runner/src/handler'
import { StudioArtifacts } from '../../services/actor-runner/src/studio-artifacts'
import type { StudioCatalogSource } from '../../services/actor-runner/src/studio-service'
import { createTurnAdmissionHandler } from '../../services/actor-runner/src/turn-admission-handler'
import { TurnLifecycleClient } from '../../services/actor-runner/src/turn-lifecycle-client'
import { createTurnStatusHandler } from '../../services/actor-runner/src/turn-status-handler'
import { TurnWorkClient } from '../../services/actor-runner/src/turn-work-client'
import {
	createWorkArtifactPublisher,
	createWorkArtifactReader
} from '../../services/actor-runner/src/work-artifacts'
import { assertWorkLease } from '../../services/actor-runner/src/work-lease'
import { createWorkStudioAuthoring } from '../../services/actor-runner/src/work-studio'
import { createIntentHandler } from '../../services/intent-service/src/handler'
import {
	createProductivityHandler,
	createTaskIntentVerifier
} from '../../services/intent-service/src/productivity'
import { IntentStore } from '../../services/intent-service/src/store'
import { TurnDispatchClient } from '../../services/intent-service/src/turn-dispatch-client'
import { createTurnLifecycleHandler } from '../../services/intent-service/src/turn-lifecycle-handler'
import { IntentTurnOutbox } from '../../services/intent-service/src/turn-outbox'
import { TurnStatusClient } from '../../services/intent-service/src/turn-status-client'
import { superviseTurns } from '../../services/intent-service/src/turn-supervision'
import { createTurnWorkHandler } from '../../services/intent-service/src/turn-work-handler'
import { IntentTurnWorker } from '../../services/intent-service/src/turn-worker'
import {
	createIntentDispatchGuard,
	createIntentWorkGuard
} from '../../services/intent-service/src/work-guard'
import { loadCatalog } from '../../services/platform-provisioner/src/catalog'
import { provisionerConfigSchema } from '../../services/platform-provisioner/src/config'
import { CustomerDatabaseProvisioner } from '../../services/platform-provisioner/src/postgres'
import { artifactServiceFixture } from './artifact-service-fixture'
import { inputFacadeFixture } from './input-facade-fixture'

export async function taskServiceFixture(
	databaseUrl: string,
	owner: string,
	intentId: string,
	options: { artifacts?: boolean } = {}
) {
	const environmentId = randomUUID(),
		databaseName = databaseNameForEnvironment(environmentId)
	const backupRole = `proof_backup_${randomBytes(8).toString('hex')}`
	const serviceToken = randomBytes(32).toString('base64url'),
		taskRoot = randomBytes(32).toString('base64url'),
		intentRoot = randomBytes(32).toString('base64url')
	const runnerToken = randomBytes(32).toString('base64url'),
		exchangeToken = randomBytes(32).toString('base64url')
	const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 })
	const providers: TenantPoolProvider[] = [],
		servers: ReturnType<typeof Bun.serve>[] = [],
		roles = new Set<string>([backupRole])
	let pool: pg.Pool | undefined,
		ownsDatabase = false
	let admissionFacade: Awaited<ReturnType<typeof inputFacadeFixture>> | undefined
	let artifacts: Awaited<ReturnType<typeof artifactServiceFixture>> | undefined
	const close = async () => {
		await admissionFacade?.close()
		await artifacts?.close()
		await Promise.all(servers.map((server) => server.stop(true)))
		await Promise.all(providers.map((provider) => provider.close()))
		await pool?.end()
		// Targets are solely this fixture's newly generated database and roles.
		if (ownsDatabase) {
			await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`)
			for (const role of roles) await admin.query(`DROP ROLE IF EXISTS ${role}`)
		}
		await admin.end()
	}
	try {
		const before = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName])
		assert.equal(before.rowCount, 0, 'Never reuse an existing database in this fixture.')
		ownsDatabase = true
		await admin.query(`CREATE ROLE ${backupRole} NOLOGIN`)
		const cwd = process.cwd()
		let catalog: Awaited<ReturnType<typeof loadCatalog>>
		try {
			process.chdir(resolve(import.meta.dir, '../../services/platform-provisioner'))
			catalog = await loadCatalog()
		} finally {
			process.chdir(cwd)
		}
		const artifactRoot = randomBytes(32).toString('base64url')
		if (options.artifacts) artifacts = await artifactServiceFixture(databaseUrl, artifactRoot)
		const config = provisionerConfigSchema.parse({
			CLUSTER_DATABASE_URL: databaseUrl,
			CONTROL_DATABASE_URL: databaseUrl,
			INTENTS_API_DB_CREDENTIAL_ROOT: intentRoot,
			PRODUCTIVITY_API_DB_CREDENTIAL_ROOT: taskRoot,
			ACTOR_API_DB_CREDENTIAL_ROOT: randomBytes(32).toString('base64url'),
			ACTOR_WORKER_DB_CREDENTIAL_ROOT: randomBytes(32).toString('base64url'),
			ARTIFACT_API_DB_CREDENTIAL_ROOT: artifactRoot,
			BACKUP_DATABASE_ROLE: backupRole,
			...(artifacts && { ARTIFACT_STORE_PROVISIONER_DATABASE_ROLE: new URL(databaseUrl).username }),
			ARTIFACT_STORE_PROVISIONER_URL: artifacts?.provisionerUrl ?? 'http://127.0.0.1:1',
			ARTIFACT_STORE_PROVISIONER_TOKEN:
				artifacts?.provisionerToken ?? randomBytes(32).toString('base64url')
		})
		const provisioner = new CustomerDatabaseProvisioner(databaseUrl, config)
		roles.add(databaseRoleName(environmentId, 'db_owner'))
		roles.add(databaseRoleName(environmentId, 'platform_owner'))
		for (const ref of [
			PRODUCTIVITY_COMPONENT,
			'ceo.aven:component:data:intents@1',
			'os.aven:component:actors:run-repository@1',
			...(artifacts ? ['ceo.aven:component:data:artifacts@1'] : [])
		]) {
			const entry = catalog.get(ref)!
			roles.add(databaseRoleName(environmentId, entry.manifest.ownerRoleSuffix))
			for (const role of entry.manifest.functionRoles)
				roles.add(databaseRoleName(environmentId, role.roleSuffix))
			await provisioner.reconcile(
				{
					id: randomUUID(),
					environmentId,
					databaseName,
					componentRef: ref,
					action: 'reconcile',
					targetSchemaVersion: entry.manifest.targetSchemaVersion,
					migrationSetDigest: entry.manifest.migrationSetDigest,
					routingGeneration: 1
				},
				entry
			)
		}
		const url = new URL(databaseUrl)
		url.pathname = `/${databaseName}`
		pool = new pg.Pool({
			connectionString: url.toString(),
			max: 4,
			options: '-c search_path=aven_actor_runs,public'
		})
		const identityKeys = await generateKeyPair('EdDSA'),
			tenantKeys = await generateKeyPair('EdDSA')
		const jwk = {
			...(await exportJWK(identityKeys.publicKey)),
			kid: 'tasks-proof',
			alg: 'EdDSA',
			use: 'sig'
		}
		const identity = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: () => Response.json({ keys: [jwk] })
		})
		servers.push(identity)
		const issuer = identity.url.origin,
			sid = randomUUID()
		const verifier = new IdentityVerifier({ issuer, jwksUrl: `${issuer}/jwks` })
		const provider = (
			ref: string,
			root: string,
			suffix: string,
			schema: string,
			roleKind: string
		) => {
			const value = new TenantPoolProvider({
				host: url.hostname,
				port: Number(url.port || 5432),
				ssl: false,
				credentialRoot: root,
				roleSuffix: suffix,
				roleKind,
				componentRef: ref,
				searchPath: [schema]
			})
			providers.push(value)
			return value
		}
		const tasks = provider(
			PRODUCTIVITY_COMPONENT,
			taskRoot,
			'prod_api',
			'aven_productivity',
			'ceo.aven:db-role:productivity:api@1'
		)
		const intents = provider(
			'ceo.aven:component:data:intents@1',
			intentRoot,
			'int_api',
			'aven_intents',
			'ceo.aven:db-role:intents:api@1'
		)
		const workers = provider(
			'os.aven:component:actors:run-repository@1',
			config.ACTOR_WORKER_DB_CREDENTIAL_ROOT,
			'act_worker',
			'aven_actor_runs',
			'os.aven:db-role:actors:worker@1'
		)
		const actors = provider(
			'os.aven:component:actors:run-repository@1',
			config.ACTOR_API_DB_CREDENTIAL_ROOT,
			'act_api',
			'aven_actor_runs',
			'os.aven:db-role:actors:api@1'
		)
		const claims = (subject = owner, ref = PRODUCTIVITY_COMPONENT, generation = 1) => ({
			iss: issuer,
			aud: ref,
			sub: subject,
			sid,
			role: 'user' as const,
			membershipRole: 'owner' as const,
			environmentId,
			databaseName,
			routingGeneration: generation,
			componentRef: ref,
			actions:
				ref === PRODUCTIVITY_COMPONENT
					? ['productivity:read', 'productivity:write']
					: ['intents:read']
		})
		const intentClaims = { ...claims(owner, 'ceo.aven:component:data:intents@1'), iat: 1, exp: 2 }
		const intentPool = await intents.forGrant(intentClaims),
			store = new IntentStore(intentPool)
		const turns = new IntentTurnOutbox(intentPool),
			turnScope = { subjectId: owner, environmentId, generation: 1 }
		const workerPool = await workers.forGrant({
			...claims(owner, 'os.aven:component:actors:run-repository@1'),
			iat: 1,
			exp: 2
		})
		const actorPool = await actors.forGrant({
			...claims(owner, 'os.aven:component:actors:run-repository@1'),
			iat: 1,
			exp: 2
		})
		await store.create(owner, {
			id: intentId,
			title: 'Community repair cafe',
			intentType: 'intent',
			sourceLabel: 'Synthetic proof',
			deadline: null
		})
		const handlerConfig = { serviceToken, issuer, key: tenantKeys.publicKey }
		const logs: string[] = []
		const productivityHandler = createProductivityHandler(
			handlerConfig,
			verifier,
			{ forGrant: async (grant) => new SqlTaskRepository(await tasks.forGrant(grant), grant) },
			createTaskIntentVerifier(handlerConfig, verifier, {
				forGrant: async (grant) => new IntentStore(await intents.forGrant(grant))
			}),
			(error) => logs.push(String(error))
		)
		const intentHandler = createIntentHandler(
			{ INTENT_SERVICE_BEARER_TOKEN: serviceToken, TENANT_GRANT_ISSUER: issuer },
			verifier,
			tenantKeys.publicKey,
			{ forGrant: async (grant) => new IntentStore(await intents.forGrant(grant)) },
			(error) => logs.push(String(error))
		)
		const guard = createIntentWorkGuard(
			{ serviceToken, tenantGrantIssuer: issuer, tenantGrantPublicKey: tenantKeys.publicKey },
			async (grant) => new IntentTurnOutbox(await intents.forGrant(grant)),
			(error) => logs.push(String(error))
		)
		const turnHandler = createTurnWorkHandler(
			{ serviceToken, tenantGrantIssuer: issuer, tenantGrantPublicKey: tenantKeys.publicKey },
			{
				outboxFor: async (grant) => new IntentTurnOutbox(await intents.forGrant(grant)),
				historyFor: async (grant) => new IntentStore(await intents.forGrant(grant))
			},
			(error) => logs.push(String(error))
		)
		const dispatchGuard = createIntentDispatchGuard(
			{ serviceToken, tenantGrantIssuer: issuer, tenantGrantPublicKey: tenantKeys.publicKey },
			async (grant) => new IntentTurnOutbox(await intents.forGrant(grant)),
			(error) => logs.push(String(error))
		)
		const lifecycleHandler = createTurnLifecycleHandler(
			{
				serviceToken,
				runtimeId: 'primary',
				tenantGrantIssuer: issuer,
				tenantGrantPublicKey: tenantKeys.publicKey
			},
			async (placement) => new IntentTurnOutbox(await intents.forPlacement(placement)),
			(error) => logs.push(String(error))
		)
		const runnerGuard = createWorkGuardHandler(
			{
				serviceToken: runnerToken,
				tenantGrantIssuer: issuer,
				tenantGrantPublicKey: tenantKeys.publicKey,
				componentRef: 'os.aven:component:actors:run-repository@1',
				requiredAction: 'actor-runs:read'
			},
			async (tenant, work) =>
				assertWorkLease(await actors.forGrant(tenant), work, tenant.execution!),
			(error) => logs.push(String(error))
		)
		let activeRunner: (() => Pick<PlanRunner, 'start'>) | undefined
		const admissionHandler = createTurnAdmissionHandler(
			{
				serviceToken: runnerToken,
				tenantGrantIssuer: issuer,
				tenantGrantPublicKey: tenantKeys.publicKey
			},
			async (grant) => {
				assert.equal(await actors.forGrant(grant), actorPool)
				if (!activeRunner) throw Error('No installed test runner.')
				return activeRunner()
			},
			(error) => logs.push(String(error))
		)
		const statusHandler = createTurnStatusHandler(
			{
				serviceToken: runnerToken,
				runtimeId: 'primary',
				tenantGrantIssuer: issuer,
				tenantGrantPublicKey: tenantKeys.publicKey
			},
			(placement) => actors.forPlacement(placement),
			(error) => logs.push(String(error))
		)
		const publicRunner = createActorRunnerHandler(
			{
				forGrant: async () => {
					throw Error('Progress reads must not construct an executor.')
				},
				chatProgress: async (grant, turnId) =>
					readChatProgress(await actors.forGrant(grant), grant.sub, turnId)
			},
			verifier,
			{
				serviceToken: runnerToken,
				tenantGrantIssuer: issuer,
				tenantGrantPublicKey: tenantKeys.publicKey
			}
		)
		const runnerService = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: (request) => {
				const path = new URL(request.url).pathname
				if (path.startsWith('/api/actor-runs/chat-turns/')) return publicRunner(request)
				return path === '/internal/v1/work/admit'
					? admissionHandler(request)
					: path === '/internal/v1/work/turn/status'
						? statusHandler(request)
						: runnerGuard(request)
			}
		})
		servers.push(runnerService)
		const handler = (request: Request) => {
			const path = new URL(request.url).pathname
			return path === '/internal/v1/work/verify'
				? guard(request)
				: path === '/internal/v1/work/dispatch/verify'
					? dispatchGuard(request)
					: path === '/internal/v1/work/turn/lifecycle'
						? lifecycleHandler(request)
						: path === '/internal/v1/work/turn'
							? turnHandler(request)
							: path.startsWith('/api/intents/')
								? intentHandler(request)
								: productivityHandler(request)
		}
		let service = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler })
		servers.push(service)
		const identityToken = async (subject = owner) =>
			new SignJWT({
				sid,
				email: 'workshop-proof@example.test',
				email_verified: true,
				role: 'user',
				amr: ['passkey'],
				scope: 'services:access'
			})
				.setProtectedHeader({ alg: 'EdDSA', kid: 'tasks-proof' })
				.setIssuer(issuer)
				.setAudience('aven-services')
				.setSubject(subject)
				.setIssuedAt()
				.setExpirationTime('10m')
				.sign(identityKeys.privateKey)
		admissionFacade = await inputFacadeFixture({
			databaseUrl,
			owner,
			environmentId,
			databaseName,
			issuer,
			key: tenantKeys.privateKey,
			verifier,
			serviceUrl: service.url.origin,
			serviceToken,
			identityToken,
			work: {
				serviceToken: exchangeToken,
				publicKey: tenantKeys.publicKey,
				runnerUrl: runnerService.url.origin,
				runnerToken
			},
			components: [...catalog.values()]
				.filter(
					(entry) =>
						artifacts || entry.manifest.componentRef !== 'ceo.aven:component:data:artifacts@1'
				)
				.map((entry) => entry.manifest)
		})
		const headers = async (subject = owner, overrides: Partial<TenantGrantClaims> = {}) => {
			return new Headers({
				authorization: `Bearer ${serviceToken}`,
				'content-type': 'application/json',
				'x-aven-identity-token': await identityToken(subject),
				'x-aven-subject': subject,
				'x-aven-role': 'user',
				'x-aven-session': sid,
				'x-aven-tenant-grant': await signTenantGrant(
					{ ...claims(subject), ...overrides },
					tenantKeys.privateKey
				),
				'x-aven-intent-grant': await signTenantGrant(
					claims(subject, 'ceo.aven:component:data:intents@1'),
					tenantKeys.privateKey
				)
			})
		}
		const request = async (
			path: string,
			options: { method?: 'GET' | 'POST'; body?: unknown; subject?: string; headers?: Headers } = {}
		) =>
			fetch(new URL(`/api/productivity${path}`, service.url), {
				method: options.method ?? 'GET',
				headers: options.headers ?? (await headers(options.subject)),
				...(options.body !== undefined && { body: JSON.stringify(options.body) })
			})
		const repository = (subject = owner) =>
			new RemoteTaskRepository(subject, async (method, path, body) => {
				const response = await request(path, { method, body, subject }),
					result = await response.json()
				if (response.status === 404 && result.code === 'TASK_RECEIPT_NOT_FOUND') return null
				if (!response.ok)
					throw new TaskRequestError(
						`${result.code}: ${result.message}`,
						result.code,
						response.status
					)
				return result
			})
		const delegatedHeaders = async (
			turnId: string,
			runId: string,
			leaseOwnerId: string,
			workToken: string,
			write: boolean
		) => {
			const work = await verifyWorkGrant(workToken, tenantKeys.publicKey, issuer)
			const binding = { workId: work.jti, turnId, runId, leaseOwnerId }
			const client = new WorkGrantClient({
				baseUrl: admissionFacade!.baseUrl,
				serviceToken: exchangeToken,
				runtimeId: 'primary',
				issuer,
				publicKey: tenantKeys.publicKey,
				workToken,
				binding
			})
			const exchange = async (component: string, actions: string[]) => {
				try {
					return await client.grant(component, actions)
				} catch (error) {
					if (error instanceof WorkAuthorizationError)
						throw new TaskRequestError(error.message, error.code, error.status)
					throw error
				}
			}
			const [grant, intentGrant] = await Promise.all([
				exchange(PRODUCTIVITY_COMPONENT, [write ? 'productivity:write' : 'productivity:read']),
				write ? exchange('ceo.aven:component:data:intents@1', ['intents:read']) : undefined
			])
			const headers = new Headers({
				authorization: `Bearer ${serviceToken}`,
				'content-type': 'application/json',
				'x-aven-tenant-grant': grant,
				'x-aven-work-grant': workToken
			})
			if (intentGrant) headers.set('x-aven-intent-grant', intentGrant)
			return headers
		}
		const delegatedRepository = (
			turnId: string,
			runId: string,
			leaseOwnerId: string,
			workToken: string
		) =>
			new RemoteTaskRepository(owner, async (method, path, body) => {
				const response = await request(path, {
					method,
					body,
					headers: await delegatedHeaders(turnId, runId, leaseOwnerId, workToken, method === 'POST')
				})
				const value = await response.json()
				if (response.status === 404 && value.code === 'TASK_RECEIPT_NOT_FOUND') return null
				if (!response.ok)
					throw new TaskRequestError(`${value.code}: ${value.message}`, value.code, response.status)
				return value
			})
		const boundaries = async () => {
			const placementInput = {
				runtimeId: 'primary',
				componentRef: 'ceo.aven:component:data:intents@1' as const
			}
			for (const bad of [
				{ authorization: 'Bearer invalid' },
				{ authorization: `Bearer ${runnerToken}` },
				{ origin: 'https://not-a-worker.example.test' },
				{ 'x-aven-identity-token': await identityToken() }
			] as Record<string, string>[])
				assert.equal((await admissionFacade!.placementRequest(placementInput, bad)).status, 403)
			assert.equal(
				(await admissionFacade!.placementRequest({ ...placementInput, runtimeId: 'elsewhere' }))
					.status,
				403
			)
			assert.equal(
				(
					await admissionFacade!.placementRequest({
						...placementInput,
						componentRef: PRODUCTIVITY_COMPONENT
					})
				).status,
				400
			)
			assert.equal(
				(await admissionFacade!.placementRequest({ ...placementInput, databaseName })).status,
				400
			)
			assert.equal(
				(await admissionFacade!.placementRequest({ ...placementInput, extra: 'x'.repeat(4096) }))
					.status,
				413
			)
			const placementPage = await placementClient.page()
			assert.equal(placementPage.placements.length, 1)
			assert.equal(placementPage.next, null)
			const placement = placementPage.placements[0]!
			assert.equal(placement.environmentId, environmentId)
			const discovered = new IntentTurnOutbox(await intents.forPlacement(placement))
			assert(Array.isArray(await discovered.pendingForWorker(placement)))
			await assert.rejects(() => tasks.forPlacement(placement), /authorize this role/)
			await pool!.query('UPDATE aven_platform.environment_identity SET execution_enabled=false')
			await assert.rejects(() => intents.forPlacement(placement), /no longer active/)
			await pool!.query('UPDATE aven_platform.environment_identity SET execution_enabled=true')
			const signedPlacement = (
				await (await admissionFacade!.placementRequest(placementInput)).json()
			).placements[0]
			await assert.rejects(() =>
				verifyWorkerPlacement(signedPlacement, tenantKeys.publicKey, {
					issuer,
					runtimeId: 'wrong',
					componentRef: placementInput.componentRef
				})
			)
			await admissionFacade!.control.query(
				`UPDATE customer_environments SET observed_state='suspended' WHERE id=$1`,
				[environmentId]
			)
			assert.deepEqual((await placementClient.page()).placements, [])
			await admissionFacade!.control.query(
				`UPDATE customer_environments SET observed_state='ready' WHERE id=$1`,
				[environmentId]
			)
			await admissionFacade!.control.query(
				`UPDATE customer_environment_components SET routing_generation=2 WHERE environment_id=$1 AND component_ref=$2`,
				[environmentId, placementInput.componentRef]
			)
			assert.deepEqual((await placementClient.page()).placements, [])
			await admissionFacade!.control.query(
				`UPDATE customer_environment_components SET routing_generation=1 WHERE environment_id=$1 AND component_ref=$2`,
				[environmentId, placementInput.componentRef]
			)
			const input = {
				inputId: randomUUID(),
				revision: 1,
				text: 'Discuss the visitor signage.',
				originalText: 'Discuss the visitor signage.',
				corrections: [],
				target: { kind: 'existing' as const, id: intentId },
				locale: 'en-GB',
				timezone: 'Europe/London',
				capturedAt: new Date().toISOString(),
				decisionId: randomUUID(),
				confirmed: true,
				references: []
			}
			const sent = await admissionFacade!.request('/input', input, owner, {
				'x-aven-work-grant': 'caller-must-not-supply-authority'
			})
			assert.equal(sent.status, 201)
			const accepted = await sent.json()
			assert.deepEqual(await admissionFacade!.admit(input), accepted)
			const outbox = (
				await pool!.query('SELECT * FROM aven_intents.turn_outbox WHERE turn_id=$1', [
					accepted.turnId
				])
			).rows[0]
			const work = await verifyWorkGrant(outbox.work_grant, tenantKeys.publicKey, issuer)
			assert.equal(work.inputId, input.inputId)
			assert.equal(workAllows(work, PRODUCTIVITY_COMPONENT, ['productivity:write']), true)
			assert.equal(workAllows(work, 'ceo.aven:component:data:intents@1', ['intents:delete']), false)
			assert(
				!JSON.stringify(outbox).includes('identity-token'),
				'Outbox does not contain a reusable login token.'
			)
			const dispatch = await turns.claim(turnScope, accepted.turnId)
			assert.equal(dispatch.state, 'claimed')
			if (dispatch.state !== 'claimed') throw Error('Missing test dispatch')
			const dispatchInput = {
				workToken: outbox.work_grant,
				binding: {
					workId: work.jti,
					turnId: accepted.turnId,
					dispatchToken: dispatch.dispatch.token
				}
			}
			const admissionResponse = await admissionFacade!.dispatchRequest(dispatchInput)
			assert.equal(admissionResponse.status, 200)
			const admissionAuthority = await admissionResponse.json()
			const admissionClaims = await verifyTenantGrant(
				admissionAuthority.token,
				tenantKeys.publicKey,
				{
					issuer,
					audience: 'os.aven:component:actors:run-repository@1',
					action: 'actor-runs:write'
				}
			)
			assert.deepEqual(admissionClaims.dispatch, dispatchInput.binding)
			assert.equal(admissionClaims.execution, undefined)
			assert(
				admissionClaims.exp <= Math.floor(new Date(dispatch.dispatch.expiresAt).getTime() / 1000)
			)
			for (const bad of [
				{ authorization: 'Bearer invalid' },
				{ 'x-aven-identity-token': await identityToken() },
				{ origin: 'https://not-a-worker.example.test' }
			] as Record<string, string>[])
				assert.equal((await admissionFacade!.dispatchRequest(dispatchInput, bad)).status, 403)
			assert.equal(
				(
					await admissionFacade!.dispatchRequest({
						...dispatchInput,
						componentRef: PRODUCTIVITY_COMPONENT
					})
				).status,
				400
			)
			assert.equal(
				(
					await admissionFacade!.dispatchRequest({
						...dispatchInput,
						binding: { ...dispatchInput.binding, dispatchToken: randomUUID() }
					})
				).status,
				403
			)
			assert.equal(
				(
					await admissionFacade!.dispatchRequest({
						...dispatchInput,
						binding: { ...dispatchInput.binding, turnId: randomUUID() }
					})
				).status,
				403
			)
			const admitHeaders = {
				authorization: `Bearer ${runnerToken}`,
				'x-aven-work-grant': outbox.work_grant,
				'x-aven-tenant-grant': admissionAuthority.token
			}
			assert.equal(
				(
					await fetch(new URL('/internal/v1/work/admit', runnerService.url), {
						method: 'POST',
						headers: admitHeaders,
						body: JSON.stringify({ skillRef: 'untrusted', prompt: 'Do unrelated work' })
					})
				).status,
				400
			)
			assert.equal(
				(
					await fetch(new URL('/internal/v1/work/verify', runnerService.url), {
						method: 'POST',
						headers: admitHeaders
					})
				).status,
				403,
				'Admission authority cannot verify an execution lease.'
			)
			await pool!.query(
				`UPDATE aven_intents.turn_outbox SET dispatch_until=clock_timestamp()-interval '1 second' WHERE turn_id=$1`,
				[accepted.turnId]
			)
			assert.equal(
				(await admissionFacade!.dispatchRequest(dispatchInput)).status,
				403,
				'Expired claims cannot admit work.'
			)
			await pool!.query('UPDATE aven_intents.turn_outbox SET dispatch_until=$2 WHERE turn_id=$1', [
				accepted.turnId,
				dispatch.dispatch.expiresAt
			])
			const runId = randomUUID(),
				leaseOwnerId = randomUUID()
			const runReference = {
				turnId: accepted.turnId,
				runId,
				subjectId: owner,
				inputId: input.inputId,
				inputRevision: input.revision,
				materialDigest: work.materialDigest
			}
			const lifecycleRequest = (body: unknown, changes: Record<string, string> = {}) =>
				fetch(new URL('/internal/v1/work/turn/lifecycle', service.url), {
					method: 'POST',
					headers: {
						authorization: `Bearer ${serviceToken}`,
						'content-type': 'application/json',
						'x-aven-worker-placement': signedPlacement,
						...changes
					},
					body: JSON.stringify(body)
				})
			for (const kind of ['state', 'resume']) {
				const response = await lifecycleRequest({ kind, run: runReference })
				assert.equal(response.status, 200)
				assert.deepEqual(await response.json(), { state: 'waiting' })
			}
			await turns.dispatched(turnScope, accepted.turnId, dispatch.dispatch.token, runId)
			assert.equal(
				(await admissionFacade!.dispatchRequest(dispatchInput)).status,
				403,
				'Bound work cannot obtain another admission authority.'
			)
			assert.deepEqual(
				await (await lifecycleRequest({ kind: 'state', run: runReference })).json(),
				{ state: 'ready', replacedRuns: [] }
			)
			const resumeResponse = await lifecycleRequest({ kind: 'resume', run: runReference })
			assert.equal(resumeResponse.status, 200)
			assert.deepEqual(await resumeResponse.json(), {
				state: 'ready',
				replacedRuns: [],
				workGrant: outbox.work_grant
			})
			await assert.rejects(
				() =>
					delegatedRepository(accepted.turnId, runId, leaseOwnerId, outbox.work_grant).list(
						owner,
						{}
					),
				/WORK_EXECUTION_ENDED/,
				'A resumed certificate alone cannot execute without the exact live runner lease.'
			)
			for (const change of [
				{ subjectId: randomUUID() },
				{ runId: randomUUID() },
				{ turnId: randomUUID() },
				{ inputId: randomUUID() },
				{ inputRevision: 2 },
				{ materialDigest: '0'.repeat(64) }
			])
				assert.equal(
					(await lifecycleRequest({ kind: 'resume', run: { ...runReference, ...change } })).status,
					409
				)
			for (const change of [
				{ authorization: 'Bearer invalid' },
				{ 'x-aven-worker-placement': 'invalid' },
				{ 'x-aven-identity-token': await identityToken() },
				{ 'x-aven-work-grant': outbox.work_grant },
				{ 'x-aven-tenant-grant': admissionAuthority.token },
				{ origin: 'https://not-a-worker.example.test' },
				{ cookie: 'x=y' }
			] as Record<string, string>[])
				assert.equal(
					(await lifecycleRequest({ kind: 'resume', run: runReference }, change)).status,
					403
				)
			assert.equal((await lifecycleRequest({ kind: 'finish', run: runReference })).status, 400)
			assert.equal(
				(await lifecycleRequest({ kind: 'resume', run: runReference, databaseName })).status,
				400
			)
			assert.equal(
				(await lifecycleRequest({ kind: 'resume', run: runReference, prompt: 'x'.repeat(2048) }))
					.status,
				413
			)
			await pool!.query(
				`INSERT INTO aven_actor_runs.runs(id,subject_id,idempotency_key,material_hash,state,revision,record)
        VALUES($1::uuid,$2,$1::text,'synthetic-boundary','running',1,$3)`,
				[
					runId,
					owner,
					{
						parameters: {
							turnId: accepted.turnId,
							inputId: work.inputId,
							inputRevision: work.inputRevision,
							materialDigest: work.materialDigest
						},
						lease: {
							ownerId: leaseOwnerId,
							expiresAt: new Date(Date.now() + 600_000).toISOString()
						}
					}
				]
			)
			const delegated = delegatedRepository(accepted.turnId, runId, leaseOwnerId, outbox.work_grant)
			await delegated.list(owner, {})
			const exchangeInput = {
				workToken: outbox.work_grant,
				binding: { workId: work.jti, turnId: accepted.turnId, runId, leaseOwnerId },
				componentRef: PRODUCTIVITY_COMPONENT,
				actions: ['productivity:read']
			}
			const clientConfig = {
				baseUrl: admissionFacade!.baseUrl,
				serviceToken: exchangeToken,
				runtimeId: 'primary',
				issuer,
				publicKey: tenantKeys.publicKey,
				workToken: outbox.work_grant,
				binding: exchangeInput.binding
			}
			// Check client-side binding too, not only downstream handlers. Real signed
			// replies for the wrong runtime must never escape as usable permissions.
			await assert.rejects(
				() =>
					new WorkGrantClient({ ...clientConfig, runtimeId: 'elsewhere' }).grant(
						PRODUCTIVITY_COMPONENT,
						['productivity:read']
					),
				(error: unknown) => error instanceof WorkAuthorizationError && error.status === 403
			)
			await assert.rejects(
				() =>
					new WorkGrantClient({ ...clientConfig, publicKey: identityKeys.publicKey }).grant(
						PRODUCTIVITY_COMPONENT,
						['productivity:read']
					),
				WorkAuthorizationError
			)
			await assert.rejects(
				() =>
					new WorkGrantClient({
						...clientConfig,
						binding: { ...exchangeInput.binding, workId: randomUUID() }
					}).grant(PRODUCTIVITY_COMPONENT, ['productivity:read']),
				(error: unknown) => error instanceof WorkAuthorizationError && error.status === 403
			)
			await assert.rejects(
				() =>
					new WorkGrantClient(clientConfig).grant(PRODUCTIVITY_COMPONENT, [
						'productivity:read',
						'productivity:read'
					]),
				WorkAuthorizationError
			)
			const contextGrant = await new WorkGrantClient(clientConfig).grant(
				'ceo.aven:component:data:intents@1',
				['intents:read']
			)
			const executionWrite = await new WorkGrantClient(clientConfig).grant(
				'os.aven:component:actors:run-repository@1',
				['actor-runs:write']
			)
			assert.equal(
				(
					await fetch(new URL('/internal/v1/work/admit', runnerService.url), {
						method: 'POST',
						headers: { ...admitHeaders, 'x-aven-tenant-grant': executionWrite }
					})
				).status,
				403,
				'A live tool grant is not turn admission authority.'
			)
			const turnHeaders = {
				authorization: `Bearer ${serviceToken}`,
				'x-aven-work-grant': outbox.work_grant,
				'x-aven-tenant-grant': contextGrant,
				'content-type': 'application/json'
			}
			const turnRequest = (body: unknown, changes: Record<string, string> = {}) =>
				fetch(new URL('/internal/v1/work/turn', service.url), {
					method: 'POST',
					headers: { ...turnHeaders, ...changes },
					body: JSON.stringify(body)
				})
			const contextResponse = await turnRequest({ kind: 'context' })
			assert.equal(contextResponse.status, 200)
			const context = await contextResponse.json()
			assert.equal(context.turnId, accepted.turnId)
			assert.equal(context.input.text, input.text)
			assert(!JSON.stringify(context).includes(outbox.work_grant))
			for (const changes of [
				{ authorization: 'Bearer invalid' },
				{ 'x-aven-work-grant': 'invalid' },
				{ 'x-aven-identity-token': await identityToken() },
				{ origin: 'https://not-a-worker.example.test' },
				{ cookie: 'session=not-authority' }
			] as Record<string, string>[])
				assert.equal((await turnRequest({ kind: 'context' }, changes)).status, 403)
			assert.equal((await turnRequest({ kind: 'context', turnId: randomUUID() })).status, 400)
			assert.equal((await turnRequest({ kind: 'context', databaseName })).status, 400)
			assert.equal(
				(await turnRequest({ kind: 'context', extra: 'x'.repeat(513 * 1024) })).status,
				413
			)
			assert.equal(
				(
					await turnRequest({
						kind: 'finish',
						output: { state: 'completed', text: 'Must not publish.', payload: {} }
					})
				).status,
				403
			)
			const historySearch = {
				kind: 'search',
				recordKind: 'message',
				input: { intent: intentId, limit: 1 }
			}
			const historyResponse = await turnRequest(historySearch)
			assert.equal(historyResponse.status, 200)
			const history = await historyResponse.json()
			assert(history.messages.some((m: any) => m.id === accepted.contributionId))
			const historyRead = await turnRequest({
				kind: 'read',
				recordKind: 'message',
				id: accepted.contributionId
			})
			assert.equal(historyRead.status, 200)
			assert.equal((await historyRead.json()).content, input.text)
			const previewIntent = randomUUID(),
				previewMessage = randomUUID()
			await store.create(owner, {
				id: previewIntent,
				title: 'Synthetic Unicode pagination',
				intentType: 'intent',
				sourceLabel: 'Boundary proof',
				deadline: null
			})
			const previewText = '🔭'.repeat(695) + 'amber locker'
			await store.append(owner, previewIntent, {
				id: previewMessage,
				contributorKind: 'human',
				kind: 'message',
				text: previewText,
				payload: { privateToolPayload: 'Not part of a history excerpt' }
			})
			for (let index = 0; index < 10; index++)
				await store.append(owner, previewIntent, {
					id: randomUUID(),
					contributorKind: 'human',
					kind: 'message',
					text: 'Earlier synthetic note',
					payload: {}
				})
			const full = await store.preview(owner, previewIntent)
			assert.equal(full.olderMessagesAvailable, true)
			assert.equal(full.conversation.length, 10)
			assert(
				!full.conversation.some((m) => m.id === previewMessage),
				'Preview returns the latest ten messages.'
			)
			const lastMessage = randomUUID()
			await store.append(owner, previewIntent, {
				id: lastMessage,
				contributorKind: 'agent',
				kind: 'message',
				text: previewText,
				payload: { privateToolPayload: 'Not part of a history excerpt' }
			})
			await store.append(owner, previewIntent, {
				id: randomUUID(),
				contributorKind: 'human',
				kind: 'response-feedback',
				text: null,
				payload: {
					responseId: lastMessage,
					vote: 'down',
					reason: 'Synthetic feedback is retained.',
					previousFeedbackId: null
				}
			})
			const previewResponse = await turnRequest({
				kind: 'read',
				recordKind: 'intent',
				id: previewIntent
			})
			assert.equal(previewResponse.status, 200)
			const preview = await previewResponse.json(),
				excerpt = preview.conversation.at(-1)
			const interactivePreview = await admissionFacade!.request(`/${previewIntent}/preview`)
			assert.equal(interactivePreview.status, 200)
			assert.deepEqual(
				await interactivePreview.json(),
				preview,
				'Native and delegated history consume the same projection.'
			)
			assert.equal(
				(await admissionFacade!.request(`/${previewIntent}/preview?owner=${owner}`)).status,
				400
			)
			assert.equal(excerpt.sourceId, lastMessage)
			assert.equal(excerpt.nextOffset, 700)
			assert.equal(excerpt.complete, false)
			assert.equal(excerpt.totalChars, 707)
			assert.equal(excerpt.content, '🔭'.repeat(695) + 'amber')
			assert.equal(excerpt.feedback.vote, 'down')
			assert(!JSON.stringify(preview).includes('privateToolPayload'))
			const continuation = await turnRequest({
				kind: 'read',
				recordKind: 'message',
				id: lastMessage,
				offset: excerpt.nextOffset
			})
			assert.equal(continuation.status, 200)
			const continued = await continuation.json()
			assert.equal(excerpt.content + continued.content, previewText)
			assert.equal(continued.nextOffset, null)
			const foreignIntent = randomUUID(),
				foreignMessage = randomUUID(),
				foreignOwner = randomUUID()
			await store.create(foreignOwner, {
				id: foreignIntent,
				title: 'Private synthetic workshop',
				intentType: 'intent',
				sourceLabel: 'Boundary proof',
				deadline: null
			})
			await store.append(foreignOwner, foreignIntent, {
				id: foreignMessage,
				contributorKind: 'human',
				kind: 'message',
				text: 'Other-owner synthetic content.',
				payload: {}
			})
			for (const [recordKind, id] of [
				['intent', foreignIntent],
				['message', foreignMessage]
			])
				assert.equal((await turnRequest({ kind: 'read', recordKind, id })).status, 404)
			assert.equal((await admissionFacade!.request(`/${foreignIntent}/preview`)).status, 404)
			const foreignSearch = await turnRequest({
				kind: 'search',
				recordKind: 'message',
				input: { intent: foreignIntent }
			})
			assert.deepEqual((await foreignSearch.json()).messages, [])
			for (const body of [
				{ ...historySearch, subjectId: foreignOwner },
				{ ...historySearch, input: { ...historySearch.input, owner: foreignOwner } },
				{ ...historySearch, input: { limit: 51 } },
				{ ...historySearch, input: { cursor: 'not-a-cursor' } },
				{ kind: 'read', recordKind: 'message', id: accepted.contributionId, offset: -1 },
				{ kind: 'read', recordKind: 'intent', id: intentId, offset: 1 }
			])
				assert.equal((await turnRequest(body)).status, 400)
			for (const untrusted of [
				{ authorization: 'Bearer invalid' },
				{ 'x-aven-identity-token': await identityToken() },
				{ origin: 'https://untrusted.example.test' },
				{ cookie: 'session=not-authority' }
			] as Record<string, string>[])
				assert.equal((await admissionFacade!.exchangeRequest(exchangeInput, untrusted)).status, 403)
			assert.equal(
				(await admissionFacade!.exchangeRequest({ ...exchangeInput, workToken: 'invalid' })).status,
				403
			)
			assert.equal(
				(
					await admissionFacade!.exchangeRequest({
						...exchangeInput,
						actions: ['intents:delete'],
						componentRef: 'ceo.aven:component:data:intents@1'
					})
				).status,
				403
			)
			assert.equal(
				(
					await admissionFacade!.exchangeRequest({
						...exchangeInput,
						targetUrl: 'http://untrusted.example.test'
					})
				).status,
				400
			)
			assert.equal(
				(await admissionFacade!.exchangeRequest({ ...exchangeInput, extra: 'x'.repeat(17 * 1024) }))
					.status,
				413
			)
			await assert.rejects(
				() =>
					delegatedRepository(accepted.turnId, runId, randomUUID(), outbox.work_grant).list(
						owner,
						{}
					),
				/WORK_EXECUTION_ENDED/
			)
			await assert.rejects(
				() =>
					delegatedRepository(randomUUID(), runId, leaseOwnerId, outbox.work_grant).list(owner, {}),
				/WORK_EXECUTION_ENDED/
			)
			const wrongCauseHeaders = await delegatedHeaders(
				accepted.turnId,
				runId,
				leaseOwnerId,
				outbox.work_grant,
				true
			)
			for (const cause of [
				{ intentId: null, contributionId: null },
				{ intentId, contributionId: randomUUID() }
			])
				assert(
					[403, 404].includes(
						(
							await request('/commands', {
								method: 'POST',
								headers: wrongCauseHeaders,
								body: {
									command: { operation: 'create', tasks: [{ title: 'Must not be saved' }] },
									cause: { ...cause, operationId: randomUUID() }
								}
							})
						).status
					)
				)
			const nearExpiry = (
				await pool!.query(
					`UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',
        to_jsonb((clock_timestamp()+interval '4 seconds')::text)) WHERE id=$1 RETURNING record->'lease'->>'expiresAt' AS expiry`,
					[runId]
				)
			).rows[0].expiry
			const boundedHeaders = await delegatedHeaders(
				accepted.turnId,
				runId,
				leaseOwnerId,
				outbox.work_grant,
				false
			)
			const shortGrant = await verifyTenantGrant(
				boundedHeaders.get('x-aven-tenant-grant')!,
				tenantKeys.publicKey,
				{ issuer, audience: PRODUCTIVITY_COMPONENT, action: 'productivity:read' }
			)
			assert(
				shortGrant.exp <= Math.floor(new Date(nearExpiry).getTime() / 1000),
				'An issued grant cannot outlive its observed runner lease.'
			)
			assert.equal((await request('/tasks', { headers: boundedHeaders })).status, 200)
			await Bun.sleep(Math.max(0, shortGrant.exp * 1000 - Date.now() + 25))
			assert.equal(
				(await request('/tasks', { headers: boundedHeaders })).status,
				403,
				'Execution must not inherit login expiration tolerance.'
			)
			await pool!.query(
				`UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1`,
				[runId]
			)
			await assert.rejects(() => delegated.list(owner, {}), /WORK_EXECUTION_ENDED/)
			await pool!.query(
				`UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()+interval '10 minutes')::text)) WHERE id=$1`,
				[runId]
			)
			await admissionFacade!.control.query(
				`UPDATE customer_environments SET observed_state='suspended' WHERE id=$1`,
				[environmentId]
			)
			await assert.rejects(
				() => delegated.list(owner, {}),
				(error) =>
					error instanceof TaskRequestError &&
					error.status === 503 &&
					error.code === 'COMPONENT_NOT_READY'
			)
			await admissionFacade!.control.query(
				`UPDATE customer_environments SET observed_state='ready' WHERE id=$1`,
				[environmentId]
			)
			await turns.finish(turnScope, accepted.turnId, runId, {
				state: 'completed',
				text: 'Synthetic boundary check finished.',
				payload: {}
			})
			// A receipt can close an already published run after its original execution
			// authority expires. This must never release the old work certificate.
			await pool!.query(
				`UPDATE aven_intents.turn_outbox SET authority_expires_at=clock_timestamp()-interval '1 second' WHERE turn_id=$1`,
				[accepted.turnId]
			)
			const freshPlacement = (
				await (await admissionFacade!.placementRequest(placementInput)).json()
			).placements[0]
			const completionResponse = await lifecycleRequest(
				{ kind: 'resume', run: runReference },
				{ 'x-aven-worker-placement': freshPlacement }
			)
			assert.equal(completionResponse.status, 200)
			const completion = await completionResponse.json()
			assert.equal(completion.state, 'completed')
			assert.equal(completion.contributionId, outbox.output_id)
			assert.deepEqual(Object.keys(completion).sort(), ['contributionId', 'state'])
			await assert.rejects(() => delegated.list(owner, {}), /WORK_EXECUTION_ENDED/)
			assert.equal(
				(await turnRequest({ kind: 'context' })).status,
				409,
				'An earlier read grant cannot reopen a completed turn.'
			)
			assert.equal(
				(await turnRequest(historySearch)).status,
				409,
				'History retrieval ends with the originating turn.'
			)
			assert.equal(
				(await admissionFacade!.request('/input', { ...input, text: 'Different request' })).status,
				409
			)
			assert.equal(
				(await admissionFacade!.request('/input', { ...input, bearerToken: 'untrusted' })).status,
				400
			)
			assert.equal((await admissionFacade!.request('/input', input, randomUUID())).status, 404)
			const directHeaders = await headers()
			directHeaders.set(
				'x-aven-tenant-grant',
				await signTenantGrant(
					{ ...claims(owner, 'ceo.aven:component:data:intents@1'), actions: ['intents:write'] },
					tenantKeys.privateKey
				)
			)
			directHeaders.set('x-aven-work-grant', outbox.work_grant)
			const swapped = await fetch(new URL('/api/intents/input', service.url), {
				method: 'POST',
				headers: directHeaders,
				body: JSON.stringify({ ...input, inputId: randomUUID() })
			})
			assert.equal(swapped.status, 401, 'A valid certificate cannot authorize another message.')
			directHeaders.delete('x-aven-work-grant')
			assert.equal(
				(
					await fetch(new URL('/api/intents/input', service.url), {
						method: 'POST',
						headers: directHeaders,
						body: JSON.stringify(input)
					})
				).status,
				401
			)
			await admissionFacade!.control.query(
				`UPDATE customer_environment_components SET observed_state='suspended'
        WHERE environment_id=$1 AND component_ref=$2`,
				[environmentId, PRODUCTIVITY_COMPONENT]
			)
			const limitedInput = { ...input, inputId: randomUUID() },
				limited = await admissionFacade!.admit(limitedInput)
			const limitedWork = await verifyWorkGrant(
				(
					await pool!.query('SELECT work_grant FROM aven_intents.turn_outbox WHERE turn_id=$1', [
						limited.turnId
					])
				).rows[0].work_grant,
				tenantKeys.publicKey,
				issuer
			)
			assert(
				!workAllows(limitedWork, PRODUCTIVITY_COMPONENT, ['productivity:write']),
				'Unavailable optional actors cannot receive delegated authority.'
			)
			await admissionFacade!.control.query(
				`UPDATE customer_environment_components SET observed_state='ready'
        WHERE environment_id=$1 AND component_ref=$2`,
				[environmentId, PRODUCTIVITY_COMPONENT]
			)
			const rejectedInput = { ...input, inputId: randomUUID() }
			await admissionFacade!.control.query(
				`UPDATE customer_environment_components SET observed_state='suspended'
        WHERE environment_id=$1 AND component_ref=$2`,
				[environmentId, 'os.aven:component:actors:run-repository@1']
			)
			assert.equal((await admissionFacade!.request('/input', rejectedInput)).status, 503)
			assert.equal(
				(
					await pool!.query('SELECT 1 FROM aven_intents.input_admissions WHERE input_id=$1', [
						rejectedInput.inputId
					])
				).rowCount,
				0
			)
			await admissionFacade!.control.query(
				`UPDATE customer_environment_components SET observed_state='ready'
        WHERE environment_id=$1 AND component_ref=$2`,
				[environmentId, 'os.aven:component:actors:run-repository@1']
			)
			const pending = {
				command: { operation: 'create', tasks: [{ title: 'Check the ventilation fan' }] },
				cause: { operationId: randomUUID(), intentId, contributionId: null }
			}
			const missing = await headers()
			missing.delete('x-aven-intent-grant')
			assert.equal(
				(await request('/commands', { method: 'POST', body: pending, headers: missing })).status,
				403
			)
			const wrongSession = await headers()
			wrongSession.set('x-aven-session', randomUUID())
			assert.equal((await request('/tasks', { headers: wrongSession })).status, 403)
			const wrongGeneration = await headers(owner, { routingGeneration: 2 })
			// A valid but stale/superseded generation cannot acquire a tenant pool.
			assert.equal((await request('/tasks', { headers: wrongGeneration })).status, 503)
			const wrongEnvironment = await headers()
			const foreignEnvironment = randomUUID()
			wrongEnvironment.set(
				'x-aven-intent-grant',
				await signTenantGrant(
					{
						...claims(owner, 'ceo.aven:component:data:intents@1'),
						environmentId: foreignEnvironment,
						databaseName: databaseNameForEnvironment(foreignEnvironment)
					},
					tenantKeys.privateKey
				)
			)
			assert.equal(
				(await request('/commands', { method: 'POST', body: pending, headers: wrongEnvironment }))
					.status,
				403
			)
			assert.equal(
				(await request('/commands', { method: 'POST', body: pending, subject: randomUUID() }))
					.status,
				404
			)
			assert.equal(
				(
					await request('/commands', {
						method: 'POST',
						body: { ...pending, cause: { ...pending.cause, contributionId: randomUUID() } }
					})
				).status,
				404
			)
			assert.equal((await request('/tasks?limit=5&limit=10')).status, 400)
			const taskPool = await tasks.forGrant({ ...claims(), iat: 1, exp: 2 })
			await assert.rejects(
				() => taskPool.query('SELECT * FROM aven_intents.intents'),
				/permission denied/
			)
			await assert.rejects(
				() => taskPool.query('DELETE FROM aven_productivity.tasks'),
				/permission denied/
			)
			await assert.rejects(
				() => taskPool.query('UPDATE aven_productivity.task_commands SET receipt=receipt'),
				/permission denied/
			)
			await assert.rejects(
				() => intentPool.query('SELECT * FROM aven_productivity.tasks'),
				/permission denied/
			)
			const before = await repository().list(owner, {})
			await pool!.query('UPDATE aven_platform.environment_identity SET execution_enabled=false')
			assert.equal((await request('/commands', { method: 'POST', body: pending })).status, 409)
			assert.equal((await request('/tasks')).status, 200, 'Paused work remains readable.')
			await pool!.query('UPDATE aven_platform.environment_identity SET execution_enabled=true')
			assert.deepEqual(await repository().list(owner, {}), before)
			const port = service.port
			await service.stop(true)
			service = Bun.serve({ hostname: '127.0.0.1', port, fetch: handler })
			servers.push(service)
			assert.deepEqual(
				await repository().list(owner, {}),
				before,
				'HTTP process reload retains the task list.'
			)
			assert(
				logs.every((value) => /password authentication failed/.test(value)),
				`Unexpected service errors: ${logs.join('; ')}`
			)
			return {
				signedAdmission: true,
				atomicFacadeAdmission: true,
				boundedWorkAuthority: true,
				admissionReplay: true,
				contextOwnership: true,
				delegatedWork: true,
				httpExchangeAndGuards: true,
				confusedAuthorityRejected: true,
				leaseFencing: true,
				delegatedCause: true,
				signedWorkerDiscovery: true,
				signedTurnAdmission: true,
				admissionCannotExecute: true,
				signedLifecycleRecovery: true,
				resumedCertificateCannotExecute: true,
				completedReceiptWithoutAuthority: true,
				signedTurnContext: true,
				contextGrantCannotPublish: true,
				grantsBoundedToLease: true,
				roleIsolation: true,
				generation: true,
				pause: true,
				serviceRestart: true
			}
		}
		const placementClient = new WorkerPlacementClient({
			baseUrl: admissionFacade.baseUrl,
			serviceToken,
			runtimeId: 'primary',
			componentRef: 'ceo.aven:component:data:intents@1',
			issuer,
			publicKey: tenantKeys.publicKey
		})
		const actorPlacementClient = new WorkerPlacementClient({
			baseUrl: admissionFacade.baseUrl,
			serviceToken: runnerToken,
			runtimeId: 'primary',
			componentRef: 'os.aven:component:actors:run-repository@1',
			issuer,
			publicKey: tenantKeys.publicKey
		})
		const statusClient = new TurnStatusClient({
			baseUrl: runnerService.url.origin,
			serviceToken: runnerToken,
			placement: (signal) => actorPlacementClient.proof(environmentId, 1, signal)
		})
		const discover = async () => {
			const page = await placementClient.page()
			assert.equal(page.next, null)
			return (
				await Promise.all(
					page.placements.map(async (placement) =>
						new IntentTurnOutbox(await intents.forPlacement(placement)).pendingForWorker(placement)
					)
				)
			).flat()
		}
		const turnWorker = (
			dispatcherFor: ConstructorParameters<typeof IntentTurnWorker>[0]['dispatcherFor'],
			report?: ConstructorParameters<typeof IntentTurnWorker>[0]['report'],
			mode: 'dispatch' | 'supervise' = 'dispatch'
		) =>
			new IntentTurnWorker(
				{
					placements: placementClient,
					outboxFor: async (placement) =>
						new IntentTurnOutbox(await intents.forPlacement(placement)),
					dispatcherFor,
					report,
					supervise: (outbox, placement, signal) =>
						superviseTurns(outbox, placement, statusClient, signal)
				},
				100,
				mode
			)
		const unavailablePlacements = async (count: number) => {
			assert(count >= 1 && count <= 32)
			const ref = 'ceo.aven:component:data:intents@1',
				component = catalog.get(ref)!.manifest
			for (let i = 1; i <= count; i++) {
				// Real directory rows, deliberately no physical database: emulate customers
				// whose database is unavailable, never mock a placement or model response.
				const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
				assert(id < environmentId)
				await admissionFacade!.control.query(
					`INSERT INTO customer_environments(id,purchased_name,owner_subject_id,database_name,
          desired_state,observed_state,routing_generation) VALUES($1,$2,$3,$4,'ready','ready',1)`,
					[id, `unavailable-proof-${i}`, owner, databaseNameForEnvironment(id)]
				)
				await admissionFacade!.control.query(
					`INSERT INTO customer_environment_components
          (environment_id,component_ref,desired_state,observed_state,target_schema_version,observed_schema_version,migration_set_digest,routing_generation)
          VALUES($1,$2,'ready','ready',$3,$3,$4,1)`,
					[id, ref, component.targetSchemaVersion, component.migrationSetDigest]
				)
			}
		}
		const turnClient = async (
			turnId: string,
			runId: string,
			leaseOwnerId: string,
			workToken: string
		) => {
			const work = await verifyWorkGrant(workToken, tenantKeys.publicKey, issuer)
			const client = new WorkGrantClient({
				baseUrl: admissionFacade!.baseUrl,
				serviceToken: exchangeToken,
				runtimeId: 'primary',
				issuer,
				publicKey: tenantKeys.publicKey,
				workToken,
				binding: { turnId, runId, leaseOwnerId, workId: work.jti }
			})
			return new TurnWorkClient({
				baseUrl: service.url.origin,
				headers: async (actions, signal) => ({
					authorization: `Bearer ${serviceToken}`,
					'x-aven-work-grant': workToken,
					'x-aven-tenant-grant': await client.grant(
						'ceo.aven:component:data:intents@1',
						actions,
						signal
					)
				})
			})
		}
		const dispatchClient = new TurnDispatchClient({
			controlUrl: admissionFacade.baseUrl,
			exchangeToken,
			runnerUrl: runnerService.url.origin,
			runnerToken,
			runtimeId: 'primary',
			issuer,
			publicKey: tenantKeys.publicKey
		})
		const lifecycleClient = new TurnLifecycleClient({
			baseUrl: service.url.origin,
			serviceToken,
			placement: (signal) => placementClient.proof(environmentId, 1, signal)
		})
		let losePublicationAck = false
		const publicationAttempts = new Map<string, number>()
		// Real Store, with a transport failure injected only after an actual commit.
		const publicationProxy = artifacts
			? Bun.serve({
					hostname: '127.0.0.1',
					port: 0,
					fetch: async (request) => {
						const path = new URL(request.url)
						if (request.method === 'PUT' && path.pathname.includes('/publications/')) {
							const publicationId = path.pathname.split('/').at(-1)!
							publicationAttempts.set(
								publicationId,
								(publicationAttempts.get(publicationId) ?? 0) + 1
							)
						}
						const response = await fetch(
							new Request(new URL(path.pathname + path.search, artifacts!.baseUrl), request),
							{ redirect: 'manual' }
						)
						if (
							losePublicationAck &&
							request.method === 'PUT' &&
							path.pathname.includes('/publications/') &&
							response.ok
						) {
							losePublicationAck = false
							await response.body?.cancel()
							return new Response(null, { status: 503 })
						}
						return response
					}
				})
			: undefined
		if (publicationProxy) servers.push(publicationProxy)
		const artifactAccess = async (
			publish: boolean,
			turnId: string,
			runId: string,
			leaseOwnerId: string,
			workToken: string,
			signal?: AbortSignal
		) => {
			assert(artifacts, 'Install the real artifact component for this journey.')
			const work = await verifyWorkGrant(workToken, tenantKeys.publicKey, issuer)
			return (publish ? createWorkArtifactPublisher : createWorkArtifactReader)({
				subjectId: work.sub,
				baseUrl: publish ? publicationProxy!.url.origin : artifacts.baseUrl,
				serviceToken: artifacts.token,
				environmentId,
				generation: 1,
				issuer,
				publicKey: tenantKeys.publicKey,
				signal,
				authority: new WorkGrantClient({
					baseUrl: admissionFacade!.baseUrl,
					serviceToken: exchangeToken,
					runtimeId: 'primary',
					issuer,
					publicKey: tenantKeys.publicKey,
					workToken,
					binding: { workId: work.jti, turnId, runId, leaseOwnerId }
				})
			})
		}
		const artifactReader = (...args: [string, string, string, string, AbortSignal?]) =>
			artifactAccess(false, ...args)
		const artifactPublisher = (...args: [string, string, string, string, AbortSignal?]) =>
			artifactAccess(true, ...args)
		const studioAuthoring = async (
			turnId: string,
			runId: string,
			leaseOwnerId: string,
			workToken: string,
			runner: PlanRunner,
			installations: TrustedActorInstallations,
			catalog: StudioCatalogSource,
			signal?: AbortSignal
		) => {
			const work = await verifyWorkGrant(workToken, tenantKeys.publicKey, issuer)
			return createWorkStudioAuthoring({
				work,
				issuer,
				publicKey: tenantKeys.publicKey,
				pools: actors,
				workerPools: workers,
				runner,
				installations,
				catalog,
				artifacts: new StudioArtifacts(
					await artifactPublisher(turnId, runId, leaseOwnerId, workToken, signal),
					environmentId
				),
				authority: new WorkGrantClient({
					baseUrl: admissionFacade!.baseUrl,
					serviceToken: exchangeToken,
					runtimeId: 'primary',
					issuer,
					publicKey: tenantKeys.publicKey,
					workToken,
					binding: { workId: work.jti, turnId, runId, leaseOwnerId }
				})
			})
		}
		const seedArtifacts = artifacts
			? new ArtifactStoreClient({
					baseUrl: artifacts.baseUrl,
					bearerToken: () => artifacts!.token,
					requestHeaders: () => ({
						'x-aven-artifact-database': databaseName,
						'x-aven-environment': environmentId,
						'x-aven-routing-generation': '1'
					})
				})
			: undefined
		return {
			pool,
			repository,
			store,
			environmentId,
			databaseName,
			close,
			boundaries,
			request,
			owner,
			turnClient,
			dispatchClient,
			lifecycleClient,
			artifactReader,
			artifactPublisher,
			studioAuthoring,
			seedArtifacts,
			publicationAttempts,
			losePublicationAcknowledgement: () => {
				losePublicationAck = true
			},
			statusClient,
			placementClient,
			actorPlacementClient,
			runnerServiceUrl: runnerService.url.origin,
			runnerToken,
			logs,
			// Host-only test wiring: exercise the production composition without
			// copying its authority adapters or exposing credentials in model evidence.
			background: () => {
				assert(artifacts, 'Background composition requires the real artifact component.')
				return {
					config: {
						controlUrl: admissionFacade!.baseUrl,
						exchangeToken,
						intentUrl: service.url.origin,
						intentToken: serviceToken,
						artifactUrl: artifacts.baseUrl,
						artifactToken: artifacts.token,
						runnerUrl: runnerService.url.origin,
						runnerToken,
						runtimeId: 'primary',
						issuer,
						publicKey: tenantKeys.publicKey
					},
					pools: { pools: actors, workerPools: workers },
					intentPools: intents
				}
			},
			installRunner: (get: () => Pick<PlanRunner, 'start'>) => {
				activeRunner = get
			},
			turns,
			turnScope,
			delegatedRepository,
			actorPool,
			workerPool,
			admission: admissionFacade,
			discover,
			turnWorker,
			unavailablePlacements,
			tenantKey: tenantKeys.publicKey,
			issuer
		}
	} catch (error) {
		await close()
		throw error
	}
}
