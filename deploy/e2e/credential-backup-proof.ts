/** Synthetic database dump/restore and separately retained wrapping-key proof. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import pg from 'pg'
import {
	loadCredentialSealer,
	loadCredentialUnsealer
} from '../../libs/aven-credential-storage/src/keys'
import {
	CredentialAdminStore,
	CredentialMetadataStore
} from '../../libs/aven-credential-storage/src/postgres'
import { credentialDatabase } from './credential-database'

const connection = process.env.CREDENTIAL_TEST_DATABASE_URL
assert(connection, 'An isolated PostgreSQL maintenance database is required')
const environmentId = randomUUID(),
	subjectId = randomUUID(),
	credentialRef = randomUUID()
const scope = { environmentId, subjectId, generation: 1 }
const context = {
	environmentId,
	ownerSubjectId: subjectId,
	credentialRef,
	kind: 'token' as const,
	secretVersion: 1
}
const directory = await mkdtemp('/tmp/aven-private-credential-backup-')
const fixture = await credentialDatabase(connection, environmentId)
const administrator = new pg.Pool({ connectionString: connection })
const restoredName = `credential_restore_${randomUUID().replaceAll('-', '')}`
let restored: pg.Pool | undefined,
	created = false
const image =
	'postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2'
async function postgresCommand(command: string[], stdin?: string) {
	const url = new URL(connection!)
	const child = Bun.spawn(
		[
			'docker',
			'run',
			'--rm',
			'-i',
			'--network',
			'host',
			'--env',
			`PGHOST=${url.hostname}`,
			'--env',
			`PGPORT=${url.port || '5432'}`,
			'--env',
			`PGUSER=${decodeURIComponent(url.username)}`,
			'--env',
			'PGPASSWORD',
			image,
			...command
		],
		{
			env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
			stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
			stdout: 'pipe',
			stderr: 'pipe'
		}
	)
	const [code, output] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	])
	assert.equal(code, 0, 'Synthetic PostgreSQL backup/restore command failed')
	return output
}
try {
	const keys = await generateKeyPair('RSA-OAEP-256', { modulusLength: 3072, extractable: true })
	const publicPath = `${directory}/public.json`,
		privatePath = `${directory}/private.json`,
		escrowPath = `${directory}/escrow.json`
	await writeFile(
		publicPath,
		JSON.stringify({
			format: 'aven-credential-sealing-key-v1',
			keyId: 'synthetic-backup',
			publicKey: await exportSPKI(keys.publicKey)
		}),
		{ mode: 0o600 }
	)
	await writeFile(
		privatePath,
		JSON.stringify({
			format: 'aven-credential-unsealing-keys-v1',
			keys: [{ keyId: 'synthetic-backup', privateKey: await exportPKCS8(keys.privateKey) }]
		}),
		{ mode: 0o600 }
	)
	await copyFile(privatePath, escrowPath)
	const secret = Buffer.from(`synthetic-backup-token-${randomUUID()}`)
	const envelope = await (await loadCredentialSealer(publicPath)).seal(secret, context)
	await new CredentialAdminStore(fixture.pools.set, scope).command(randomUUID(), {
		action: 'create',
		credentialRef,
		expectedVersion: 0,
		label: 'Fictional weather archive',
		kind: 'token',
		envelope
	})
	const before = await new CredentialMetadataStore(fixture.pools.metadata, scope).metadata()
	const dump = await postgresCommand([
		'pg_dump',
		'--format=plain',
		'--no-comments',
		new URL(fixture.databaseUrl).pathname.slice(1)
	])
	assert(!dump.includes(secret.toString()), 'Plaintext secret entered database backup')
	assert(!dump.includes('BEGIN PRIVATE KEY'), 'Operator wrapping key entered database backup')
	assert(dump.includes(envelope.jwe.ciphertext), 'Backup omitted encrypted credential')
	await administrator.query(`CREATE DATABASE ${restoredName}`)
	created = true
	await postgresCommand(['psql', '-v', 'ON_ERROR_STOP=1', '-d', restoredName], dump)
	const target = new URL(connection)
	target.pathname = `/${restoredName}`
	restored = new pg.Pool({ connectionString: target.toString() })
	// A restored snapshot is not permission to resume external work.
	await restored.query('UPDATE aven_platform.environment_identity SET execution_enabled=false')
	const retained = (
		await restored.query(
			'SELECT envelope FROM aven_credentials.credentials WHERE credential_ref=$1',
			[credentialRef]
		)
	).rows[0].envelope
	assert.deepEqual(retained, envelope)
	assert.deepEqual(await new CredentialMetadataStore(restored, scope).metadata(), before)
	await unlink(privatePath)
	await assert.rejects(loadCredentialUnsealer(privatePath), /CREDENTIAL_KEY_FILE_UNAVAILABLE/)
	await assert.rejects(loadCredentialUnsealer(publicPath), /CREDENTIAL_KEY_FILE_UNAVAILABLE/)
	await copyFile(escrowPath, privatePath)
	const recovered = await loadCredentialUnsealer(privatePath)
	assert.deepEqual(Buffer.from(await recovered.unseal(retained, context)), secret)
	await assert.rejects(recovered.unseal(retained, { ...context, environmentId: randomUUID() }))
	assert.equal(
		(await restored.query('SELECT execution_enabled FROM aven_platform.environment_identity'))
			.rows[0].execution_enabled,
		false
	)
	secret.fill(0)
	console.log(
		'PASS encrypted credential dump/restore, missing-key rejection, separate key recovery, customer binding and paused execution'
	)
} finally {
	await restored?.end()
	try {
		if (created) await administrator.query(`DROP DATABASE ${restoredName} WITH (FORCE)`)
	} finally {
		await administrator.end()
		await fixture.close()
		await rm(directory, { recursive: true, force: true })
	}
}
