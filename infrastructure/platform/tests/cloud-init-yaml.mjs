import { parse } from 'yaml'
import { renderCloudInit } from '../src/cloud-init.mjs'

const parsed = parse(
	renderCloudInit({
		deployUser: 'aven-deploy',
		deployPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeploy deploy',
		observePublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIObserve observe',
		tunnelPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITunnel tunnel',
		sshAllowedCidrs: ['192.0.2.4/32'],
		volumeDevice: '/dev/disk/by-id/scsi-0HC_Volume_123',
		appRoot: '/opt/aven/identity',
		sshHostPrivateKey:
			'-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n',
		sshHostPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHost test\n'
	})
)
if (!Array.isArray(parsed.runcmd) || !Array.isArray(parsed.write_files))
	throw new Error('cloud-init did not parse into the expected structure')
