import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { credentialUseSigner, credentialUseVerifier } from '../src/authority'
import type { CredentialUse } from '../src/contracts'
import { createCredentialSealer, createCredentialUnsealer } from '../src/envelope'
import { CredentialAdminStore, CredentialMetadataStore, CredentialUseStore } from '../src/postgres'

const url = process.env.CREDENTIAL_TEST_DATABASE_URL
const environmentId = randomUUID(),
	subjectId = randomUUID(),
	credentialRef = randomUUID(),
	bindingRef = randomUUID()
const scope = { environmentId, subjectId, generation: 1 }
const suffix = randomUUID().replaceAll('-', '')
const database = `credential_proof_${suffix}`,
	owner = `cred_owner_${suffix}`
const roles = {
	set: `cred_set_${suffix}`,
	metadata: `cred_meta_${suffix}`,
	http: `cred_http_${suffix}`,
	imap: `cred_imap_${suffix}`
}
const password = randomUUID()
let admin: pg.Pool, db: pg.Pool
const runtime: Partial<Record<keyof typeof roles, pg.Pool>> = {}
let set: CredentialAdminStore,
	metadata: CredentialMetadataStore,
	http: CredentialUseStore,
	imap: CredentialUseStore
let seal: ReturnType<typeof createCredentialSealer>,
	unseal: ReturnType<typeof createCredentialUnsealer>
const profile = {
	label: 'Synthetic inventory',
	placements: ['server'],
	schemes: ['https'],
	host: { kind: 'exact', value: 'inventory.example.test' },
	ports: [443],
	pathPrefix: '/items',
	methods: ['GET'],
	purpose: 'inventory-read',
	attachment: { kind: 'header', name: 'authorization', prefix: 'Bearer ' }
}
const digest = 'a'.repeat(64)
function authority(patch: Partial<CredentialUse> = {}): CredentialUse {
	return {
		authorizationId: randomUUID(),
		runId: randomUUID(),
		leaseOwnerId: randomUUID(),
		...scope,
		sessionId: 'synthetic-active-session',
		generation: 1,
		protocol: 'http',
		capabilityId: 'ceo.aven:capability:web.http-fetch:http_fetch_authenticated@1',
		invocationId: randomUUID(),
		attemptId: randomUUID(),
		callerActorId: 'ceo.aven:actor:test:inventory@1',
		parentInvocationIds: [],
		credentialRef,
		bindingRef,
		bindingRevision: 1,
		secretVersion: 1,
		requestOccurrenceId: randomUUID(),
		requestArtifactDigest: digest,
		operationDigest: digest,
		requestSchemaId: 'ceo.aven:schema:web:http-request@1',
		purpose: 'inventory-read',
		policyRevision: 1,
		reviewRequestId: randomUUID(),
		reviewDecisionId: randomUUID(),
		mode: 'productive',
		publicationScopeId: randomUUID(),
		maximumUnits: 3,
		maximumBytes: 4096,
		issuedAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 120000).toISOString(),
		...patch
	}
}
const secret = Buffer.from('independently-generated-fixture-token-not-a-real-secret')
async function createCredential(ref = credentialRef, kind: 'token' | 'password' = 'token') {
	const envelope = await seal.seal(secret, {
		environmentId,
		ownerSubjectId: subjectId,
		credentialRef: ref,
		kind,
		secretVersion: 1
	})
	const command = {
		action: 'create' as const,
		credentialRef: ref,
		expectedVersion: 0 as const,
		label: 'Synthetic inventory',
		kind,
		envelope
	}
	const commandId = randomUUID()
	await set.command(commandId, command)
	return { command, commandId }
}
describe.skipIf(!url)('credential store with actual isolated PostgreSQL roles', () => {
	beforeAll(async () => {
		if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
			throw Error('An isolated local PostgreSQL URL is required')
		const pair = await crypto.subtle.generateKey(
			{
				name: 'RSA-OAEP',
				modulusLength: 3072,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: 'SHA-256'
			},
			false,
			['encrypt', 'decrypt']
		)
		seal = createCredentialSealer('synthetic', pair.publicKey)
		unseal = createCredentialUnsealer(new Map([['synthetic', pair.privateKey]]))
		admin = new pg.Pool({ connectionString: url })
		await admin.query(`CREATE DATABASE ${database}`)
		const target = new URL(url)
		target.pathname = `/${database}`
		db = new pg.Pool({ connectionString: target.toString() })
		await db.query(`CREATE ROLE ${owner} NOLOGIN; CREATE SCHEMA aven_platform;
      CREATE TABLE aven_platform.environment_identity(singleton boolean PRIMARY KEY,environment_id uuid NOT NULL,routing_generation bigint NOT NULL,execution_enabled boolean NOT NULL DEFAULT true,execution_unsettled uuid[] NOT NULL DEFAULT '{}');
      CREATE SCHEMA aven_credentials AUTHORIZATION ${owner};
      GRANT USAGE ON SCHEMA aven_platform TO ${owner};
      GRANT SELECT,UPDATE(execution_unsettled) ON aven_platform.environment_identity TO ${owner}`)
		await db.query(
			'INSERT INTO aven_platform.environment_identity(singleton,environment_id,routing_generation) VALUES(true,$1,1)',
			[environmentId]
		)
		const migration = await readFile(
			new URL(
				'../../../services/platform-provisioner/components/credentials/0001_credentials.sql',
				import.meta.url
			),
			'utf8'
		)
		// One actual component owner creates all objects; runtime logins cannot assume it.
		const client = await db.connect()
		try {
			await client.query(`SET ROLE ${owner}`)
			await client.query(migration)
			await client.query('RESET ROLE')
		} finally {
			client.release()
		}
		const grants = {
			set: ['admin_command(uuid,uuid,bigint,uuid,jsonb)', 'command_receipt(uuid,uuid,bigint,uuid)'],
			metadata: ['metadata(uuid,uuid,bigint)'],
			http: [
				'claim_http(jsonb,int,text)',
				'finish_http(uuid,uuid,uuid,int,text,text)',
				'settle_http(uuid,uuid,uuid)'
			],
			imap: [
				'claim_imap(jsonb,int,text)',
				'finish_imap(uuid,uuid,uuid,int,text,text)',
				'settle_imap(uuid,uuid,uuid)'
			]
		}
		for (const kind of Object.keys(roles) as Array<keyof typeof roles>) {
			await db.query(
				`CREATE ROLE ${roles[kind]} LOGIN PASSWORD '${password}'; GRANT USAGE ON SCHEMA aven_credentials TO ${roles[kind]}`
			)
			for (const fn of grants[kind])
				await db.query(`GRANT EXECUTE ON FUNCTION aven_credentials.${fn} TO ${roles[kind]}`)
			const login = new URL(target)
			login.username = roles[kind]
			login.password = password
			runtime[kind] = new pg.Pool({ connectionString: login.toString(), max: 4 })
		}
		set = new CredentialAdminStore(runtime.set!, scope)
		metadata = new CredentialMetadataStore(runtime.metadata!, scope)
		http = new CredentialUseStore(runtime.http!, scope, 'http')
		imap = new CredentialUseStore(runtime.imap!, scope, 'imap')
	}, 30000)
	afterAll(async () => {
		await Promise.all(Object.values(runtime).map((pool) => pool.end()))
		await db?.end()
		if (admin) {
			try {
				await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
				for (const role of [...Object.values(roles), owner])
					await admin.query(`DROP ROLE IF EXISTS ${role}`)
			} finally {
				await admin.end()
			}
		}
	})

	test('set-only create and readback contain no secret or ciphertext; retries are exact', async () => {
		const { command, commandId } = await createCredential()
		const receipt = await set.command(commandId, command)
		expect(await set.receipt(commandId)).toEqual(receipt)
		expect(receipt).toMatchObject({ credentialRef, secretVersion: 1, enabled: true })
		await expect(set.command(commandId, { ...command, label: 'different' })).rejects.toMatchObject({
			code: 'CREDENTIAL_COMMAND_CONFLICT'
		})
		const list = await metadata.metadata()
		expect(list.credentials).toHaveLength(1)
		expect(JSON.stringify([receipt, list])).not.toContain(secret.toString())
		expect(JSON.stringify([receipt, list])).not.toContain(command.envelope.jwe.ciphertext)
		await set.command(randomUUID(), {
			action: 'binding-set',
			credentialRef,
			bindingRef,
			expectedVersion: 0,
			protocol: 'http',
			profile
		})
	})
	test('every runtime login is denied tables, owner escalation and private core functions', async () => {
		for (const pool of Object.values(runtime)) {
			for (const table of ['credentials', 'bindings', 'commands', 'uses', 'claims'])
				await expect(pool.query(`SELECT * FROM aven_credentials.${table}`)).rejects.toMatchObject({
					code: '42501'
				})
			await expect(pool.query(`SET ROLE ${owner}`)).rejects.toMatchObject({ code: '42501' })
			await expect(
				pool.query("SELECT aven_credentials.claim_unit('http','{}',0,$1)", [digest])
			).rejects.toMatchObject({ code: '42501' })
		}
		await expect(
			runtime.set!.query('SELECT aven_credentials.claim_http($1,0,$2)', [authority(), digest])
		).rejects.toMatchObject({ code: '42501' })
		await expect(
			runtime.http!.query('SELECT aven_credentials.claim_imap($1,0,$2)', [authority(), digest])
		).rejects.toMatchObject({ code: '42501' })
		await expect(
			runtime.metadata!.query('SELECT aven_credentials.admin_command($1,$2,1,$3,$4)', [
				environmentId,
				subjectId,
				randomUUID(),
				{}
			])
		).rejects.toMatchObject({ code: '42501' })
	})
	test('parallel identical claims release one envelope only and never retry an uncertain request', async () => {
		const grant = authority()
		const results = await Promise.all(
			Array.from({ length: 12 }, () => http.claim(grant, 0, digest))
		)
		expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1)
		expect(results.filter((r) => r.outcome === 'already-claimed')).toHaveLength(11)
		const claimed = results.find((r) => r.outcome === 'claimed')!
		if (claimed.outcome !== 'claimed') throw Error('claim missing')
		expect(
			Buffer.from(
				await unseal.unseal(claimed.envelope, {
					environmentId,
					ownerSubjectId: subjectId,
					credentialRef,
					kind: 'token',
					secretVersion: 1
				})
			)
		).toEqual(secret)
		await expect(http.claim(grant, 1, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_PREVIOUS_UNIT_UNSETTLED'
		})
		await http.finish(grant.authorizationId, 0, digest, 'uncertain')
		expect(await http.claim(grant, 0, digest)).toEqual({
			outcome: 'already-claimed',
			state: 'uncertain'
		})
		await expect(http.finish(grant.authorizationId, 0, digest, 'succeeded')).rejects.toMatchObject({
			code: 'CREDENTIAL_USE_CONFLICT'
		})
		await expect(http.claim(grant, 1, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_PREVIOUS_UNIT_UNSETTLED'
		})
	})
	test('lifecycle fence survives expiry and suspension until explicit once-only shutdown', async () => {
		const counter = async () =>
			Number(
				(
					await db.query(
						'SELECT cardinality(execution_unsettled) AS count FROM aven_platform.environment_identity'
					)
				).rows[0].count
			)
		const before = await counter()
		const grant = authority()
		await http.claim(grant, 0, digest)
		expect(await counter()).toBe(before + 1)
		await http.finish(grant.authorizationId, 0, digest, 'succeeded')
		expect(await counter()).toBe(before + 1)
		await http.claim(grant, 1, digest)
		expect(await counter()).toBe(before + 1)
		await expect(imap.settle(grant.authorizationId)).rejects.toMatchObject({
			code: 'CREDENTIAL_USE_DENIED'
		})
		await expect(
			new CredentialUseStore(runtime.http!, { ...scope, subjectId: randomUUID() }, 'http').settle(
				grant.authorizationId
			)
		).rejects.toMatchObject({ code: 'CREDENTIAL_USE_DENIED' })
		await db.query(
			"UPDATE aven_credentials.uses SET expires_at=clock_timestamp()-interval '1 second' WHERE authorization_id=$1",
			[grant.authorizationId]
		)
		await db.query('UPDATE aven_platform.environment_identity SET execution_enabled=false')
		try {
			expect(await counter()).toBe(before + 1)
			await Promise.all(Array.from({ length: 8 }, () => http.settle(grant.authorizationId)))
			expect(await counter()).toBe(before)
		} finally {
			await db.query('UPDATE aven_platform.environment_identity SET execution_enabled=true')
		}
		await expect(http.claim(grant, 2, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_USE_SETTLED'
		})
		expect(await http.claim(grant, 0, digest)).toEqual({
			outcome: 'already-claimed',
			state: 'succeeded'
		})
		expect(await counter()).toBe(before)
	})
	test('protocol, owner, customer, epoch, budget and command order remain bound', async () => {
		await expect(imap.claim(authority(), 0, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_USE_DENIED'
		})
		await expect(http.claim(authority({ generation: 2 }), 0, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_SCOPE_INVALID'
		})
		await expect(
			new CredentialUseStore(runtime.http!, { ...scope, subjectId: randomUUID() }, 'http').claim(
				authority(),
				0,
				digest
			)
		).rejects.toMatchObject({ code: 'CREDENTIAL_USE_DENIED' })
		await expect(
			new CredentialMetadataStore(runtime.metadata!, {
				...scope,
				environmentId: randomUUID()
			}).metadata()
		).rejects.toMatchObject({ code: 'CREDENTIAL_SCOPE_INVALID' })
		const grant = authority({ maximumUnits: 2 })
		await expect(http.claim(grant, 1, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_UNIT_ORDER_INVALID'
		})
		await http.claim(grant, 0, digest)
		await http.finish(grant.authorizationId, 0, digest, 'succeeded')
		await http.claim(grant, 1, digest)
		await http.finish(grant.authorizationId, 1, digest, 'succeeded')
		await expect(http.claim(grant, 2, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_USE_DENIED'
		})
		await expect(http.claim({ ...grant, maximumUnits: 3 }, 2, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_USE_CONFLICT'
		})
		await expect(
			http.claim({ ...grant, authorizationId: randomUUID() }, 0, digest)
		).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_UNAVAILABLE' })
	})
	test('signed authority cannot cross protocol, issuer, key, lifetime or request fields', async () => {
		const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
			'sign',
			'verify'
		])) as CryptoKeyPair
		const sign = credentialUseSigner('https://policy.example.test', pair.privateKey)
		const verify = credentialUseVerifier('https://policy.example.test', pair.publicKey, 'http')
		const grant = authority(),
			token = await sign(grant)
		expect(await verify(token)).toEqual(grant)
		await expect(
			credentialUseVerifier('https://policy.example.test', pair.publicKey, 'imap')(token)
		).rejects.toMatchObject({ code: 'CREDENTIAL_AUTHORITY_INVALID' })
		await expect(
			credentialUseVerifier('https://other.example.test', pair.publicKey, 'http')(token)
		).rejects.toMatchObject({ code: 'CREDENTIAL_AUTHORITY_INVALID' })
		const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
			'sign',
			'verify'
		])) as CryptoKeyPair
		await expect(
			credentialUseVerifier('https://policy.example.test', other.publicKey, 'http')(token)
		).rejects.toMatchObject({ code: 'CREDENTIAL_AUTHORITY_INVALID' })
		const parts = token.split('.')
		parts[1] = Buffer.from(
			JSON.stringify({
				...JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()),
				use: { ...grant, maximumUnits: 128 }
			})
		).toString('base64url')
		await expect(verify(parts.join('.'))).rejects.toMatchObject({
			code: 'CREDENTIAL_AUTHORITY_INVALID'
		})
		await expect(
			sign({ ...grant, expiresAt: new Date(Date.now() + 3600000).toISOString() })
		).rejects.toMatchObject({ code: 'CREDENTIAL_INPUT_INVALID' })
		await expect(
			sign({
				...grant,
				issuedAt: new Date(Date.now() - 120000).toISOString(),
				expiresAt: new Date(Date.now() - 60000).toISOString()
			})
		).rejects.toMatchObject({ code: 'CREDENTIAL_AUTHORITY_INVALID' })
	})
	test('IMAP uses the same store with distinct bindings, command claims and immutable account identity', async () => {
		const credential = randomUUID(),
			binding = randomUUID(),
			account = randomUUID()
		await createCredential(credential, 'password')
		const profile = {
			label: 'Synthetic workshop mail',
			host: 'mail.example.test',
			port: 993,
			tls: 'implicit',
			authentication: 'password',
			login: 'workshop@example.test',
			accountRef: account,
			mailboxes: ['INBOX', 'Parts'],
			operations: ['query', 'read-message'],
			purpose: 'parts-mail',
			maximumCommands: 12,
			maximumBytes: 4096,
			maximumSeconds: 30
		}
		await set.command(randomUUID(), {
			action: 'binding-set',
			credentialRef: credential,
			bindingRef: binding,
			expectedVersion: 0,
			protocol: 'imap',
			profile
		})
		const grant = authority({
			protocol: 'imap',
			credentialRef: credential,
			bindingRef: binding,
			purpose: 'parts-mail',
			capabilityId: 'ceo.aven:capability:mail.imap-mailbox:imap_query@1',
			requestSchemaId: 'ceo.aven:schema:mail:imap-query@1'
		})
		expect((await imap.claim(grant, 0, digest)).outcome).toBe('claimed')
		await imap.finish(grant.authorizationId, 0, digest, 'succeeded')
		await expect(
			set.command(randomUUID(), {
				action: 'binding-set',
				credentialRef: credential,
				bindingRef: binding,
				expectedVersion: 1,
				protocol: 'imap',
				profile: { ...profile, login: 'different-account@example.test' }
			})
		).rejects.toMatchObject({ code: 'CREDENTIAL_ACCOUNT_CHANGE_REQUIRES_NEW_BINDING' })
		await expect(
			set.command(randomUUID(), {
				action: 'binding-set',
				credentialRef: credential,
				bindingRef: randomUUID(),
				expectedVersion: 0,
				protocol: 'imap',
				profile: { ...profile, host: 'other.example.test' }
			})
		).rejects.toMatchObject({ code: 'CREDENTIAL_ACCOUNT_CHANGE_REQUIRES_NEW_BINDING' })
		await expect(
			set.command(randomUUID(), {
				action: 'binding-set',
				credentialRef,
				bindingRef: randomUUID(),
				expectedVersion: 0,
				protocol: 'imap',
				profile
			})
		).rejects.toMatchObject({ code: 'CREDENTIAL_INPUT_INVALID' })
		await set.command(randomUUID(), {
			action: 'binding-revoke',
			credentialRef: credential,
			bindingRef: binding,
			expectedVersion: 1,
			protocol: 'imap'
		})
		await expect(imap.claim(grant, 1, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_NOT_USABLE'
		})
	})
	test('execution fencing prevents new credential uses but permits metadata inspection', async () => {
		await db.query('UPDATE aven_platform.environment_identity SET execution_enabled=false')
		try {
			await expect(http.claim(authority(), 0, digest)).rejects.toMatchObject({
				code: 'CREDENTIAL_SCOPE_INVALID'
			})
			expect((await metadata.metadata()).credentials.length).toBeGreaterThan(0)
			await expect(createCredential(randomUUID())).rejects.toMatchObject({
				code: 'CREDENTIAL_SCOPE_INVALID'
			})
		} finally {
			await db.query('UPDATE aven_platform.environment_identity SET execution_enabled=true')
		}
	})
	test('stale pooled metadata and admin adapters cannot operate after a generation change', async () => {
		await db.query('UPDATE aven_platform.environment_identity SET routing_generation=2')
		try {
			await expect(metadata.metadata()).rejects.toMatchObject({ code: 'CREDENTIAL_SCOPE_INVALID' })
			await expect(createCredential(randomUUID())).rejects.toMatchObject({
				code: 'CREDENTIAL_SCOPE_INVALID'
			})
			expect(
				(
					await new CredentialMetadataStore(runtime.metadata!, {
						...scope,
						generation: 2
					}).metadata()
				).credentials.length
			).toBeGreaterThan(0)
		} finally {
			await db.query('UPDATE aven_platform.environment_identity SET routing_generation=1')
		}
	})
	test('rotation rejects old grants; revocation serializes with new claims', async () => {
		const envelope = await seal.seal(secret, {
			environmentId,
			ownerSubjectId: subjectId,
			credentialRef,
			kind: 'token',
			secretVersion: 2
		})
		await set.command(randomUUID(), {
			action: 'rotate',
			credentialRef,
			expectedVersion: 1,
			envelope
		})
		await expect(http.claim(authority(), 0, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_NOT_USABLE'
		})
		expect((await http.claim(authority({ secretVersion: 2 }), 0, digest)).outcome).toBe('claimed')
		await set.command(randomUUID(), { action: 'revoke', credentialRef, expectedVersion: 2 })
		await expect(http.claim(authority({ secretVersion: 2 }), 0, digest)).rejects.toMatchObject({
			code: 'CREDENTIAL_NOT_USABLE'
		})
	})
})
