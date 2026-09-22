/** Actual facade + encrypted ingress + JWT verification + isolated SQL authorization.
 * This fixture colocates control tables and component tables only in its random test
 * database; it does not qualify production placement, native login or use policy. */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import pg from 'pg'
import {
	createCredentialSealer,
	createCredentialUnsealer
} from '../../libs/aven-credential-storage/src/envelope'
import {
	CredentialAdminStore,
	CredentialMetadataStore
} from '../../libs/aven-credential-storage/src/postgres'
import {
	customerComponentCatalog,
	databaseNameForEnvironment
} from '../../libs/aven-customer-contracts/src/index'
import { IdentityVerifier } from '../../libs/aven-identity/src/index'
import { CustomerHandler } from '../../services/aven-api/src/customers/handler'
import { CustomerStore } from '../../services/aven-api/src/customers/store'
import { createFacadeHandler } from '../../services/aven-api/src/facade'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { createCredentialHandler } from '../../services/credential-service/src/handler'
import { credentialDatabase } from './credential-database'
import { credentialProcessFixture } from './credential-process-fixture'

export async function credentialManagementFixture(connection: string, tenantPools = false) {
	const environmentId = randomUUID(),
		subjectId = randomUUID(),
		sessionId = randomUUID()
	const database = await credentialDatabase(connection, environmentId, tenantPools)
	const root = new pg.Pool({ connectionString: database.databaseUrl })
	const roleSuffix = randomUUID().replaceAll('-', '')
	const roles = Object.fromEntries(
		['authorization', 'entitlements', 'reconciler', 'migrator'].map((kind) => [
			`aven_api_${kind}`,
			`proof_${kind}_${roleSuffix}`
		])
	)
	const servers: Array<{ stop(force?: boolean): Promise<void> | void }> = []
	let ingressProcess: Awaited<ReturnType<typeof credentialProcessFixture>> | undefined
	let authorization: pg.Pool | undefined
	const close = async () => {
		await ingressProcess?.close()
		await Promise.all(servers.map((server) => server.stop(true)))
		await authorization?.end()
		await root.end()
		await database.close()
		const maintenance = new pg.Pool({ connectionString: connection })
		try {
			for (const role of Object.values(roles))
				await maintenance.query(`DROP ROLE IF EXISTS ${role}`)
		} finally {
			await maintenance.end()
		}
	}
	try {
		for (const role of Object.values(roles)) await root.query(`CREATE ROLE ${role} NOLOGIN`)
		for (const file of [
			'0001_customer_platform.sql',
			'0002_customer_movement.sql',
			'0003_runtime_catalog.sql'
		]) {
			let sql = await readFile(
				new URL(`../../services/aven-api/migrations/${file}`, import.meta.url),
				'utf8'
			)
			for (const [from, to] of Object.entries(roles)) sql = sql.replaceAll(from, to)
			await root.query(sql)
		}
		const password = randomUUID()
		await root.query(`ALTER ROLE ${roles.aven_api_authorization} LOGIN PASSWORD '${password}'`)
		const login = new URL(database.databaseUrl)
		login.username = roles.aven_api_authorization!
		login.password = password
		authorization = new pg.Pool({ connectionString: login.toString() })
		const component = customerComponentCatalog.find(
			(c) => c.componentRef === 'ceo.aven:component:data:credentials@1'
		)!
		await root.query(
			`INSERT INTO customer_environments(id,purchased_name,owner_subject_id,database_name,desired_state,observed_state,routing_generation)
      VALUES($1,'synthetic-connections',$2,$3,'ready','ready',1)`,
			[environmentId, subjectId, databaseNameForEnvironment(environmentId)]
		)
		await root.query(
			`INSERT INTO customer_environment_memberships(environment_id,subject_id,role) VALUES($1,$2,'owner')`,
			[environmentId, subjectId]
		)
		await root.query(
			`INSERT INTO customer_environment_components(environment_id,component_ref,desired_state,observed_state,target_schema_version,migration_set_digest,routing_generation)
      VALUES($1,$2,'ready','ready',$3,$4,1)`,
			[
				environmentId,
				component.componentRef,
				component.targetSchemaVersion,
				component.migrationSetDigest
			]
		)
		const signing = await generateKeyPair('EdDSA'),
			jwk = await exportJWK(signing.publicKey)
		const identity = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: () => Response.json({ keys: [{ ...jwk, kid: 'synthetic', alg: 'EdDSA', use: 'sig' }] })
		})
		servers.push(identity)
		const issuer = `http://127.0.0.1:${identity.port}`,
			policyIssuer = 'https://synthetic-policy.example.test'
		const token = await new SignJWT({
			sid: sessionId,
			email: 'paper-orchard@example.test',
			email_verified: true,
			role: 'user',
			amr: ['passkey'],
			scope: 'services:access'
		})
			.setProtectedHeader({ alg: 'EdDSA', kid: 'synthetic' })
			.setSubject(subjectId)
			.setIssuer(issuer)
			.setAudience('aven-services')
			.setIssuedAt()
			.setExpirationTime('10m')
			.sign(signing.privateKey)
		const verifier = new IdentityVerifier({ issuer })
		const wrapping = await crypto.subtle.generateKey(
			{
				name: 'RSA-OAEP',
				modulusLength: 3072,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: 'SHA-256'
			},
			false,
			['encrypt', 'decrypt']
		)
		const serviceToken = randomUUID() + randomUUID()
		const ingress = createCredentialHandler(
			{ serviceToken, issuer: policyIssuer, key: signing.publicKey },
			verifier,
			{
				adminFor: async (grant) =>
					new CredentialAdminStore(database.pools.set, {
						environmentId: grant.environmentId,
						subjectId: grant.sub,
						generation: grant.routingGeneration
					}),
				metadataFor: async (grant) =>
					new CredentialMetadataStore(database.pools.metadata, {
						environmentId: grant.environmentId,
						subjectId: grant.sub,
						generation: grant.routingGeneration
					})
			},
			createCredentialSealer('synthetic', wrapping.publicKey)
		)
		let credentialPort: number
		if (tenantPools) {
			ingressProcess = await credentialProcessFixture({
				databaseUrl: database.databaseUrl,
				setRoot: database.roots.set,
				metadataRoot: database.roots.metadata,
				serviceToken,
				identityIssuer: issuer,
				tenantIssuer: policyIssuer,
				tenantKey: signing.publicKey,
				wrappingKey: wrapping.publicKey
			})
			credentialPort = ingressProcess.port
		} else {
			const credentialServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: ingress })
			servers.push(credentialServer)
			credentialPort = credentialServer.port!
		}
		let handler: ReturnType<typeof createFacadeHandler> | undefined
		const facade = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: (request) => (handler ? handler(request) : new Response(null, { status: 503 }))
		})
		servers.push(facade)
		const baseUrl = `http://127.0.0.1:${facade.port}`
		const store = new CustomerStore(authorization, policyIssuer)
		const config = testConfig({
			API_PUBLIC_BASE_URL: baseUrl,
			IDENTITY_ISSUER: issuer,
			CUSTOMER_DOWNSTREAMS_JSON: JSON.stringify([
				{
					segment: 'credentials',
					componentRef: component.componentRef,
					baseUrl: `http://127.0.0.1:${credentialPort}`,
					targetPrefix: '/api/credentials',
					bearerToken: serviceToken,
					readAction: 'credentials:read',
					writeAction: 'credentials:write'
				}
			])
		})
		const customers = new CustomerHandler(
			store,
			store,
			randomUUID() + randomUUID(),
			signing.privateKey
		)
		handler = createFacadeHandler(config, verifier, fetch, undefined, customers)
		return {
			environmentId,
			subjectId,
			sessionId,
			baseUrl,
			token,
			root,
			close,
			// Private in-process fixture ports, never serialized into evidence.
			config,
			customers,
			verifier,
			signing,
			policyIssuer,
			database,
			unsealer: createCredentialUnsealer(new Map([['synthetic', wrapping.privateKey]]))
		}
	} catch (error) {
		await close()
		throw error
	}
}
