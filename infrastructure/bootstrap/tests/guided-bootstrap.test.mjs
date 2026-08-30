import assert from 'node:assert/strict'
import test from 'node:test'
import {
	actionableWizardProgress,
	deploymentTargetSummary,
	guidedBootstrapIntroduction,
	guidedBootstrapRecoveryNotice,
	guidedCredentialsCsv,
	hetznerProjectTokensUrl,
	hetznerS3CredentialsUrl,
	orderedDeploymentTargets,
	POLAR_API_KEY_SCOPES,
	S3_CREDENTIAL_STEPS,
	s3ErrorCode,
	savedWizardResumeIndex,
	setValueAt,
	signedS3ReadRequest,
	valueAt
} from '../../../scripts/lib/deployment-bootstrap-guided.ts'

test('documents the least-privilege Polar scopes used by bootstrap and checkout', () => {
	assert.deepEqual(POLAR_API_KEY_SCOPES, [
		'organizations:read',
		'products:write',
		'benefits:write',
		'meters:write',
		'checkouts:write',
		'subscriptions:write',
		'customers:read',
		'orders:read',
		'webhooks:write'
	])
})

test('counts only screens that require an answer', () => {
	const steps = [{ info: true }, { info: true }, {}, {}, {}]
	assert.equal(actionableWizardProgress(steps, 0), undefined)
	assert.equal(actionableWizardProgress(steps, 1), undefined)
	assert.deepEqual(actionableWizardProgress(steps, 2), { current: 1, total: 3 })
	assert.deepEqual(actionableWizardProgress(steps, 4), { current: 3, total: 3 })
})

test('resumes at the latest saved station so an unverified value is checked again', () => {
	const steps = [
		{ info: true, path: [] },
		{ path: ['repository'] },
		{ path: ['providers', 'next', 'dnsToken'] },
		{ path: ['providers', 'next', 'polarApiKey'] }
	]
	assert.equal(savedWizardResumeIndex(steps, {}), 1)
	assert.equal(savedWizardResumeIndex(steps, { repository: 'MyAvenCEO/avenOS' }), 1)
	assert.equal(
		savedWizardResumeIndex(steps, {
			repository: 'MyAvenCEO/avenOS',
			providers: { next: { dnsToken: 'saved-but-not-yet-verified' } }
		}),
		2
	)
})

test('introduces every manual prerequisite and the incremental plaintext recovery behavior', () => {
	const contents = guidedBootstrapIntroduction('avenos-0123456789')
	for (const requiredText of [
		'GitHub',
		'9 S3 credentials',
		'3 target-scoped Cloud write token',
		'the project ID that owns aven.ceo',
		'2 DNS write tokens from that project',
		'Polar',
		'SMTP',
		'RedPill',
		'Phala-hosted',
		'ACME email',
		'second GitHub reviewer',
		'aven.id'
	])
		assert.match(contents, new RegExp(requiredText.replaceAll('.', '\\.')))
	const recovery = guidedBootstrapRecoveryNotice(
		'/private/bootstrap-input.json',
		'/private/credentials.csv'
	)
	for (const requiredText of [
		'plaintext',
		'/private/bootstrap-input.json',
		'/private/credentials.csv',
		'can strand a partially applied bootstrap',
		'no default'
	])
		assert.match(recovery, new RegExp(requiredText.replaceAll('.', '\\.')))
})

test('orders and explains any non-empty target selection', () => {
	assert.deepEqual(orderedDeploymentTargets(['production', 'identity']), ['identity', 'production'])
	assert.deepEqual(orderedDeploymentTargets(['not-a-target']), [])
	assert.match(deploymentTargetSummary(['next']), /next platform at \*\.next\.aven\.ceo/)
	const identityOnly = guidedBootstrapIntroduction('avenos-0123456789', ['identity'])
	assert.match(identityOnly, /Selected targets: identity/)
	assert.match(identityOnly, /3 S3 credentials/)
	assert.doesNotMatch(identityOnly, /Polar:/)
	assert.doesNotMatch(identityOnly, /RedPill:/)
})

test('guides one administrator and two roles in each isolated target project', () => {
	assert.equal(S3_CREDENTIAL_STEPS.length, 9)
	assert.equal(new Set(S3_CREDENTIAL_STEPS.map((step) => step.description)).size, 9)
	assert.equal(new Set(S3_CREDENTIAL_STEPS.map((step) => step.path.join('.'))).size, 9)
	for (const target of ['identity', 'next', 'production']) {
		assert.equal(S3_CREDENTIAL_STEPS.filter((step) => step.target === target).length, 3)
		assert.ok(
			S3_CREDENTIAL_STEPS.some(
				(step) => step.description === `avenOS ${target} bootstrap administrator`
			)
		)
		assert.ok(
			S3_CREDENTIAL_STEPS.some((step) => step.description === `avenOS ${target} deployment`)
		)
		assert.ok(S3_CREDENTIAL_STEPS.some((step) => step.description === `avenOS ${target} observer`))
	}
})

test('preserves partial credentials with descriptive password-manager fields', () => {
	const draft = {
		objectStorage: {
			targets: {
				identity: {
					projectId: '1234567',
					bootstrapCredential: {
						accessKeyId: 'BOOTACCESS',
						secretAccessKey: 'BOOTSECRET'
					}
				}
			}
		},
		providers: {
			dnsProjectId: '4567890',
			identity: { computeToken: 'COMPUTESECRET' },
			next: { dnsToken: 'DNSSECRET' }
		}
	}
	const contents = guidedCredentialsCsv(draft, 'avenos-0123456789')
	assert.match(contents, /"Group","Title","Username","Password","URL","Notes"/)
	assert.match(contents, /"avenOS\/avenos-0123456789\/identity"/)
	assert.match(contents, /avenOS identity bootstrap administrator/)
	assert.match(contents, /Creates and repairs only the identity buckets/)
	assert.match(contents, /BOOTACCESS/)
	assert.match(contents, /BOOTSECRET/)
	assert.match(contents, /avenOS identity deployment \(Hetzner Cloud token\)/)
	assert.match(contents, /Target-scoped Hetzner Cloud API token/)
	assert.match(contents, /avenOS next DNS deployment \(Hetzner DNS token\)/)
	assert.match(contents, /projects\/4567890\/security\/tokens/)
	assert.match(contents, /shared aven\.ceo DNS zone in Hetzner project 4567890/)
	assert.doesNotMatch(contents, /avenOS next Hetzner compute token/)
})

test('builds the exact project console URL and rejects ambiguous IDs', () => {
	assert.equal(
		hetznerS3CredentialsUrl('1234567'),
		'https://console.hetzner.com/projects/1234567/security/s3-credentials'
	)
	assert.throws(() => hetznerS3CredentialsUrl('project-1'), /must be numeric/)
	assert.equal(
		hetznerProjectTokensUrl('1234567'),
		'https://console.hetzner.com/projects/1234567/security/tokens'
	)
})

test('signs read-only S3 verification requests without exposing the secret', () => {
	const request = signedS3ReadRequest({
		region: 'hel1',
		accessKeyId: 'EXAMPLEACCESS',
		secretAccessKey: 'example-secret-that-must-not-appear',
		bucket: 'avenos-0123456789-1234567-next-state',
		now: new Date('2026-08-30T12:34:56.000Z')
	})
	assert.equal(
		request.url,
		'https://hel1.your-objectstorage.com/avenos-0123456789-1234567-next-state?list-type=2&max-keys=0'
	)
	assert.match(request.headers.Authorization, /Credential=EXAMPLEACCESS\/20260830\/hel1\/s3/)
	assert.match(request.headers.Authorization, /Signature=[a-f0-9]{64}$/)
	assert.doesNotMatch(JSON.stringify(request), /example-secret-that-must-not-appear/)
	assert.equal(s3ErrorCode('<Error><Code>NoSuchBucket</Code></Error>'), 'NoSuchBucket')
})

test('persists nested answers without replacing sibling values', () => {
	const draft = {}
	setValueAt(draft, ['objectStorage', 'targets', 'next', 'deploymentCredential'], 'deploy')
	setValueAt(draft, ['objectStorage', 'targets', 'next', 'observerCredential'], 'observe')
	assert.equal(
		valueAt(draft, ['objectStorage', 'targets', 'next', 'deploymentCredential']),
		'deploy'
	)
	assert.equal(
		valueAt(draft, ['objectStorage', 'targets', 'next', 'observerCredential']),
		'observe'
	)
})
