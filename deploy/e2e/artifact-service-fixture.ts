/** Real Rust Store and provisioner on disposable ports; no substitute storage. */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

export async function artifactServiceFixture(databaseUrl: string, credentialRoot: string) {
	const processes: ReturnType<typeof Bun.spawn>[] = []
	const token = randomBytes(32).toString('hex'),
		provisionerToken = randomBytes(32).toString('hex')
	const close = async () => {
		await Promise.all(
			processes.map(async (process) => {
				if (process.exitCode !== null) return
				process.kill('SIGTERM')
				await Promise.race([process.exited, Bun.sleep(3000)])
				if (process.exitCode === null) process.kill('SIGKILL')
				await process.exited
			})
		)
	}
	const start = async (command: string, config: Record<string, string>, listen: string) => {
		const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
		const port = reservation.port!
		await reservation.stop(true)
		const process = Bun.spawn([resolve('target/rust/debug/aven-artifact-store'), command], {
			env: { ...globalThis.process.env, ...config, [listen]: `127.0.0.1:${port}` },
			stdout: 'ignore',
			stderr: 'inherit'
		})
		processes.push(process)
		const baseUrl = `http://127.0.0.1:${port}`
		for (let i = 0; i < 60; i++) {
			assert(process.exitCode === null, `Artifact ${command} exited before readiness.`)
			const response = await fetch(`${baseUrl}/health/ready`, {
				signal: AbortSignal.timeout(500)
			}).catch(() => null)
			if (response?.status === 204) return baseUrl
			await response?.body?.cancel()
			await Bun.sleep(100)
		}
		throw Error(`Artifact ${command} did not become ready.`)
	}
	try {
		const provisionerUrl = await start(
			'serve-provisioner',
			{
				ARTIFACT_STORE_PROVISIONER_DATABASE_URL: databaseUrl,
				ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN: provisionerToken
			},
			'ARTIFACT_STORE_PROVISIONER_LISTEN'
		)
		const baseUrl = await start(
			'serve',
			{
				ARTIFACT_STORE_DATABASE_URL: databaseUrl,
				ARTIFACT_STORE_TENANT_MODE: 'true',
				ARTIFACT_STORE_BEARER_TOKEN: token,
				ARTIFACT_STORE_API_DB_CREDENTIAL_ROOT: credentialRoot,
				ARTIFACT_STORE_PUBLISHER_ISSUER: 'os.aven',
				ARTIFACT_STORE_PUBLISHER_SUBJECT: 'service:actor-runner'
			},
			'ARTIFACT_STORE_LISTEN'
		)
		return { baseUrl, token, provisionerUrl, provisionerToken, close }
	} catch (error) {
		await close()
		throw error
	}
}
