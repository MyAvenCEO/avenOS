import assert from 'node:assert/strict'
import test from 'node:test'
import { loadIdentityConfig, parseSshCidrs } from '../src/config.mjs'

const base = {
	HETZNER_LOCATION: 'nbg1',
	HETZNER_SERVER_TYPE: 'cx23',
	HETZNER_SERVER_ARCHITECTURE: 'amd64',
	HETZNER_OS_IMAGE: 'ubuntu-24.04',
	HETZNER_VOLUME_SIZE_GB: '40',
	HETZNER_ENABLE_BACKUPS: 'true',
	SSH_ALLOWED_CIDRS: '192.0.2.4/32,2001:db8::4/128',
	DEPLOY_SSH_PUBLIC_KEY: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest deploy'
}

test('loads the fixed next identity contract', () => {
	const config = loadIdentityConfig(base)
	assert.equal(config.identityHostname, 'id.next.aven.ceo')
	assert.equal(config.deployUser, 'aven-deploy')
	assert.equal(config.architecture, 'amd64')
	assert.deepEqual(config.sshAllowedCidrs, ['192.0.2.4/32', '2001:db8::4/128'])
})

test('rejects unsafe or unsupported infrastructure settings', () => {
	assert.throws(() => loadIdentityConfig({ ...base, HETZNER_VOLUME_SIZE_GB: '29' }), /at least 30/)
	assert.throws(
		() => loadIdentityConfig({ ...base, HETZNER_SERVER_ARCHITECTURE: 'arm64' }),
		/requires amd64/
	)
	assert.throws(() => loadIdentityConfig({ ...base, SSH_ALLOWED_CIDRS: '0.0.0.0/0' }), /exactly/)
	assert.throws(() => parseSshCidrs('not-an-ip/32'), /invalid SSH CIDR/)
	assert.throws(
		() =>
			loadIdentityConfig({
				...base,
				DEPLOY_SSH_PUBLIC_KEY: `${base.DEPLOY_SSH_PUBLIC_KEY}\npackages: []`
			}),
		/not an OpenSSH public key/
	)
})
