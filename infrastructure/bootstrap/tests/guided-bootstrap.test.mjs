import assert from 'node:assert/strict'
import test from 'node:test'
import {
	actionableWizardProgress,
	bootstrapFailureSummary,
	createExactS3Bucket,
	deploymentTargetSummary,
	exactS3BucketExists,
	guidedBootstrapIntroduction,
	guidedBootstrapRecoveryNotice,
	guidedCredentialsCsv,
	hetznerProjectTokensUrl,
	hetznerS3CredentialsUrl,
	orderedDeploymentTargets,
	POLAR_API_KEY_SCOPES,
	retryableGitHubCliFailure,
	S3_CREDENTIAL_STEPS,
	s3ErrorCode,
	savedWizardResumeIndex,
	savedWizardVerificationIndexes,
	setValueAt,
	signedS3CreateBucketRequest,
	signedS3DeleteBucketRequest,
	signedS3ListBucketsRequest,
	signedS3ReadRequest,
	unseenWorkflowRunId,
	validateS3ProjectCredential,
	valueAt,
	workflowFailureSummary,
	workflowRunIdFromDispatchOutput
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

test('identifies a dispatched workflow without depending on exact gh prose', () => {
	assert.equal(
		workflowRunIdFromDispatchOutput(
			'✓ Created workflow dispatch\nhttps://github.com/MyAvenCEO/avenOS/actions/runs/123456?check_suite_focus=true'
		),
		123456
	)
	assert.equal(workflowRunIdFromDispatchOutput('dispatch accepted; URL unavailable'), undefined)
	assert.equal(
		unseenWorkflowRunId(
			[{ databaseId: 14 }, { databaseId: 13 }, { databaseId: 12 }],
			new Set([13, 12])
		),
		14
	)
	assert.equal(unseenWorkflowRunId([{ databaseId: 12 }], new Set([12])), undefined)
})

test('turns repeated Hetzner DNS conflicts into one actionable workflow failure', () => {
	const log = `next Infrastructure\tCreate DNS\t2026-08-31T10:00:00Z error: (next, CNAME) conflicts with (next, A)
next Infrastructure\tCreate DNS\t2026-08-31T10:00:01Z error: (next, CNAME) conflicts with (next, AAAA)
next Infrastructure\tCreate DNS\t2026-08-31T10:00:02Z error: (api.next, CNAME) conflicts with (api.next, A)
next Infrastructure\tCreate DNS\t2026-08-31T10:00:03Z error: (api.next, CNAME) conflicts with (api.next, AAAA)
next Infrastructure\tCreate DNS\t2026-08-31T10:00:04Z error: (next, CNAME) conflicts with (next, A)`
	assert.equal(
		workflowFailureSummary(log),
		'Hetzner DNS conflict: next CNAME blocks A and AAAA; api.next CNAME blocks A and AAAA. Retry with the current setup; it removes only those obsolete CNAME record sets before applying the managed addresses.'
	)
})

test('turns unmanaged matching Hetzner DNS record sets into an automatic retry instruction', () => {
	const log = `error: [ERROR] An unexpected error was encountered during an API request.
RRSet(s) already exist(s) (uniqueness_error, 34a3f5c19c173e0ec40c4b476a6dca94)
Error code: uniqueness_error
Status code: 409
error: API request failed`
	assert.equal(
		workflowFailureSummary(log),
		'Hetzner DNS record sets already exist outside this Pulumi stack. Retry with the current setup; it adopts and updates the exact managed A and AAAA record sets automatically.'
	)
})

test('keeps a concise provider error when no specialized failure explanation applies', () => {
	assert.equal(
		workflowFailureSummary(
			'job\tstep\t2026-08-31T10:00:00Z error: update failed\njob\tstep\t2026-08-31T10:00:01Z Error: token lacks zones:write\nError: Process completed with exit code 1.'
		),
		'Error: token lacks zones:write'
	)
	assert.equal(workflowFailureSummary('ordinary workflow output'), undefined)
})

test('explains a missing native release-runner library and removes terminal escapes', () => {
	const ansiEscape = String.fromCharCode(27)
	const log = `verify\tE2E\t2026-09-02T23:47:19Z ${ansiEscape}[1m${ansiEscape}[91merror${ansiEscape}[0m: failed to run custom build command for alsa-sys
verify\tE2E\t2026-09-02T23:47:19Z The system library \`alsa\` required by crate \`alsa-sys\` was not found.
verify\tE2E\t2026-09-02T23:47:19Z ^[[1m^[[33mwarning^[[0m: build failed, waiting for other jobs to finish...`
	assert.equal(
		workflowFailureSummary(log),
		'Release runner is missing native library alsa required by alsa-sys. Merge a workflow dependency fix, update this checkout to that commit, then resume the saved setup.'
	)
})

test('recognizes transient GitHub CLI failures that are safe to reconcile', () => {
	assert.equal(retryableGitHubCliFailure('gh timed out after 30s'), true)
	assert.equal(retryableGitHubCliFailure('gh failed: HTTP 502 Bad Gateway'), true)
	assert.equal(retryableGitHubCliFailure('gh failed: authentication required'), false)
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

test('reopens a newly required station before later saved values', () => {
	const steps = [
		{ info: true, path: [] },
		{ path: ['repository'] },
		{ path: ['githubPackagesReadToken'] },
		{ path: ['reviewer'], optional: true },
		{ path: ['providers', 'next', 'dnsToken'] }
	]
	assert.equal(
		savedWizardResumeIndex(steps, {
			repository: 'MyAvenCEO/avenOS',
			providers: { next: { dnsToken: 'saved-later-value' } }
		}),
		2
	)
})

test('rechecks every saved credential on resume, including earlier Polar keys', () => {
	const steps = [
		{ info: true, path: [], verify: true },
		{ path: ['repository'], verify: true },
		{ path: ['providers', 'production', 'polarApiKey'], verify: true },
		{ path: ['providers', 'production', 'smtpUrl'] },
		{ path: ['providers', 'redpillApiKey'], verify: true },
		{ path: ['reviewer'], optional: true, verify: true },
		{
			path: ['storage', 'accessKey'],
			verify: true,
			companion: { path: ['storage', 'secretKey'] }
		}
	]
	const draft = {
		repository: 'MyAvenCEO/avenOS',
		providers: {
			production: { polarApiKey: 'old-token', smtpUrl: 'smtps://saved' },
			redpillApiKey: 'saved-redpill-key'
		},
		storage: { accessKey: 'saved-without-companion' }
	}

	assert.deepEqual(savedWizardVerificationIndexes(steps, draft), [1, 2, 4])
})

test('surfaces a concise provider error on the recovery screen', () => {
	assert.equal(
		bootstrapFailureSummary([
			'error: The payment provider rejected list-benefits.',
			'details: "API error: HTTP 403 insufficient_scope",',
			'at async syncBenefits'
		]),
		'The payment provider rejected list-benefits. — API error: HTTP 403 insufficient_scope'
	)
	assert.equal(bootstrapFailureSummary(['stack frame only']), undefined)
	assert.equal(
		bootstrapFailureSummary([
			'error: update failed',
			'error: expected non-nil error with nil state during Create of identity-state',
			'error: pulumi failed'
		]),
		'expected non-nil error with nil state during Create of identity-state'
	)
})

test('introduces every manual prerequisite and the incremental plaintext recovery behavior', () => {
	const contents = guidedBootstrapIntroduction('avenos-0123456789')
	for (const requiredText of [
		'GitHub',
		'read:packages',
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
		githubPackagesReadToken: 'PACKAGESECRET',
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
	assert.match(contents, /avenOS GitHub Packages reader/)
	assert.match(contents, /PACKAGESECRET/)
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

test('signs the project-level bucket listing used to validate an S3 credential', () => {
	const request = signedS3ListBucketsRequest({
		region: 'hel1',
		accessKeyId: 'EXAMPLEACCESS',
		secretAccessKey: 'example-secret-that-must-not-appear',
		now: new Date('2026-08-30T12:34:56.000Z')
	})
	assert.equal(request.url, 'https://hel1.your-objectstorage.com/')
	assert.match(request.headers.Authorization, /Credential=EXAMPLEACCESS\/20260830\/hel1\/s3/)
	assert.match(request.headers.Authorization, /Signature=[a-f0-9]{64}$/)
	assert.doesNotMatch(JSON.stringify(request), /example-secret-that-must-not-appear/)
})

test('validates an S3 credential by listing the project root, not a bucket', async () => {
	const input = {
		region: 'hel1',
		accessKeyId: 'EXAMPLEACCESS',
		secretAccessKey: 'example-secret-that-must-not-appear'
	}
	const requests = []
	assert.equal(
		await validateS3ProjectCredential(input, async (url, options) => {
			requests.push({ url, options })
			return new Response(
				'<ListAllMyBucketsResult><Buckets><Bucket></Bucket><Bucket></Bucket></Buckets></ListAllMyBucketsResult>',
				{ status: 200 }
			)
		}),
		2
	)
	assert.equal(requests[0].url, 'https://hel1.your-objectstorage.com/')
	assert.doesNotMatch(JSON.stringify(requests), /example-secret-that-must-not-appear/)
	await assert.rejects(
		validateS3ProjectCredential(
			input,
			async () => new Response('<Error><Code>InvalidAccessKeyId</Code></Error>', { status: 403 })
		),
		/HTTP 403 \(InvalidAccessKeyId\)/
	)
	await assert.rejects(
		validateS3ProjectCredential(input, async () => new Response('<html/>', { status: 200 })),
		/unexpected list-buckets response/
	)
})

test('signs an empty private bucket create without exposing the secret', () => {
	const request = signedS3CreateBucketRequest({
		region: 'hel1',
		accessKeyId: 'EXAMPLEACCESS',
		secretAccessKey: 'example-secret-that-must-not-appear',
		bucket: 'avenos-0123456789-1234567-next-state',
		now: new Date('2026-08-30T12:34:56.000Z')
	})
	assert.equal(
		request.url,
		'https://hel1.your-objectstorage.com/avenos-0123456789-1234567-next-state'
	)
	assert.match(request.headers.Authorization, /Credential=EXAMPLEACCESS\/20260830\/hel1\/s3/)
	assert.match(request.headers.Authorization, /Signature=[a-f0-9]{64}$/)
	assert.doesNotMatch(JSON.stringify(request), /example-secret-that-must-not-appear/)
})

test('signs an exact empty bucket delete without exposing the secret', () => {
	const request = signedS3DeleteBucketRequest({
		region: 'hel1',
		accessKeyId: 'EXAMPLEACCESS',
		secretAccessKey: 'example-secret-that-must-not-appear',
		bucket: 'avenos-0123456789-1234567-disposable',
		now: new Date('2026-08-30T12:34:56.000Z')
	})
	assert.equal(
		request.url,
		'https://hel1.your-objectstorage.com/avenos-0123456789-1234567-disposable'
	)
	assert.match(request.headers.Authorization, /Credential=EXAMPLEACCESS\/20260830\/hel1\/s3/)
	assert.match(request.headers.Authorization, /Signature=[a-f0-9]{64}$/)
	assert.doesNotMatch(JSON.stringify(request), /example-secret-that-must-not-appear/)
})

test('checks one exact bucket without listing storage', async () => {
	const requests = []
	const input = {
		region: 'hel1',
		accessKeyId: 'EXAMPLEACCESS',
		secretAccessKey: 'example-secret',
		bucket: 'avenos-0123456789-1234567-next-state'
	}
	assert.equal(
		await exactS3BucketExists(input, async (url, options) => {
			requests.push({ url, options })
			return new Response('', { status: 200 })
		}),
		true
	)
	assert.equal(requests.length, 1)
	assert.match(requests[0].url, new RegExp(`/${input.bucket}\\?list-type=2&max-keys=0$`))
	assert.equal(requests[0].options.method, undefined)
	assert.equal(
		await exactS3BucketExists(input, async () => new Response('', { status: 404 })),
		false
	)
	await assert.rejects(
		exactS3BucketExists(input, async () => new Response('', { status: 403 })),
		/HTTP 403.*exact bucket/
	)
})

test('creates only the exact bucket and accepts an idempotent conflict', async () => {
	const input = {
		region: 'hel1',
		accessKeyId: 'EXAMPLEACCESS',
		secretAccessKey: 'example-secret',
		bucket: 'avenos-0123456789-1234567-next-state'
	}
	const requests = []
	await createExactS3Bucket(input, async (url, options) => {
		requests.push({ url, options })
		return new Response('', { status: 200 })
	})
	assert.equal(requests.length, 1)
	assert.equal(requests[0].url, `https://hel1.your-objectstorage.com/${input.bucket}`)
	assert.equal(requests[0].options.method, 'PUT')
	await createExactS3Bucket(
		input,
		async () => new Response('<Error><Code>BucketAlreadyOwnedByYou</Code></Error>', { status: 409 })
	)
	await assert.rejects(
		createExactS3Bucket(
			input,
			async () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
		),
		/HTTP 403 \(AccessDenied\)/
	)
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
