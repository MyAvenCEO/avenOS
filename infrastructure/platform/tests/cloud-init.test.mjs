import assert from 'node:assert/strict'
import test from 'node:test'
import { renderCloudInit } from '../src/cloud-init.mjs'

const hostPrivate = '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n'
const hostPublic = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHost test\n'

function render(appRoot) {
	return renderCloudInit({
		deployUser: 'aven-deploy',
		deployPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeploy deploy',
		observePublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIObserve observe',
		tunnelPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITunnel tunnel',
		sshAllowedCidrs: ['192.0.2.4/32'],
		volumeDevice: '/dev/disk/by-id/scsi-0HC_Volume_123',
		appRoot,
		sshHostPrivateKey: hostPrivate,
		sshHostPublicKey: hostPublic
	})
}

test('identity and platform cloud-init use different deployment roots', () => {
	const identity = render('/opt/aven/identity')
	const platform = render('/opt/aven/platform')
	assert.match(identity, /\/opt\/aven\/identity/)
	assert.doesNotMatch(identity, /\/opt\/aven\/platform/)
	assert.match(platform, /\/opt\/aven\/platform/)
	assert.doesNotMatch(platform, /\/opt\/aven\/identity/)
})

test('pins a Pulumi-managed SSH host key and contains no application secret', () => {
	const cloudInit = render('/opt/aven/identity')
	assert.match(cloudInit, /HostKey \/etc\/ssh\/ssh_host_ed25519_key/)
	assert.match(cloudInit, /PasswordAuthentication no/)
	assert.doesNotMatch(cloudInit, /BETTER_AUTH|POSTGRES_PASSWORD|POLAR_API_KEY|SMTP_URL/)
})

test('creates least-privilege persistent and deployment directories', () => {
	const cloudInit = render('/opt/aven/platform')
	assert.match(cloudInit, /install -d -o 70 -g 70 -m 0700 \/var\/lib\/aven\/postgres/)
	assert.match(cloudInit, /install -d -o 10003 -g 10003 -m 0750 \/var\/lib\/aven\/static-sites/)
	assert.match(cloudInit, /install -d -o aven-deploy -g aven-deploy -m 0750 \/opt\/aven\/platform/)
})

test('creates separate deploy, observe, and database tunnel accounts without broad sudo', () => {
	const cloudInit = render('/opt/aven/platform')
	assert.match(cloudInit, /name: aven-observe/)
	assert.match(cloudInit, /name: aven-tunnel/)
	assert.match(cloudInit, /PermitOpen 127\.0\.0\.1:5432/)
	assert.match(cloudInit, /\/usr\/local\/sbin\/aven-deploy platform/)
	assert.doesNotMatch(cloudInit, /NOPASSWD:ALL|groups: \[sudo\]|usermod -aG docker/)
})
