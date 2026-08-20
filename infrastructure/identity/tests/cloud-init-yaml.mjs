import assert from 'node:assert/strict'
import { renderCloudInit } from '../src/cloud-init.mjs'

const cloudInit = renderCloudInit({
	deployUser: 'aven-deploy',
	sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest deploy',
	sshAllowedCidrs: ['192.0.2.4/32', '2001:db8::4/128'],
	volumeDevice: '/dev/disk/by-id/scsi-0HC_Volume_123'
})

const parsed = Bun.YAML.parse(cloudInit)
assert.equal(parsed.users[1].name, 'aven-deploy')
assert.equal(parsed.ssh_pwauth, false)
assert.ok(parsed.packages.includes('docker-compose-v2'))
assert.ok(parsed.runcmd.includes('/usr/local/sbin/aven-mount-data-volume'))
assert.ok(Buffer.byteLength(cloudInit) < 32 * 1024)
