/** Opt-in local composition. Writes new private files; never installs a component,
 * starts services, replaces old keys, or changes a customer database. */
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import { z } from 'zod'

const token = () => randomBytes(32).toString('base64url')
const policySchema = z
	.object({
		revision: z.number().int().positive(),
		httpTargets: z
			.array(
				z
					.object({
						origin: z.url().refine((s) => s.startsWith('https://') && new URL(s).origin === s),
						pathPrefix: z.string().startsWith('/').max(2048)
					})
					.strict()
			)
			.min(1)
			.max(64),
		imapOrigins: z
			.array(z.url().refine((s) => s.startsWith('https://') && new URL(s).origin === s))
			.min(1)
			.max(64),
		maximumBytes: z.number().int().min(1).max(33554432),
		maximumSeconds: z.number().int().min(1).max(60)
	})
	.strict()

export async function prepareLocalConnections(base: any, rawPolicy: unknown, parent = '/tmp') {
	const api = base.services?.api?.environment,
		runner = base.services?.['actor-runner']?.environment
	if (
		!api ||
		!runner ||
		!['localhost', '127.0.0.1'].includes(new URL(api.API_PUBLIC_BASE_URL).hostname)
	)
		throw Error(
			'A resolved local Compose configuration is required; hosted targets are not accepted.'
		)
	if (api.CONNECTION_POLICY_KEY_FILE || runner.CONNECTION_RUNTIME_JSON)
		throw Error(
			'Connections are already configured. Reuse the existing keys and overlay; do not rotate implicitly.'
		)
	const policy = policySchema.parse(rawPolicy)
	const directory = await mkdtemp(resolve(parent, 'aven-private-connections-'))
	try {
		const signing = await generateKeyPair('EdDSA', { extractable: true })
		const wrapping = await generateKeyPair('RSA-OAEP-256', {
			modulusLength: 3072,
			extractable: true
		})
		const write = (name: string, value: unknown) =>
			writeFile(`${directory}/${name}`, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' })
		await write('sealing.json', {
			format: 'aven-credential-sealing-key-v1',
			keyId: 'local-1',
			publicKey: await exportSPKI(wrapping.publicKey)
		})
		await write('unsealing.json', {
			format: 'aven-credential-unsealing-keys-v1',
			keys: [{ keyId: 'local-1', privateKey: await exportPKCS8(wrapping.privateKey) }]
		})
		await write('policy-key.json', {
			format: 'aven-connection-policy-key-v1',
			privateKey: await exportPKCS8(signing.privateKey)
		})
		const roots = { set: token(), metadata: token(), match: token(), http: token(), imap: token() }
		const tokens = {
			ingress: token(),
			runner: token(),
			verify: token(),
			http: token(),
			imap: token(),
			httpStore: token(),
			imapStore: token()
		}
		const common = {
			CUSTOMER_DATABASE_HOST: runner.CUSTOMER_DATABASE_HOST,
			CUSTOMER_DATABASE_PORT: runner.CUSTOMER_DATABASE_PORT,
			CUSTOMER_DATABASE_SSL: runner.CUSTOMER_DATABASE_SSL,
			IDENTITY_ISSUER: runner.IDENTITY_ISSUER,
			IDENTITY_JWKS_URL: runner.IDENTITY_JWKS_URL,
			IDENTITY_AUDIENCE: runner.IDENTITY_AUDIENCE,
			TENANT_GRANT_ISSUER: runner.TENANT_GRANT_ISSUER,
			TENANT_GRANT_PUBLIC_KEY: runner.TENANT_GRANT_PUBLIC_KEY
		}
		for (const [name, value] of Object.entries(common))
			if (typeof value !== 'string' || !value) throw Error(`Missing local runtime setting: ${name}`)
		const mount = (file: string) => ({
			type: 'bind',
			source: `${directory}/${file}`,
			target: `/run/aven/${file}`,
			read_only: true
		})
		const hardened = {
			networks: ['platform-private', 'public-test'],
			read_only: true,
			cap_drop: ['ALL'],
			security_opt: ['no-new-privileges:true'],
			tmpfs: ['/tmp:size=16m,mode=1777'],
			mem_limit: '384m',
			pids_limit: 64
		}
		const executor = (protocol: 'http' | 'imap') => ({
			...hardened,
			image: 'aven-connection-executor:local',
			volumes: [mount('unsealing.json')],
			environment: {
				...common,
				PORT: '3015',
				CONNECTION_PROTOCOL: protocol,
				CONNECTION_SERVICE_BEARER_TOKEN: tokens[protocol],
				CONNECTION_POLICY_URL: 'http://api:13000',
				CONNECTION_POLICY_VERIFY_TOKEN: tokens.verify,
				CONNECTION_POLICY_ISSUER: api.API_PUBLIC_BASE_URL,
				CONNECTION_POLICY_PUBLIC_KEY: '',
				CONNECTION_ALLOWED_ORIGINS: JSON.stringify(
					protocol === 'http'
						? [...new Set(policy.httpTargets.map((t) => t.origin))]
						: policy.imapOrigins
				),
				CREDENTIAL_USE_DB_CREDENTIAL_ROOT: roots[protocol],
				CREDENTIAL_UNSEALING_KEYS_FILE: '/run/aven/unsealing.json',
				ARTIFACT_STORE_BASE_URL: runner.ARTIFACT_STORE_BASE_URL,
				ARTIFACT_STORE_BEARER_TOKEN: protocol === 'http' ? tokens.httpStore : tokens.imapStore,
				CONNECTION_PUBLISHER_ISSUER: 'os.aven',
				CONNECTION_PUBLISHER_SUBJECT: 'service:credential-executor'
			}
		})
		const http = executor('http'),
			imap = executor('imap')
		http.environment.CONNECTION_POLICY_PUBLIC_KEY = imap.environment.CONNECTION_POLICY_PUBLIC_KEY =
			await exportSPKI(signing.publicKey)
		const downstreams = z
			.array(z.record(z.string(), z.unknown()))
			.parse(JSON.parse(api.CUSTOMER_DOWNSTREAMS_JSON))
		if (downstreams.some((d) => d.segment === 'credentials'))
			throw Error('Credential route already configured.')
		downstreams.push({
			segment: 'credentials',
			baseUrl: 'http://credential-service:3014',
			targetPrefix: '/api/credentials',
			bearerToken: tokens.ingress,
			componentRef: 'ceo.aven:component:data:credentials@1',
			readAction: 'credentials:read',
			writeAction: 'credentials:write',
			roles: ['user', 'admin']
		})
		const overlay = {
			services: {
				'credential-service': {
					...hardened,
					image: 'aven-connection-ingress:local',
					volumes: [mount('sealing.json')],
					environment: {
						...common,
						PORT: '3014',
						CREDENTIAL_SERVICE_BEARER_TOKEN: tokens.ingress,
						CREDENTIAL_SET_DB_CREDENTIAL_ROOT: roots.set,
						CREDENTIAL_METADATA_DB_CREDENTIAL_ROOT: roots.metadata,
						CREDENTIAL_SEALING_KEY_FILE: '/run/aven/sealing.json'
					}
				},
				'http-executor': http,
				'imap-executor': imap,
				api: {
					image: 'aven-connection-api:local',
					volumes: [mount('policy-key.json')],
					environment: {
						CUSTOMER_DOWNSTREAMS_JSON: JSON.stringify(downstreams),
						CONNECTION_POLICY_KEY_FILE: '/run/aven/policy-key.json',
						CONNECTION_POLICY_RUNNER_TOKEN: tokens.runner,
						CONNECTION_POLICY_VERIFY_TOKEN: tokens.verify,
						CONNECTION_POLICY_JSON: JSON.stringify(policy)
					}
				},
				'actor-runner': {
					image: 'aven-connection-runner:local',
					environment: {
						CONNECTION_RUNTIME_JSON: JSON.stringify({
							metadataUrl: 'http://api:13000',
							policyUrl: 'http://api:13000',
							policyToken: tokens.runner,
							http: { url: 'http://http-executor:3015', token: tokens.http },
							imap: { url: 'http://imap-executor:3015', token: tokens.imap },
							publisher: { issuer: 'os.aven', subject: 'service:credential-executor' }
						})
					}
				},
				'platform-provisioner': {
					image: 'aven-connection-provisioner:local',
					environment: Object.fromEntries(
						Object.entries(roots).map(([kind, root]) => [
							`CREDENTIAL_${kind.toUpperCase()}_DB_CREDENTIAL_ROOT`,
							root
						])
					)
				},
				'artifact-store': {
					image: 'aven-connection-store:local',
					environment: {
						ARTIFACT_STORE_HTTP_EXECUTOR_BEARER_TOKEN: tokens.httpStore,
						ARTIFACT_STORE_IMAP_EXECUTOR_BEARER_TOKEN: tokens.imapStore
					}
				}
			}
		}
		await write('compose.json', overlay)
		return { directory, overlay }
	} catch (error) {
		// Only this fresh, never-activated directory belongs to the failed attempt.
		await rm(directory, { recursive: true, force: true })
		throw error
	}
}

if (import.meta.main) {
	const [basePath, policyPath, parent] = process.argv.slice(2)
	if (!basePath || !policyPath || !parent)
		throw Error(
			'Usage: bun deploy/local/connections.ts private-resolved-compose.json allowed-targets.json private-key-directory'
		)
	const { directory } = await prepareLocalConnections(
		await Bun.file(basePath).json(),
		await Bun.file(policyPath).json(),
		resolve(parent)
	)
	console.log(
		`Prepared ${directory}/compose.json. No services started and no customer components installed. Preserve this private directory across restarts; losing unsealing.json makes stored credentials unreadable.`
	)
}
