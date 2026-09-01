import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
	bootstrapPulumiUpArgs,
	collidingBootstrapBucketKinds,
	deploymentConfigurationTargets,
	encodeBootstrapProgress,
	ensurePrivateDirectory,
	generateBootstrapSecrets,
	githubConfiguration,
	githubEnvironmentProtection,
	githubEnvironmentVariableChanges,
	isRetryableGitHubError,
	parseBootstrapProgress,
	providerCreatedBootstrapBucketKinds,
	reconcileBootstrapBucketUpdate,
	recoveryCsv,
	trackedBootstrapBucketKinds,
	validateBootstrapInput,
	writeRecoveryCsv
} from '../../../scripts/lib/deployment-bootstrap.ts'

test('reconciles empty GitHub variables by removing only stale values', () => {
	assert.deepEqual(
		githubEnvironmentVariableChanges(
			{
				SMTP_FROM: 'avenOS <hello@example.com>',
				SMTP_REPLY_TO: '',
				ANDROID_APP_CERT_SHA256_FINGERPRINTS: ''
			},
			['SMTP_REPLY_TO', 'UNRELATED_VARIABLE']
		),
		{
			set: [['SMTP_FROM', 'avenOS <hello@example.com>']],
			remove: ['SMTP_REPLY_TO']
		}
	)
})

test('retries only transient GitHub failures', () => {
	for (const commandOutput of [
		'dial tcp 140.82.121.5:443: i/o timeout',
		'TLS handshake timeout',
		'HTTP 429: rate limited',
		'HTTP 503: unavailable'
	]) {
		assert.equal(isRetryableGitHubError({ commandOutput }), true)
	}
	for (const commandOutput of [
		'HTTP 401: Bad credentials',
		'HTTP 403: Resource not accessible',
		'HTTP 422: Invalid request',
		'not found'
	]) {
		assert.equal(isRetryableGitHubError({ commandOutput }), false)
	}
})

test('adopts only deterministic buckets reported by an interrupted bootstrap update', () => {
	const expected = {
		state: 'avenos-0123456789-1234567-next-state',
		backup: 'avenos-0123456789-1234567-next-backup'
	}
	assert.deepEqual(
		collidingBootstrapBucketKinds(
			'[FATAL] bucket already exists! (avenos-0123456789-1234567-next-state)',
			expected
		),
		['state']
	)
	assert.deepEqual(
		collidingBootstrapBucketKinds(
			'[FATAL] bucket already exists! (someone-elses-bucket)',
			expected
		),
		[]
	)
})

test('recognizes the provider nil-state defect only for an exact bootstrap bucket URN', () => {
	const output = `error: expected non-nil error with nil state during Create of
urn:pulumi:production::aven-bootstrap::minio:index/s3Bucket:S3Bucket::production-state`
	assert.deepEqual(providerCreatedBootstrapBucketKinds(output, 'production'), ['state'])
	assert.deepEqual(providerCreatedBootstrapBucketKinds(output, 'next'), [])
	assert.deepEqual(
		providerCreatedBootstrapBucketKinds(
			'expected non-nil error with nil state during Create of urn:pulumi:production::other-project::minio:index/s3Bucket:S3Bucket::production-state',
			'production'
		),
		[]
	)
})

test('converges after either bucket is created without entering the failed checkpoint', async () => {
	for (const orphan of ['state', 'backup']) {
		const physical = new Set()
		const tracked = new Set()
		const calls = []
		let first = true
		await reconcileBootstrapBucketUpdate({
			target: 'production',
			expected: {
				state: 'avenos-0123456789-123-production-state',
				backup: 'avenos-0123456789-123-production-backup'
			},
			inspect: async () => ({ existing: [...physical], tracked: [...tracked] }),
			apply: async (adopt) => {
				calls.push([...adopt])
				for (const kind of adopt) tracked.add(kind)
				if (first) {
					first = false
					physical.add(orphan)
					const error = new Error('provider lost create state')
					error.commandOutput = `expected non-nil error with nil state during Create of urn:pulumi:production::aven-bootstrap::minio:index/s3Bucket:S3Bucket::production-${orphan}`
					throw error
				}
				for (const kind of ['state', 'backup']) {
					physical.add(kind)
					tracked.add(kind)
				}
			}
		})
		assert.deepEqual(calls, [[], [orphan]])
		assert.deepEqual([...physical].sort(), ['backup', 'state'])
		assert.deepEqual([...tracked].sort(), ['backup', 'state'])
	}
})

test('adopts every exact untracked bucket left by an interrupted process', async () => {
	const calls = []
	const tracked = new Set(['backup'])
	await reconcileBootstrapBucketUpdate({
		target: 'identity',
		expected: { state: 'expected-state', backup: 'expected-backup' },
		inspect: async () => ({ existing: ['state', 'backup'], tracked: [...tracked] }),
		apply: async (adopt) => {
			calls.push([...adopt])
			for (const kind of adopt) tracked.add(kind)
		}
	})
	assert.deepEqual(calls, [['state']])
})

test('derives exact adoption from every physical and checkpoint subset', async () => {
	const subsets = [[], ['state'], ['backup'], ['state', 'backup']]
	for (const existing of subsets) {
		for (const tracked of subsets) {
			const calls = []
			await reconcileBootstrapBucketUpdate({
				target: 'identity',
				expected: { state: 'expected-state', backup: 'expected-backup' },
				inspect: async () => ({ existing, tracked }),
				apply: async (adopt) => calls.push([...adopt])
			})
			assert.deepEqual(calls, [existing.filter((kind) => !tracked.includes(kind))])
		}
	}
})

test('does not loop when adoption itself cannot establish ownership', async () => {
	let calls = 0
	const original = new Error('import failed')
	await assert.rejects(
		reconcileBootstrapBucketUpdate({
			target: 'next',
			expected: { state: 'expected-state', backup: 'expected-backup' },
			inspect: async () => ({ existing: ['state'], tracked: [] }),
			apply: async () => {
				calls += 1
				throw original
			}
		}),
		(error) => error === original
	)
	assert.equal(calls, 1)
})

test('bounds retries even when a broken provider reports an already tracked create', async () => {
	let calls = 0
	const original = new Error('impossible repeated create')
	original.commandOutput =
		'expected non-nil error with nil state during Create of urn:pulumi:next::aven-bootstrap::minio:index/s3Bucket:S3Bucket::next-state'
	await assert.rejects(
		reconcileBootstrapBucketUpdate({
			target: 'next',
			expected: { state: 'expected-state', backup: 'expected-backup' },
			inspect: async () => ({ existing: ['state'], tracked: ['state'] }),
			apply: async () => {
				calls += 1
				throw original
			}
		}),
		(error) => error === original
	)
	assert.equal(calls, 3)
})

test('does not reinterpret an unrelated provider failure as owned storage', async () => {
	let calls = 0
	const original = new Error('permission denied')
	await assert.rejects(
		reconcileBootstrapBucketUpdate({
			target: 'next',
			expected: { state: 'expected-state', backup: 'expected-backup' },
			inspect: async () => ({ existing: [], tracked: [] }),
			apply: async () => {
				calls += 1
				throw original
			}
		}),
		(error) => error === original
	)
	assert.equal(calls, 1)
})

test('finds only target buckets already tracked in an interrupted bootstrap stack', () => {
	assert.deepEqual(
		trackedBootstrapBucketKinds(
			{
				deployment: {
					resources: [
						{
							type: 'minio:index/s3Bucket:S3Bucket',
							urn: 'urn:pulumi:identity::aven-bootstrap::minio:index/s3Bucket:S3Bucket::identity-backup'
						},
						{
							type: 'minio:index/s3Bucket:S3Bucket',
							urn: 'urn:pulumi:identity::aven-bootstrap::minio:index/s3Bucket:S3Bucket::next-state'
						}
					]
				}
			},
			'identity'
		),
		['backup']
	)
})

test('serializes bootstrap storage mutations through Pulumi', () => {
	assert.deepEqual(
		bootstrapPulumiUpArgs('organization/aven-bootstrap/identity', '/repo/bootstrap'),
		[
			'up',
			'--yes',
			'--parallel',
			'1',
			'--stack',
			'organization/aven-bootstrap/identity',
			'--cwd',
			'/repo/bootstrap'
		]
	)
})

test('round-trips machine-readable bootstrap progress without accepting ordinary output', () => {
	const event = {
		status: 'active',
		current: 2,
		total: 9,
		label: 'Prepare next storage',
		detail: 'Reconciling bucket policies.'
	}
	assert.deepEqual(parseBootstrapProgress(encodeBootstrapProgress(event).trim()), event)
	assert.equal(parseBootstrapProgress('pulumi: updating resources'), undefined)
	assert.throws(
		() =>
			parseBootstrapProgress(
				'::avenos-bootstrap-progress::{"status":"active","current":0,"total":1,"label":"bad"}'
			),
		/invalid progress event/
	)
	assert.throws(
		() =>
			parseBootstrapProgress(
				'::avenos-bootstrap-progress::{"status":"active","current":1,"total":1,"label":"bad","detail":4}'
			),
		/invalid progress event/
	)
})

test('creates the local Pulumi backend as an owner-only directory', () => {
	const parent = mkdtempSync(join(tmpdir(), 'aven-bootstrap-directory-test-'))
	const directory = join(parent, 'pulumi-state')
	ensurePrivateDirectory(directory)
	assert.equal(statSync(directory).mode & 0o777, 0o700)

	chmodSync(directory, 0o755)
	assert.throws(() => ensurePrivateDirectory(directory), /must be owner-only/)
})

const credential = (name) => ({ accessKeyId: `${name}ACCESS1`, secretAccessKey: `${name}-secret` })
const input = {
	deploymentTargets: ['identity', 'next', 'production'],
	repository: 'MyAvenCEO/avenOS',
	githubPackagesReadToken: 'github-packages-read-token',
	reviewer: 'operator',
	objectStorage: {
		region: 'hel1',
		targets: Object.fromEntries(
			['identity', 'next', 'production'].map((target, index) => [
				target,
				{
					projectId: String(12345 + index),
					bootstrapCredential: credential(`${target}BOOT`),
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
		dnsProjectId: '4567890',
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
		() => validateBootstrapInput({ ...input, githubPackagesReadToken: '' }),
		/githubPackagesReadToken is required/
	)
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
	assert.throws(
		() =>
			validateBootstrapInput({
				...input,
				providers: { ...input.providers, dnsProjectId: 'not-a-project' }
			}),
		/providers.dnsProjectId must be numeric/
	)
	assert.throws(
		() =>
			validateBootstrapInput({
				...input,
				objectStorage: {
					...input.objectStorage,
					targets: {
						...input.objectStorage.targets,
						next: {
							...input.objectStorage.targets.next,
							projectId: input.objectStorage.targets.identity.projectId
						}
					}
				}
			}),
		/different Hetzner project/
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
	assert.equal(
		new Set(Object.values(generated.targets).map((target) => target.bootstrapPulumiPassphrase))
			.size,
		3
	)
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
		`${prefix}-12346-next-state`
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

test('validates and configures only the selected deployment targets', () => {
	const nextOnly = {
		deploymentTargets: ['next'],
		repository: input.repository,
		githubPackagesReadToken: input.githubPackagesReadToken,
		objectStorage: {
			region: input.objectStorage.region,
			targets: { next: input.objectStorage.targets.next }
		},
		defaults: {
			hetznerLocation: input.defaults.hetznerLocation,
			hetznerServerType: input.defaults.hetznerServerType,
			hetznerOsImage: input.defaults.hetznerOsImage,
			platformVolumeSizeGb: input.defaults.platformVolumeSizeGb,
			sshAllowedCidrs: input.defaults.sshAllowedCidrs,
			acmeEmail: input.defaults.acmeEmail,
			downloadUrl: input.defaults.downloadUrl
		},
		providers: {
			dnsProjectId: input.providers.dnsProjectId,
			next: input.providers.next,
			redpillApiKey: input.providers.redpillApiKey
		}
	}
	assert.doesNotThrow(() => validateBootstrapInput(nextOnly))
	const generated = generateBootstrapSecrets()
	generated.polarWebhooks = {
		next: {
			id: 'next-hook',
			url: 'https://my.next.aven.ceo/api/webhooks/polar',
			secret: 'next-secret'
		}
	}
	const settings = githubConfiguration(nextOnly, generated)
	assert.deepEqual(Object.keys(settings).sort(), [
		`${generated.deploymentPrefix}-next`,
		`${generated.deploymentPrefix}-next-operations`
	])
	assert.equal(
		settings[`${generated.deploymentPrefix}-next`].variables.PLATFORM_VOLUME_SIZE_GB,
		'80'
	)
	assert.equal(
		settings[`${generated.deploymentPrefix}-next`].variables.IDENTITY_VOLUME_SIZE_GB,
		undefined
	)
	assert.throws(
		() => validateBootstrapInput({ ...nextOnly, deploymentTargets: [] }),
		/select at least one/
	)
})

test('supports every non-empty combination without configuring an unselected target', () => {
	const combinations = [
		['identity'],
		['next'],
		['production'],
		['identity', 'next'],
		['identity', 'production'],
		['next', 'production'],
		['identity', 'next', 'production']
	]
	for (const deploymentTargets of combinations) {
		const platformTargets = deploymentTargets.filter((target) => target !== 'identity')
		const selectedInput = {
			deploymentTargets,
			repository: input.repository,
			githubPackagesReadToken: input.githubPackagesReadToken,
			objectStorage: {
				region: input.objectStorage.region,
				targets: Object.fromEntries(
					deploymentTargets.map((target) => [target, input.objectStorage.targets[target]])
				)
			},
			defaults: {
				hetznerLocation: input.defaults.hetznerLocation,
				hetznerServerType: input.defaults.hetznerServerType,
				hetznerOsImage: input.defaults.hetznerOsImage,
				sshAllowedCidrs: input.defaults.sshAllowedCidrs,
				acmeEmail: input.defaults.acmeEmail,
				...(deploymentTargets.includes('identity') && {
					identityVolumeSizeGb: input.defaults.identityVolumeSizeGb
				}),
				...(platformTargets.length > 0 && {
					platformVolumeSizeGb: input.defaults.platformVolumeSizeGb,
					downloadUrl: input.defaults.downloadUrl
				})
			},
			providers: {
				...Object.fromEntries(deploymentTargets.map((target) => [target, input.providers[target]])),
				...(platformTargets.length > 0 && {
					dnsProjectId: input.providers.dnsProjectId,
					redpillApiKey: input.providers.redpillApiKey
				})
			}
		}
		assert.doesNotThrow(() => validateBootstrapInput(selectedInput))
		const generated = generateBootstrapSecrets()
		generated.polarWebhooks = Object.fromEntries(
			platformTargets.map((target) => [
				target,
				{
					id: `${target}-hook`,
					url:
						target === 'next'
							? 'https://my.next.aven.ceo/api/webhooks/polar'
							: 'https://my.aven.ceo/api/webhooks/polar',
					secret: `${target}-secret`
				}
			])
		)
		const settings = githubConfiguration(selectedInput, generated)
		assert.deepEqual(
			Object.keys(settings).sort(),
			deploymentTargets
				.flatMap((target) => [
					`${generated.deploymentPrefix}-${target}`,
					`${generated.deploymentPrefix}-${target}-operations`
				])
				.sort()
		)
		const csv = recoveryCsv(selectedInput, generated)
		for (const target of ['identity', 'next', 'production']) {
			const matcher = new RegExp(`avenOS ${target} bootstrap administrator`)
			if (deploymentTargets.includes(target)) assert.match(csv, matcher)
			else assert.doesNotMatch(csv, matcher)
		}
	}
})

test('refreshes completed environments when a later target adds shared state references', () => {
	const generated = generateBootstrapSecrets()
	generated.completedTargets = ['identity']
	generated.polarWebhooks = {
		next: {
			id: 'next-hook',
			url: 'https://my.next.aven.ceo/api/webhooks/polar',
			secret: 'next-secret'
		}
	}
	const stagedInput = { ...input, deploymentTargets: ['next'] }
	const configurationTargets = deploymentConfigurationTargets(stagedInput, generated)
	assert.deepEqual(configurationTargets, ['identity', 'next'])
	assert.doesNotThrow(() => validateBootstrapInput(stagedInput, configurationTargets))
	const settings = githubConfiguration(stagedInput, generated)
	assert.deepEqual(Object.keys(settings).sort(), [
		`${generated.deploymentPrefix}-identity`,
		`${generated.deploymentPrefix}-identity-operations`,
		`${generated.deploymentPrefix}-next`,
		`${generated.deploymentPrefix}-next-operations`
	])
	assert.equal(
		settings[`${generated.deploymentPrefix}-identity`].secrets.NEXT_STATE_S3_ACCESS_KEY_ID,
		input.objectStorage.targets.next.observerCredential.accessKeyId
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
	assert.match(contents, /"Group","Title","Username","Password","URL","Notes"/)
	assert.match(contents, new RegExp(`avenOS/${generated.deploymentPrefix}/next`))
	assert.match(contents, /avenOS next Restic password/)
	assert.match(contents, /avenOS identity bootstrap administrator/)
	assert.match(contents, /avenOS next bootstrap administrator/)
	assert.match(contents, /avenOS production bootstrap administrator/)
	assert.match(contents, /avenOS production billing \(Polar API key\)/)
	assert.match(contents, /serves checkout, subscription, customer, and order operations/)
	assert.match(contents, /projects\/12345\/security\/s3-credentials/)
	assert.match(contents, /projects\/4567890\/security\/tokens/)
	assert.match(contents, /shared aven\.ceo DNS zone in Hetzner project 4567890/)
	assert.match(contents, /avenOS RedPill API key/)
	assert.match(contents, /avenOS GitHub Packages reader/)
	assert.match(contents, /avenOS identity recovery storage/)
	assert.match(contents, /identity-state/)
	assert.match(contents, /identity-backup/)
	assert.doesNotMatch(contents, /aven\.id apex A record/)
	assert.throws(() => writeRecoveryCsv(path, contents), /refusing to overwrite/)
})

test('adds the resumable initial rollout and manual DNS handoff to the password-manager CSV', () => {
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
	generated.initialRollout = {
		ref: '0123456789abcdef0123456789abcdef01234567',
		targets: ['identity', 'next', 'production'],
		infrastructurePreviewRunId: 101,
		infrastructureApplyRunId: 102,
		identityDns: { ipv4: '192.0.2.10', ipv6: '2001:db8::10', verified: false }
	}

	const pendingContents = recoveryCsv(input, generated)
	assert.match(pendingContents, /aven\.id apex A record/)
	assert.match(pendingContents, /aven\.id apex AAAA record/)
	assert.match(pendingContents, /192\.0\.2\.10/)
	assert.match(pendingContents, /2001:db8::10/)
	assert.match(pendingContents, /type A, name @, TTL 300/)
	assert.match(pendingContents, /This value still needs to be set and verified/)
	assert.match(pendingContents, /actions\/runs\/101/)
	assert.match(pendingContents, /actions\/runs\/102/)
	assert.doesNotMatch(pendingContents, /actions\/runs\/103/)

	generated.initialRollout.identityDns.verified = true
	generated.initialRollout.deployRunId = 103
	generated.initialRollout.verifiedAt = '2026-08-30T12:00:00.000Z'
	const completedContents = recoveryCsv(input, generated)
	assert.match(completedContents, /actions\/runs\/103/)
	assert.match(completedContents, /commit\/0123456789abcdef0123456789abcdef01234567/)
	assert.match(completedContents, /Public installation verified at 2026-08-30T12:00:00\.000Z/)
	assert.match(completedContents, /https:\/\/api\.next\.aven\.ceo/)
	assert.match(completedContents, /https:\/\/my\.aven\.ceo/)
	assert.match(completedContents, /settings\/environments/)
})
