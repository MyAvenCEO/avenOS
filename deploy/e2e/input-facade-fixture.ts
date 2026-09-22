/** Actual facade and control-directory SQL for synthetic, disposable admission journeys. */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { admissionReceiptSchema, type InputAdmission } from '@avenos/intents/admission'
import pg from 'pg'
import type { TenantGrantKey } from '../../libs/aven-customer-contracts/src'
import type { IdentityVerifier } from '../../libs/aven-identity/src'
import { CustomerHandler } from '../../services/aven-api/src/customers/handler'
import { CustomerStore } from '../../services/aven-api/src/customers/store'
import { configuredWorkControl } from '../../services/aven-api/src/customers/work-http'
import { createFacadeHandler } from '../../services/aven-api/src/facade'
import { testConfig } from '../../services/aven-api/tests/helpers'

export async function inputFacadeFixture(options: {
	databaseUrl: string
	environmentId: string
	databaseName: string
	owner: string
	issuer: string
	key: TenantGrantKey
	verifier: IdentityVerifier
	serviceUrl: string
	serviceToken: string
	identityToken: (subject?: string) => Promise<string>
	components: { componentRef: string; targetSchemaVersion: number; migrationSetDigest: string }[]
	work?: { serviceToken: string; publicKey: TenantGrantKey; runnerUrl: string; runnerToken: string }
}) {
	const name = `input_control_${randomBytes(12).toString('hex')}`
	const admin = new pg.Pool({ connectionString: options.databaseUrl, max: 1 })
	const rolePrefix = `input_proof_${randomBytes(8).toString('hex')}`
	const roles = new Map<string, string>(),
		rolePassword = randomBytes(32).toString('hex')
	let control: pg.Pool | undefined,
		authorization: pg.Pool | undefined,
		server: ReturnType<typeof Bun.serve> | undefined,
		ownsDatabase = false
	const close = async () => {
		await server?.stop(true)
		await authorization?.end()
		await control?.end()
		if (ownsDatabase) await admin.query(`DROP DATABASE IF EXISTS ${name}`)
		for (const role of roles.values()) await admin.query(`DROP ROLE IF EXISTS ${role}`)
		await admin.end()
	}
	try {
		assert.equal(
			(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount,
			0
		)
		await admin.query(`CREATE DATABASE ${name}`)
		ownsDatabase = true
		const url = new URL(options.databaseUrl)
		url.pathname = `/${name}`
		control = new pg.Pool({ connectionString: url.toString(), max: 1 })
		for (const suffix of ['authorization', 'entitlements', 'reconciler', 'migrator']) {
			const role = `${rolePrefix}_${suffix}`
			await admin.query(
				`CREATE ROLE ${role} ${suffix === 'authorization' ? `LOGIN PASSWORD '${rolePassword}'` : 'NOLOGIN'}`
			)
			roles.set(`aven_api_${suffix}`, role)
		}
		for (const migration of [
			'0001_customer_platform',
			'0002_customer_movement',
			'0003_runtime_catalog',
			'0004_customer_return'
		]) {
			let sql = await readFile(
				new URL(`../../services/aven-api/migrations/${migration}.sql`, import.meta.url),
				'utf8'
			)
			// Role names alone are scoped to the disposable fixture; production tables and grants are unchanged.
			for (const [original, replacement] of roles) sql = sql.replaceAll(original, replacement)
			await control.query(sql)
		}
		await control.query(
			`INSERT INTO customer_environments(id,purchased_name,owner_subject_id,database_name,
      desired_state,observed_state,routing_generation) VALUES($1,'synthetic-workshop',$2,$3,'ready','ready',1)`,
			[options.environmentId, options.owner, options.databaseName]
		)
		await control.query(
			`INSERT INTO customer_environment_memberships(environment_id,subject_id,role) VALUES($1,$2,'owner')`,
			[options.environmentId, options.owner]
		)
		for (const component of options.components)
			await control.query(
				`INSERT INTO customer_environment_components
      (environment_id,component_ref,desired_state,observed_state,target_schema_version,observed_schema_version,migration_set_digest,routing_generation)
      VALUES($1,$2,'ready','ready',$3,$3,$4,1)`,
				[
					options.environmentId,
					component.componentRef,
					component.targetSchemaVersion,
					component.migrationSetDigest
				]
			)
		url.username = roles.get('aven_api_authorization')!
		url.password = rolePassword
		authorization = new pg.Pool({ connectionString: url.toString(), max: 2 })
		await assert.rejects(
			() => authorization!.query(`UPDATE customer_environments SET routing_generation=2`),
			/permission denied/
		)
		const authorizationStore = new CustomerStore(authorization, options.issuer)
		const customers = new CustomerHandler(
			new CustomerStore(control, options.issuer),
			authorizationStore,
			randomBytes(32).toString('hex'),
			options.key
		)
		const config = testConfig({
			API_PUBLIC_BASE_URL: options.issuer,
			...(options.work && { WORK_GRANT_EXCHANGE_BEARER_TOKEN: options.work.serviceToken }),
			CUSTOMER_DOWNSTREAMS_JSON: JSON.stringify([
				{
					segment: 'intents',
					componentRef: 'ceo.aven:component:data:intents@1',
					baseUrl: options.serviceUrl,
					targetPrefix: '/api/intents',
					bearerToken: options.serviceToken,
					readAction: 'intents:read',
					writeAction: 'intents:write'
				},
				...(options.work
					? [
							{
								segment: 'actor-runs',
								componentRef: 'os.aven:component:actors:run-repository@1',
								baseUrl: options.work.runnerUrl,
								targetPrefix: '/api/actor-runs',
								bearerToken: options.work.runnerToken,
								readAction: 'actor-runs:read',
								writeAction: 'actor-runs:write'
							}
						]
					: [])
			])
		})
		const exchange = options.work
			? configuredWorkControl(config, authorizationStore, {
					privateKey: options.key,
					publicKey: options.work.publicKey
				})
			: undefined
		const handler = createFacadeHandler(
			config,
			options.verifier,
			fetch,
			undefined,
			customers,
			undefined,
			undefined,
			exchange
		)
		server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => handler(request) })
		const request = async (
			path: string,
			body?: unknown,
			subject?: string,
			headers?: Record<string, string>
		) =>
			fetch(new URL(`/api/environments/${options.environmentId}/intents${path}`, server!.url), {
				method: body === undefined ? 'GET' : 'POST',
				headers: {
					authorization: `Bearer ${await options.identityToken(subject)}`,
					'content-type': 'application/json',
					...headers
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) })
			})
		const progress = async (turnId: string, subject?: string) =>
			fetch(
				new URL(
					`/api/environments/${options.environmentId}/actor-runs/chat-turns/${turnId}`,
					server!.url
				),
				{
					headers: { authorization: `Bearer ${await options.identityToken(subject)}` }
				}
			)
		const admit = async (input: InputAdmission) => {
			const response = await request('/input', input),
				value = await response.json()
			assert.equal(response.status, 201, `Admission failed: ${JSON.stringify(value)}`)
			return admissionReceiptSchema.parse(value)
		}
		const exchangeRequest = (body: unknown, headers: Record<string, string> = {}) =>
			fetch(new URL('/internal/v1/work/exchange', server!.url), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${options.work?.serviceToken ?? ''}`,
					'content-type': 'application/json',
					...headers
				},
				body: JSON.stringify(body)
			})
		const placementRequest = (body: unknown, headers: Record<string, string> = {}) =>
			fetch(new URL('/internal/v1/work/placements', server!.url), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${options.serviceToken}`,
					'content-type': 'application/json',
					...headers
				},
				body: JSON.stringify(body)
			})
		const dispatchRequest = (body: unknown, headers: Record<string, string> = {}) =>
			fetch(new URL('/internal/v1/work/dispatch', server!.url), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${options.work?.serviceToken ?? ''}`,
					'content-type': 'application/json',
					...headers
				},
				body: JSON.stringify(body)
			})
		return {
			close,
			control,
			customers,
			request,
			progress,
			admit,
			authorizationStore,
			exchangeRequest,
			placementRequest,
			dispatchRequest,
			baseUrl: server.url.origin
		}
	} catch (error) {
		await close()
		throw error
	}
}
