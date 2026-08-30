import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
	generateBootstrapSecrets,
	githubConfiguration,
	githubEnvironmentProtection,
	recoveryCsv,
	validateBootstrapInput,
	writeRecoveryCsv
} from '../../../scripts/lib/deployment-bootstrap.ts'

const credential = (name) => ({ accessKeyId: `${name}ACCESS1`, secretAccessKey: `${name}-secret` })
const input = {
	repository: 'MyAvenCEO/avenOS',
	reviewer: 'operator',
	objectStorage: {
		projectId: '12345',
		region: 'hel1',
		bootstrapCredential: credential('BOOT'),
		targets: Object.fromEntries(
			['identity', 'next', 'production'].map((target) => [
				target,
				{
					deploymentCredential: credential(`${target}DEPLOY`),
					observerCredential: credential(`${target}READ`)
				}
			])
		)
	},
	defaults: {
		hetznerLocation: 'hel1',
		hetznerServerType: 'cpx32',
		hetznerOsImage: 'ubuntu-24.04',
		identityVolumeSizeGb: 40,
		platformVolumeSizeGb: 80,
		sshAllowedCidrs: '192.0.2.1/32',
		acmeEmail: 'ops@example.test',
		downloadUrl: 'https://example.test/download'
	},
	providers: {
		identity: { computeToken: 'identity-compute-token' },
		next: {
			computeToken: 'next-compute-token',
			dnsToken: 'next-dns',
			polarApiKey: 'next-polar',
			polarOrganizationId: 'next-org',
			smtpUrl: 'smtp://next',
			smtpFrom: 'next@example.test'
		},
		production: {
			computeToken: 'prod-compute-token',
			dnsToken: 'prod-dns',
			polarApiKey: 'prod-polar',
			polarOrganizationId: 'prod-org',
			smtpUrl: 'smtp://prod',
			smtpFrom: 'prod@example.test'
		},
		redpillApiKey: 'redpill-secret-key'
	}
}

test('validates the complete provider input before changing anything', () => {
	assert.doesNotThrow(() => validateBootstrapInput(input))
	const { reviewer: _reviewer, ...soloInput } = input
	assert.doesNotThrow(() => validateBootstrapInput(soloInput))
	assert.throws(() => validateBootstrapInput({ ...input, reviewer: '' }), /reviewer is required/)
	assert.throws(
		() =>
			validateBootstrapInput({
				...input,
				providers: { ...input.providers, redpillApiKey: '' }
			}),
		/providers.redpillApiKey/
	)
	assert.throws(
		() =>
			validateBootstrapInput({
				...input,
				providers: { ...input.providers, redpillApiKey: 'PASTE_REDPILL_API_KEY' }
			}),
		/template placeholder/
	)
})

test('uses solo operation by default and enables review when requested', () => {
	assert.deepEqual(githubEnvironmentProtection(true), {
		wait_timer: 0,
		prevent_self_review: false,
		reviewers: [],
		deployment_branch_policy: { protected_branches: true, custom_branch_policies: false }
	})
	assert.deepEqual(githubEnvironmentProtection(true, 42), {
		wait_timer: 0,
		prevent_self_review: true,
		reviewers: [{ type: 'User', id: 42 }],
		deployment_branch_policy: { protected_branches: true, custom_branch_policies: false }
	})
	assert.deepEqual(githubEnvironmentProtection(false, 42).reviewers, [])
})

test('builds all deployment and operations environment settings', () => {
	const generated = generateBootstrapSecrets()
	generated.polarWebhooks = {
		next: {
			id: 'next-hook',
			url: 'https://my.next.aven.ceo/api/webhooks/polar',
			secret: 'next-secret'
		},
		production: {
			id: 'prod-hook',
			url: 'https://my.aven.ceo/api/webhooks/polar',
			secret: 'prod-secret'
		}
	}
	const settings = githubConfiguration(input, generated)
	const prefix = generated.deploymentPrefix
	assert.deepEqual(
		Object.keys(settings).sort(),
		[
			`${prefix}-identity`,
			`${prefix}-identity-operations`,
			`${prefix}-next`,
			`${prefix}-next-operations`,
			`${prefix}-production`,
			`${prefix}-production-operations`
		].sort()
	)
	assert.equal(
		settings[`${prefix}-next`].variables.PULUMI_STATE_S3_BUCKET,
		`${prefix}-12345-next-state`
	)
	assert.equal(
		settings[`${prefix}-next`].secrets.BACKUP_S3_ACCESS_KEY_ID,
		settings[`${prefix}-next`].secrets.PULUMI_STATE_S3_ACCESS_KEY_ID
	)
	assert.equal(
		settings[`${prefix}-next-operations`].secrets.PULUMI_STATE_S3_ACCESS_KEY_ID,
		input.objectStorage.targets.next.observerCredential.accessKeyId
	)
	assert.equal(
		settings[`${prefix}-identity`].secrets.NEXT_STATE_S3_ACCESS_KEY_ID,
		input.objectStorage.targets.next.observerCredential.accessKeyId
	)
	assert.equal(
		settings[`${prefix}-production`].secrets.LLM_GATEWAY_CREDENTIALS_JSON,
		JSON.stringify({ redpill: 'redpill-secret-key' })
	)
})

test('writes password-manager recovery material owner-only', () => {
	const directory = mkdtempSync(join(tmpdir(), 'aven-bootstrap-test-'))
	chmodSync(directory, 0o700)
	const path = join(directory, 'recovery.csv')
	const generated = generateBootstrapSecrets()
	generated.polarWebhooks = {
		next: {
			id: 'next-hook',
			url: 'https://my.next.aven.ceo/api/webhooks/polar',
			secret: 'next-secret'
		},
		production: {
			id: 'prod-hook',
			url: 'https://my.aven.ceo/api/webhooks/polar',
			secret: 'prod-secret'
		}
	}
	writeRecoveryCsv(path, recoveryCsv(input, generated))
	assert.equal(statSync(path).mode & 0o777, 0o600)
	const contents = readFileSync(path, 'utf8')
	assert.match(contents, /avenOS next Restic password/)
	assert.match(contents, /avenOS RedPill API key/)
	assert.throws(() => writeRecoveryCsv(path, contents), /refusing to overwrite/)
})
