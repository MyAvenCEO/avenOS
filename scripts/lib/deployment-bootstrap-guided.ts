import { createHash, createHmac } from 'node:crypto'

export interface S3CredentialStep {
	path: readonly string[]
	target: 'identity' | 'next' | 'production'
	description: string
	purpose: string
}

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

export function guidedBootstrapIntroduction(deploymentPrefix: string): string {
	return `Generation: ${deploymentPrefix}
Have these ready before you start:
  - GitHub: gh authenticated as a repository administrator
  - Hetzner Object Storage: 3 numeric project IDs and permission to create 9 S3 credentials
  - Hetzner: 3 Cloud write tokens; the project ID that owns aven.ceo; and 2 DNS write tokens from that project
  - Polar: sandbox + production organization IDs and org-read/product+webhook read-write API keys
  - SMTP: send-only URLs and From addresses for next and production; Reply-To is optional
  - RedPill: 1 active, funded API key for the Phala-hosted model catalog
  - Settings: ACME email; host, volume, SSH, and download defaults are offered
  - Optional: Android certificate fingerprints and a second GitHub reviewer
  - Later: aven.id DNS access after Pulumi returns the identity addresses
`
}

export function guidedBootstrapRecoveryNotice(inputPath: string, credentialsPath: string): string {
	return `Created automatically: buckets, GitHub Environments, Polar webhooks, passwords, SSH keys, and database credentials.

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
			`avenOS ${target} bootstrap (Polar API key)`,
			stringValue(draft, ['providers', target, 'polarOrganizationId']),
			stringValue(draft, ['providers', target, 'polarApiKey']),
			target === 'next' ? 'https://sandbox.polar.sh' : 'https://polar.sh',
			`Manages products and the raw webhook endpoint in the Polar ${target} organization.`
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
