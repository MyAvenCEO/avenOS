/** A disposable real Dovecot mailbox. Never points at a user's account or maildir. */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
export async function imapFixture(options: { multipart?: boolean } = {}) {
	const directory = await mkdtemp('/tmp/aven-private-imap-'),
		name = `aven-imap-proof-${randomUUID()}`
	const password = randomUUID(),
		login = 'synthetic-reader'
	let created = false
	const close = async () => {
		if (created) execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' })
		await rm(directory, { recursive: true, force: true })
	}
	try {
		execFileSync(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-nodes',
				'-sha256',
				'-days',
				'1',
				'-keyout',
				`${directory}/key.pem`,
				'-out',
				`${directory}/cert.pem`,
				'-subj',
				'/CN=localhost',
				'-addext',
				'subjectAltName=DNS:localhost'
			],
			{ stdio: 'ignore' }
		)
		await mkdir(`${directory}/mail`)
		for (const path of ['cur', 'new', 'tmp']) await mkdir(`${directory}/mail/${path}`)
		const messages = [
			['Seed count', 'The greenhouse contains 37 violet seed packets.'],
			['Watering schedule', 'Water the lavender seedlings on Thursday.'],
			['Workshop', 'The fictional kite workshop starts at 14:00.']
		]
		for (const [index, [subject, body]] of messages.entries()) {
			const contents =
				options.multipart && index === 2
					? 'Content-Type: multipart/mixed; boundary=synthetic-garden\r\n\r\n' +
						'--synthetic-garden\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n' +
						body +
						'\r\n' +
						[1, 2]
							.map(
								(n) =>
									'--synthetic-garden\r\nContent-Type: application/json\r\nContent-Disposition: attachment; filename="../../invented-' +
									n +
									'.json"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
									Buffer.from('{"color":"amber","count":11}').toString('base64') +
									'\r\n'
							)
							.join('') +
						'--synthetic-garden\r\nContent-Type: text/html\r\n\r\n<img src="https://example.test/tracker"><script>fetch("https://example.test")</script>\r\n--synthetic-garden--\r\n'
					: `Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`
			await writeFile(
				`${directory}/mail/new/synthetic-${index + 1}`,
				`From: Greenhouse <garden@example.test>\r\nTo: Reader <reader@example.test>\r\nSubject: ${subject}\r\nMessage-ID: <fixture-${index}@example.test>\r\nDate: Tue, 6 Jan 2026 12:00:00 +0000\r\nMIME-Version: 1.0\r\n${contents}`
			)
		}
		await writeFile(`${directory}/users`, `${login}:{PLAIN}${password}\n`, { mode: 0o600 })
		await writeFile(
			`${directory}/dovecot.conf`,
			`protocols = imap
listen = *
ssl = required
ssl_cert = </fixture/cert.pem
ssl_key = </fixture/key.pem
ssl_min_protocol = TLSv1.2
disable_plaintext_auth = yes
auth_mechanisms = plain login
mail_location = maildir:/fixture/mail
first_valid_uid = 1000
log_path = /dev/stderr
info_log_path = /dev/stderr
passdb {
  driver = passwd-file
  args = /fixture/users
}
userdb {
  driver = static
  args = uid=1000 gid=1000 home=/fixture
}
service imap-login {
  inet_listener imap {
    port = 0
  }
  inet_listener imaps {
    port = 993
    ssl = yes
  }
}
service auth {
  user = root
}
`
		)
		// Only independently generated data; the container sees this one temporary directory.
		await chmod(directory, 0o755)
		execFileSync(
			'docker',
			[
				'run',
				'--rm',
				'-v',
				`${directory}:/fixture`,
				'--entrypoint',
				'chown',
				'aven-imap-proof:local',
				'-R',
				'1000:1000',
				'/fixture/mail'
			],
			{ stdio: 'ignore' }
		)
		execFileSync(
			'docker',
			[
				'run',
				'-d',
				'--name',
				name,
				'--label',
				'aven.proof=credential-imap',
				'-p',
				'127.0.0.1::993',
				'-v',
				`${directory}:/fixture`,
				'aven-imap-proof:local'
			],
			{ stdio: 'ignore' }
		)
		created = true
		const port = Number(
			execFileSync('docker', ['port', name, '993/tcp'], { encoding: 'utf8' })
				.trim()
				.split(':')
				.at(-1)
		)
		return { directory, name, password, login, port, close }
	} catch (error) {
		if (created)
			console.error(
				execFileSync('docker', ['logs', name], {
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe']
				})
			)
		await close()
		throw error
	}
}
