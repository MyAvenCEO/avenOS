import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Exercise the production renderer and Caddy's actual remote-address boundary.
const root = resolve(import.meta.dir, '../..')
const directory = await mkdtemp(join(tmpdir(), 'aven-identity-callers-'))
const container = `aven-identity-callers-${process.pid}`
let internalRequests = 0
const backend = Bun.serve({
	hostname: '127.0.0.1',
	port: 0,
	fetch: (request) => {
		if (new URL(request.url).pathname.startsWith('/internal/')) internalRequests++
		return new Response('ready')
	}
})
const reservation = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
const port = reservation.port
reservation.stop(true)
async function run(args: string[]) {
	const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
	const [code, output, error] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	])
	if (code) throw new Error(`Identity proxy proof failed: ${error.slice(0, 500)}`)
	return output
}
async function status(path: string, address = '127.0.0.1') {
	return Number(
		await run([
			'curl',
			'--silent',
			'--show-error',
			'--max-time',
			'2',
			'--noproxy',
			'*',
			'--interface',
			address,
			'--header',
			'X-Forwarded-For: 127.0.0.2',
			'--output',
			'/dev/null',
			'--write-out',
			'%{http_code}',
			`http://127.0.0.1:${port}${path}`
		])
	)
}
try {
	for (const standalone of [true, false]) {
		const file = join(directory, 'Caddyfile')
		await run([
			'bash',
			'-c',
			'source "$1"; render_identity_caddy "$2" "$3" "$4"',
			'identity-proof',
			join(root, 'deploy/release/identity-caddy.sh'),
			join(root, 'deploy/identity/Caddyfile'),
			file,
			String(standalone)
		])
		const rendered = await readFile(file, 'utf8')
		const site = rendered.slice(rendered.indexOf('{$IDENTITY_DOMAIN:'))
		await writeFile(
			file,
			'{\n admin off\n auto_https off\n}\n' +
				site
					.replace('{$IDENTITY_DOMAIN:aven.id}', `http://127.0.0.1:${port}`)
					.replace('\n\tencode', '\n\tbind 127.0.0.1\n\tencode')
					.replace('identity:3000', `127.0.0.1:${backend.port}`)
		)
		await run([
			'docker',
			'run',
			'--detach',
			'--name',
			container,
			'--network',
			'host',
			'--read-only',
			'--cap-drop',
			'ALL',
			'--cap-add',
			'NET_BIND_SERVICE',
			'--security-opt',
			'no-new-privileges:true',
			'--memory',
			'128m',
			'--pids-limit',
			'64',
			'--tmpfs',
			'/config:size=8m',
			'--tmpfs',
			'/data:size=8m',
			'--env',
			'IDENTITY_PLATFORM_IPS=127.0.0.2',
			'--volume',
			`${file}:/etc/caddy/Caddyfile:ro`,
			'caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648'
		])
		let ready = false
		for (let attempt = 0; attempt < 50; attempt++) {
			try {
				if ((await status('/api/health/ready')) === 200) {
					ready = true
					break
				}
			} catch {
				/* startup */
			}
			await Bun.sleep(100)
		}
		if (!ready) {
			const logs = Bun.spawnSync(['docker', 'logs', container])
			throw new Error(`Public identity readiness unavailable: ${logs.stderr.toString()}`)
		}
		internalRequests = 0
		assert.equal(
			await status('/internal/v1/accounts'),
			404,
			'forwarded headers cannot spoof a platform caller'
		)
		assert.equal(internalRequests, 0)
		assert.equal(await status('/internal/v1/accounts', '127.0.0.2'), standalone ? 404 : 200)
		assert.equal(internalRequests, standalone ? 0 : 1)
		await run(['docker', 'rm', '--force', container])
	}
	console.info(
		'Identity proxy: standalone denies every internal caller; attachment admits only the exact host address.'
	)
} finally {
	await run(['docker', 'rm', '--force', container]).catch(() => {})
	backend.stop(true)
	await rm(directory, { recursive: true, force: true })
}
