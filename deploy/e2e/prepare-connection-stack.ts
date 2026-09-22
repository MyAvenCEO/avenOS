/** Fresh synthetic topology; never reads running-container environment variables. */
import { writeFile } from 'node:fs/promises'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import { prepareLocalConnections } from '../local/connections'
import { localLlmCatalog } from '../local/llm-catalog'

const model = process.env.LIVE_LLM_MODEL,
	baseUrl = process.env.LIVE_LLM_BASE_URL
if (!model || !baseUrl) throw Error('A real model endpoint and model are required.')
const existing = Bun.spawnSync(
	['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=aven-connections'],
	{ stdout: 'pipe', stderr: 'pipe' }
)
if (existing.exitCode !== 0 || existing.stdout.toString().trim())
	throw Error(
		'Cannot prepare over an existing synthetic stack. Reuse its private configuration or explicitly retire it first.'
	)
const keys = await generateKeyPair('EdDSA', { extractable: true })
const env = {
	PATH: process.env.PATH!,
	HOME: process.env.HOME!,
	E2E_TENANT_PRIVATE_KEY: await exportPKCS8(keys.privateKey),
	E2E_TENANT_PUBLIC_KEY: await exportSPKI(keys.publicKey),
	E2E_API_HOST_PORT: '13041',
	E2E_IDENTITY_HOST_PORT: '13141',
	E2E_CHECKOUT_HOST_PORT: '13241',
	E2E_DATABASE_HOST_PORT: '55441',
	E2E_ARTIFACT_STORE_HOST_PORT: '18041',
	E2E_MAILPIT_HOST_PORT: '18042',
	E2E_API_IMAGE: 'aven-connection-api:local',
	E2E_PLATFORM_PROVISIONER_IMAGE: 'aven-connection-provisioner:local',
	E2E_ACTOR_RUNNER_IMAGE: 'aven-connection-runner:local',
	E2E_ARTIFACT_STORE_IMAGE: 'aven-connection-store:local',
	E2E_INTENT_SERVICE_IMAGE: process.env.E2E_INTENT_SERVICE_IMAGE ?? 'aven-e2e-intent-service:local',
	LLM_GATEWAY_ENABLED: 'true',
	LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
	LLM_GATEWAY_CREDENTIALS_JSON: '{}',
	LLM_GATEWAY_MODELS_JSON: JSON.stringify(
		localLlmCatalog({
			LOCAL_LLM_MODEL: model,
			LOCAL_LLM_BASE_URL: baseUrl,
			LOCAL_LLM_VISION: 'false'
		})
	)
}
const result = Bun.spawnSync(
	[
		'docker',
		'compose',
		'--env-file',
		'/dev/null',
		'--project-name',
		'aven-connections',
		'--file',
		'deploy/e2e/docker-compose.yml',
		'--file',
		'deploy/local/docker-compose.yml',
		'config',
		'--format',
		'json'
	],
	{ env, stdout: 'pipe', stderr: 'pipe' }
)
if (result.exitCode !== 0) throw Error('Synthetic Compose resolution failed. No services started.')
const base = JSON.parse(result.stdout.toString())
delete base.services['llm-mock']
delete base.services.api.depends_on['llm-mock']
delete base.services['artifact-store-conformance']
delete base.services['artifact-store-conformance-migrate']
const policy = {
	revision: 1,
	httpTargets: [{ origin: 'https://api.example.test', pathPrefix: '/reports/' }],
	imapOrigins: ['https://mail.example.test:993'],
	maximumBytes: 1048576,
	maximumSeconds: 30
}
const { directory } = await prepareLocalConnections(base, policy)
await writeFile(`${directory}/base.json`, JSON.stringify(base, null, 2), {
	mode: 0o600,
	flag: 'wx'
})
console.log(
	JSON.stringify({ directory, project: 'aven-connections', prepared: true, started: false })
)
