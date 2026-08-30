#!/usr/bin/env bun
import { randomBytes } from 'node:crypto'
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Polar } from '@polar-sh/sdk'
import {
	type BootstrapInput,
	loadOrCreateGeneratedSecrets,
	validateBootstrapInput
} from './lib/deployment-bootstrap.js'
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
} from './lib/deployment-bootstrap-guided.js'
import { BootstrapTui, TuiInterruptedError } from './lib/deployment-bootstrap-tui.js'
import { fetchRedpillPhalaCatalog } from './lib/redpill-model-catalog.js'

function failPreflight(error: unknown): never {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: 'Unknown bootstrap preflight failure.'
	process.stderr.write(`ERROR: ${message}\n`)
	process.exit(1)
}

function preflight<T>(action: () => T): T {
	try {
		return action()
	} catch (error) {
		return failPreflight(error)
	}
}

const root = resolve(import.meta.dir, '..')
const args = process.argv.slice(2)
const requestedPlainTerminal = args.includes('--plain')
const outputArgument = args.indexOf('--output')
if (outputArgument >= 0 && !args[outputArgument + 1]) failPreflight('--output needs a directory.')
const outputDirectory = resolve(
	outputArgument >= 0
		? (args[outputArgument + 1] as string)
		: join(homedir(), 'avenos-bootstrap-record')
)
const outputRelativeToRepository = relative(root, outputDirectory)
if (
	outputRelativeToRepository === '' ||
	(!outputRelativeToRepository.startsWith('..') && !isAbsolute(outputRelativeToRepository))
)
	failPreflight('The guided bootstrap output must be outside the repository checkout.')
if (!process.stdin.isTTY || !process.stdout.isTTY)
	failPreflight('The guided bootstrap needs an interactive terminal.')

preflight(() => {
	if (!existsSync(outputDirectory)) mkdirSync(outputDirectory, { recursive: true, mode: 0o700 })
})
if ((preflight(() => statSync(outputDirectory)).mode & 0o077) !== 0)
	failPreflight(`${outputDirectory} must be owner-only (chmod 700).`)

const inputPath = join(outputDirectory, 'bootstrap-input.json')
const credentialsPath = join(outputDirectory, 'credentials.csv')
const completedCredentialsPath = join(outputDirectory, 'avenos-recovery.csv')
const generatedPath = join(outputDirectory, 'bootstrap.generated.json')
const draft = preflight(() =>
	existsSync(inputPath)
		? (JSON.parse(readFileSync(inputPath, 'utf8')) as Record<string, unknown>)
		: {}
)
if (existsSync(inputPath) && (preflight(() => statSync(inputPath)).mode & 0o077) !== 0)
	failPreflight(`${inputPath} must be owner-only (chmod 600).`)
if (existsSync(credentialsPath) && (preflight(() => statSync(credentialsPath)).mode & 0o077) !== 0)
	failPreflight(`${credentialsPath} must be owner-only (chmod 600).`)
const generated = preflight(() => loadOrCreateGeneratedSecrets(generatedPath))

class CancelledError extends Error {
	constructor() {
		super('cancelled before credential collection')
		this.name = 'CancelledError'
	}
}

function writePrivateAtomic(path: string, contents: string): void {
	const temporary = `${path}.${randomBytes(6).toString('hex')}.next`
	writeFileSync(temporary, contents, {
		encoding: 'utf8',
		mode: 0o600,
		flag: 'wx'
	})
	chmodSync(temporary, 0o600)
	renameSync(temporary, path)
}

function saveDraft(): void {
	writePrivateAtomic(inputPath, `${JSON.stringify(draft, null, 2)}\n`)
	writePrivateAtomic(credentialsPath, guidedCredentialsCsv(draft, generated.deploymentPrefix))
}

function promoteCompletedCredentials(): void {
	if (!existsSync(completedCredentialsPath)) return
	if ((statSync(completedCredentialsPath).mode & 0o077) !== 0)
		throw new Error(`${completedCredentialsPath} must be owner-only (chmod 600).`)
	renameSync(completedCredentialsPath, credentialsPath)
	chmodSync(credentialsPath, 0o600)
}

const tuiCandidate = requestedPlainTerminal ? undefined : new BootstrapTui()
const tui = tuiCandidate?.isSupported() ? tuiCandidate : undefined
const plainTerminal = !tui
const terminal = plainTerminal
	? createInterface({ input: process.stdin, output: process.stdout, terminal: false })
	: undefined
if (!requestedPlainTerminal && !tui)
	process.stdout.write('Terminal is smaller than 60x20; using the accessible plain wizard.\n')
let echoDisabled = false
function setEcho(enabled: boolean): void {
	const result = Bun.spawnSync(['stty', enabled ? 'echo' : '-echo'], {
		stdin: 'inherit',
		stdout: 'ignore',
		stderr: 'ignore'
	})
	if (result.exitCode !== 0) throw new Error('Could not control terminal echo for a secret prompt.')
	echoDisabled = !enabled
}
function restoreEcho(): void {
	if (echoDisabled) {
		Bun.spawnSync(['stty', 'echo'], { stdin: 'inherit', stdout: 'ignore', stderr: 'ignore' })
		echoDisabled = false
	}
}
process.on('exit', restoreEcho)
let handlingInterrupt = false
if (plainTerminal)
	process.on('SIGINT', () => {
		if (handlingInterrupt) return
		handlingInterrupt = true
		restoreEcho()
		const resolution = resolveInterruptedRunCredentials()
		if (resolution === 'deleted')
			process.stderr.write('\nERROR: interrupted. Local credential artifacts deleted.\n')
		else process.stderr.write(`\nERROR: interrupted. Progress preserved in ${credentialsPath}\n`)
		process.exit(130)
	})

async function readAnswer(): Promise<string> {
	if (!terminal) throw new Error('The plain terminal reader is not active.')
	return (await terminal.question('')).trim()
}

async function question(label: string, defaultValue?: string): Promise<string> {
	if (tui) return tui.ask({ label, defaultValue })
	const suffix = defaultValue === undefined ? ': ' : ` [${defaultValue}]: `
	process.stdout.write(`${label}${suffix}`)
	const answer = await readAnswer()
	return answer || defaultValue || ''
}

async function secretQuestion(label: string): Promise<string> {
	if (tui) return tui.ask({ label, secret: true })
	process.stdout.write(`${label}: `)
	setEcho(false)
	try {
		return await readAnswer()
	} finally {
		restoreEcho()
		process.stdout.write('\n')
	}
}

const localCredentialPaths = [
	inputPath,
	credentialsPath,
	completedCredentialsPath,
	generatedPath
] as const

function deleteLocalCredentialArtifacts(): void {
	for (const path of localCredentialPaths) {
		if (existsSync(path)) unlinkSync(path)
	}
}

function resolveInterruptedRunCredentials(): 'deleted' | 'kept' {
	terminal?.pause()
	let tty: number | undefined
	try {
		tty = openSync('/dev/tty', 'r')
		for (;;) {
			process.stderr.write(
				'\nDelete local credential artifacts? Deleting prevents resume. Type "delete" or "keep" (no default): '
			)
			const buffer = Buffer.alloc(128)
			const length = readSync(tty, buffer, 0, buffer.length, null)
			const choice = buffer.toString('utf8', 0, length).trim().toLowerCase()
			if (choice === 'delete') {
				deleteLocalCredentialArtifacts()
				return 'deleted'
			}
			if (choice === 'keep') return 'kept'
			process.stderr.write('Enter exactly "delete" or "keep"; no choice is preselected.\n')
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown terminal failure'
		process.stderr.write(`\nCould not ask for cleanup (${message}); preserving progress.\n`)
		return 'kept'
	} finally {
		if (tty !== undefined) closeSync(tty)
	}
}

function setUiContext(title: string, content: string): void {
	if (tui) tui.setContext(title, content)
	else process.stdout.write(`\n${content.trim()}\n`)
}

function reportStatus(message: string): void {
	if (tui) tui.status(message)
	else process.stdout.write(`${message.trim()}\n`)
}

function reportFailure(message: string): void {
	if (tui) tui.status(`✗ ${message}`)
	else process.stderr.write(`✗ ${message.trim()}\n`)
}

async function resolveFailedRunCredentials(): Promise<'deleted' | 'kept'> {
	restoreEcho()
	for (;;) {
		const choice = (
			await question(
				'Delete local credential artifacts? Deleting prevents resume. Type "delete" or "keep" (no default)'
			)
		).toLowerCase()
		if (choice === 'delete') {
			deleteLocalCredentialArtifacts()
			return 'deleted'
		}
		if (choice === 'keep') return 'kept'
		reportStatus('Enter exactly "delete" or "keep"; no choice is preselected.')
	}
}

async function required(
	path: readonly string[],
	label: string,
	options: { defaultValue?: string; secret?: boolean; validate?: (value: string) => boolean } = {}
): Promise<string> {
	const existing = valueAt(draft, path)
	if (typeof existing === 'string' && existing.trim() !== '') {
		const valid = options.validate?.(existing) ?? true
		if (valid) {
			const keep = (await question(`${label} is recorded. Keep it?`, 'yes')).toLowerCase()
			if (['y', 'yes'].includes(keep)) return existing
		} else reportStatus(`${label} is recorded but invalid and must be replaced.`)
	}
	for (;;) {
		const answer = options.secret
			? await secretQuestion(label)
			: await question(label, options.defaultValue)
		if (answer && (options.validate?.(answer) ?? true)) {
			setValueAt(draft, path, answer)
			saveDraft()
			return answer
		}
		reportStatus('A valid value is required.')
	}
}

async function optional(path: readonly string[], label: string): Promise<string | undefined> {
	const existing = valueAt(draft, path)
	if (typeof existing === 'string' && existing.trim() !== '') {
		const keep = (await question(`${label} is recorded. Keep it?`, 'yes')).toLowerCase()
		if (['y', 'yes'].includes(keep)) return existing
	}
	const answer = await question(`${label} (leave empty to omit)`)
	if (!answer) {
		if (existing !== undefined) {
			setValueAt(draft, path, undefined)
			saveDraft()
		}
		return undefined
	}
	setValueAt(draft, path, answer)
	saveDraft()
	return answer
}

async function requiredInteger(
	path: readonly string[],
	label: string,
	defaultValue: number,
	minimum: number
): Promise<number> {
	const existing = valueAt(draft, path)
	if (Number.isSafeInteger(existing) && (existing as number) >= minimum) {
		const keep = (await question(`${label} is recorded. Keep it?`, 'yes')).toLowerCase()
		if (['y', 'yes'].includes(keep)) return existing as number
	}
	for (;;) {
		const value = Number(await question(label, String(defaultValue)))
		if (Number.isSafeInteger(value) && value >= minimum) {
			setValueAt(draft, path, value)
			saveDraft()
			return value
		}
		reportStatus(`Enter an integer of at least ${minimum}.`)
	}
}

async function run(command: string, commandArgs: string[], quiet = false): Promise<string> {
	const child = Bun.spawn([command, ...commandArgs], {
		cwd: root,
		stdin: 'inherit',
		stdout: quiet ? 'pipe' : 'inherit',
		stderr: quiet ? 'pipe' : 'inherit'
	})
	const stdout = quiet ? await new Response(child.stdout).text() : ''
	const stderr = quiet ? await new Response(child.stderr).text() : ''
	if ((await child.exited) !== 0)
		throw new Error(`${command} failed${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
	return stdout.trim()
}

async function validateHetznerToken(token: string, label: string, resource: string): Promise<void> {
	const response = await fetch(`https://api.hetzner.cloud/v1/${resource}`, {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(20_000)
	})
	if (!response.ok) throw new Error(`Hetzner returned HTTP ${response.status}.`)
	const payload = (await response.json()) as Record<string, unknown>
	if (resource.startsWith('servers')) {
		if (!Array.isArray(payload.servers)) throw new Error('Hetzner returned no server list.')
		const meta = payload.meta as { pagination?: { total?: number } } | undefined
		const total = meta?.pagination?.total
		reportStatus(
			`✓ ${label}: authenticated Cloud project access${typeof total === 'number' ? `; ${total} server(s) currently visible` : ''}.\n`
		)
		return
	}
	const zone = payload.zone as { id?: string | number; name?: string } | undefined
	if (zone?.name !== 'aven.ceo') throw new Error('the token did not resolve the aven.ceo zone.')
	reportStatus(
		`✓ ${label}: exact DNS zone ${zone.name}${zone.id === undefined ? '' : ` (ID ${zone.id})`} is readable.\n`
	)
}

function redactSecrets(message: string): string {
	const paths: readonly (readonly string[])[] = [
		...S3_CREDENTIAL_STEPS.flatMap((step) => [
			[...step.path, 'accessKeyId'],
			[...step.path, 'secretAccessKey']
		]),
		...(['identity', 'next', 'production'] as const).map((target) => [
			'providers',
			target,
			'computeToken'
		]),
		...(['next', 'production'] as const).flatMap((target) => [
			['providers', target, 'dnsToken'],
			['providers', target, 'polarApiKey'],
			['providers', target, 'smtpUrl']
		]),
		['providers', 'redpillApiKey']
	]
	let redacted = message
	for (const path of paths) {
		const value = valueAt(draft, path)
		if (typeof value === 'string' && value.length >= 4)
			redacted = redacted.replaceAll(value, '[redacted]')
	}
	return redacted
}

async function verificationAction(label: string): Promise<'retry' | 'replace' | 'stop'> {
	for (;;) {
		const action = (
			await question(`${label} was not verified. Type "retry", "replace", or "stop" (no default)`)
		).toLowerCase()
		if (action === 'retry' || action === 'replace' || action === 'stop') return action
		reportStatus('Enter exactly "retry", "replace", or "stop"; no action is preselected.')
	}
}

async function replacement(
	path: readonly string[],
	label: string,
	options: { secret?: boolean; validate?: (value: string) => boolean } = {}
): Promise<string> {
	for (;;) {
		const answer = options.secret
			? await secretQuestion(`${label} replacement`)
			: await question(`${label} replacement`)
		if (answer && (options.validate?.(answer) ?? true)) {
			setValueAt(draft, path, answer)
			saveDraft()
			return answer
		}
		reportStatus('A valid replacement value is required.')
	}
}

async function requiredVerified(
	path: readonly string[],
	label: string,
	options: { secret?: boolean; validate?: (value: string) => boolean },
	verify: (value: string) => Promise<void>
): Promise<string> {
	let candidate = await required(path, label, options)
	for (;;) {
		try {
			await verify(candidate)
			return candidate
		} catch (error) {
			const message = redactSecrets(error instanceof Error ? error.message : 'unknown failure')
			reportFailure(`${label}: ${message}`)
			const action = await verificationAction(label)
			if (action === 'stop') throw error
			if (action === 'replace') candidate = await replacement(path, label, options)
		}
	}
}

async function validateS3Credential(input: {
	label: string
	region: string
	accessKeyId: string
	secretAccessKey: string
}): Promise<void> {
	const request = signedS3ReadRequest({
		region: input.region,
		accessKeyId: input.accessKeyId,
		secretAccessKey: input.secretAccessKey
	})
	const response = await fetch(request.url, {
		headers: request.headers,
		signal: AbortSignal.timeout(20_000)
	})
	const body = await response.text()
	if (!response.ok)
		throw new Error(
			`Object Storage returned HTTP ${response.status}${s3ErrorCode(body) ? ` (${s3ErrorCode(body)})` : ''}.`
		)
	if (!body.includes('<ListAllMyBucketsResult'))
		throw new Error('Object Storage returned an unexpected list-buckets response.')
	const bucketCount = (body.match(/<Bucket>/g) ?? []).length
	reportStatus(
		`✓ ${input.label}: authenticated ${input.region} Object Storage project access; ${bucketCount} bucket(s) currently visible. Role isolation is installed by the bootstrap.\n`
	)
}

async function validatePolarCredential(input: {
	target: 'next' | 'production'
	apiKey: string
	organizationId: string
}): Promise<void> {
	const polar = new Polar({
		accessToken: input.apiKey,
		server: input.target === 'next' ? 'sandbox' : 'production'
	})
	const organization = await polar.organizations.get({ id: input.organizationId })
	const products = await polar.products.list({ organizationId: input.organizationId, limit: 1 })
	const webhooks = await polar.webhooks.listWebhookEndpoints({
		organizationId: input.organizationId,
		limit: 1
	})
	let productCount: number | undefined
	let webhookCount: number | undefined
	for await (const page of products) {
		productCount = page.result.pagination.totalCount
		break
	}
	for await (const page of webhooks) {
		webhookCount = page.result.pagination.totalCount
		break
	}
	reportStatus(
		`✓ Polar ${input.target}: ${organization.name} (${organization.slug}, ${organization.id}); product and webhook read access confirmed${productCount === undefined ? '' : `, ${productCount} product(s)`}${webhookCount === undefined ? '' : `, ${webhookCount} webhook(s)`}.\n`
	)
}

function describeSmtpUrl(value: string, target: 'next' | 'production'): void {
	const url = new URL(value)
	const transport = url.protocol === 'smtps:' ? 'implicit TLS' : 'SMTP/STARTTLS at deployment'
	const port = url.port || (url.protocol === 'smtps:' ? '465' : '587')
	reportStatus(
		`✓ SMTP ${target}: ${transport} endpoint ${url.hostname}:${port}; credentials are present but cannot be safely authenticated without an SMTP session.\n`
	)
}

function validSmtpUrl(value: string): boolean {
	try {
		const url = new URL(value)
		return (
			['smtp:', 'smtps:'].includes(url.protocol) &&
			Boolean(url.hostname) &&
			Boolean(url.username) &&
			Boolean(url.password)
		)
	} catch {
		return false
	}
}

async function collectInput(): Promise<BootstrapInput> {
	setUiContext('Before you start', guidedBootstrapIntroduction(generated.deploymentPrefix))
	for (;;) {
		const start = (
			await question('Type "start" to continue or "cancel" to stop (no default)')
		).toLowerCase()
		if (start === 'start') break
		if (start === 'cancel') throw new CancelledError()
		reportStatus('Enter exactly "start" or "cancel"; no choice is preselected.')
	}
	setUiContext('Secret recovery', guidedBootstrapRecoveryNotice(inputPath, credentialsPath))
	for (;;) {
		const recoveryChoice = (
			await question('Type "continue" to accept or "cancel" to stop (no default)')
		).toLowerCase()
		if (recoveryChoice === 'continue') break
		if (recoveryChoice === 'cancel') throw new CancelledError()
		reportStatus('Enter exactly "continue" or "cancel"; no choice is preselected.')
	}
	setUiContext(
		'GitHub and local tools',
		'Checking the authenticated GitHub administrator and the local Pulumi installation.'
	)
	await run('gh', ['auth', 'status'])
	await run('pulumi', ['version'])
	const repository = await required(['repository'], 'GitHub repository', {
		defaultValue: 'MyAvenCEO/avenOS',
		validate: (value) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
	})
	const repositoryInfo = JSON.parse(
		await run(
			'gh',
			[
				'api',
				`repos/${repository}`,
				'--jq',
				'{fullName: .full_name, defaultBranch: .default_branch, admin: .permissions.admin}'
			],
			true
		)
	) as { fullName?: string; defaultBranch?: string; admin?: boolean }
	if (repositoryInfo.admin !== true)
		throw new Error(`The authenticated GitHub account is not an administrator of ${repository}.`)
	reportStatus(
		`✓ GitHub repository: ${repositoryInfo.fullName ?? repository}; administrator access; default branch ${repositoryInfo.defaultBranch ?? 'unknown'}.\n`
	)
	const reviewer = await optional(['reviewer'], 'Optional second GitHub reviewer login')
	if (reviewer) {
		const resolvedReviewer = await run('gh', ['api', `users/${reviewer}`, '--jq', '.login'], true)
		reportStatus(`✓ Optional deployment reviewer resolves to ${resolvedReviewer}.`)
	}

	const projectId = await required(
		['objectStorage', 'projectId'],
		'Hetzner Object Storage project ID',
		{ validate: (value) => /^\d+$/.test(value) }
	)
	const objectStorageRegion = await required(['objectStorage', 'region'], 'Object Storage region', {
		defaultValue: 'hel1',
		validate: (value) => ['fsn1', 'nbg1', 'hel1'].includes(value)
	})

	const consoleUrl = hetznerProjectConsoleUrl(projectId)
	setUiContext(
		'Hetzner Object Storage',
		`Hetzner cannot create S3 credentials through an API.\nOpen ${consoleUrl}\nChoose Security → S3 Credentials → Generate credentials.\nOfficial instructions: https://docs.hetzner.com/storage/object-storage/getting-started/generating-s3-keys/\nKeep each result open until both values have been accepted here.`
	)
	for (const [index, step] of S3_CREDENTIAL_STEPS.entries()) {
		setUiContext(
			`S3 credential ${index + 1} of ${S3_CREDENTIAL_STEPS.length}`,
			`Open ${consoleUrl}\nDescription: ${step.description}\nPurpose: ${step.purpose}\nBoth values are saved immediately and verified before advancing.`
		)
		let accessKeyId = await required(
			[...step.path, 'accessKeyId'],
			`${step.description} access key`,
			{
				secret: true
			}
		)
		let secretAccessKey = await required(
			[...step.path, 'secretAccessKey'],
			`${step.description} secret key`,
			{
				secret: true
			}
		)
		for (;;) {
			try {
				await validateS3Credential({
					label: step.description,
					region: objectStorageRegion,
					accessKeyId,
					secretAccessKey
				})
				break
			} catch (error) {
				const message = redactSecrets(
					error instanceof Error ? error.message : 'unknown Object Storage failure'
				)
				reportFailure(`${step.description}: ${message}`)
				const action = await verificationAction(step.description)
				if (action === 'stop') throw error
				if (action === 'replace') {
					accessKeyId = await replacement(
						[...step.path, 'accessKeyId'],
						`${step.description} access key`,
						{ secret: true }
					)
					secretAccessKey = await replacement(
						[...step.path, 'secretAccessKey'],
						`${step.description} secret key`,
						{ secret: true }
					)
				}
			}
		}
	}

	for (const target of ['identity', 'next', 'production'] as const) {
		setUiContext(
			`Hetzner Cloud · ${target}`,
			`Enter the write token for the ${target} Cloud project. A read-only server-list request confirms which project view it exposes.`
		)
		await requiredVerified(
			['providers', target, 'computeToken'],
			`Hetzner ${target} compute API token`,
			{ secret: true },
			(token) =>
				validateHetznerToken(token, `Hetzner ${target} compute API token`, 'servers?per_page=1')
		)
	}
	for (const target of ['next', 'production'] as const) {
		setUiContext(
			`Platform providers · ${target}`,
			`Enter the ${target} DNS, Polar, and send-only SMTP credentials. Each non-mutating provider check must pass before advancing.`
		)
		await requiredVerified(
			['providers', target, 'dnsToken'],
			`Hetzner ${target} DNS token`,
			{ secret: true },
			(token) => validateHetznerToken(token, `Hetzner ${target} DNS token`, 'zones/aven.ceo')
		)
		let polarApiKey = await required(
			['providers', target, 'polarApiKey'],
			`Polar ${target} API key`,
			{
				secret: true
			}
		)
		let polarOrganizationId = await required(
			['providers', target, 'polarOrganizationId'],
			`Polar ${target} organization ID`
		)
		for (;;) {
			try {
				await validatePolarCredential({
					target,
					apiKey: polarApiKey,
					organizationId: polarOrganizationId
				})
				break
			} catch (error) {
				const message = redactSecrets(
					error instanceof Error ? error.message : 'unknown Polar failure'
				)
				reportFailure(`Polar ${target}: ${message}`)
				const action = await verificationAction(`Polar ${target} credentials`)
				if (action === 'stop') throw error
				if (action === 'replace') {
					polarApiKey = await replacement(
						['providers', target, 'polarApiKey'],
						`Polar ${target} API key`,
						{ secret: true }
					)
					polarOrganizationId = await replacement(
						['providers', target, 'polarOrganizationId'],
						`Polar ${target} organization ID`
					)
				}
			}
		}
		const smtpUrl = await required(['providers', target, 'smtpUrl'], `SMTP ${target} URL`, {
			secret: true,
			validate: validSmtpUrl
		})
		describeSmtpUrl(smtpUrl, target)
		await required(['providers', target, 'smtpFrom'], `SMTP ${target} From address`)
		await optional(['providers', target, 'smtpReplyTo'], `SMTP ${target} Reply-To address`)
	}
	await requiredVerified(
		['providers', 'redpillApiKey'],
		'RedPill API key',
		{ secret: true },
		async (apiKey) => {
			const catalog = await fetchRedpillPhalaCatalog(fetch, apiKey)
			const examples = catalog.slice(0, 3).map((model) => model.label)
			reportStatus(
				`✓ RedPill API key: authenticated catalog access; ${catalog.length} Phala-hosted model(s)${examples.length === 0 ? '' : `, including ${examples.join(', ')}`}.\n`
			)
		}
	)
	await optional(
		['providers', 'production', 'androidAppCertSha256Fingerprints'],
		'Production Android certificate SHA-256 fingerprints'
	)

	await required(['defaults', 'hetznerLocation'], 'Hetzner server location', {
		defaultValue: 'hel1'
	})
	await required(['defaults', 'hetznerServerType'], 'Hetzner server type', {
		defaultValue: 'cpx32'
	})
	await required(['defaults', 'hetznerOsImage'], 'Hetzner OS image', {
		defaultValue: 'ubuntu-24.04'
	})
	await requiredInteger(['defaults', 'identityVolumeSizeGb'], 'Identity volume GiB', 40, 20)
	await requiredInteger(['defaults', 'platformVolumeSizeGb'], 'Platform volume GiB', 80, 20)
	await required(['defaults', 'sshAllowedCidrs'], 'SSH allowed CIDRs', {
		defaultValue: '0.0.0.0/0,::/0'
	})
	await required(['defaults', 'acmeEmail'], 'ACME certificate contact email')
	await required(['defaults', 'downloadUrl'], 'Client download URL', {
		defaultValue: 'https://github.com/MyAvenCEO/avenOS/releases/latest',
		validate: (value) => value.startsWith('https://')
	})

	validateBootstrapInput(draft)
	return draft
}

try {
	if (!existsSync(inputPath) || !existsSync(credentialsPath)) saveDraft()
	await collectInput()
	process.stdout.write('\nValidating the complete plan without changing providers…\n')
	await run(process.execPath, [
		resolve(root, 'scripts/deployment-bootstrap.ts'),
		'--input',
		inputPath,
		'--output',
		outputDirectory,
		'--dry-run'
	])
	const apply = (await question('Apply this bootstrap now?', 'yes')).toLowerCase()
	if (!['y', 'yes'].includes(apply)) {
		process.stdout.write(
			`SUCCESS: plan validated without provider changes. Resume with ${outputDirectory}\nCredentials: ${credentialsPath}\n`
		)
	} else {
		await run(
			process.execPath,
			[
				resolve(root, 'scripts/deployment-bootstrap.ts'),
				'--input',
				inputPath,
				'--output',
				outputDirectory
			],
			true
		)
		promoteCompletedCredentials()
		process.stdout.write(
			`SUCCESS: bootstrap ${generated.deploymentPrefix} is configured.\nImport ${credentialsPath} into the password manager, verify it, then securely delete the local bootstrap directory.\n`
		)
	}
} catch (error) {
	try {
		promoteCompletedCredentials()
	} catch {
		// The incremental credentials file remains intact and owner-only.
	}
	const message = redactSecrets(
		error instanceof Error ? error.message : 'Unknown bootstrap failure.'
	)
	if (tui)
		tui.setContext(
			'Bootstrap stopped',
			`ERROR: ${message}\n\nChoose whether to preserve the owner-only credential artifacts for a retry or delete them. Deletion prevents resume.`
		)
	else process.stderr.write(`\nERROR: ${message}\n`)
	try {
		const resolution = await resolveFailedRunCredentials()
		if (tui) process.stderr.write(`ERROR: ${message}\n`)
		if (resolution === 'deleted') process.stderr.write('Local credential artifacts deleted.\n')
		else process.stderr.write(`Progress preserved in ${credentialsPath}\n`)
	} catch (cleanupError) {
		const cleanupMessage =
			cleanupError instanceof Error ? cleanupError.message : 'Unknown credential cleanup failure.'
		process.stderr.write(
			`Credential cleanup failed: ${redactSecrets(cleanupMessage)}\nProgress may remain in ${outputDirectory}.\n`
		)
	}
	process.exitCode = error instanceof TuiInterruptedError ? 130 : 1
} finally {
	restoreEcho()
	terminal?.close()
	tui?.close()
}
