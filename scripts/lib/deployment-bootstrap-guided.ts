import { createHash, createHmac } from 'node:crypto'
import { TARGETS, type Target } from './deployment-bootstrap.ts'

export interface S3CredentialStep {
	path: readonly string[]
	target: 'identity' | 'next' | 'production'
	description: string
	purpose: string
}

export const POLAR_API_KEY_SCOPES = [
	'organizations:read',
	'products:write',
	'benefits:write',
	'meters:write',
	'checkouts:write',
	'subscriptions:write',
	'customers:read',
	'orders:read',
	'webhooks:write'
] as const

export const S3_CREDENTIAL_STEPS: readonly S3CredentialStep[] = (
	['identity', 'next', 'production'] as const
).flatMap((target) => [
	{
		path: ['objectStorage', 'targets', target, 'bootstrapCredential'],
		target,
		description: `avenOS ${target} bootstrap administrator`,
		purpose: `Creates and repairs only the ${target} buckets; keep it offline afterwards.`
	},
	{
		path: ['objectStorage', 'targets', target, 'deploymentCredential'],
		target,
		description: `avenOS ${target} deployment`,
		purpose: `Writes only the ${target} state and backup buckets after policies are applied.`
	},
	{
		path: ['objectStorage', 'targets', target, 'observerCredential'],
		target,
		description: `avenOS ${target} observer`,
		purpose: `Reads only the ${target} state bucket for unattended operations.`
	}
])

export function actionableWizardProgress(
	steps: readonly { info?: boolean }[],
	index: number
): { current: number; total: number } | undefined {
	if (!Number.isSafeInteger(index) || index < 0 || index >= steps.length)
		throw new Error('Wizard step index is out of range.')
	if (steps[index]?.info) return undefined
	return {
		current: steps.slice(0, index + 1).filter((step) => !step.info).length,
		total: steps.filter((step) => !step.info).length
	}
}

export function savedWizardResumeIndex(
	steps: readonly {
		info?: boolean
		path: readonly string[]
		optional?: boolean
		companion?: { path: readonly string[]; optional?: boolean }
	}[],
	draft: Record<string, unknown>
): number {
	const firstActionable = steps.findIndex((step) => !step.info)
	let latestSaved = firstActionable < 0 ? 0 : firstActionable
	for (const [index, step] of steps.entries()) {
		if (step.info) continue
		const values = [
			valueAt(draft, step.path),
			step.companion && valueAt(draft, step.companion.path)
		]
		if (values.some((value) => value !== undefined && value !== null && String(value) !== ''))
			latestSaved = index
	}
	const firstMissing = steps.findIndex((step) => {
		if (step.info) return false
		const primary = valueAt(draft, step.path)
		if (!step.optional && (primary === undefined || primary === null || String(primary) === ''))
			return true
		if (!step.companion?.optional) {
			const companion = step.companion && valueAt(draft, step.companion.path)
			if (
				step.companion &&
				(companion === undefined || companion === null || String(companion) === '')
			)
				return true
		}
		return false
	})
	if (firstMissing >= 0 && firstMissing < latestSaved) return firstMissing
	return latestSaved
}

export function savedWizardVerificationIndexes(
	steps: readonly {
		info?: boolean
		path: readonly string[]
		optional?: boolean
		verify?: unknown
		companion?: { path: readonly string[]; optional?: boolean }
	}[],
	draft: Record<string, unknown>
): number[] {
	return steps.flatMap((step, index) => {
		if (step.info || !step.verify) return []
		const primary = valueAt(draft, step.path)
		const hasPrimary = primary !== undefined && primary !== null && String(primary) !== ''
		if (!hasPrimary) return []
		if (step.companion) {
			const companion = valueAt(draft, step.companion.path)
			const hasCompanion = companion !== undefined && companion !== null && String(companion) !== ''
			if (!hasCompanion && !step.companion.optional) return []
		}
		return [index]
	})
}

export function bootstrapFailureSummary(lines: readonly string[]): string | undefined {
	const error = [...lines].reverse().find((line) => line.startsWith('error:'))
	const details = [...lines].reverse().find((line) => line.startsWith('details:'))
	const summary = [error, details]
		.filter((line): line is string => Boolean(line))
		.map((line) => line.replace(/^(error|details):\s*/, '').replace(/^"|"[,]?$/g, ''))
		.join(' — ')
	return summary ? summary.slice(0, 600) : undefined
}

export function orderedDeploymentTargets(values: readonly string[]): Target[] {
	const selected = new Set(values)
	return TARGETS.filter((target) => selected.has(target))
}

export function workflowRunIdFromDispatchOutput(output: string): number | undefined {
	const match = output.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/actions\/runs\/(\d+)/)
	if (!match) return undefined
	const runId = Number(match[1])
	return Number.isSafeInteger(runId) && runId > 0 ? runId : undefined
}

export function unseenWorkflowRunId(
	runs: readonly { databaseId: number }[],
	knownRunIds: ReadonlySet<number>
): number | undefined {
	return runs.find(
		(run) =>
			Number.isSafeInteger(run.databaseId) && run.databaseId > 0 && !knownRunIds.has(run.databaseId)
	)?.databaseId
}

export function deploymentTargetSummary(targets: readonly Target[]): string {
	const descriptions: Record<Target, string> = {
		identity: 'shared aven.id identity host',
		next: 'next platform at *.next.aven.ceo',
		production: 'production platform at *.aven.ceo'
	}
	return targets.map((target) => `${target} — ${descriptions[target]}`).join('\n')
}

export function guidedBootstrapIntroduction(
	deploymentPrefix: string,
	targets: readonly Target[] = TARGETS
): string {
	const platformTargets = targets.filter((target) => target !== 'identity')
	const count = (amount: number, singular: string, plural = `${singular}s`) =>
		`${amount} ${amount === 1 ? singular : plural}`
	return `Generation: ${deploymentPrefix}
Selected targets: ${targets.join(', ')}
Have these ready before you start:
  - GitHub: gh authenticated as a repository administrator; 1 classic token with read:packages only
  - Hetzner Object Storage: ${count(targets.length, 'numeric project ID')} and permission to create ${count(targets.length * 3, 'S3 credential')}
  - Hetzner: ${count(targets.length, 'target-scoped Cloud write token')}${platformTargets.length ? `; the project ID that owns aven.ceo; and ${count(platformTargets.length, 'DNS write token')} from that project` : ''}
${platformTargets.length ? `  - Polar: ${count(platformTargets.length, 'organization ID')} for ${platformTargets.join(' and ')}, plus the listed billing API scopes\n  - SMTP: send-only URLs and From addresses for ${platformTargets.join(' and ')}; Reply-To is optional\n  - RedPill: 1 active, funded API key for the Phala-hosted model catalog\n` : ''}  - Settings: host, SSH, ACME email, and ${targets.includes('identity') ? 'identity volume' : ''}${targets.includes('identity') && platformTargets.length ? ' plus ' : ''}${platformTargets.length ? 'platform volume and download' : ''} defaults are offered
  - Optional: a second GitHub reviewer${targets.includes('production') ? ' and Android certificate fingerprints' : ''}
${targets.includes('identity') ? '  - Later: aven.id DNS access after Pulumi returns the identity addresses\n' : ''}`
}

export function guidedBootstrapRecoveryNotice(inputPath: string, credentialsPath: string): string {
	return `Created automatically: buckets, GitHub configuration, Polar webhooks, hosts, passwords, SSH keys, database credentials, and the first software deployment.

Every answer is saved immediately because Hetzner displays S3 secrets only once. These owner-only plaintext files contain the entered credentials:
  ${inputPath}
  ${credentialsPath}

Cancel or error asks whether to keep or delete them, with no default. Deletion prevents resume and can strand a partially applied bootstrap.
`
}

export function hetznerS3CredentialsUrl(projectId: string): string {
	if (!/^\d+$/.test(projectId))
		throw new Error('Hetzner Object Storage project ID must be numeric.')
	return `https://console.hetzner.com/projects/${projectId}/security/s3-credentials`
}

export function hetznerProjectTokensUrl(projectId: string): string {
	if (!/^\d+$/.test(projectId)) throw new Error('Hetzner project ID must be numeric.')
	return `https://console.hetzner.com/projects/${projectId}/security/tokens`
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
	return createHmac('sha256', key).update(value).digest()
}

export function signedS3ReadRequest(input: {
	region: string
	accessKeyId: string
	secretAccessKey: string
	bucket?: string
	now?: Date
}): { url: string; headers: Record<string, string> } {
	if (!/^[a-z0-9-]+$/.test(input.region)) throw new Error('Invalid Object Storage region.')
	if (!input.accessKeyId || !input.secretAccessKey)
		throw new Error('Both Object Storage credential values are required.')
	if (input.bucket && !/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(input.bucket))
		throw new Error('Invalid Object Storage bucket name.')
	const host = `${input.region}.your-objectstorage.com`
	const path = input.bucket ? `/${input.bucket}` : '/'
	const query = input.bucket ? 'list-type=2&max-keys=0' : ''
	const now = input.now ?? new Date()
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
	const date = amzDate.slice(0, 8)
	const payloadHash = sha256('')
	const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
	const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
	const canonicalRequest = ['GET', path, query, canonicalHeaders, signedHeaders, payloadHash].join(
		'\n'
	)
	const scope = `${date}/${input.region}/s3/aws4_request`
	const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`
	const dateKey = hmac(`AWS4${input.secretAccessKey}`, date)
	const regionKey = hmac(dateKey, input.region)
	const serviceKey = hmac(regionKey, 's3')
	const signingKey = hmac(serviceKey, 'aws4_request')
	const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
	return {
		url: `https://${host}${path}${query ? `?${query}` : ''}`,
		headers: {
			Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
			'x-amz-content-sha256': payloadHash,
			'x-amz-date': amzDate
		}
	}
}

export function s3ErrorCode(xml: string): string | undefined {
	return /<Code>([^<]+)<\/Code>/.exec(xml)?.[1]
}

export function valueAt(root: Record<string, unknown>, path: readonly string[]): unknown {
	let current: unknown = root
	for (const part of path) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
		current = (current as Record<string, unknown>)[part]
	}
	return current
}

export function setValueAt(
	root: Record<string, unknown>,
	path: readonly string[],
	value: unknown
): void {
	if (path.length === 0) throw new Error('A bootstrap input path cannot be empty.')
	let current = root
	for (const part of path.slice(0, -1)) {
		const next = current[part]
		if (!next || typeof next !== 'object' || Array.isArray(next)) current[part] = {}
		current = current[part] as Record<string, unknown>
	}
	current[path.at(-1) as string] = value
}

function stringValue(root: Record<string, unknown>, path: readonly string[]): string {
	const value = valueAt(root, path)
	return typeof value === 'string' ? value : ''
}

function csv(value: string): string {
	return `"${value.replaceAll('"', '""')}"`
}

export function guidedCredentialsCsv(
	draft: Record<string, unknown>,
	deploymentPrefix = 'pending'
): string {
	const rows: string[][] = []
	const add = (
		group: string,
		name: string,
		username: string,
		secret: string,
		url: string,
		notes: string
	) => {
		if (!username && !secret) return
		rows.push([`avenOS/${deploymentPrefix}/${group}`, name, username, secret, url, notes])
	}
	add(
		'shared',
		'avenOS GitHub Packages reader',
		'',
		stringValue(draft, ['githubPackagesReadToken']),
		'https://github.com/settings/tokens',
		'Classic GitHub token with read:packages only; CI uses it to install the cross-repository @myavenceo packages.'
	)
	for (const step of S3_CREDENTIAL_STEPS) {
		const projectId = stringValue(draft, ['objectStorage', 'targets', step.target, 'projectId'])
		const objectStorageUrl = projectId
			? hetznerS3CredentialsUrl(projectId)
			: 'https://console.hetzner.com/projects'
		add(
			step.target,
			step.description,
			stringValue(draft, [...step.path, 'accessKeyId']),
			stringValue(draft, [...step.path, 'secretAccessKey']),
			objectStorageUrl,
			`${step.purpose}${projectId ? ` Hetzner Object Storage project ${projectId}.` : ''}`
		)
	}
	for (const target of ['identity', 'next', 'production'] as const) {
		const projectId = stringValue(draft, ['objectStorage', 'targets', target, 'projectId'])
		add(
			target,
			`avenOS ${target} deployment (Hetzner Cloud token)`,
			'',
			stringValue(draft, ['providers', target, 'computeToken']),
			projectId ? hetznerProjectTokensUrl(projectId) : 'https://console.hetzner.com/projects',
			`Target-scoped Hetzner Cloud API token used to provision the ${target} host.`
		)
	}
	for (const target of ['next', 'production'] as const) {
		const projectId = stringValue(draft, ['providers', 'dnsProjectId'])
		add(
			target,
			`avenOS ${target} DNS deployment (Hetzner DNS token)`,
			'',
			stringValue(draft, ['providers', target, 'dnsToken']),
			projectId ? hetznerProjectTokensUrl(projectId) : 'https://console.hetzner.com/projects',
			`Writes the ${target} records in the shared aven.ceo DNS zone${projectId ? ` in Hetzner project ${projectId}` : ''}.`
		)
		add(
			target,
			`avenOS ${target} billing (Polar API key)`,
			stringValue(draft, ['providers', target, 'polarOrganizationId']),
			stringValue(draft, ['providers', target, 'polarApiKey']),
			target === 'next' ? 'https://sandbox.polar.sh' : 'https://polar.sh',
			`Reconciles products, benefits, meters, and webhooks and serves checkout, subscription, customer, and order operations in the Polar ${target} organization.`
		)
		add(
			target,
			`avenOS ${target} SMTP`,
			'',
			stringValue(draft, ['providers', target, 'smtpUrl']),
			'',
			`Send-only checkout mail transport for ${target}.`
		)
	}
	add(
		'shared',
		'avenOS chat bootstrap (RedPill API key)',
		'',
		stringValue(draft, ['providers', 'redpillApiKey']),
		'https://redpill.ai',
		'Server-side inference credential shared by next and production.'
	)
	const header = ['Group', 'Title', 'Username', 'Password', 'URL', 'Notes']
	return `${[header, ...rows].map((row) => row.map(csv).join(',')).join('\n')}\n`
}
