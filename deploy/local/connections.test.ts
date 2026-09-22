import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import {
	loadConnectionPolicyKey,
	loadCredentialSealer,
	loadCredentialUnsealer
} from '../../libs/aven-credential-storage/src/keys'
import { prepareLocalConnections } from './connections'

const policy = {
	revision: 1,
	httpTargets: [{ origin: 'https://api.example.test', pathPrefix: '/reports/' }],
	imapOrigins: ['https://mail.example.test:993'],
	maximumBytes: 1048576,
	maximumSeconds: 30
}
const base = () => ({
	services: {
		api: {
			environment: {
				API_PUBLIC_BASE_URL: 'http://localhost:13000',
				CUSTOMER_DOWNSTREAMS_JSON: '[]'
			}
		},
		'actor-runner': {
			environment: {
				CUSTOMER_DATABASE_HOST: 'db',
				CUSTOMER_DATABASE_PORT: '5432',
				CUSTOMER_DATABASE_SSL: 'false',
				IDENTITY_ISSUER: 'http://localhost:13100',
				IDENTITY_JWKS_URL: 'http://identity:13100/jwks',
				IDENTITY_AUDIENCE: 'aven-services',
				TENANT_GRANT_ISSUER: 'http://localhost:13000',
				TENANT_GRANT_PUBLIC_KEY: 'test-public-key',
				ARTIFACT_STORE_BASE_URL: 'http://artifact-store:8087'
			}
		}
	}
})

describe('private local connection composition', () => {
	test('separates runtime authorities and creates only owner-readable files', async () => {
		const { directory, overlay } = await prepareLocalConnections(base(), policy)
		try {
			for (const name of await readdir(directory))
				expect((await stat(`${directory}/${name}`)).mode & 0o777).toBe(0o600)
			expect((await stat(directory)).mode & 0o777).toBe(0o700)
			await loadCredentialSealer(`${directory}/sealing.json`)
			await loadCredentialUnsealer(`${directory}/unsealing.json`)
			await loadConnectionPolicyKey(`${directory}/policy-key.json`)
			const services = overlay.services
			const runner = JSON.stringify(services['actor-runner'])
			expect(runner).not.toContain('unsealing')
			expect(runner).not.toContain('CREDENTIAL_USE')
			expect(services['credential-service'].volumes.map((v) => v.target)).toEqual([
				'/run/aven/sealing.json'
			])
			expect(services.api.volumes.map((v) => v.target)).toEqual(['/run/aven/policy-key.json'])
			expect(services['http-executor'].environment.CREDENTIAL_USE_DB_CREDENTIAL_ROOT).not.toBe(
				services['imap-executor'].environment.CREDENTIAL_USE_DB_CREDENTIAL_ROOT
			)
			expect(new Set(Object.values(services['platform-provisioner'].environment)).size).toBe(5)
			expect(JSON.parse(await readFile(`${directory}/compose.json`, 'utf8'))).toEqual(overlay)
			const composed = base()
			Object.assign(composed.services.api.environment, services.api.environment)
			await expect(prepareLocalConnections(composed, policy)).rejects.toThrow('already configured')
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}, 15000)
	test('refuses remote stacks and removes only its fresh files on failure', async () => {
		const parent = await mkdtemp('/tmp/aven-connection-compose-proof-')
		try {
			const invalid = base()
			invalid.services.api.environment.API_PUBLIC_BASE_URL = 'https://production.example.test'
			await expect(prepareLocalConnections(invalid, policy, parent)).rejects.toThrow(
				'local Compose'
			)
			invalid.services.api.environment.API_PUBLIC_BASE_URL = 'http://localhost:13000'
			invalid.services['actor-runner'].environment.TENANT_GRANT_PUBLIC_KEY = ''
			await expect(prepareLocalConnections(invalid, policy, parent)).rejects.toThrow(
				'Missing local'
			)
			expect(await readdir(parent)).toEqual([])
		} finally {
			await rm(parent, { recursive: true, force: true })
		}
	}, 15000)
})
