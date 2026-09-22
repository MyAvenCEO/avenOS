/** Bounded read-pressure probe of the actual Rust server, never a customer workspace. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import pg from 'pg'

const image = process.env.TEST_ARTIFACT_STORE_IMAGE
const connectionString = process.env.TEST_TASK_DATABASE_URL
assert(image && connectionString, 'Explicit test image and disposable PostgreSQL are required')
const database = 'store_memory_' + randomBytes(10).toString('hex')
const container = 'aven-store-memory-' + randomBytes(6).toString('hex')
const directory = await mkdtemp('/tmp/aven-artifact-store-memory-')
const admin = new pg.Pool({ connectionString, max: 1 })
const scope = randomUUID(),
	token = randomBytes(32).toString('hex')
const url = new URL(connectionString)
url.pathname = '/' + database
const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
const port = reservation.port!
await reservation.stop(true)
const env = {
	ARTIFACT_STORE_DATABASE_URL: url.toString(),
	ARTIFACT_STORE_SCOPE_ID: scope,
	ARTIFACT_STORE_BEARER_TOKEN: token,
	ARTIFACT_STORE_PUBLISHER_ISSUER: 'proof.aven',
	ARTIFACT_STORE_PUBLISHER_SUBJECT: 'synthetic-memory',
	ARTIFACT_STORE_LISTEN: `127.0.0.1:${port}`
}
const config = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
const evidence: any = {
	synthetic: true,
	image,
	passed: false,
	samples: [],
	startedAt: new Date().toISOString()
}
async function docker(...args: string[]) {
	const proc = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' })
	const [stdout, stderr, status] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	])
	assert.equal(status, 0, `Disposable Docker operation failed: ${stderr}`)
	return stdout.trim()
}
async function sample(completed: number) {
	const memory = Number(await docker('exec', container, 'cat', '/sys/fs/cgroup/memory.current'))
	const peak = Number(await docker('exec', container, 'cat', '/sys/fs/cgroup/memory.peak'))
	const result = { completed, memory, peak }
	evidence.samples.push(result)
	console.log(JSON.stringify(result))
	await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
}
let created = false,
	started = false
try {
	console.log(directory)
	await admin.query(`CREATE DATABASE ${database}`)
	created = true
	const setup = new pg.Pool({ connectionString: url.toString(), max: 1 })
	try {
		await setup.query('CREATE SCHEMA artifact_store')
	} finally {
		await setup.end()
	}
	await docker('run', '--rm', '--network', 'host', ...config, image, 'migrate')
	await docker(
		'run',
		'-d',
		'--name',
		container,
		'--network',
		'host',
		'--memory',
		'768m',
		'--memory-swap',
		'768m',
		'--cpus',
		'1.5',
		'--pids-limit',
		'128',
		'--read-only',
		'--cap-drop',
		'ALL',
		'--security-opt',
		'no-new-privileges:true',
		...config,
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
	const headers = { authorization: 'Bearer ' + token }
	const context = await fetch(base + '/v1/context', { headers }).then((r) => r.json())
	assert(context.storeEpoch)
	await sample(0)
	const begin = performance.now()
	for (let round = 0; round < 80; round++) {
		await Promise.all(
			Array.from({ length: 16 }, async (_, i) => {
				const path =
					i % 2
						? '/v1/context'
						: `/v1/scopes/${scope}/publications?storeEpoch=${context.storeEpoch}&limit=1000`
				const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(20_000) })
				assert(response.ok, `Metadata read failed: ${response.status}`)
				await response.json()
			})
		)
		if (round % 8 === 7) await sample((round + 1) * 16)
	}
	evidence.durationMs = performance.now() - begin
	evidence.containerState = JSON.parse(
		await docker('inspect', '--format', '{{json .State}}', container)
	)
	assert(!evidence.containerState.OOMKilled)
	assert(
		evidence.samples.at(-1).peak < 256 * 1024 * 1024,
		'Light metadata reads must stay below 256 MiB'
	)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	if (started)
		evidence.containerState = JSON.parse(
			await docker('inspect', '--format', '{{json .State}}', container)
		)
	throw error
} finally {
	if (started) await docker('rm', '-f', container)
	if (created) await admin.query(`DROP DATABASE ${database}`)
	await admin.end()
	await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
}
