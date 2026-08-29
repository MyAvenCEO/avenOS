import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPlatformConfig, parseSshCidrs } from '../src/config.mjs'

const base = {
	HETZNER_LOCATION: 'nbg1',
	HETZNER_SERVER_TYPE: 'cx23',
	HETZNER_SERVER_ARCHITECTURE: 'amd64',
	HETZNER_OS_IMAGE: 'ubuntu-24.04',
	SSH_ALLOWED_CIDRS: '192.0.2.4/32'
}

test('defines two independent fresh hosts and explicit apex management', () => {
	const config = loadPlatformConfig(base)
	assert.equal(config.identityHostname, 'aven.id')
	assert.deepEqual(config.platformHostnames, {
		apex: 'aven.ceo',
		api: 'api.aven.ceo',
		checkout: 'my.aven.ceo'
	})
	assert.equal(config.identityVolumeSize, 40)
	assert.equal(config.platformVolumeSize, 80)
	assert.equal(config.manageApexDns, false)
})

test('treats absent GitHub optional variables as defaults', () => {
	const config = loadPlatformConfig({
		...base,
		IDENTITY_VOLUME_SIZE_GB: '',
		PLATFORM_VOLUME_SIZE_GB: ''
	})
	assert.equal(config.identityVolumeSize, 40)
	assert.equal(config.platformVolumeSize, 80)
})

test('validates exact SSH CIDRs', () => {
	assert.deepEqual(parseSshCidrs('192.0.2.1/32,2001:db8::1/128'), [
		'192.0.2.1/32',
		'2001:db8::1/128'
	])
	assert.throws(() => parseSshCidrs('192.0.2.1/33'))
})
