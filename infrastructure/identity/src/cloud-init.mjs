import { isOpenSshPublicKey } from './config.mjs'

function indent(value, spaces) {
	const prefix = ' '.repeat(spaces)
	return value
		.split('\n')
		.map((line) => `${prefix}${line}`)
		.join('\n')
}

export function renderCloudInit({ deployUser, sshPublicKey, sshAllowedCidrs, volumeDevice }) {
	if (!/^[a-z][a-z0-9-]{0,30}$/.test(deployUser)) throw new Error('invalid deploy user')
	if (!isOpenSshPublicKey(sshPublicKey)) throw new Error('invalid SSH public key')
	if (!/^\/dev\/[A-Za-z0-9_./-]+$/.test(volumeDevice) || volumeDevice.includes('..'))
		throw new Error('volume device must be a safe path below /dev')
	const firewallCommands = sshAllowedCidrs
		.map((cidr) => `  - ufw allow from ${cidr} to any port 22 proto tcp`)
		.join('\n')
	const mountScript = `#!/bin/sh
set -eu
device=${volumeDevice}
for attempt in $(seq 1 180); do
  [ -b "$device" ] && break
  sleep 2
done
[ -b "$device" ] || { echo "attached volume did not appear" >&2; exit 1; }
if ! blkid "$device" >/dev/null 2>&1; then
  mkfs.ext4 -F "$device"
fi
mkdir -p /var/lib/aven
uuid=$(blkid -s UUID -o value "$device")
grep -q "UUID=$uuid " /etc/fstab || printf 'UUID=%s /var/lib/aven ext4 defaults,nofail 0 2\\n' "$uuid" >> /etc/fstab
mountpoint -q /var/lib/aven || mount /var/lib/aven
install -d -m 0700 /var/lib/aven/postgres
install -d -m 0750 /var/lib/aven/caddy/data /var/lib/aven/caddy/config
install -d -m 0700 /var/lib/aven/backups /var/lib/aven/pulumi-state
`

	return `#cloud-config
users:
  - default
  - name: ${deployUser}
    groups: [sudo]
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    lock_passwd: true
    ssh_authorized_keys:
      - ${sshPublicKey}
ssh_pwauth: false
package_update: true
package_upgrade: true
packages:
  - ca-certificates
  - curl
  - docker.io
  - docker-compose-v2
  - fail2ban
  - unattended-upgrades
write_files:
  - path: /etc/ssh/sshd_config.d/99-aven-hardening.conf
    owner: root:root
    permissions: "0644"
    content: |
      AuthenticationMethods publickey
      PubkeyAuthentication yes
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitEmptyPasswords no
      PermitRootLogin no
      AllowUsers ${deployUser}
      MaxAuthTries 3
  - path: /etc/fail2ban/jail.d/aven-sshd.local
    owner: root:root
    permissions: "0644"
    content: |
      [sshd]
      enabled = true
      port = ssh
      maxretry = 5
      findtime = 10m
      bantime = 1h
  - path: /usr/local/sbin/aven-mount-data-volume
    owner: root:root
    permissions: "0755"
    content: |
${indent(mountScript.trimEnd(), 6)}
runcmd:
  - systemctl enable --now docker
  - systemctl enable --now fail2ban
  - usermod -aG docker ${deployUser}
  - systemctl restart ssh
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw allow 443/udp
${firewallCommands}
  - ufw --force enable
  - /usr/local/sbin/aven-mount-data-volume
  - install -d -o ${deployUser} -g ${deployUser} -m 0750 /opt/aven-api /opt/aven-api/deploy
  - touch /var/lib/aven/cloud-init-complete
`
}
