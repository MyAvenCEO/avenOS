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
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Polar } from '@polar-sh/sdk'
import {
	type BootstrapInput,
	deploymentConfigurationTargets,
	loadOrCreateGeneratedSecrets,
	parseBootstrapProgress,
	TARGETS,
	type Target,
	validateBootstrapInput
} from './lib/deployment-bootstrap.js'
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
} from './lib/deployment-bootstrap-guided.js'
import {
	BootstrapTui,
	TuiInterruptedError,
	type TuiProgress,
	type TuiProgressUpdate
} from './lib/deployment-bootstrap-tui.js'
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
	(outputRelativeToRepository !== '..' &&
		!outputRelativeToRepository.startsWith(`..${sep}`) &&
		!isAbsolute(outputRelativeToRepository))
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
const bootstrapLogPath = join(outputDirectory, 'bootstrap-apply.log')
for (const path of [
	inputPath,
	credentialsPath,
	completedCredentialsPath,
	generatedPath,
	bootstrapLogPath
]) {
	if (existsSync(path) && (preflight(() => statSync(path)).mode & 0o077) !== 0)
		failPreflight(`${path} must be owner-only (chmod 600).`)
}
const savedCredentialCsvPaths = [credentialsPath, completedCredentialsPath].filter((path) =>
	existsSync(path)
)
if (savedCredentialCsvPaths.length > 0 && (!existsSync(inputPath) || !existsSync(generatedPath)))
	failPreflight(
		`Found owner-only credential CSV data in ${outputDirectory}, but bootstrap-input.json or bootstrap.generated.json is missing. The CSV is preserved, but it cannot safely reconstruct every setup answer. Restore the companion files or choose another --output directory.`
	)
const draft = preflight(() =>
	existsSync(inputPath)
		? (JSON.parse(readFileSync(inputPath, 'utf8')) as Record<string, unknown>)
		: {}
)
const generated = preflight(() => loadOrCreateGeneratedSecrets(generatedPath))

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
let activeChild: { kill(signal?: number | NodeJS.Signals): void } | undefined
function interruptActiveOperation(): void {
	activeChild?.kill('SIGTERM')
}
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
process.on('SIGINT', () => {
	if (handlingInterrupt) return
	handlingInterrupt = true
	interruptActiveOperation()
	restoreEcho()
	tui?.close()
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

const localCredentialPaths = [
	inputPath,
	credentialsPath,
	completedCredentialsPath,
	generatedPath,
	bootstrapLogPath,
	join(outputDirectory, 'pulumi-state'),
	...TARGETS.flatMap((target) => [
		join(outputDirectory, `bootstrap-state-${target}.json`),
		join(outputDirectory, `bootstrap.${target}.remote`)
	])
] as const

function deleteLocalCredentialArtifacts(): void {
	for (const path of localCredentialPaths) {
		if (existsSync(path)) rmSync(path, { recursive: true, force: true })
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

function setUiContext(
	chapter: string,
	title: string,
	content: string,
	progress?: TuiProgress
): void {
	if (tui) tui.setContext(chapter, title, content, progress)
	else process.stdout.write(`\n${chapter} · ${title}\n${content.trim()}\n`)
}

function reportStatus(message: string, chapter?: string): void {
	if (tui) tui.status(message, 'success', chapter)
	else process.stdout.write(`${message.trim()}\n`)
}

function reportFailure(message: string): void {
	if (tui) tui.status(`✗ ${message}`, 'error')
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

async function run(
	command: string,
	commandArgs: string[],
	quiet = false,
	timeoutMs?: number
): Promise<string> {
	const child = Bun.spawn([command, ...commandArgs], {
		cwd: root,
		stdin: 'inherit',
		stdout: quiet ? 'pipe' : 'inherit',
		stderr: quiet ? 'pipe' : 'inherit'
	})
	activeChild = child
	let timedOut = false
	const timeout = timeoutMs
		? setTimeout(() => {
				timedOut = true
				child.kill()
			}, timeoutMs)
		: undefined
	try {
		const stdout = quiet ? await new Response(child.stdout).text() : ''
		const stderr = quiet ? await new Response(child.stderr).text() : ''
		const exitCode = await child.exited
		if (timedOut)
			throw new Error(`${command} timed out after ${Math.ceil((timeoutMs ?? 0) / 1000)}s`)
		if (exitCode !== 0)
			throw new Error(`${command} failed${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
		return stdout.trim()
	} finally {
		if (timeout) clearTimeout(timeout)
		if (activeChild === child) activeChild = undefined
	}
}

async function withProgress<T>(
	label: string,
	action: (update: (event: TuiProgressUpdate) => void) => Promise<T>
): Promise<T> {
	if (tui) return tui.progress(label, action, interruptActiveOperation)
	return action((event) => {
		const marker = event.status === 'complete' ? '✓' : '›'
		process.stdout.write(
			`${marker} [${event.current}/${event.total}] ${event.label}${event.detail ? ` — ${event.detail}` : ''}\n`
		)
	})
}

async function runBootstrapApply(update: (event: TuiProgressUpdate) => void): Promise<void> {
	const child = Bun.spawn(
		[
			process.execPath,
			resolve(root, 'scripts/deployment-bootstrap.ts'),
			'--input',
			inputPath,
			'--output',
			outputDirectory,
			'--progress-json'
		],
		{
			cwd: root,
			stdin: 'inherit',
			stdout: 'pipe',
			stderr: 'pipe'
		}
	)
	activeChild = child
	const log: string[] = [`avenOS bootstrap apply ${new Date().toISOString()}`]
	let lastEvent: TuiProgressUpdate | undefined
	const consume = async (
		stream: ReadableStream<Uint8Array>,
		source: 'stdout' | 'stderr'
	): Promise<void> => {
		const reader = stream.getReader()
		const decoder = new TextDecoder()
		let pending = ''
		for (;;) {
			const { value, done } = await reader.read()
			pending += decoder.decode(value, { stream: !done })
			const lines = pending.split('\n')
			pending = lines.pop() ?? ''
			for (const line of lines) {
				let event: TuiProgressUpdate | undefined
				try {
					event = parseBootstrapProgress(line)
				} catch (error) {
					log.push(`[progress] ${error instanceof Error ? error.message : 'invalid event'}`)
				}
				if (event) {
					lastEvent = event
					log.push(
						`[stage ${event.current}/${event.total}] ${event.status}: ${event.label}${event.detail ? ` — ${event.detail}` : ''}`
					)
					update(event)
				} else if (line.trim()) log.push(`[${source}] ${redactSecrets(line)}`)
			}
			if (done) break
		}
		if (pending.trim()) log.push(`[${source}] ${redactSecrets(pending)}`)
	}
	try {
		const [exitCode] = await Promise.all([
			child.exited,
			consume(child.stdout as ReadableStream<Uint8Array>, 'stdout'),
			consume(child.stderr as ReadableStream<Uint8Array>, 'stderr')
		])
		writePrivateAtomic(bootstrapLogPath, `${log.join('\n')}\n`)
		if (exitCode !== 0) {
			const phase = lastEvent
				? `${lastEvent.label}${lastEvent.detail ? ` — ${lastEvent.detail}` : ''}`
				: 'starting the provider bootstrap'
			throw new Error(
				`Bootstrap apply failed during ${phase.replace(/[.!?]+$/, '')}. Diagnostic log: ${bootstrapLogPath}`
			)
		}
	} finally {
		if (activeChild === child) activeChild = undefined
	}
}

async function validateHetznerToken(token: string, label: string, resource: string): Promise<void> {
	const response = await fetch(`https://api.hetzner.cloud/v1/${resource}`, {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(20_000)
	})
	if (!response.ok) {
		if (resource.startsWith('zones/') && response.status === 404)
			throw new Error(
				"this token's Hetzner project does not contain the aven.ceo zone. Create both DNS tokens in the project that owns that zone"
			)
		throw new Error(`Hetzner returned HTTP ${response.status}.`)
	}
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
	const generatedSecrets = TARGETS.flatMap((target) => [
		generated.targets[target].bootstrapPulumiPassphrase,
		generated.targets[target].pulumiPassphrase,
		generated.targets[target].resticPassword
	]).concat(Object.values(generated.polarWebhooks ?? {}).map((webhook) => webhook.secret))
	const knownSecrets = [...paths.map((path) => valueAt(draft, path)), ...generatedSecrets].filter(
		(value): value is string => typeof value === 'string' && value.length >= 4
	)
	for (const value of knownSecrets) redacted = redacted.replaceAll(value, '[redacted]')
	return redacted
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
		`✓ Polar ${input.target}: ${organization.name} (${organization.slug}, ${organization.id}); organization, product, and webhook read access confirmed${productCount === undefined ? '' : `, ${productCount} product(s)`}${webhookCount === undefined ? '' : `, ${webhookCount} webhook(s)`}. Mutation scopes are exercised during apply and checkout use.\n`
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

interface WizardStep {
	chapter: string
	subchapter?: string
	stationLabel?: string
	title: string
	description: string | (() => string)
	path: readonly string[]
	label: string
	info?: boolean
	secret?: boolean
	optional?: boolean
	defaultValue?: string
	integer?: boolean
	validate?: (value: string) => string | undefined
	verify?: (value: string) => Promise<void>
	summary?: (value: string) => string
	companion?: {
		path: readonly string[]
		label: string
		secret?: boolean
		optional?: boolean
		validate?: (value: string) => string | undefined
	}
}

function wizardLocation(step: Pick<WizardStep, 'chapter' | 'subchapter'>): string {
	return step.subchapter ? `${step.chapter} · ${step.subchapter}` : step.chapter
}

async function navigateStep(
	step: WizardStep,
	initialValue: string | undefined,
	companionInitialValue: string | undefined,
	allowBack: boolean
): Promise<{ direction: 'back' | 'next'; value: string; companionValue?: string }> {
	if (tui) {
		if (step.companion) {
			const result = await tui.navigateFields({
				label: 'Paste both values from the generated credential',
				fields: [
					{
						key: 'primary',
						label: `${step.label} > `,
						initialValue: step.secret ? undefined : initialValue,
						secret: step.secret
					},
					{
						key: 'companion',
						label: `${step.companion.label} > `,
						initialValue: step.companion.secret ? undefined : companionInitialValue,
						secret: step.companion.secret
					}
				],
				allowBack
			})
			return {
				direction: result.direction,
				value: result.values.primary ?? '',
				companionValue: result.values.companion ?? ''
			}
		}
		const result = await tui.navigate({
			label: step.label,
			initialValue: step.secret ? undefined : initialValue,
			secret: step.secret,
			allowBack
		})
		return { ...result }
	}
	const suffix = step.secret || initialValue === undefined ? ': ' : ` [${initialValue}]: `
	process.stdout.write(`${step.label}${allowBack ? ' (enter < to go back)' : ''}${suffix}`)
	if (step.secret) setEcho(false)
	try {
		const answer = await readAnswer()
		if (answer === '<' && allowBack) return { direction: 'back', value: '' }
		if (!step.companion) return { direction: 'next', value: answer || initialValue || '' }
		if (step.secret) restoreEcho()
		process.stdout.write('\n')
		const companionSuffix =
			step.companion.secret || companionInitialValue === undefined
				? ': '
				: ` [${companionInitialValue}]: `
		process.stdout.write(
			`${step.companion.label}${allowBack ? ' (enter < to go back)' : ''}${companionSuffix}`
		)
		if (step.companion.secret) setEcho(false)
		const companionAnswer = await readAnswer()
		if (companionAnswer === '<' && allowBack) return { direction: 'back', value: '' }
		return {
			direction: 'next',
			value: answer || initialValue || '',
			companionValue: companionAnswer || companionInitialValue || ''
		}
	} finally {
		if (step.secret || step.companion?.secret) {
			restoreEcho()
			process.stdout.write('\n')
		}
	}
}

function wizardSteps(selectedTargets: readonly Target[]): WizardStep[] {
	const platformTargets = selectedTargets.filter(
		(target): target is 'next' | 'production' => target !== 'identity'
	)
	const steps: WizardStep[] = [
		{
			chapter: 'Welcome',
			title: 'Before you start',
			description: guidedBootstrapIntroduction(generated.deploymentPrefix, selectedTargets),
			path: [],
			label: '',
			info: true
		},
		{
			chapter: 'Welcome',
			title: 'Credential recovery',
			description: guidedBootstrapRecoveryNotice(inputPath, credentialsPath),
			path: [],
			label: '',
			info: true,
			verify: async () => {
				await run('gh', ['auth', 'status'], true, 30_000)
				const login = await run('gh', ['api', 'user', '--jq', '.login'], true, 30_000)
				const pulumiVersion = await run('pulumi', ['version'], true, 30_000)
				reportStatus(`✓ Account ${login}; Pulumi ${pulumiVersion}.`, 'GitHub')
			}
		},
		{
			chapter: 'GitHub',
			title: 'Repository administrator',
			description:
				'The authenticated GitHub account must administer the repository. The CLI checks the repository and reports its default branch.',
			path: ['repository'],
			label: 'Repository',
			defaultValue: 'MyAvenCEO/avenOS',
			validate: (value) =>
				/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) ? undefined : 'Use the owner/name form.',
			verify: async (repository) => {
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
					throw new Error(`The authenticated account is not an administrator of ${repository}.`)
				reportStatus(
					`✓ ${repositoryInfo.fullName ?? repository}: administrator access; default branch ${repositoryInfo.defaultBranch ?? 'unknown'}.`
				)
			}
		},
		{
			chapter: 'GitHub',
			title: 'Optional deployment reviewer',
			description:
				'Leave this empty for a solo installation. When set, this account must approve protected deployments and cannot be the initiating operator.',
			path: ['reviewer'],
			label: 'Reviewer login',
			optional: true,
			validate: (value) =>
				!value || /^[A-Za-z0-9-]+$/.test(value) ? undefined : 'Enter a GitHub login.',
			verify: async (reviewer) => {
				if (!reviewer) return
				const resolved = await run('gh', ['api', `users/${reviewer}`, '--jq', '.login'], true)
				reportStatus(`✓ Reviewer account: ${resolved}.`)
			}
		},
		{
			chapter: 'Hetzner',
			subchapter: 'Object Storage',
			title: 'Storage region',
			description: `${selectedTargets.length * 2} buckets use one Hetzner Object Storage region. Each selected target remains in its own project.`,
			path: ['objectStorage', 'region'],
			label: 'Region',
			defaultValue: 'hel1',
			validate: (value) =>
				['fsn1', 'nbg1', 'hel1'].includes(value) ? undefined : 'Choose fsn1, nbg1, or hel1.',
			summary: (value) => `✓ Region ${value}; endpoint ${value}.your-objectstorage.com.`
		}
	]

	for (const target of selectedTargets) {
		const subchapter = `${target} project`
		steps.push({
			chapter: 'Hetzner',
			subchapter,
			title: `avenOS ${target} project`,
			stationLabel: 'Project details',
			description: `Open https://console.hetzner.com/projects\nName: avenOS ${target}\n\nCreate or open the dedicated project with the name above. It contains the ${target} host, state, and backup resources and must differ from the other two deployment projects. Paste its numeric project ID below.`,
			path: ['objectStorage', 'targets', target, 'projectId'],
			label: `${target} project ID`,
			validate: (value) => {
				if (!/^\d+$/.test(value)) return 'The project ID must be numeric.'
				const duplicate = selectedTargets.some(
					(other) =>
						other !== target &&
						valueAt(draft, ['objectStorage', 'targets', other, 'projectId']) === value
				)
				return duplicate ? 'Choose a different project for every target.' : undefined
			},
			summary: (value) => `✓ ${target} project ${value}; ${hetznerS3CredentialsUrl(value)}.`
		})
		for (const credential of S3_CREDENTIAL_STEPS.filter((step) => step.target === target)) {
			const context = () => {
				const projectId = String(
					valueAt(draft, ['objectStorage', 'targets', target, 'projectId']) ?? ''
				)
				return `Open: ${hetznerS3CredentialsUrl(projectId)}\nDescription: ${credential.description}\n\nGenerate the credential, then paste both values below. Keep the Hetzner result open until this check succeeds.\nPurpose: ${credential.purpose}`
			}
			steps.push({
				chapter: 'Hetzner',
				subchapter,
				title: credential.description,
				stationLabel: credential.description.replace(`avenOS ${target} `, 'S3 '),
				description: context,
				path: [...credential.path, 'accessKeyId'],
				label: 'Access key',
				secret: true,
				validate: (value) =>
					/^[A-Z0-9]{8,64}$/.test(value) ? undefined : 'This is not a Hetzner S3 access key.',
				companion: {
					path: [...credential.path, 'secretAccessKey'],
					label: 'Secret key',
					secret: true
				},
				verify: async () => {
					await validateS3Credential({
						label: credential.description,
						region: String(valueAt(draft, ['objectStorage', 'region'])),
						accessKeyId: String(valueAt(draft, [...credential.path, 'accessKeyId'])),
						secretAccessKey: String(valueAt(draft, [...credential.path, 'secretAccessKey']))
					})
				}
			})
		}
		steps.push({
			chapter: 'Hetzner',
			subchapter,
			title: `avenOS ${target} deployment`,
			stationLabel: 'Compute deployment token',
			description: () =>
				`Open ${hetznerProjectTokensUrl(String(valueAt(draft, ['objectStorage', 'targets', target, 'projectId'])))}\nName: avenOS ${target} deployment\n\nCreate a read/write API token with the name above and paste it below. A read-only request reports the visible server count before the wizard advances.`,
			path: ['providers', target, 'computeToken'],
			label: 'Cloud API token',
			secret: true,
			verify: (token) =>
				validateHetznerToken(token, `Hetzner ${target} compute token`, 'servers?per_page=1')
		})
	}

	if (platformTargets.length > 0)
		steps.push({
			chapter: 'Hetzner',
			subchapter: 'aven.ceo DNS project',
			title: 'aven.ceo DNS project',
			stationLabel: 'Project details',
			description:
				'Open https://console.hetzner.com/projects\n\nOpen the existing project that contains the aven.ceo DNS zone and paste its numeric project ID. Both deployment environments use separate tokens from this one shared project.',
			path: ['providers', 'dnsProjectId'],
			label: 'DNS project ID',
			validate: (value) => (/^\d+$/.test(value) ? undefined : 'The project ID must be numeric.'),
			summary: (value) => `✓ aven.ceo DNS project ${value}; ${hetznerProjectTokensUrl(value)}.`
		})

	for (const target of platformTargets) {
		steps.push({
			chapter: 'Hetzner',
			subchapter: 'aven.ceo DNS project',
			title: `avenOS ${target} DNS deployment`,
			stationLabel: `${target} deployment token`,
			description: () =>
				`Open ${hetznerProjectTokensUrl(String(valueAt(draft, ['providers', 'dnsProjectId'])))}\nName: avenOS ${target} DNS deployment\n\nCreate a read/write token with the name above in this shared DNS project and paste it below. The wizard resolves the exact aven.ceo zone and displays its provider ID.`,
			path: ['providers', target, 'dnsToken'],
			label: 'DNS API token',
			secret: true,
			verify: (token) =>
				validateHetznerToken(token, `Hetzner ${target} DNS token`, 'zones/aven.ceo')
		})
	}

	for (const target of platformTargets) {
		const subchapter = `${target} organization`
		steps.push(
			{
				chapter: 'Polar',
				subchapter,
				title: `${target} organization`,
				stationLabel: 'Organization details',
				description: `Open ${target === 'next' ? 'https://sandbox.polar.sh' : 'https://polar.sh'}\n\nUse the ${target === 'next' ? 'sandbox' : 'live'} organization that should own ${target} checkout products and webhooks. Paste its organization ID below.`,
				path: ['providers', target, 'polarOrganizationId'],
				label: 'Organization ID'
			},
			{
				chapter: 'Polar',
				subchapter,
				title: `avenOS ${target} billing`,
				stationLabel: 'Billing API key',
				description: `Open ${target === 'next' ? 'https://sandbox.polar.sh' : 'https://polar.sh'}\nName: avenOS ${target} billing\n\nSelect only these scopes:\n${POLAR_API_KEY_SCOPES.map((scope) => `  ${scope}`).join('\n')}\n\nThis backend token is used by bootstrap and the checkout service. Its expiry must cover production use and planned rotation. Paste it below.`,
				path: ['providers', target, 'polarApiKey'],
				label: 'Polar API key',
				secret: true,
				verify: (apiKey) =>
					validatePolarCredential({
						target,
						apiKey,
						organizationId: String(valueAt(draft, ['providers', target, 'polarOrganizationId']))
					})
			}
		)
	}

	for (const target of platformTargets) {
		const subchapter = `${target} sending`
		steps.push(
			{
				chapter: 'Email',
				subchapter,
				title: `avenOS ${target} SMTP`,
				stationLabel: 'SMTP credential',
				description: `Name: avenOS ${target} SMTP\n\nCreate a send-only SMTP credential with the name above when the provider supports names. Paste a complete smtp:// or smtps:// URL containing its username and password; the endpoint structure is checked without sending mail.`,
				path: ['providers', target, 'smtpUrl'],
				label: 'SMTP URL',
				secret: true,
				validate: (value) => (validSmtpUrl(value) ? undefined : 'Enter a complete SMTP URL.'),
				summary: (value) => {
					describeSmtpUrl(value, target)
					return ''
				}
			},
			{
				chapter: 'Email',
				subchapter,
				title: `${target} sender`,
				description: 'This is the From address customers see on checkout and account email.',
				path: ['providers', target, 'smtpFrom'],
				label: 'From address'
			},
			{
				chapter: 'Email',
				subchapter,
				title: `${target} reply address`,
				description: 'Optional. Leave this empty when replies should use the From address.',
				path: ['providers', target, 'smtpReplyTo'],
				label: 'Reply-To address',
				optional: true
			}
		)
	}

	if (platformTargets.length > 0)
		steps.push(
			{
				chapter: 'AI models',
				title: 'avenOS chat bootstrap',
				description:
					'Open https://redpill.ai\nName: avenOS chat bootstrap\n\nCreate an active, funded key with the name above and paste it below. The authenticated model catalog is filtered to Phala-hosted chat models and summarized before advancing.',
				path: ['providers', 'redpillApiKey'],
				label: 'RedPill API key',
				secret: true,
				verify: async (apiKey) => {
					const catalog = await fetchRedpillPhalaCatalog(fetch, apiKey)
					const examples = catalog.slice(0, 3).map((model) => model.label)
					reportStatus(
						`✓ ${catalog.length} Phala-hosted model(s)${examples.length ? `, including ${examples.join(', ')}` : ''}.`
					)
				}
			},
			...(selectedTargets.includes('production')
				? [
						{
							chapter: 'Client release',
							title: 'Android signing identity',
							description:
								'Optional. Add production Android certificate SHA-256 fingerprints for verified app links.',
							path: ['providers', 'production', 'androidAppCertSha256Fingerprints'],
							label: 'Certificate fingerprints',
							optional: true
						} satisfies WizardStep
					]
				: [])
		)

	for (const step of [
		{
			title: 'Server location',
			path: ['defaults', 'hetznerLocation'],
			label: 'Hetzner location',
			defaultValue: 'hel1',
			description: 'Default location for all three hosts and their attached volumes.'
		},
		{
			title: 'Server size',
			path: ['defaults', 'hetznerServerType'],
			label: 'Hetzner server type',
			defaultValue: 'cpx32',
			description: 'Default compute shape for identity, next, and production.'
		},
		{
			title: 'Operating system',
			path: ['defaults', 'hetznerOsImage'],
			label: 'Hetzner OS image',
			defaultValue: 'ubuntu-24.04',
			description: 'Supported base image used by the fresh-host Pulumi program.'
		},
		...(selectedTargets.includes('identity')
			? [
					{
						title: 'Identity volume',
						path: ['defaults', 'identityVolumeSizeGb'],
						label: 'Identity volume GiB',
						defaultValue: '40',
						integer: true,
						validate: (value: string) =>
							Number.isSafeInteger(Number(value)) && Number(value) >= 20
								? undefined
								: 'Enter an integer of at least 20.',
						description: 'Persistent volume for shared identity data.'
					}
				]
			: []),
		...(platformTargets.length > 0
			? [
					{
						title: 'Platform volumes',
						path: ['defaults', 'platformVolumeSizeGb'],
						label: 'Platform volume GiB',
						defaultValue: '80',
						integer: true,
						validate: (value: string) =>
							Number.isSafeInteger(Number(value)) && Number(value) >= 20
								? undefined
								: 'Enter an integer of at least 20.',
						description: `Persistent volume size used independently by ${platformTargets.join(' and ')}.`
					}
				]
			: []),
		{
			title: 'SSH network access',
			path: ['defaults', 'sshAllowedCidrs'],
			label: 'Allowed CIDRs',
			defaultValue: '0.0.0.0/0,::/0',
			description:
				'GitHub-hosted runners use changing source addresses. SSH still requires generated role keys and forced commands.'
		},
		{
			title: 'Certificate contact',
			path: ['defaults', 'acmeEmail'],
			label: 'ACME email',
			validate: (value: string) => (value.includes('@') ? undefined : 'Enter an email address.'),
			description: 'Contact address used for automatic TLS certificate issuance.'
		},
		...(platformTargets.length > 0
			? [
					{
						title: 'Client download',
						path: ['defaults', 'downloadUrl'],
						label: 'Download URL',
						defaultValue: 'https://github.com/MyAvenCEO/avenOS/releases/latest',
						validate: (value: string) =>
							value.startsWith('https://') ? undefined : 'The download URL must use HTTPS.',
						description:
							'Public link checkout and account surfaces use for current client downloads.'
					}
				]
			: [])
	] satisfies Array<Omit<WizardStep, 'chapter'>>) {
		steps.push({ chapter: 'Infrastructure defaults', ...step })
	}
	return steps
}

function currentDeploymentTargets(): Target[] {
	const saved = valueAt(draft, ['deploymentTargets'])
	if (!Array.isArray(saved)) return [...TARGETS]
	const ordered = orderedDeploymentTargets(
		saved.filter((value): value is string => typeof value === 'string')
	)
	return ordered.length > 0 ? ordered : [...TARGETS]
}

function wizardStations(steps: readonly WizardStep[]) {
	return [
		{ chapter: 'Welcome', subchapter: 'Scope', item: 'Deployment targets' },
		...steps
			.filter((step) => !step.info)
			.map((step) => {
				const scope = /^(identity|next|production)\b/.exec(step.subchapter ?? '')?.[1]
				let item = step.stationLabel ?? step.title
				if (scope) item = item.replace(new RegExp(`^(?:avenOS )?${scope}\\s+`, 'i'), '')
				else item = item.replace(/^avenOS\s+/i, '')
				return { chapter: step.chapter, subchapter: step.subchapter, item }
			})
	]
}

async function chooseDeploymentTargets(): Promise<Target[]> {
	let selectedTargets = currentDeploymentTargets()
	for (;;) {
		setUiContext(
			'Welcome · Scope',
			'Deployment targets',
			`Check every target to prepare in this run. Only pages and provider changes needed by the checked targets will follow.\n\n${deploymentTargetSummary(TARGETS)}\n\nA complete installation eventually needs all three. You can prepare one target now and add another later with the same saved generation.`
		)
		let values: string[]
		if (tui) {
			const result = await tui.chooseMany({
				label: 'Targets for this run',
				options: TARGETS.map((target) => ({
					label: target,
					value: target
				})),
				selected: selectedTargets
			})
			values = result.values
		} else {
			process.stdout.write(
				`\nSelected [${selectedTargets.join(', ')}]. Enter identity, next, production, a comma-separated combination, or all: `
			)
			const answer = (await readAnswer()).toLowerCase()
			values =
				answer === ''
					? selectedTargets
					: answer === 'all'
						? [...TARGETS]
						: answer.split(',').map((value) => value.trim())
		}
		const ordered = orderedDeploymentTargets(values)
		if (ordered.length === 0 || values.some((value) => !TARGETS.includes(value as Target))) {
			reportFailure('Check at least one of identity, next, or production.')
			continue
		}
		selectedTargets = ordered
		setValueAt(draft, ['deploymentTargets'], selectedTargets)
		saveDraft()
		return selectedTargets
	}
}

async function offerSavedSetupResume(): Promise<'fresh' | 'resume' | 'exit'> {
	if (savedCredentialCsvPaths.length === 0) return 'fresh'
	const steps = wizardSteps(currentDeploymentTargets())
	const resumeIndex = savedWizardResumeIndex(steps, draft)
	const resumeStep = steps[resumeIndex] as WizardStep
	const resumeProgress = actionableWizardProgress(steps, resumeIndex)
	const records = savedCredentialCsvPaths
		.map((path) => `  ${path}\n    modified ${statSync(path).mtime.toISOString()}`)
		.join('\n')
	const context = `Owner-only saved setup data was found:\n${records}\n\nResume at ${resumeStep.title}${resumeProgress ? ` (Step ${resumeProgress.current + 1} of ${resumeProgress.total + 1})` : ''}. You can change the target selection first. The latest saved station is reopened and checked again, so a value saved before a failed check is never skipped.`
	for (;;) {
		setUiContext('Welcome', 'Saved setup found', context)
		let choice: 'exit' | 'resume'
		if (tui) {
			choice = (await tui.choose({
				label: '',
				options: [
					{ label: 'Resume >', value: 'resume' },
					{ label: 'Exit', value: 'exit' }
				]
			})) as 'exit' | 'resume'
		} else {
			process.stdout.write('\nEnter r to resume or e to exit: ')
			const answer = (await readAnswer()).toLowerCase()
			if (answer !== 'r' && answer !== 'e') {
				reportFailure('Choose r to resume or e to exit.')
				continue
			}
			choice = answer === 'r' ? 'resume' : 'exit'
		}
		if (choice === 'exit') return 'exit'
		const dependencyCheck = steps.find((step) => step.title === 'Credential recovery')?.verify
		try {
			await withProgress('Checking GitHub login and Pulumi…', async () => {
				await dependencyCheck?.('')
			})
			return 'resume'
		} catch (error) {
			if (error instanceof TuiInterruptedError) throw error
			const message = redactSecrets(error instanceof Error ? error.message : 'check failed')
			reportFailure(message)
		}
	}
}

async function collectInput(
	selectedTargets: readonly Target[],
	resumeSavedSetup = false
): Promise<BootstrapInput> {
	const steps = wizardSteps(selectedTargets)
	const stations = wizardStations(steps)
	let index = resumeSavedSetup ? savedWizardResumeIndex(steps, draft) : 0
	while (index < steps.length) {
		const step = steps[index] as WizardStep
		if (step.info) {
			setUiContext(
				wizardLocation(step),
				step.title,
				typeof step.description === 'function' ? step.description() : step.description
			)
			let direction: 'back' | 'next' = 'next'
			if (tui) {
				const action = await tui.choose({
					label: '',
					allowBack: index > 0,
					options: [{ label: 'Next >', value: 'next' }]
				})
				direction = action === 'back' ? 'back' : 'next'
			} else {
				process.stdout.write(
					index > 0 ? '\nPress Enter for Next, or type < for Back.\n' : '\nPress Enter for Next.\n'
				)
				direction = (await readAnswer()) === '<' && index > 0 ? 'back' : 'next'
			}
			if (direction === 'back') {
				index -= 1
				continue
			}
			if (step.verify) {
				try {
					await withProgress('Checking GitHub login and Pulumi…', async () => {
						await step.verify?.('')
					})
				} catch (error) {
					if (error instanceof TuiInterruptedError) throw error
					const message = redactSecrets(error instanceof Error ? error.message : 'check failed')
					reportFailure(message)
					continue
				}
			}
			index += 1
			continue
		}
		const existing = valueAt(draft, step.path)
		const existingText =
			typeof existing === 'string' || typeof existing === 'number' ? String(existing) : ''
		const companionExisting = step.companion ? valueAt(draft, step.companion.path) : undefined
		const companionExistingText =
			typeof companionExisting === 'string' || typeof companionExisting === 'number'
				? String(companionExisting)
				: ''
		const initialValue = existingText || step.defaultValue
		const current = step.companion
			? existingText || companionExistingText
				? 'Saved values remain hidden. Leave either field empty to keep its saved value.'
				: 'Both values are required.'
			: existingText
				? step.secret
					? 'A saved value is present and remains hidden. Leave the field empty to keep and recheck it.'
					: `Current value: ${existingText}.`
				: step.defaultValue
					? `Suggested value: ${step.defaultValue}.`
					: step.optional
						? 'This value is optional.'
						: ''
		const actionProgress = actionableWizardProgress(steps, index)
		setUiContext(
			wizardLocation(step),
			step.title,
			`${typeof step.description === 'function' ? step.description() : step.description}\n\n${current}`,
			actionProgress
				? {
						current: actionProgress.current + 1,
						total: actionProgress.total + 1,
						stations
					}
				: undefined
		)
		const result = await navigateStep(step, initialValue, companionExistingText, index > 0)
		if (result.direction === 'back') {
			index -= 1
			continue
		}
		let candidate = result.value
		if (step.secret && !candidate && existingText) candidate = existingText
		if (!candidate && step.defaultValue) candidate = step.defaultValue
		let companionCandidate = result.companionValue ?? ''
		if (step.companion?.secret && !companionCandidate && companionExistingText)
			companionCandidate = companionExistingText
		if (!candidate && !step.optional) {
			reportFailure(`${step.label}: a value is required.`)
			continue
		}
		const invalid = step.validate?.(candidate)
		if (invalid) {
			reportFailure(`${step.label}: ${invalid}`)
			continue
		}
		if (step.companion && !companionCandidate && !step.companion.optional) {
			reportFailure(`${step.companion.label}: a value is required.`)
			continue
		}
		const companionInvalid = step.companion?.validate?.(companionCandidate)
		if (companionInvalid) {
			reportFailure(`${step.companion?.label}: ${companionInvalid}`)
			continue
		}
		setValueAt(
			draft,
			step.path,
			candidate ? (step.integer ? Number(candidate) : candidate) : undefined
		)
		if (step.companion) setValueAt(draft, step.companion.path, companionCandidate || undefined)
		saveDraft()
		try {
			if (step.verify)
				await withProgress(`Checking ${step.title}…`, async () => {
					await step.verify?.(candidate)
				})
		} catch (error) {
			if (error instanceof TuiInterruptedError) throw error
			const message = redactSecrets(error instanceof Error ? error.message : 'verification failed')
			const punctuation = /[.!?]$/.test(message) ? '' : '.'
			reportFailure(
				`${step.companion ? 'Credential' : step.label}: ${message}${punctuation} Correct the value${step.companion ? 's' : ''} and try again.`
			)
			continue
		}
		const summary = step.summary?.(candidate)
		if (summary) reportStatus(summary)
		index += 1
	}

	validateBootstrapInput(draft)
	return draft
}

try {
	const startup = await offerSavedSetupResume()
	if (startup === 'exit') {
		process.stdout.write(`Saved setup preserved in ${outputDirectory}.\n`)
		process.exit(0)
	}
	const selectedTargets = await chooseDeploymentTargets()
	const configurationTargets = deploymentConfigurationTargets(
		{ deploymentTargets: selectedTargets },
		generated
	)
	if (!existsSync(inputPath) || !existsSync(credentialsPath)) saveDraft()
	await collectInput(selectedTargets, startup === 'resume')
	setUiContext('Review', 'Validating the plan', 'No provider state changes while this check runs.')
	await withProgress('Validating the complete deployment plan…', () =>
		run(
			process.execPath,
			[
				resolve(root, 'scripts/deployment-bootstrap.ts'),
				'--input',
				inputPath,
				'--output',
				outputDirectory,
				'--dry-run'
			],
			true
		)
	)
	setUiContext(
		'Review',
		'Plan validated',
		`The input for ${selectedTargets.join(', ')} is valid. Apply creates ${selectedTargets.length * 2} private buckets, ${selectedTargets.filter((target) => target !== 'identity').length} Polar webhook(s), generated credentials, and reconciles ${configurationTargets.length * 2} namespaced GitHub Environments. Previously prepared targets are refreshed only to keep shared references current.`
	)
	const apply = tui
		? await tui.choose({
				label: 'Choose the next action',
				options: [
					{ label: 'Apply now', value: 'apply' },
					{ label: 'Stop after validation', value: 'stop' }
				]
			})
		: (await question('Apply this bootstrap now?', 'yes')).toLowerCase()
	if (!['apply', 'y', 'yes'].includes(apply)) {
		process.stdout.write(
			`SUCCESS: plan validated without provider changes. Resume with ${outputDirectory}\nCredentials: ${credentialsPath}\n`
		)
	} else {
		setUiContext(
			'Review',
			'Applying the bootstrap',
			`Preparing ${selectedTargets.join(', ')}. The activity below shows the current provider operation, completed work, and elapsed time. A redacted diagnostic log is saved at ${bootstrapLogPath}.`
		)
		await withProgress('Starting provider reconciliation…', runBootstrapApply)
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
	if (tui) {
		tui.close()
		tui.setContext(
			'Recovery',
			'Bootstrap stopped',
			`ERROR: ${message}\n\nChoose whether to preserve the owner-only credential artifacts for a retry or delete them. Deletion prevents resume.`
		)
	} else process.stderr.write(`\nERROR: ${message}\n`)
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
