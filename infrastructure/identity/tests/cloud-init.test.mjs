import assert from 'node:assert/strict'
import test from 'node:test'
import { renderCloudInit } from '../src/cloud-init.mjs'

test('cloud-init mounts persistent state and configures the deployment account', () => {
	const cloudInit = renderCloudInit({
		deployUser: 'aven-deploy',
		sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest deploy',
		sshAllowedCidrs: ['192.0.2.4/32'],
		volumeDevice: '/dev/disk/by-id/scsi-0HC_Volume_123'
	})
	assert.match(cloudInit, /AllowUsers aven-deploy/)
	assert.match(cloudInit, /PasswordAuthentication no/)
	assert.match(cloudInit, /ufw allow 443\/udp/)
	assert.match(cloudInit, /\/var\/lib\/aven\/postgres/)
	assert.match(cloudInit, /\/var\/lib\/aven\/caddy\/data/)
	assert.match(cloudInit, /\/var\/lib\/aven\/cloud-init-complete/)
	assert.doesNotMatch(cloudInit, /TOKEN|PASSWORD|SECRET=/)
})
