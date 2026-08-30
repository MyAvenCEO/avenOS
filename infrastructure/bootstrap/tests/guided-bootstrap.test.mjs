import assert from 'node:assert/strict'
import test from 'node:test'
import {
	guidedBootstrapIntroduction,
	guidedBootstrapRecoveryNotice,
	guidedCredentialsCsv,
	hetznerProjectConsoleUrl,
	S3_CREDENTIAL_STEPS,
	s3ErrorCode,
	setValueAt,
	signedS3ReadRequest,
	valueAt
} from '../../../scripts/lib/deployment-bootstrap-guided.ts'

test('introduces every manual prerequisite and the incremental plaintext recovery behavior', () => {
	const contents = guidedBootstrapIntroduction('avenos-0123456789')
	for (const requiredText of [
		'GitHub',
		'7 S3 credentials',
		'3 Cloud write tokens',
		'2 aven.ceo DNS write tokens',
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

test('guides exactly one administrator and two roles for every target', () => {
	assert.equal(S3_CREDENTIAL_STEPS.length, 7)
	assert.equal(new Set(S3_CREDENTIAL_STEPS.map((step) => step.description)).size, 7)
	assert.equal(new Set(S3_CREDENTIAL_STEPS.map((step) => step.path.join('.'))).size, 7)
	assert.deepEqual(S3_CREDENTIAL_STEPS[0].path, ['objectStorage', 'bootstrapCredential'])
	for (const target of ['identity', 'next', 'production']) {
		assert.ok(
			S3_CREDENTIAL_STEPS.some((step) => step.description === `avenOS ${target} deployment`)
		)
		assert.ok(S3_CREDENTIAL_STEPS.some((step) => step.description === `avenOS ${target} observer`))
	}
})

test('preserves partial credentials with descriptive password-manager fields', () => {
	const draft = {
		objectStorage: {
			projectId: '1234567',
			bootstrapCredential: { accessKeyId: 'BOOTACCESS', secretAccessKey: 'BOOTSECRET' }
		},
		providers: { identity: { computeToken: 'COMPUTESECRET' } }
	}
	const contents = guidedCredentialsCsv(draft, 'avenos-0123456789')
	assert.match(contents, /"Group","Title","Username","Password","URL","Notes"/)
	assert.match(contents, /"avenOS\/avenos-0123456789\/bootstrap"/)
	assert.match(contents, /"avenOS\/avenos-0123456789\/identity"/)
	assert.match(contents, /avenOS bootstrap administrator/)
	assert.match(contents, /Creates buckets and installs their isolation policies/)
	assert.match(contents, /BOOTACCESS/)
	assert.match(contents, /BOOTSECRET/)
	assert.match(contents, /avenOS identity Hetzner compute token/)
	assert.match(contents, /Target-scoped Hetzner Cloud API token/)
	assert.doesNotMatch(contents, /avenOS next Hetzner compute token/)
})

test('builds the exact project console URL and rejects ambiguous IDs', () => {
	assert.equal(
		hetznerProjectConsoleUrl('1234567'),
		'https://console.hetzner.com/projects/1234567/servers'
	)
	assert.throws(() => hetznerProjectConsoleUrl('project-1'), /must be numeric/)
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
