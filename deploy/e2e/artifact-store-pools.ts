/** Cold concurrent tenant reads against real PostgreSQL and the production image. */
import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import pg from 'pg'

const image = process.env.TEST_ARTIFACT_STORE_IMAGE
const connectionString = process.env.TEST_TASK_DATABASE_URL
assert(image && connectionString, 'Explicit test image and disposable PostgreSQL are required')
const root = randomBytes(32)
const token = randomBytes(32).toString('hex')
const name = 'aven-store-pools-' + randomBytes(6).toString('hex')
const directory = await mkdtemp('/tmp/aven-artifact-store-pools-')
const admin = new pg.Pool({ connectionString, max: 1 })
const tenants: { id: string; database: string; role: string; epoch?: string }[] = []
const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
const port = reservation.port!
await reservation.stop(true)
const evidence: any = {
	synthetic: true,
	image,
	passed: false,
	bursts: [],
	startedAt: new Date().toISOString()
}
let started = false
async function docker(...args: string[]) {
	const child = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' })
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	])
	assert.equal(code, 0, `Disposable Docker operation failed: ${stderr}`)
	return stdout.trim()
}
const config = (env: Record<string, string>) =>
	Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
try {
	console.log(directory)
	for (let i = 0; i < 2; i++) {
		const id = randomUUID(),
			database = 'cust_' + id.replaceAll('-', ''),
			role = 'c_' + id.replaceAll('-', '') + '_art_api'
		const password = createHmac('sha256', root)
			.update(`aven/postgres-role/v1\0${id}\0${1}\0ceo.aven:db-role:artifacts:api@1`)
			.digest('base64url')
		// Identifiers and password are generated here, never supplied by a caller.
		await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' CONNECTION LIMIT 1`)
		tenants.push({ id, database, role })
		await admin.query(`CREATE DATABASE ${database}`)
		const target = new URL(connectionString)
		target.pathname = '/' + database
		const setup = new pg.Pool({ connectionString: target.toString(), max: 1 })
		try {
			await setup.query('CREATE SCHEMA artifact_store')
		} finally {
			await setup.end()
		}
		await docker(
			'run',
			'--rm',
			'--network',
			'host',
			...config({
				ARTIFACT_STORE_DATABASE_URL: target.toString(),
				ARTIFACT_STORE_SCOPE_ID: id,
				ARTIFACT_STORE_RUNTIME_ROLE: role
			}),
			image,
			'migrate'
		)
		const inspect = new pg.Pool({ connectionString: target.toString(), max: 1 })
		try {
			tenants.at(-1)!.epoch = (
				await inspect.query('SELECT store_epoch FROM artifact_store.store_state')
			).rows[0].store_epoch
		} finally {
			await inspect.end()
		}
	}
	await docker(
		'run',
		'-d',
		'--name',
		name,
		'--network',
		'host',
		'--read-only',
		'--cap-drop',
		'ALL',
		'--security-opt',
		'no-new-privileges:true',
		'--memory',
		'768m',
		'--pids-limit',
		'128',
		...config({
			ARTIFACT_STORE_DATABASE_URL: connectionString,
			ARTIFACT_STORE_BEARER_TOKEN: token,
			ARTIFACT_STORE_PUBLISHER_ISSUER: 'proof.aven',
			ARTIFACT_STORE_PUBLISHER_SUBJECT: 'synthetic-pools',
			ARTIFACT_STORE_TENANT_MODE: 'true',
			ARTIFACT_STORE_API_DB_CREDENTIAL_ROOT: root.toString('base64url'),
			ARTIFACT_STORE_CONNECTIONS_PER_TENANT: '1',
			ARTIFACT_STORE_MAX_TENANT_POOLS: '2',
			ARTIFACT_STORE_LISTEN: `127.0.0.1:${port}`
		}),
		image
	)
	started = true
	const base = `http://127.0.0.1:${port}`
	for (let attempt = 0; ; attempt++) {
		assert(attempt < 100, 'Store did not become ready')
		const ready = await fetch(base + '/health/ready').catch(() => null)
		if (ready?.status === 204) break
		await ready?.body?.cancel()
		await Bun.sleep(100)
	}
	// No warming request: both tenant pools must first be resolved concurrently.
	for (let round = 0; round < 3; round++) {
		const begin = performance.now()
		const results = await Promise.all(
			Array.from({ length: 64 }, async (_, i) => {
				const tenant = tenants[i % tenants.length]!
				const response = await fetch(base + '/v1/context', {
					headers: {
						authorization: 'Bearer ' + token,
						'x-aven-artifact-database': tenant.database,
						'x-aven-environment': tenant.id,
						'x-aven-routing-generation': '1'
					},
					signal: AbortSignal.timeout(20_000)
				})
				const body = await response.json()
				return { status: response.status, correctScope: body.storeEpoch === tenant.epoch }
			})
		)
		evidence.bursts.push({ round, durationMs: performance.now() - begin, results })
		console.log(JSON.stringify({ round, statuses: results.map((r) => r.status) }))
	}
	assert(
		evidence.bursts.every((burst: any) =>
			burst.results.every((r: any) => r.status === 200 && r.correctScope)
		),
		'Every cold/warm request must succeed in its own scope under the actual role limit'
	)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	if (started) await docker('rm', '-f', name)
	for (const tenant of tenants) {
		await admin.query(`DROP DATABASE IF EXISTS ${tenant.database}`)
		await admin.query(`DROP ROLE ${tenant.role}`)
	}
	await admin.end()
	evidence.finishedAt = new Date().toISOString()
	await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
}
