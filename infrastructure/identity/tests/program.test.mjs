import assert from 'node:assert/strict'
import test from 'node:test'
import * as pulumi from '@pulumi/pulumi'

const resources = []

pulumi.runtime.setMocks(
	{
		newResource(args) {
			resources.push({ type: args.type, name: args.name, inputs: args.inputs })
			const state = { ...args.inputs }
			if (args.type === 'hcloud:index/server:Server') {
				state.ipv4Address = '192.0.2.10'
				state.ipv6Address = '2001:db8::10'
			}
			if (args.type === 'hcloud:index/volume:Volume') {
				state.linuxDevice = '/dev/disk/by-id/scsi-0HC_Volume_123'
			}
			if (args.type === 'hcloud:index/sshKey:SshKey') state.fingerprint = 'mock-fingerprint'
			return { id: `${args.name}-id`, state }
		},
		call(args) {
			if (args.token === 'hcloud:index/getServerType:getServerType') {
				return {
					...args.inputs,
					architecture: 'x86',
					locations: [{ name: 'nbg1', available: true, isDeprecated: false }]
				}
			}
			return args.inputs
		}
	},
	'aven-identity',
	'next',
	false
)

Object.assign(process.env, {
	HETZNER_LOCATION: 'nbg1',
	HETZNER_SERVER_TYPE: 'cx23',
	HETZNER_SERVER_ARCHITECTURE: 'amd64',
	HETZNER_OS_IMAGE: 'ubuntu-24.04',
	HETZNER_VOLUME_SIZE_GB: '40',
	HETZNER_ENABLE_BACKUPS: 'true',
	SSH_ALLOWED_CIDRS: '192.0.2.4/32',
	DEPLOY_SSH_PUBLIC_KEY: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest deploy',
	HETZNER_COMPUTE_TOKEN: 'compute-token-for-tests-only',
	HETZNER_DNS_TOKEN: 'dns-token-for-tests-only-000'
})

const program = await import('../src/index.mjs')
await Promise.all([
	program.ipv4Address.promise(),
	program.volumeAttachmentId.promise(),
	...program.dnsRecordIds.map((output) => output.promise())
])

test('registers the bounded identity foundation and public outputs', async () => {
	assert.deepEqual(
		resources
			.filter(({ type }) => type.startsWith('hcloud:'))
			.map(({ type, name }) => ({ type, name })),
		[
			{ type: 'hcloud:index/sshKey:SshKey', name: 'identity-deploy-key' },
			{ type: 'hcloud:index/firewall:Firewall', name: 'identity-firewall' },
			{ type: 'hcloud:index/volume:Volume', name: 'identity-data' },
			{ type: 'hcloud:index/server:Server', name: 'identity-server' },
			{
				type: 'hcloud:index/volumeAttachment:VolumeAttachment',
				name: 'identity-data-attachment'
			},
			{ type: 'hcloud:index/zoneRrset:ZoneRrset', name: 'identity-a' },
			{ type: 'hcloud:index/zoneRrset:ZoneRrset', name: 'identity-aaaa' }
		]
	)
	assert.deepEqual(
		resources.filter(({ type }) => type === 'pulumi:providers:hcloud').map(({ name }) => name),
		['identity-compute-provider', 'identity-dns-provider']
	)
	assert.equal(program.deployUser, 'aven-deploy')
	assert.equal(program.identityHostname, 'id.next.aven.ceo')
	assert.equal(program.publicBaseUrl, 'https://id.next.aven.ceo')
	assert.equal(await program.ipv4Address.promise(), '192.0.2.10')
})

test('does not put application credentials in cloud-init', () => {
	const server = resources.find(({ name }) => name === 'identity-server')
	assert.ok(server)
	const serializedInputs = JSON.stringify(server.inputs)
	assert.doesNotMatch(serializedInputs, /BETTER_AUTH|POSTGRES_PASSWORD|SMTP_URL|CREEM_API_KEY/)
})
