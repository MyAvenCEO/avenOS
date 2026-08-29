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
				state.ipv4Address = args.name === 'identity-server' ? '192.0.2.10' : '192.0.2.20'
				state.ipv6Address = args.name === 'identity-server' ? '2001:db8::10' : '2001:db8::20'
			}
			if (args.type === 'hcloud:index/volume:Volume')
				state.linuxDevice = `/dev/disk/by-id/${args.name}`
			if (args.type === 'tls:index/privateKey:PrivateKey') {
				state.privateKeyOpenssh =
					'-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n'
				state.publicKeyOpenssh = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHost ${args.name}`
				state.privateKeyPem = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n'
				state.publicKeyPem = '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n'
			}
			if (args.type === 'random:index/randomPassword:RandomPassword') state.result = 'r'.repeat(64)
			if (args.type === 'random:index/randomBytes:RandomBytes')
				state.base64 = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='
			return { id: `${args.name}-id`, state }
		},
		call(args) {
			if (args.token === 'hcloud:index/getServerType:getServerType')
				return { ...args.inputs, architecture: 'x86', name: args.inputs.name }
			return args.inputs
		}
	},
	'aven-platform',
	'next',
	false
)

Object.assign(process.env, {
	HETZNER_LOCATION: 'nbg1',
	HETZNER_SERVER_TYPE: 'cx23',
	HETZNER_SERVER_ARCHITECTURE: 'amd64',
	HETZNER_OS_IMAGE: 'ubuntu-24.04',
	HETZNER_ENABLE_BACKUPS: 'true',
	SSH_ALLOWED_CIDRS: '192.0.2.4/32',
	HETZNER_COMPUTE_TOKEN: 'compute-token-for-tests-only',
	HETZNER_DNS_TOKEN: 'dns-token-for-tests-only-000',
	MANAGE_AVEN_CEO_APEX_DNS: 'false'
})

const program = await import('../src/index.mjs')
await Promise.all([
	program.identityIpv4Address.promise(),
	program.platformIpv4Address.promise(),
	program.identityDnsRecords.promise(),
	...program.dnsRecordIds.map((output) => output.promise())
])

test('creates exactly two protected server foundations', () => {
	assert.deepEqual(
		resources
			.filter(({ type }) => type === 'hcloud:index/server:Server')
			.map(({ name }) => name)
			.sort(),
		['identity-server', 'platform-server']
	)
	assert.equal(resources.filter(({ type }) => type === 'hcloud:index/firewall:Firewall').length, 2)
	assert.equal(resources.filter(({ type }) => type === 'hcloud:index/volume:Volume').length, 2)
	assert.equal(resources.filter(({ type }) => type === 'tls:index/privateKey:PrivateKey').length, 9)
	assert.equal(resources.filter(({ type }) => type === 'hcloud:index/sshKey:SshKey').length, 2)
	assert.equal(
		resources.filter(({ type }) => type === 'hcloud:index/zoneRrset:ZoneRrset').length,
		4
	)
	assert.equal(program.apexDnsManaged, false)
})

test('returns exact aven.id records for the external DNS provider', async () => {
	assert.deepEqual(await program.identityDnsRecords.promise(), [
		{ hostname: 'aven.id', name: '@', type: 'A', value: '192.0.2.10', ttl: 300 },
		{ hostname: 'aven.id', name: '@', type: 'AAAA', value: '2001:db8::10', ttl: 300 }
	])
})

test('keeps identity and platform bootstrap roots isolated', () => {
	const identity = resources.find(({ name }) => name === 'identity-server')
	const platform = resources.find(({ name }) => name === 'platform-server')
	const identityUserData = identity.inputs.userData.value ?? identity.inputs.userData
	const platformUserData = platform.inputs.userData.value ?? platform.inputs.userData
	assert.match(identityUserData, /\/opt\/aven\/identity/)
	assert.doesNotMatch(identityUserData, /\/opt\/aven\/platform/)
	assert.match(platformUserData, /\/opt\/aven\/platform/)
	assert.doesNotMatch(platformUserData, /\/opt\/aven\/identity/)
	assert.doesNotMatch(
		JSON.stringify([identity.inputs, platform.inputs]),
		/BETTER_AUTH|POSTGRES_PASSWORD|POLAR_API_KEY|SMTP_URL/
	)
})
