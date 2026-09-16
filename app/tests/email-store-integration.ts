// Real Python -> client context -> API handler/coordinator -> Rust Artifact Store -> PostgreSQL.
// The isolated fixture publishes synthetic PDFs only and removes its containers on exit.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TenantGrantClaims } from '@avenos/aven-customer-contracts'
import type { IdentityClaims } from '@avenos/aven-identity'
import { ArtifactHandler } from '../../services/aven-api/src/artifacts/handler'
import { ArtifactFileService } from '../../services/aven-api/src/lib/server/artifacts/service'
import { type EmailAttachment, emailImportContext } from '../src/lib/artifacts/email-import'

const output = mkdtempSync(join(tmpdir(), 'email-store-proof-'))
const containers: string[] = []
const suffix = randomUUID()
const scope = randomUUID()
const image = process.env.AVEN_EMAIL_TEST_STORE_IMAGE || 'aven-imap-store-test:local'
const docker = (...args: string[]) =>
	execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
try {
	const postgres = `email-proof-db-${suffix}`
	containers.push(postgres)
	docker(
		'run',
		'--detach',
		'--rm',
		'--name',
		postgres,
		'--publish',
		'127.0.0.1::5432',
		'--env',
		'POSTGRES_PASSWORD=synthetic-email-proof',
		'postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2'
	)
	const port = docker('port', postgres, '5432/tcp').split(':').at(-1)
	for (let attempt = 0; ; attempt++) {
		try {
			docker('exec', postgres, 'pg_isready', '-U', 'postgres')
			break
		} catch (error) {
			if (attempt === 60) throw error
			await Bun.sleep(250)
		}
	}
	docker('exec', postgres, 'psql', '-U', 'postgres', '-c', 'CREATE SCHEMA artifact_store')
	const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
	const storePort = listener.port
	listener.stop(true)
	const origin = `http://127.0.0.1:${storePort}`
	const environment = [
		'--network',
		'host',
		'--env',
		`ARTIFACT_STORE_DATABASE_URL=postgres://postgres:synthetic-email-proof@127.0.0.1:${port}/postgres`,
		'--env',
		`ARTIFACT_STORE_SCOPE_ID=${scope}`,
		'--env',
		'ARTIFACT_STORE_BEARER_TOKEN=synthetic-email-store-proof-token',
		'--env',
		'ARTIFACT_STORE_PUBLISHER_ISSUER=api.aven.ceo',
		'--env',
		'ARTIFACT_STORE_PUBLISHER_SUBJECT=service:aven-api',
		'--env',
		`ARTIFACT_STORE_LISTEN=127.0.0.1:${storePort}`
	]
	docker('run', '--rm', ...environment, image, 'migrate')
	const store = `email-proof-store-${suffix}`
	containers.push(store)
	docker('run', '--detach', '--rm', '--name', store, ...environment, image, 'serve')
	for (let attempt = 0; ; attempt++) {
		try {
			assert.equal((await fetch(`${origin}/health/ready`)).ok, true)
			break
		} catch (error) {
			if (attempt === 60) throw error
			await Bun.sleep(250)
		}
	}
	const sample = execFileSync(
		'python3',
		[
			'-I',
			new URL('../../prototypes/imap-pdf/imap_pdf.py', import.meta.url).pathname,
			'--tauri',
			output
		],
		{
			input: JSON.stringify({ operation: 'demo' }),
			encoding: 'utf8'
		}
	)
	const attachments: EmailAttachment[] = JSON.parse(sample).result.attachments
	const service = ArtifactFileService.fromConfig({
		ARTIFACT_STORE_BASE_URL: origin,
		ARTIFACT_STORE_BEARER_TOKEN: 'synthetic-email-store-proof-token'
	})
	assert.ok(service)
	const handler = new ArtifactHandler(service)
	let committed = 0
	for (const placement of ['local', 'server'] as const) {
		for (const attachment of attachments) {
			const context = await emailImportContext(scope, attachment, placement)
			const body = readFileSync(attachment.path)
			const send = (intentId = context.intentId, publicationId = context.publicationId) =>
				handler.user(
					new Request(`${origin}/api/artifacts/files/${publicationId}`, {
						method: 'PUT',
						body,
						headers: {
							'content-type': 'application/pdf',
							'content-length': String(body.length),
							'x-aven-intent-id': intentId,
							'x-aven-observed-at': context.observedAt,
							'x-aven-original-name': Buffer.from(attachment.name).toString('base64url'),
							'x-expected-sha256': createHash('sha256').update(body).digest('hex'),
							'x-aven-execution-environment': placement
						}
					}),
					{ sub: 'synthetic-user' } as IdentityClaims,
					{ databaseName: 'postgres', environmentId: scope } as TenantGrantClaims,
					`files/${publicationId}`
				)
			const oldId = `${context.intentId.slice(0, 14)}8${context.intentId.slice(15)}`
			const broken = await send(oldId, randomUUID())
			assert.equal(broken.status, 502)
			assert.equal((await broken.json()).code, 'SCHEMA_VALIDATION_FAILED')
			const response = await send()
			const receipt = await response.json()
			assert.equal(response.status, 201, JSON.stringify(receipt))
			assert.equal(receipt.replayed, false)
			assert.equal(receipt.intentId, context.intentId)
			const replay = await send()
			assert.equal(replay.status, 201)
			assert.equal((await replay.json()).replayed, true)
			const stored = await service.content('postgres', scope, receipt.artifactId)
			assert.deepEqual(Buffer.from(stored), body)
			committed++
		}
	}
	console.log(
		`Email store integration passed: ${committed} sample PDFs committed and replayed across both placements; exact bytes read back; version-8 rejection reproduced.`
	)
} finally {
	for (const container of containers.reverse()) {
		try {
			docker('rm', '--force', container)
		} catch {
			/* Already removed on exit. */
		}
	}
	rmSync(output, { recursive: true, force: true })
}
