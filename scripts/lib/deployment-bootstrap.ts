import { randomBytes } from 'node:crypto'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync
} from 'node:fs'

export const TARGETS = ['identity', 'next', 'production'] as const
export type Target = (typeof TARGETS)[number]
export const PULUMI_ORGANIZATION = 'organization'

export interface S3Credential {
	accessKeyId: string
	secretAccessKey: string
}

export interface BootstrapInput {
	repository: string
	reviewer?: string
	objectStorage: {
		region: 'fsn1' | 'nbg1' | 'hel1'
		targets: Record<
			Target,
			{
				projectId: string
				bootstrapCredential: S3Credential
				deploymentCredential: S3Credential
				observerCredential: S3Credential
			}
		>
	}
	defaults: {
		hetznerLocation: string
		hetznerServerType: string
		hetznerOsImage: string
		identityVolumeSizeGb: number
		platformVolumeSizeGb: number
		sshAllowedCidrs: string
		acmeEmail: string
		downloadUrl: string
	}
	providers: {
		dnsProjectId: string
		identity: { computeToken: string }
		next: {
			computeToken: string
			dnsToken: string
			polarApiKey: string
			polarOrganizationId: string
			smtpUrl: string
			smtpFrom: string
			smtpReplyTo?: string
		}
		production: {
			computeToken: string
			dnsToken: string
			polarApiKey: string
			polarOrganizationId: string
			smtpUrl: string
			smtpFrom: string
			smtpReplyTo?: string
			androidAppCertSha256Fingerprints?: string
		}
		redpillApiKey: string
	}
}

export interface GeneratedSecrets {
	deploymentPrefix: string
	targets: Record<
		Target,
		{ bootstrapPulumiPassphrase: string; pulumiPassphrase: string; resticPassword: string }
	>
	polarWebhooks?: Partial<Record<'next' | 'production', PolarWebhookRecord>>
}

export interface PolarWebhookRecord {
	id: string
	url: string
	secret: string
}

const password = () => randomBytes(48).toString('base64url')
const generatedPrefix = /^avenos-[0-9a-f]{10}$/

function objectAt(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error(`${path} must be an object.`)
	return value as Record<string, unknown>
}

function stringAt(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} is required.`)
	if (value.startsWith('PASTE_')) throw new Error(`${path} still contains a template placeholder.`)
	return value
}

export function validateBootstrapInput(value: unknown): asserts value is BootstrapInput {
	const input = objectAt(value, 'input')
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(stringAt(input.repository, 'repository')))
		throw new Error('repository must be owner/name.')
	if (input.reviewer !== undefined && !/^[A-Za-z0-9-]+$/.test(stringAt(input.reviewer, 'reviewer')))
		throw new Error('reviewer must be a GitHub user login when provided.')
	const storage = objectAt(input.objectStorage, 'objectStorage')
	if (!['fsn1', 'nbg1', 'hel1'].includes(stringAt(storage.region, 'objectStorage.region')))
		throw new Error('objectStorage.region must be fsn1, nbg1, or hel1.')
	const credential = (candidate: unknown, path: string) => {
		const item = objectAt(candidate, path)
		stringAt(item.accessKeyId, `${path}.accessKeyId`)
		stringAt(item.secretAccessKey, `${path}.secretAccessKey`)
	}
	const storageTargets = objectAt(storage.targets, 'objectStorage.targets')
	const projectIds = new Set<string>()
	for (const target of TARGETS) {
		const targetStorage = objectAt(storageTargets[target], `objectStorage.targets.${target}`)
		const projectId = stringAt(targetStorage.projectId, `objectStorage.targets.${target}.projectId`)
		if (!/^\d+$/.test(projectId))
			throw new Error(`objectStorage.targets.${target}.projectId must be numeric.`)
		if (projectIds.has(projectId))
			throw new Error('Every Object Storage target must use a different Hetzner project.')
		projectIds.add(projectId)
		credential(
			targetStorage.bootstrapCredential,
			`objectStorage.targets.${target}.bootstrapCredential`
		)
		credential(
			targetStorage.deploymentCredential,
			`objectStorage.targets.${target}.deploymentCredential`
		)
		credential(
			targetStorage.observerCredential,
			`objectStorage.targets.${target}.observerCredential`
		)
	}
	const defaults = objectAt(input.defaults, 'defaults')
	for (const name of [
		'hetznerLocation',
		'hetznerServerType',
		'hetznerOsImage',
		'sshAllowedCidrs',
		'acmeEmail',
		'downloadUrl'
	])
		stringAt(defaults[name], `defaults.${name}`)
	for (const name of ['identityVolumeSizeGb', 'platformVolumeSizeGb']) {
		const size = defaults[name]
		if (!Number.isSafeInteger(size) || (size as number) < 20)
			throw new Error(`defaults.${name} must be an integer of at least 20.`)
	}
	for (const name of ['downloadUrl'] as const) {
		if (new URL(stringAt(defaults[name], `defaults.${name}`)).protocol !== 'https:')
			throw new Error(`defaults.${name} must use HTTPS.`)
	}
	const providers = objectAt(input.providers, 'providers')
	const dnsProjectId = stringAt(providers.dnsProjectId, 'providers.dnsProjectId')
	if (!/^\d+$/.test(dnsProjectId)) throw new Error('providers.dnsProjectId must be numeric.')
	stringAt(providers.redpillApiKey, 'providers.redpillApiKey')
	const identity = objectAt(providers.identity, 'providers.identity')
	stringAt(identity.computeToken, 'providers.identity.computeToken')
	for (const target of ['next', 'production'] as const) {
		const provider = objectAt(providers[target], `providers.${target}`)
		for (const name of [
			'computeToken',
			'dnsToken',
			'polarApiKey',
			'polarOrganizationId',
			'smtpUrl',
			'smtpFrom'
		])
			stringAt(provider[name], `providers.${target}.${name}`)
		const smtp = new URL(stringAt(provider.smtpUrl, `providers.${target}.smtpUrl`))
		if (!['smtp:', 'smtps:'].includes(smtp.protocol))
			throw new Error(`providers.${target}.smtpUrl must use smtp or smtps.`)
	}
}

export function generateBootstrapSecrets(): GeneratedSecrets {
	return {
		deploymentPrefix: `avenos-${randomBytes(5).toString('hex')}`,
		targets: Object.fromEntries(
			TARGETS.map((target) => [
				target,
				{
					bootstrapPulumiPassphrase: password(),
					pulumiPassphrase: password(),
					resticPassword: password()
				}
			])
		) as GeneratedSecrets['targets']
	}
}

export function assertPrivateFile(path: string): void {
	const mode = statSync(path).mode & 0o777
	if ((mode & 0o077) !== 0) throw new Error(`${path} must be owner-only (chmod 600).`)
}

export function ensurePrivateDirectory(path: string): void {
	if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 })
	const details = statSync(path)
	if (!details.isDirectory()) throw new Error(`${path} must be a directory.`)
	const mode = details.mode & 0o777
	if ((mode & 0o077) !== 0) throw new Error(`${path} must be owner-only (chmod 700).`)
}

export function loadOrCreateGeneratedSecrets(path: string): GeneratedSecrets {
	if (existsSync(path)) {
		assertPrivateFile(path)
		const generated = JSON.parse(readFileSync(path, 'utf8')) as GeneratedSecrets
		if (!generatedPrefix.test(generated.deploymentPrefix))
			throw new Error(`${path} contains an invalid deployment namespace.`)
		for (const target of TARGETS) {
			if (
				!generated.targets?.[target]?.bootstrapPulumiPassphrase ||
				!generated.targets?.[target]?.pulumiPassphrase ||
				!generated.targets[target].resticPassword
			)
				throw new Error(`${path} is missing generated ${target} secrets.`)
		}
		return generated
	}
	const generated = generateBootstrapSecrets()
	writeFileSync(path, `${JSON.stringify(generated, null, 2)}\n`, {
		encoding: 'utf8',
		mode: 0o600,
		flag: 'wx'
	})
	chmodSync(path, 0o600)
	return generated
}

export function saveGeneratedSecrets(path: string, generated: GeneratedSecrets): void {
	const temporary = `${path}.${randomBytes(6).toString('hex')}.next`
	writeFileSync(temporary, `${JSON.stringify(generated, null, 2)}\n`, {
		encoding: 'utf8',
		mode: 0o600,
		flag: 'wx'
	})
	chmodSync(temporary, 0o600)
	renameSync(temporary, path)
}

function csv(value: string): string {
	return `"${value.replaceAll('"', '""')}"`
}

export function recoveryCsv(input: BootstrapInput, generated: GeneratedSecrets): string {
	const rows: string[][] = []
	const add = (
		group: string,
		name: string,
		username: string,
		secret: string,
		notes: string,
		url = ''
	) =>
		rows.push([`avenOS/${generated.deploymentPrefix}/${group}`, name, username, secret, url, notes])
	add(
		'bootstrap',
		'avenOS deployment namespace',
		generated.deploymentPrefix,
		'',
		'Prefixes the active GitHub Environments and identifies this infrastructure generation.'
	)
	for (const target of TARGETS) {
		const storage = input.objectStorage.targets[target]
		add(
			target,
			`avenOS ${target} bootstrap Pulumi passphrase`,
			'',
			generated.targets[target].bootstrapPulumiPassphrase,
			`Encrypts the isolated ${target} storage-bootstrap state.`
		)
		add(
			target,
			`avenOS ${target} bootstrap administrator`,
			storage.bootstrapCredential.accessKeyId,
			storage.bootstrapCredential.secretAccessKey,
			`Offline administrator for ${target} project ${storage.projectId}; never add to GitHub.`,
			`https://console.hetzner.com/projects/${storage.projectId}/security/s3-credentials`
		)
		add(
			target,
			`avenOS ${target} Pulumi passphrase`,
			'',
			generated.targets[target].pulumiPassphrase,
			'Encrypts generated infrastructure secrets.'
		)
		add(
			target,
			`avenOS ${target} Restic password`,
			'',
			generated.targets[target].resticPassword,
			'Encrypts database backups; loss makes backups unrecoverable.'
		)
		add(
			target,
			`avenOS ${target} deployment storage`,
			storage.deploymentCredential.accessKeyId,
			storage.deploymentCredential.secretAccessKey,
			'Writes this target state and backup buckets only.',
			`https://console.hetzner.com/projects/${storage.projectId}/security/s3-credentials`
		)
		add(
			target,
			`avenOS ${target} observer storage`,
			storage.observerCredential.accessKeyId,
			storage.observerCredential.secretAccessKey,
			'Reads this target state bucket only.',
			`https://console.hetzner.com/projects/${storage.projectId}/security/s3-credentials`
		)
		add(
			target,
			`avenOS ${target} deployment (Hetzner Cloud token)`,
			'',
			input.providers[target].computeToken,
			'Target-scoped compute API token.',
			`https://console.hetzner.com/projects/${storage.projectId}/security/tokens`
		)
	}
	for (const target of ['next', 'production'] as const) {
		const provider = input.providers[target]
		const webhook = generated.polarWebhooks?.[target]
		if (!webhook) throw new Error(`Polar ${target} webhook has not been provisioned.`)
		add(
			target,
			`avenOS ${target} DNS deployment (Hetzner DNS token)`,
			'',
			provider.dnsToken,
			`Writes the shared aven.ceo DNS zone in Hetzner project ${input.providers.dnsProjectId}.`,
			`https://console.hetzner.com/projects/${input.providers.dnsProjectId}/security/tokens`
		)
		add(
			target,
			`avenOS ${target} billing (Polar API key)`,
			provider.polarOrganizationId,
			provider.polarApiKey,
			`Reconciles products, benefits, meters, and webhooks and serves checkout, subscription, customer, and order operations in the Polar ${target} organization.`,
			target === 'next' ? 'https://sandbox.polar.sh' : 'https://polar.sh'
		)
		add(
			target,
			`avenOS ${target} Polar webhook secret`,
			webhook.id,
			webhook.secret,
			`Verifies every raw Polar webhook delivery sent to ${webhook.url}.`,
			webhook.url
		)
		add(target, `avenOS ${target} SMTP`, '', provider.smtpUrl, 'Send-only checkout mail transport.')
	}
	add(
		'shared',
		'avenOS RedPill API key',
		'',
		input.providers.redpillApiKey,
		'Shared inference credential for next and production.',
		'https://redpill.ai'
	)
	const header = ['Group', 'Title', 'Username', 'Password', 'URL', 'Notes']
	return `${[header, ...rows].map((row) => row.map(csv).join(',')).join('\n')}\n`
}

export function writeRecoveryCsv(path: string, contents: string): void {
	if (existsSync(path))
		throw new Error(`${path} already exists; refusing to overwrite recovery material.`)
	writeFileSync(path, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
	chmodSync(path, 0o600)
}

const backend = (bucket: string, region: string) =>
	`s3://${bucket}/avenos/platform?endpoint=${region}.your-objectstorage.com&region=${region}&s3ForcePathStyle=true&awssdk=v2`

export function objectStorageBucketName(
	input: BootstrapInput,
	generated: GeneratedSecrets,
	target: Target,
	kind: 'state' | 'backup'
): string {
	return `${generated.deploymentPrefix}-${input.objectStorage.targets[target].projectId}-${target}-${kind}`
}

export function githubConfiguration(input: BootstrapInput, generated: GeneratedSecrets) {
	const region = input.objectStorage.region
	const commonVariables = {
		PULUMI_STATE_S3_REGION: region,
		HETZNER_LOCATION: input.defaults.hetznerLocation,
		HETZNER_SERVER_TYPE: input.defaults.hetznerServerType,
		IDENTITY_SERVER_TYPE: input.defaults.hetznerServerType,
		PLATFORM_SERVER_TYPE: input.defaults.hetznerServerType,
		HETZNER_OS_IMAGE: input.defaults.hetznerOsImage,
		IDENTITY_VOLUME_SIZE_GB: String(input.defaults.identityVolumeSizeGb),
		PLATFORM_VOLUME_SIZE_GB: String(input.defaults.platformVolumeSizeGb),
		SSH_ALLOWED_CIDRS: input.defaults.sshAllowedCidrs,
		ACME_EMAIL: input.defaults.acmeEmail,
		BACKUP_S3_REGION: region
	}
	const result: Record<
		string,
		{ secrets: Record<string, string>; variables: Record<string, string> }
	> = {}
	for (const target of TARGETS) {
		const storage = input.objectStorage.targets[target]
		const stateBucket = objectStorageBucketName(input, generated, target, 'state')
		const backupBucket = objectStorageBucketName(input, generated, target, 'backup')
		result[`${generated.deploymentPrefix}-${target}`] = {
			secrets: {
				HETZNER_COMPUTE_TOKEN: input.providers[target].computeToken,
				PULUMI_STATE_S3_ACCESS_KEY_ID: storage.deploymentCredential.accessKeyId,
				PULUMI_STATE_S3_SECRET_ACCESS_KEY: storage.deploymentCredential.secretAccessKey,
				PULUMI_CONFIG_PASSPHRASE: generated.targets[target].pulumiPassphrase,
				BACKUP_S3_ACCESS_KEY_ID: storage.deploymentCredential.accessKeyId,
				BACKUP_S3_SECRET_ACCESS_KEY: storage.deploymentCredential.secretAccessKey,
				BACKUP_RESTIC_PASSWORD: generated.targets[target].resticPassword
			},
			variables: {
				...commonVariables,
				PULUMI_STATE_S3_BUCKET: stateBucket,
				PULUMI_STACK: `${PULUMI_ORGANIZATION}/aven-platform/${target}`,
				BACKUP_REPOSITORY_BASE: `s3:https://${region}.your-objectstorage.com/${backupBucket}`
			}
		}
		result[`${generated.deploymentPrefix}-${target}-operations`] = {
			secrets: {
				PULUMI_STATE_S3_ACCESS_KEY_ID: storage.observerCredential.accessKeyId,
				PULUMI_STATE_S3_SECRET_ACCESS_KEY: storage.observerCredential.secretAccessKey,
				PULUMI_CONFIG_PASSPHRASE: generated.targets[target].pulumiPassphrase
			},
			variables: {
				PULUMI_STATE_S3_BUCKET: stateBucket,
				PULUMI_STATE_S3_REGION: region,
				PULUMI_STACK: `${PULUMI_ORGANIZATION}/aven-platform/${target}`
			}
		}
	}
	const identity = result[`${generated.deploymentPrefix}-identity`]
	const next = result[`${generated.deploymentPrefix}-next`]
	const production = result[`${generated.deploymentPrefix}-production`]
	Object.assign(identity.secrets, {
		NEXT_STATE_S3_ACCESS_KEY_ID: input.objectStorage.targets.next.observerCredential.accessKeyId,
		NEXT_STATE_S3_SECRET_ACCESS_KEY:
			input.objectStorage.targets.next.observerCredential.secretAccessKey,
		NEXT_PULUMI_CONFIG_PASSPHRASE: generated.targets.next.pulumiPassphrase,
		PRODUCTION_STATE_S3_ACCESS_KEY_ID:
			input.objectStorage.targets.production.observerCredential.accessKeyId,
		PRODUCTION_STATE_S3_SECRET_ACCESS_KEY:
			input.objectStorage.targets.production.observerCredential.secretAccessKey,
		PRODUCTION_PULUMI_CONFIG_PASSPHRASE: generated.targets.production.pulumiPassphrase
	})
	Object.assign(identity.variables, {
		NEXT_PULUMI_STACK: `${PULUMI_ORGANIZATION}/aven-platform/next`,
		NEXT_PULUMI_BACKEND: backend(
			objectStorageBucketName(input, generated, 'next', 'state'),
			region
		),
		PRODUCTION_PULUMI_STACK: `${PULUMI_ORGANIZATION}/aven-platform/production`,
		PRODUCTION_PULUMI_BACKEND: backend(
			objectStorageBucketName(input, generated, 'production', 'state'),
			region
		)
	})
	for (const target of ['next', 'production'] as const) {
		const provider = input.providers[target]
		const environment = target === 'next' ? next : production
		const webhookSecret = generated.polarWebhooks?.[target]?.secret
		if (!webhookSecret) throw new Error(`Polar ${target} webhook has not been provisioned.`)
		Object.assign(environment.secrets, {
			HETZNER_DNS_TOKEN: provider.dnsToken,
			POLAR_API_KEY: provider.polarApiKey,
			POLAR_WEBHOOK_SECRET: webhookSecret,
			SMTP_URL: provider.smtpUrl,
			LLM_GATEWAY_CREDENTIALS_JSON: JSON.stringify({ redpill: input.providers.redpillApiKey })
		})
		Object.assign(environment.variables, {
			POLAR_SERVER: target === 'next' ? 'sandbox' : 'production',
			POLAR_ORGANIZATION_ID: provider.polarOrganizationId,
			SMTP_FROM: provider.smtpFrom,
			SMTP_REPLY_TO: provider.smtpReplyTo ?? '',
			DOWNLOAD_URL: input.defaults.downloadUrl,
			ANDROID_APP_CERT_SHA256_FINGERPRINTS:
				target === 'production'
					? (input.providers.production.androidAppCertSha256Fingerprints ?? '')
					: '',
			LLM_GATEWAY_TIMEOUT_SECONDS: '180'
		})
	}
	return result
}

export function githubEnvironmentProtection(protectedDeployment: boolean, reviewerId?: number) {
	const requiresReview = protectedDeployment && reviewerId !== undefined
	return {
		wait_timer: 0,
		prevent_self_review: requiresReview,
		reviewers: requiresReview ? [{ type: 'User', id: reviewerId }] : [],
		deployment_branch_policy: { protected_branches: true, custom_branch_policies: false }
	}
}
