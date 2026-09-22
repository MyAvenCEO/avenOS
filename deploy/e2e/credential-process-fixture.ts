/** Real ingress entry point, a public wrapping key, and isolated tenant role roots. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { exportSPKI } from 'jose'

export async function credentialProcessFixture(options: {
	databaseUrl: string
	setRoot: string
	metadataRoot: string
	serviceToken: string
	identityIssuer: string
	tenantIssuer: string
	tenantKey: CryptoKey
	wrappingKey: CryptoKey
}) {
	const directory = await mkdtemp('/tmp/aven-private-credential-ingress-')
	let child: ReturnType<typeof Bun.spawn> | undefined
	const close = async () => {
		if (child && child.exitCode === null) {
			child.kill('SIGTERM')
			const timer = setTimeout(() => child?.kill('SIGKILL'), 6000)
			try {
				await child.exited
			} finally {
				clearTimeout(timer)
			}
		}
		await rm(directory, { recursive: true, force: true })
	}
	try {
		await writeFile(
			`${directory}/sealing.json`,
			JSON.stringify({
				format: 'aven-credential-sealing-key-v1',
				keyId: 'synthetic',
				publicKey: await exportSPKI(options.wrappingKey)
			}),
			{ mode: 0o600 }
		)
		const reserved = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null) })
		const port = reserved.port!
		await reserved.stop(true)
		const database = new URL(options.databaseUrl)
		child = Bun.spawn([process.execPath, 'services/credential-service/src/index.ts'], {
			stdin: 'ignore',
			stdout: 'ignore',
			stderr: 'ignore',
			env: {
				PORT: String(port),
				CUSTOMER_DATABASE_HOST: database.hostname,
				CUSTOMER_DATABASE_PORT: database.port,
				CUSTOMER_DATABASE_SSL: 'false',
				CREDENTIAL_SET_DB_CREDENTIAL_ROOT: options.setRoot,
				CREDENTIAL_METADATA_DB_CREDENTIAL_ROOT: options.metadataRoot,
				CREDENTIAL_SERVICE_BEARER_TOKEN: options.serviceToken,
				CREDENTIAL_SEALING_KEY_FILE: `${directory}/sealing.json`,
				IDENTITY_ISSUER: options.identityIssuer,
				IDENTITY_AUDIENCE: 'aven-services',
				TENANT_GRANT_ISSUER: options.tenantIssuer,
				TENANT_GRANT_PUBLIC_KEY: await exportSPKI(options.tenantKey)
			}
		})
		for (let n = 0; n < 100; n++) {
			if (child.exitCode !== null) throw Error('Credential ingress exited before readiness')
			if (
				await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(300) })
					.then((r) => r.ok)
					.catch(() => false)
			)
				return { port, close }
			await Bun.sleep(100)
		}
		throw Error('Credential ingress readiness timed out')
	} catch (error) {
		await close()
		throw error
	}
}
