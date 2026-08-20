import * as hcloud from '@pulumi/hcloud'
import * as pulumi from '@pulumi/pulumi'
import { renderCloudInit } from './cloud-init.mjs'
import { loadIdentityConfig, requireProviderToken } from './config.mjs'
import { identityRecordSpecs } from './dns.mjs'

const config = loadIdentityConfig()
const protect = { protect: true }
const labels = {
	application: 'aven-identity',
	deployment: config.deploymentId,
	environment: 'next'
}

const computeProvider = new hcloud.Provider('identity-compute-provider', {
	token: pulumi.secret(requireProviderToken(process.env, 'HETZNER_COMPUTE_TOKEN'))
})
const dnsProvider = new hcloud.Provider('identity-dns-provider', {
	token: pulumi.secret(requireProviderToken(process.env, 'HETZNER_DNS_TOKEN'))
})

const selectedServerType = hcloud
	.getServerTypeOutput({ name: config.serverType }, { provider: computeProvider })
	.apply((serverType) => {
		if (serverType.architecture !== 'x86') {
			throw new Error(`${config.serverType} is not an amd64-compatible Hetzner server type`)
		}
		return serverType.name ?? config.serverType
	})

const sshKey = new hcloud.SshKey(
	'identity-deploy-key',
	{
		name: `${config.deploymentId}-deploy`,
		publicKey: config.sshPublicKey,
		labels
	},
	{ ...protect, provider: computeProvider }
)

const firewall = new hcloud.Firewall(
	'identity-firewall',
	{
		name: `${config.deploymentId}-firewall`,
		labels,
		rules: [
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
	},
	{ ...protect, provider: computeProvider }
)

const dataVolume = new hcloud.Volume(
	'identity-data',
	{
		name: `${config.deploymentId}-data`,
		location: config.location,
		size: config.volumeSize,
		format: 'ext4',
		deleteProtection: true,
		labels
	},
	{ ...protect, provider: computeProvider }
)

const cloudInit = dataVolume.linuxDevice.apply((volumeDevice) =>
	renderCloudInit({
		deployUser: config.deployUser,
		sshPublicKey: config.sshPublicKey,
		sshAllowedCidrs: config.sshAllowedCidrs,
		volumeDevice
	})
)

const server = new hcloud.Server(
	'identity-server',
	{
		name: `${config.deploymentId}-server`,
		location: config.location,
		serverType: selectedServerType,
		image: config.osImage,
		backups: config.enableBackups,
		deleteProtection: true,
		rebuildProtection: true,
		keepDisk: true,
		firewallIds: [firewall.id.apply(Number)],
		sshKeys: [sshKey.id],
		publicNets: [{ ipv4Enabled: true, ipv6Enabled: true }],
		userData: cloudInit,
		labels
	},
	{ ...protect, provider: computeProvider }
)

const attachment = new hcloud.VolumeAttachment(
	'identity-data-attachment',
	{
		serverId: server.id.apply(Number),
		volumeId: dataVolume.id.apply(Number),
		automount: false
	},
	{ ...protect, provider: computeProvider, dependsOn: [server, dataVolume] }
)

const dnsRecords = identityRecordSpecs({
	zone: config.dnsZone,
	hostname: config.identityHostname,
	ttl: 300,
	ipv4: server.ipv4Address,
	ipv6: server.ipv6Address
}).map(
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
			{ ...protect, provider: dnsProvider, dependsOn: [server] }
		)
)

export const deploymentId = config.deploymentId
export const deployUser = config.deployUser
export const identityHostname = config.identityHostname
export const publicBaseUrl = `https://${config.identityHostname}`
export const ipv4Address = server.ipv4Address
export const ipv6Address = server.ipv6Address
export const serverId = server.id
export const firewallId = firewall.id
export const dataVolumeId = dataVolume.id
export const volumeAttachmentId = attachment.id
export const sshKeyFingerprint = sshKey.fingerprint
export const dnsRecordIds = dnsRecords.map((record) => record.id)
