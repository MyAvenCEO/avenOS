#!/usr/bin/env bun
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	assertPrivateFile,
	type BootstrapInput,
	githubConfiguration,
	githubEnvironmentProtection,
	loadOrCreateGeneratedSecrets,
	objectStorageBucketName,
	PULUMI_ORGANIZATION,
	recoveryCsv,
	saveGeneratedSecrets,
	TARGETS,
	validateBootstrapInput,
	writeRecoveryCsv
} from './lib/deployment-bootstrap.js'
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

assertPrivateFile(inputPath)
const parsedInput: unknown = JSON.parse(readFileSync(inputPath, 'utf8'))
validateBootstrapInput(parsedInput)
const input: BootstrapInput = parsedInput
if (!existsSync(outputDirectory)) mkdirSync(outputDirectory, { recursive: true, mode: 0o700 })
if ((statSync(outputDirectory).mode & 0o077) !== 0)
	throw new Error(`${outputDirectory} must be owner-only (chmod 700).`)

const generatedPath = resolve(outputDirectory, 'bootstrap.generated.json')
const recoveryPath = resolve(outputDirectory, 'avenos-recovery.csv')
const generated = loadOrCreateGeneratedSecrets(generatedPath)

const catalog = await fetchRedpillPhalaCatalog(fetch, input.providers.redpillApiKey)

if (dryRun) {
	const planned = {
		...generated,
		polarWebhooks: {
			next: {
				id: 'pending',
				url: 'https://my.next.aven.ceo/api/webhooks/polar',
				secret: 'pending'
			},
			production: {
				id: 'pending',
				url: 'https://my.aven.ceo/api/webhooks/polar',
				secret: 'pending'
			}
		}
	}
	const github = githubConfiguration(input, planned)
	process.stdout.write(
		`Bootstrap plan is valid: 6 buckets, 2 Polar webhooks, ${Object.keys(github).length} GitHub Environments, ${catalog.length} Phala models.\n`
	)
	process.exit(0)
}

async function run(
	command: string,
	commandArgs: string[],
	options: { env?: Record<string, string>; stdin?: string; quiet?: boolean } = {}
) {
	const child = Bun.spawn([command, ...commandArgs], {
		cwd: root,
		env: { ...process.env, ...options.env },
		stdin: options.stdin === undefined ? 'ignore' : new Blob([options.stdin]),
		stdout: options.quiet ? 'pipe' : 'inherit',
		stderr: options.quiet ? 'pipe' : 'inherit'
	})
	const stdout = options.quiet ? await new Response(child.stdout).text() : ''
	const stderr = options.quiet ? await new Response(child.stderr).text() : ''
	const exitCode = await child.exited
	if (exitCode !== 0) throw new Error(`${command} failed${stderr ? `: ${stderr.trim()}` : ''}`)
	return stdout.trim()
}

const bootstrapCwd = resolve(root, 'infrastructure/bootstrap')
const localBackend = `file://${resolve(outputDirectory, 'pulumi-state')}`

for (const target of TARGETS) {
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
		await run('pulumi', ['up', '--yes', '--stack', stack, '--cwd', bootstrapCwd], {
			env: bootstrapEnvironment
		})
		const exportPath = resolve(outputDirectory, `bootstrap-state-${target}.json`)
		await run(
			'pulumi',
			['stack', 'export', '--stack', stack, '--cwd', bootstrapCwd, '--file', exportPath],
			{ env: bootstrapEnvironment }
		)
		chmodSync(exportPath, 0o600)
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
		await run('pulumi', ['login', remoteBackend], { env: bootstrapEnvironment })
		await run('pulumi', ['up', '--yes', '--stack', stack, '--cwd', bootstrapCwd], {
			env: bootstrapEnvironment
		})
	}
}

generated.polarWebhooks ??= {}
for (const target of ['next', 'production'] as const) {
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
}
saveGeneratedSecrets(generatedPath, generated)

const expectedRecovery = recoveryCsv(input, generated)
if (!existsSync(recoveryPath)) writeRecoveryCsv(recoveryPath, expectedRecovery)
else {
	assertPrivateFile(recoveryPath)
	if (readFileSync(recoveryPath, 'utf8') !== expectedRecovery)
		throw new Error(
			`${recoveryPath} no longer matches provider state; move it aside after reconciling the password manager, then rerun.`
		)
}

const github = githubConfiguration(input, generated)

const reviewerId = input.reviewer
	? Number(await run('gh', ['api', `users/${input.reviewer}`, '--jq', '.id'], { quiet: true }))
	: undefined
if (reviewerId !== undefined && !Number.isSafeInteger(reviewerId))
	throw new Error(`Could not resolve GitHub reviewer ${input.reviewer}.`)

for (const [environment, settings] of Object.entries(github)) {
	const protectedDeployment = TARGETS.some(
		(target) => environment === `${generated.deploymentPrefix}-${target}`
	)
	const body = githubEnvironmentProtection(protectedDeployment, reviewerId)
	await run(
		'gh',
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
		await run('gh', ['secret', 'set', name, '--repo', input.repository, '--env', environment], {
			stdin: secret,
			quiet: true
		})
	}
	for (const [name, variable] of Object.entries(settings.variables)) {
		await run(
			'gh',
			[
				'variable',
				'set',
				name,
				'--repo',
				input.repository,
				'--env',
				environment,
				'--body',
				variable
			],
			{
				quiet: true
			}
		)
	}
}

await run(
	'gh',
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

process.stdout.write(
	`Bootstrap complete for ${generated.deploymentPrefix}: six isolated buckets, two Polar webhooks, six GitHub Environments, and ${catalog.length} Phala models configured. Import ${recoveryPath} into the company password manager, then remove the local bootstrap directory after verifying the remote stack and import.\n`
)
