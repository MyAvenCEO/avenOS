#!/usr/bin/env bun
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
	assertPrivateFile,
	type BootstrapInput,
	bootstrapPulumiUpArgs,
	collidingBootstrapBucketKinds,
	deploymentConfigurationTargets,
	encodeBootstrapProgress,
	ensurePrivateDirectory,
	githubConfiguration,
	githubEnvironmentProtection,
	githubEnvironmentVariableChanges,
	isRetryableGitHubError,
	loadOrCreateGeneratedSecrets,
	objectStorageBucketName,
	PULUMI_ORGANIZATION,
	recoveryCsv,
	saveGeneratedSecrets,
	selectedDeploymentTargets,
	TARGETS,
	type Target,
	trackedBootstrapBucketKinds,
	validateBootstrapInput,
	writeRecoveryCsv
} from './lib/deployment-bootstrap.js'
import { signedS3ReadRequest } from './lib/deployment-bootstrap-guided.js'
import { ensurePolarCatalog } from './lib/polar-catalog.js'
import { ensurePolarWebhook } from './lib/polar-webhook.js'
import { fetchRedpillPhalaCatalog } from './lib/redpill-model-catalog.js'

const root = resolve(import.meta.dir, '..')
const args = process.argv.slice(2)
const value = (name: string) => {
	const index = args.indexOf(name)
	if (index < 0 || !args[index + 1]) throw new Error(`${name} is required`)
	return resolve(args[index + 1] as string)
}
const inputPath = value('--input')
const outputDirectory = value('--output')
const dryRun = args.includes('--dry-run')
const progressJson = args.includes('--progress-json')
const outputRelativeToRepository = relative(root, outputDirectory)
if (
	outputRelativeToRepository === '' ||
	(outputRelativeToRepository !== '..' &&
		!outputRelativeToRepository.startsWith(`..${sep}`) &&
		!isAbsolute(outputRelativeToRepository))
)
	throw new Error('The deployment bootstrap output must be outside the repository checkout.')

assertPrivateFile(inputPath)
const parsedInput: unknown = JSON.parse(readFileSync(inputPath, 'utf8'))
validateBootstrapInput(parsedInput)
const input: BootstrapInput = parsedInput
const selectedTargets = selectedDeploymentTargets(input.deploymentTargets)
const platformTargets = selectedTargets.filter(
	(target): target is 'next' | 'production' => target !== 'identity'
)
ensurePrivateDirectory(outputDirectory)

const generatedPath = resolve(outputDirectory, 'bootstrap.generated.json')
const recoveryPath = resolve(outputDirectory, 'avenos-recovery.csv')
const generated = loadOrCreateGeneratedSecrets(generatedPath)
const configurationTargets = deploymentConfigurationTargets(input, generated)
validateBootstrapInput(input, configurationTargets)

let catalog = [] as Awaited<ReturnType<typeof fetchRedpillPhalaCatalog>>

if (dryRun) {
	catalog =
		platformTargets.length > 0
			? await fetchRedpillPhalaCatalog(fetch, input.providers.redpillApiKey as string)
			: []
	const planned = {
		...generated,
		polarWebhooks: {
			...generated.polarWebhooks,
			...(platformTargets.includes('next') && {
				next: {
					id: 'pending',
					url: 'https://my.next.aven.ceo/api/webhooks/polar',
					secret: 'pending'
				}
			}),
			...(platformTargets.includes('production') && {
				production: {
					id: 'pending',
					url: 'https://my.aven.ceo/api/webhooks/polar',
					secret: 'pending'
				}
			})
		}
	}
	const github = githubConfiguration(input, planned)
	process.stdout.write(
		`Bootstrap plan is valid for ${selectedTargets.join(', ')}: ${selectedTargets.length * 2} buckets, ${platformTargets.length} Polar webhook(s), ${Object.keys(github).length} GitHub Environments, ${catalog.length} Phala models.\n`
	)
	process.exit(0)
}

const progressTotal =
	(platformTargets.length > 0 ? 1 : 0) +
	selectedTargets.length +
	platformTargets.length +
	1 +
	1 +
	configurationTargets.length * 2 +
	1
let completedProgress = 0
let activeProgress: { label: string; detail?: string } | undefined
function emitProgress(status: 'active' | 'complete', label: string, detail?: string): void {
	if (!progressJson) return
	process.stdout.write(
		encodeBootstrapProgress({
			status,
			current: completedProgress + 1,
			total: progressTotal,
			label,
			detail
		})
	)
}
function beginProgress(label: string, detail?: string): void {
	activeProgress = { label, detail }
	emitProgress('active', label, detail)
}
function updateProgress(detail: string): void {
	if (activeProgress) {
		activeProgress.detail = detail
		emitProgress('active', activeProgress.label, detail)
	}
}
function completeProgress(detail?: string): void {
	if (!activeProgress) return
	emitProgress('complete', activeProgress.label, detail ?? activeProgress.detail)
	completedProgress += 1
	activeProgress = undefined
}

if (platformTargets.length > 0) {
	beginProgress('Discover chat models', 'Reading the authenticated RedPill catalog.')
	catalog = await fetchRedpillPhalaCatalog(fetch, input.providers.redpillApiKey as string)
	completeProgress(`${catalog.length} Phala-hosted model(s) selected.`)
}

async function run(
	command: string,
	commandArgs: string[],
	options: { env?: Record<string, string>; stdin?: string; quiet?: boolean; capture?: boolean } = {}
) {
	const capture = options.quiet || options.capture
	const child = Bun.spawn([command, ...commandArgs], {
		cwd: root,
		env: { ...process.env, ...options.env },
		stdin: options.stdin === undefined ? 'ignore' : new Blob([options.stdin]),
		stdout: capture ? 'pipe' : 'inherit',
		stderr: capture ? 'pipe' : 'inherit'
	})
	const relay = async (
		stream: ReadableStream<Uint8Array>,
		destination: NodeJS.WriteStream
	): Promise<string> => {
		const reader = stream.getReader()
		const decoder = new TextDecoder()
		let result = ''
		for (;;) {
			const { value, done } = await reader.read()
			if (done) break
			const text = decoder.decode(value, { stream: true })
			result += text
			if (!options.quiet) destination.write(text)
		}
		const tail = decoder.decode()
		result += tail
		if (tail && !options.quiet) destination.write(tail)
		return result
	}
	const [exitCode, stdout, stderr] = capture
		? await Promise.all([
				child.exited,
				relay(child.stdout as ReadableStream<Uint8Array>, process.stdout),
				relay(child.stderr as ReadableStream<Uint8Array>, process.stderr)
			])
		: [await child.exited, '', '']
	if (exitCode !== 0) {
		const error = new Error(
			`${command} failed${stderr && options.quiet ? `: ${stderr.trim()}` : ''}`
		)
		Object.assign(error, { commandOutput: `${stdout}\n${stderr}` })
		throw error
	}
	return stdout.trim()
}

async function runGitHub(
	commandArgs: string[],
	options: { stdin?: string; quiet?: boolean; capture?: boolean } = {}
) {
	const attempts = 4
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await run('gh', commandArgs, options)
		} catch (error) {
			if (attempt === attempts || !isRetryableGitHubError(error)) throw error
			updateProgress(
				`GitHub did not answer; retrying the current request (${attempt + 1}/${attempts}).`
			)
			await Bun.sleep(attempt * 1_000)
		}
	}
	throw new Error('GitHub retry loop ended unexpectedly.')
}

const bootstrapCwd = resolve(root, 'infrastructure/bootstrap')
const localStateDirectory = resolve(outputDirectory, 'pulumi-state')
ensurePrivateDirectory(localStateDirectory)
const localBackend = `file://${localStateDirectory}`

async function existingBootstrapBucketKinds(
	expected: Record<'state' | 'backup', string>,
	storage: BootstrapInput['objectStorage']['targets'][Target]
): Promise<Array<'state' | 'backup'>> {
	const checks = await Promise.all(
		(['state', 'backup'] as const).map(async (kind) => {
			const request = signedS3ReadRequest({
				region: input.objectStorage.region,
				accessKeyId: storage.bootstrapCredential.accessKeyId,
				secretAccessKey: storage.bootstrapCredential.secretAccessKey,
				bucket: expected[kind]
			})
			const response = await fetch(request.url, {
				headers: request.headers,
				signal: AbortSignal.timeout(20_000)
			})
			if (response.ok) return kind
			if (response.status === 404) return undefined
			throw new Error(
				`Hetzner Object Storage returned HTTP ${response.status} while checking the exact ${kind} bucket for interrupted-bootstrap recovery.`
			)
		})
	)
	return checks.filter((kind): kind is 'state' | 'backup' => kind !== undefined)
}

for (const target of selectedTargets) {
	beginProgress(`Prepare ${target} storage`, `Opening the ${target} bootstrap stack.`)
	const storage = input.objectStorage.targets[target]
	const bootstrapEnvironment = {
		PULUMI_CONFIG_PASSPHRASE: generated.targets[target].bootstrapPulumiPassphrase,
		AWS_ACCESS_KEY_ID: storage.bootstrapCredential.accessKeyId,
		AWS_SECRET_ACCESS_KEY: storage.bootstrapCredential.secretAccessKey,
		AWS_REGION: input.objectStorage.region,
		AWS_DEFAULT_REGION: input.objectStorage.region,
		AWS_EC2_METADATA_DISABLED: 'true',
		OBJECT_STORAGE_TARGET: target,
		OBJECT_STORAGE_PROJECT_ID: storage.projectId,
		OBJECT_STORAGE_REGION: input.objectStorage.region,
		OBJECT_STORAGE_BUCKET_PREFIX: generated.deploymentPrefix,
		BOOTSTRAP_S3_ACCESS_KEY_ID: storage.bootstrapCredential.accessKeyId,
		BOOTSTRAP_S3_SECRET_ACCESS_KEY: storage.bootstrapCredential.secretAccessKey,
		DEPLOYMENT_S3_ACCESS_KEY_ID: storage.deploymentCredential.accessKeyId,
		OBSERVER_S3_ACCESS_KEY_ID: storage.observerCredential.accessKeyId
	}
	const stack = `${PULUMI_ORGANIZATION}/aven-bootstrap/${target}`
	const stateBucket = objectStorageBucketName(input, generated, target, 'state')
	const remoteBackend = `s3://${stateBucket}/avenos/bootstrap?endpoint=${input.objectStorage.region}.your-objectstorage.com&region=${input.objectStorage.region}&s3ForcePathStyle=true&awssdk=v2`
	const migratedMarker = resolve(outputDirectory, `bootstrap.${target}.remote`)

	if (!existsSync(migratedMarker)) {
		updateProgress(`Using owner-only local state while the ${target} buckets are created.`)
		await run('pulumi', ['login', localBackend], { env: bootstrapEnvironment })
		try {
			await run('pulumi', ['stack', 'init', stack, '--cwd', bootstrapCwd], {
				env: bootstrapEnvironment,
				quiet: true
			})
		} catch {
			await run('pulumi', ['stack', 'select', stack, '--cwd', bootstrapCwd], {
				env: bootstrapEnvironment
			})
		}
		updateProgress(
			`Creating or reconciling the ${target} state and backup buckets and access policies.`
		)
		const expectedBuckets = {
			state: objectStorageBucketName(input, generated, target, 'state'),
			backup: objectStorageBucketName(input, generated, target, 'backup')
		}
		const currentStack = JSON.parse(
			await run('pulumi', ['stack', 'export', '--stack', stack, '--cwd', bootstrapCwd], {
				env: bootstrapEnvironment,
				quiet: true
			})
		) as unknown
		const trackedBuckets = trackedBootstrapBucketKinds(currentStack as never, target)
		let bucketsToAdopt = (await existingBootstrapBucketKinds(expectedBuckets, storage)).filter(
			(kind) => !trackedBuckets.includes(kind)
		)
		const attemptedAdoptions = [...bucketsToAdopt]
		if (bucketsToAdopt.length > 0)
			updateProgress(
				`Adopting the existing, untracked ${target} ${bucketsToAdopt.join(' and ')} bucket from this interrupted generation.`
			)
		for (;;) {
			try {
				await run('pulumi', bootstrapPulumiUpArgs(stack, bootstrapCwd), {
					env: {
						...bootstrapEnvironment,
						OBJECT_STORAGE_ADOPT_EXISTING_BUCKETS: bucketsToAdopt.join(',')
					},
					capture: true
				})
				break
			} catch (error) {
				const output = (error as { commandOutput?: unknown }).commandOutput
				const collisions =
					typeof output === 'string' ? collidingBootstrapBucketKinds(output, expectedBuckets) : []
				const additions = collisions.filter((kind) => !attemptedAdoptions.includes(kind))
				if (additions.length === 0) throw error
				attemptedAdoptions.push(...additions)
				bucketsToAdopt = [...new Set([...bucketsToAdopt, ...additions])]
				updateProgress(
					`Adopting the existing ${target} ${additions.join(' and ')} bucket from this interrupted generation, then reconciling it.`
				)
			}
		}
		const exportPath = resolve(outputDirectory, `bootstrap-state-${target}.json`)
		await run(
			'pulumi',
			['stack', 'export', '--stack', stack, '--cwd', bootstrapCwd, '--file', exportPath],
			{ env: bootstrapEnvironment }
		)
		chmodSync(exportPath, 0o600)
		updateProgress(`Moving the ${target} bootstrap state into its private state bucket.`)
		await run('pulumi', ['login', remoteBackend], { env: bootstrapEnvironment })
		try {
			await run('pulumi', ['stack', 'init', stack, '--cwd', bootstrapCwd], {
				env: bootstrapEnvironment,
				quiet: true
			})
		} catch {
			await run('pulumi', ['stack', 'select', stack, '--cwd', bootstrapCwd], {
				env: bootstrapEnvironment
			})
		}
		await run(
			'pulumi',
			['stack', 'import', '--stack', stack, '--cwd', bootstrapCwd, '--file', exportPath],
			{ env: bootstrapEnvironment }
		)
		writeFileSync(migratedMarker, `${remoteBackend}\n`, { mode: 0o600, flag: 'wx' })
	} else {
		updateProgress(`Remote ${target} bootstrap state found; reconciling it in place.`)
		await run('pulumi', ['login', remoteBackend], { env: bootstrapEnvironment })
		await run('pulumi', bootstrapPulumiUpArgs(stack, bootstrapCwd), {
			env: bootstrapEnvironment
		})
	}
	completeProgress(`${target} storage and role policies are reconciled.`)
}

generated.polarWebhooks ??= {}
for (const target of platformTargets) {
	beginProgress(
		`Configure ${target} billing`,
		`Reconciling the Polar webhook and published product manifest.`
	)
	const provider = input.providers[target]
	const endpoint = await ensurePolarWebhook({
		accessToken: provider.polarApiKey,
		organizationId: provider.polarOrganizationId,
		server: target === 'next' ? 'sandbox' : 'production',
		target
	})
	generated.polarWebhooks[target] = {
		id: endpoint.id,
		url: endpoint.url,
		secret: endpoint.secret
	}
	// Preserve the one-time signing secret before a later catalog call can fail.
	saveGeneratedSecrets(generatedPath, generated)
	updateProgress(`Applying the published pricing manifest to Polar ${target}.`)
	const catalogResult = await ensurePolarCatalog({
		accessToken: provider.polarApiKey,
		organizationId: provider.polarOrganizationId,
		server: target === 'next' ? 'sandbox' : 'production',
		publicBaseUrl: target === 'next' ? 'https://my.next.aven.ceo' : 'https://my.aven.ceo',
		webhookSecret: endpoint.secret
	})
	completeProgress(
		`${target} Polar webhook ${endpoint.id}, ${Object.keys(catalogResult.products).length} product(s), and ${Object.values(catalogResult.benefits).reduce((total, count) => total + count, 0)} product-benefit attachment(s) are configured.`
	)
}
saveGeneratedSecrets(generatedPath, generated)

beginProgress('Write recovery record', 'Collecting generated and provider-issued credentials.')
const expectedRecovery = recoveryCsv(input, generated)
if (!existsSync(recoveryPath)) writeRecoveryCsv(recoveryPath, expectedRecovery)
else {
	assertPrivateFile(recoveryPath)
	if (readFileSync(recoveryPath, 'utf8') !== expectedRecovery)
		throw new Error(
			`${recoveryPath} no longer matches provider state; move it aside after reconciling the password manager, then rerun.`
		)
}
completeProgress('The owner-only password-manager CSV is current.')

const github = githubConfiguration(input, generated)

beginProgress(
	'Configure package reader',
	'Storing the repository-level token used only for cross-repository npm downloads.'
)
await runGitHub(['secret', 'set', 'PACKAGE_READ_TOKEN', '--repo', input.repository], {
	stdin: input.githubPackagesReadToken,
	quiet: true
})
completeProgress('The GitHub Packages read token is stored as an encrypted repository secret.')

const reviewerId = input.reviewer
	? Number(await runGitHub(['api', `users/${input.reviewer}`, '--jq', '.id'], { quiet: true }))
	: undefined
if (reviewerId !== undefined && !Number.isSafeInteger(reviewerId))
	throw new Error(`Could not resolve GitHub reviewer ${input.reviewer}.`)

for (const [environment, settings] of Object.entries(github)) {
	beginProgress(`Configure ${environment}`, 'Applying protection rules, secrets, and variables.')
	const protectedDeployment = TARGETS.some(
		(target) => environment === `${generated.deploymentPrefix}-${target}`
	)
	const body = githubEnvironmentProtection(protectedDeployment, reviewerId)
	await runGitHub(
		[
			'api',
			'--method',
			'PUT',
			`repos/${input.repository}/environments/${environment}`,
			'--input',
			'-'
		],
		{ stdin: JSON.stringify(body), quiet: true }
	)
	for (const [name, secret] of Object.entries(settings.secrets)) {
		await runGitHub(['secret', 'set', name, '--repo', input.repository, '--env', environment], {
			stdin: secret,
			quiet: true
		})
	}
	const existingVariableNames = (
		await runGitHub(
			[
				'api',
				`repos/${input.repository}/environments/${environment}/variables`,
				'--paginate',
				'--jq',
				'.variables[].name'
			],
			{ quiet: true }
		)
	)
		.split('\n')
		.filter(Boolean)
	const variableChanges = githubEnvironmentVariableChanges(
		settings.variables,
		existingVariableNames
	)
	for (const [name, variable] of variableChanges.set) {
		const exists = existingVariableNames.includes(name)
		await runGitHub(
			[
				'api',
				'--method',
				exists ? 'PATCH' : 'POST',
				`repos/${input.repository}/environments/${environment}/variables${exists ? `/${name}` : ''}`,
				'--input',
				'-'
			],
			{ stdin: JSON.stringify({ name, value: variable }), quiet: true }
		)
	}
	for (const name of variableChanges.remove) {
		await runGitHub(
			[
				'api',
				'--method',
				'DELETE',
				`repos/${input.repository}/environments/${environment}/variables/${name}`
			],
			{ quiet: true }
		)
	}
	completeProgress(
		`${environment}: ${Object.keys(settings.secrets).length} secret(s) and ${variableChanges.set.length} variable(s) configured; ${Object.keys(settings.variables).length - variableChanges.set.length} empty value(s) kept absent.`
	)
}

beginProgress('Activate deployment namespace', 'Updating the repository-level environment prefix.')
const activatedTargets = configurationTargets
await runGitHub(
	[
		'variable',
		'set',
		'DEPLOYMENT_TARGETS_JSON',
		'--repo',
		input.repository,
		'--body',
		JSON.stringify(activatedTargets)
	],
	{ quiet: true }
)
updateProgress(
	`Configured target set: ${activatedTargets.join(', ')}. Switching the active namespace last.`
)
await runGitHub(
	[
		'variable',
		'set',
		'DEPLOYMENT_ENVIRONMENT_PREFIX',
		'--repo',
		input.repository,
		'--body',
		generated.deploymentPrefix
	],
	{ quiet: true }
)
generated.completedTargets = activatedTargets
saveGeneratedSecrets(generatedPath, generated)
completeProgress(`${generated.deploymentPrefix} now selects the configured GitHub Environments.`)

process.stdout.write(
	`Bootstrap complete for ${generated.deploymentPrefix} (${selectedTargets.join(', ')}): ${selectedTargets.length * 2} isolated buckets, ${platformTargets.length} Polar webhook(s), ${Object.keys(github).length} GitHub Environments, and ${catalog.length} Phala models configured. Import ${recoveryPath} into the company password manager, then remove the local bootstrap directory after verifying the remote stack and import.\n`
)
