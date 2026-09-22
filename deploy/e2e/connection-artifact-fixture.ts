/** Actual Rust Store on the exclusively owned credential proof database. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { ArtifactRunStore, ArtifactStoreClient } from '../../libs/aven-artifact-store/src'

export async function connectionArtifactFixture(databaseUrl: string, scope: string) {
	const target = new URL(databaseUrl)
	assert(
		['localhost', '127.0.0.1'].includes(target.hostname) &&
			(/^\/credential_live_[a-f0-9]{32}$/.test(target.pathname) ||
				(/^[a-f0-9-]{36}$/.test(scope) && target.pathname === `/cust_${scope.replaceAll('-', '')}`))
	)
	const db = new pg.Pool({ connectionString: databaseUrl })
	try {
		await db.query('CREATE SCHEMA artifact_store')
	} finally {
		await db.end()
	}
	const reserve = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
	const port = reserve.port!
	await reserve.stop(true)
	const token = randomUUID() + randomUUID()
	const actorToken = randomUUID() + randomUUID()
	const env = {
		...process.env,
		ARTIFACT_STORE_DATABASE_URL: databaseUrl,
		ARTIFACT_STORE_SCOPE_ID: scope,
		ARTIFACT_STORE_BEARER_TOKEN: token,
		ARTIFACT_STORE_ACTOR_RUNNER_BEARER_TOKEN: actorToken,
		ARTIFACT_STORE_PUBLISHER_ISSUER: 'os.aven',
		ARTIFACT_STORE_PUBLISHER_SUBJECT: 'service:credential-executor',
		ARTIFACT_STORE_TENANT_MODE: 'false',
		ARTIFACT_STORE_LISTEN: `127.0.0.1:${port}`,
		TOKIO_WORKER_THREADS: '2'
	}
	const migrated = Bun.spawnSync(['./target/rust/debug/aven-artifact-store', 'migrate'], { env })
	assert.equal(migrated.exitCode, 0, new TextDecoder().decode(migrated.stderr))
	const server = Bun.spawn(['./target/rust/debug/aven-artifact-store', 'serve'], {
		env,
		stdout: 'inherit',
		stderr: 'inherit'
	})
	const close = async () => {
		if (server.exitCode !== null) return
		server.kill('SIGTERM')
		await Promise.race([server.exited, Bun.sleep(3000)])
		if (server.exitCode === null) server.kill('SIGKILL')
		await server.exited
	}
	try {
		const client = new ArtifactStoreClient({
			baseUrl: `http://127.0.0.1:${port}`,
			bearerToken: () => token
		})
		for (let i = 0; ; i++) {
			try {
				await client.context()
				break
			} catch (error) {
				if (server.exitCode !== null || i >= 150) throw error
				await Bun.sleep(100)
			}
		}
		await client.type('mail.imap-query-result', 1)
		return {
			store: new ArtifactRunStore(client, scope),
			actorStore: new ArtifactRunStore(
				new ArtifactStoreClient({
					baseUrl: `http://127.0.0.1:${port}`,
					bearerToken: () => actorToken
				}),
				scope
			),
			baseUrl: `http://127.0.0.1:${port}`,
			bearerToken: token,
			close
		}
	} catch (error) {
		await close()
		throw error
	}
}
