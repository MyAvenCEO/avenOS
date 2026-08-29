import * as hcloud from '@pulumi/hcloud'
import * as pulumi from '@pulumi/pulumi'
import * as random from '@pulumi/random'
import * as tls from '@pulumi/tls'
import { renderCloudInit } from './cloud-init.mjs'
import { loadPlatformConfig, requireProviderToken } from './config.mjs'
import { manualIdentityRecordSpecs, platformRecordSpecs } from './dns.mjs'

const config = loadPlatformConfig()
const protect = { protect: true }

const computeProvider = new hcloud.Provider('platform-compute-provider', {
	token: pulumi.secret(requireProviderToken(process.env, 'HETZNER_COMPUTE_TOKEN'))
})
const dnsProvider = new hcloud.Provider('platform-dns-provider', {
	token: pulumi.secret(requireProviderToken(process.env, 'HETZNER_DNS_TOKEN'))
})

const selectedServerType = (name) =>
	hcloud.getServerTypeOutput({ name }, { provider: computeProvider }).apply((serverType) => {
		if (serverType.architecture !== 'x86')
			throw new Error(`${name} is not an amd64-compatible Hetzner server type`)
		return serverType.name ?? name
	})

const firewallRules = [
	{
		direction: 'in',
		protocol: 'tcp',
		port: '80',
		sourceIps: ['0.0.0.0/0', '::/0'],
		description: 'HTTP ACME and redirect'
	},
	{
		direction: 'in',
		protocol: 'tcp',
		port: '443',
		sourceIps: ['0.0.0.0/0', '::/0'],
		description: 'HTTPS ingress'
	},
	{
		direction: 'in',
		protocol: 'udp',
		port: '443',
		sourceIps: ['0.0.0.0/0', '::/0'],
		description: 'HTTP/3 ingress'
	},
	{
		direction: 'in',
		protocol: 'tcp',
		port: '22',
		sourceIps: config.sshAllowedCidrs,
		description: 'Deployment SSH'
	},
	{
		direction: 'in',
		protocol: 'icmp',
		sourceIps: ['0.0.0.0/0', '::/0'],
		description: 'Diagnostics'
	}
]

function createHost({ resource, deploymentId, appRoot, serverType, volumeSize }) {
	const labels = {
		application: resource,
		deployment: deploymentId,
		environment: config.environment
	}
	const hostKey = new tls.PrivateKey(`${resource}-host-key`, { algorithm: 'ED25519' }, protect)
	const deployKey = new tls.PrivateKey(`${resource}-deploy-key`, { algorithm: 'ED25519' }, protect)
	const observeKey = new tls.PrivateKey(
		`${resource}-observe-key`,
		{ algorithm: 'ED25519' },
		protect
	)
	const tunnelKey = new tls.PrivateKey(`${resource}-tunnel-key`, { algorithm: 'ED25519' }, protect)
	const registeredDeployKey = new hcloud.SshKey(
		`${resource}-deploy-key-registration`,
		{
			name: `${deploymentId}-deploy`,
			publicKey: deployKey.publicKeyOpenssh,
			labels
		},
		{ ...protect, provider: computeProvider }
	)
	const firewall = new hcloud.Firewall(
		`${resource}-firewall`,
		{ name: `${deploymentId}-firewall`, labels, rules: firewallRules },
		{ ...protect, provider: computeProvider }
	)
	const volume = new hcloud.Volume(
		`${resource}-data`,
		{
			name: `${deploymentId}-data`,
			location: config.location,
			size: volumeSize,
			format: 'ext4',
			deleteProtection: true,
			labels
		},
		{ ...protect, provider: computeProvider }
	)
	const cloudInit = pulumi
		.all([
			volume.linuxDevice,
			hostKey.privateKeyOpenssh,
			hostKey.publicKeyOpenssh,
			deployKey.publicKeyOpenssh,
			observeKey.publicKeyOpenssh,
			tunnelKey.publicKeyOpenssh
		])
		.apply(
			([
				volumeDevice,
				sshHostPrivateKey,
				sshHostPublicKey,
				deployPublicKey,
				observePublicKey,
				tunnelPublicKey
			]) =>
				renderCloudInit({
					deployUser: config.deployUser,
					deployPublicKey,
					observePublicKey,
					tunnelPublicKey,
					sshAllowedCidrs: config.sshAllowedCidrs,
					volumeDevice,
					appRoot,
					sshHostPrivateKey,
					sshHostPublicKey
				})
		)
	const server = new hcloud.Server(
		`${resource}-server`,
		{
			name: `${deploymentId}-server`,
			location: config.location,
			serverType: selectedServerType(serverType),
			image: config.osImage,
			backups: config.enableBackups,
			deleteProtection: true,
			rebuildProtection: true,
			keepDisk: true,
			firewallIds: [firewall.id.apply(Number)],
			sshKeys: [registeredDeployKey.id],
			publicNets: [{ ipv4Enabled: true, ipv6Enabled: true }],
			userData: pulumi.secret(cloudInit),
			labels
		},
		{ ...protect, provider: computeProvider }
	)
	const attachment = new hcloud.VolumeAttachment(
		`${resource}-data-attachment`,
		{ serverId: server.id.apply(Number), volumeId: volume.id.apply(Number), automount: false },
		{ ...protect, provider: computeProvider, dependsOn: [server, volume] }
	)
	return { server, firewall, volume, attachment, hostKey, deployKey, observeKey, tunnelKey }
}

const identity = createHost({
	resource: 'identity',
	deploymentId: config.identityDeploymentId,
	appRoot: '/opt/aven/identity',
	serverType: config.identityServerType,
	volumeSize: config.identityVolumeSize
})
const platform = createHost({
	resource: 'platform',
	deploymentId: config.platformDeploymentId,
	appRoot: '/opt/aven/platform',
	serverType: config.platformServerType,
	volumeSize: config.platformVolumeSize
})

const createDnsRecords = (records, dependsOn) =>
	records.map(
		(record) =>
			new hcloud.ZoneRrset(
				record.resourceName,
				{
					zone: record.zone,
					name: record.name,
					type: record.type,
					ttl: record.ttl,
					changeProtection: true,
					records: [{ value: record.value }]
				},
				{ ...protect, provider: dnsProvider, dependsOn }
			)
	)

const platformDns = createDnsRecords(
	platformRecordSpecs({
		zone: config.platformDnsZone,
		hostnames: config.platformHostnames,
		ipv4: platform.server.ipv4Address,
		ipv6: platform.server.ipv6Address,
		includeApex: config.manageApexDns
	}),
	[platform.server]
)

const password = (name, length = 48) =>
	new random.RandomPassword(name, { length, special: false }, protect).result

export const deployUser = config.deployUser
export const identityHostname = config.identityHostname
export const platformApexHostname = config.platformHostnames.apex
export const platformApiHostname = config.platformHostnames.api
export const platformCheckoutHostname = config.platformHostnames.checkout
export const apexDnsManaged = config.manageApexDns
export const identityIpv4Address = identity.server.ipv4Address
export const identityIpv6Address = identity.server.ipv6Address
export const identityDnsRecords = pulumi
	.all([identity.server.ipv4Address, identity.server.ipv6Address])
	.apply(([ipv4, ipv6]) =>
		manualIdentityRecordSpecs({ hostname: config.identityHostname, ipv4, ipv6 })
	)
export const platformIpv4Address = platform.server.ipv4Address
export const platformIpv6Address = platform.server.ipv6Address
export const identityHostPublicKey = identity.hostKey.publicKeyOpenssh
export const platformHostPublicKey = platform.hostKey.publicKeyOpenssh
export const identityDeployPrivateKey = pulumi.secret(identity.deployKey.privateKeyOpenssh)
export const identityObservePrivateKey = pulumi.secret(identity.observeKey.privateKeyOpenssh)
export const identityTunnelPrivateKey = pulumi.secret(identity.tunnelKey.privateKeyOpenssh)
export const platformDeployPrivateKey = pulumi.secret(platform.deployKey.privateKeyOpenssh)
export const platformObservePrivateKey = pulumi.secret(platform.observeKey.privateKeyOpenssh)
export const platformTunnelPrivateKey = pulumi.secret(platform.tunnelKey.privateKeyOpenssh)
export const identityPostgresPassword = pulumi.secret(password('identity-postgres-password'))
export const identityAuthPassword = pulumi.secret(password('identity-auth-password'))
export const identityAccountsPassword = pulumi.secret(password('identity-accounts-password'))
export const identityAuthorizationPassword = pulumi.secret(
	password('identity-authorization-password')
)
export const identityMigratorPassword = pulumi.secret(password('identity-migrator-password'))
export const identityBetterAuthSecret = pulumi.secret(password('identity-better-auth-secret', 64))
export const identityProvisioningSecret = pulumi.secret(
	password('identity-provisioning-secret', 64)
)
export const platformPostgresPassword = pulumi.secret(password('platform-postgres-password'))
export const checkoutRuntimePassword = pulumi.secret(password('checkout-runtime-password'))
export const checkoutWebhookPassword = pulumi.secret(password('checkout-webhook-password'))
export const checkoutMigratorPassword = pulumi.secret(password('checkout-migrator-password'))
export const checkoutEmailPassword = pulumi.secret(password('checkout-email-password'))
export const checkoutPlatformEventsPassword = pulumi.secret(
	password('checkout-platform-events-password')
)
export const apiHostingPassword = pulumi.secret(password('api-hosting-password'))
export const apiAuthorizationPassword = pulumi.secret(password('api-authorization-password'))
export const apiEntitlementsPassword = pulumi.secret(password('api-entitlements-password'))
export const apiReconcilerPassword = pulumi.secret(password('api-reconciler-password'))
export const apiMigratorPassword = pulumi.secret(password('api-migrator-password'))
export const customerProvisionerPassword = pulumi.secret(password('customer-provisioner-password'))
export const artifactStoreProvisionerDbPassword = pulumi.secret(
	password('artifact-store-provisioner-db-password')
)
export const intentDatabaseCredentialRoot = pulumi.secret(
	password('intent-database-credential-root', 64)
)
export const artifactApiDatabaseCredentialRoot = pulumi.secret(
	password('artifact-api-database-credential-root', 64)
)
export const actorApiDatabaseCredentialRoot = pulumi.secret(
	password('actor-api-database-credential-root', 64)
)
export const actorWorkerDatabaseCredentialRoot = pulumi.secret(
	password('actor-worker-database-credential-root', 64)
)
export const customerEntitlementToken = pulumi.secret(password('customer-entitlement-token', 64))
export const intentServiceToken = pulumi.secret(password('intent-service-token', 64))
export const actorRunnerServiceToken = pulumi.secret(password('actor-runner-service-token', 64))
export const artifactStoreServiceToken = pulumi.secret(password('artifact-store-service-token', 64))
export const artifactStoreProvisionerToken = pulumi.secret(
	password('artifact-store-provisioner-token', 64)
)
const tenantGrantKey = new tls.PrivateKey(
	'tenant-grant-signing-key',
	{ algorithm: 'ED25519' },
	protect
)
export const tenantGrantPrivateKey = pulumi.secret(tenantGrantKey.privateKeyPem)
export const tenantGrantPublicKey = tenantGrantKey.publicKeyPem
export const siteHostDirectoryToken = pulumi.secret(password('site-host-directory-token', 64))
export const checkoutFacadeToken = pulumi.secret(password('checkout-facade-token', 64))
export const checkoutEmailEncryptionKey = pulumi.secret(
	new random.RandomBytes('checkout-email-encryption-key', { length: 32 }, protect).base64
)
export const dnsRecordIds = platformDns.map((record) => record.id)
