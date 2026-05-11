import { describe, expect, test } from 'bun:test'
import { once } from 'node:events'
import net from 'node:net'
import {
	createInboundSmtpServer,
	createInMemoryMailStore,
	listMessageSummaries
} from '../src/index.js'

/**
 * @param {net.Socket} sock
 * @param {string} buf
 */
async function fillBuffer(sock, buf) {
	let b = buf
	while (true) {
		const i = b.indexOf('\r\n')
		if (i !== -1) return { line: b.slice(0, i), rest: b.slice(i + 2) }
		const [chunk] = await once(sock, 'data')
		b += chunk.toString('latin1')
	}
}

/**
 * @param {net.Socket} sock
 * @param {string} buf
 */
async function readSmtpResponse(sock, buf) {
	let b = buf
	/** @type {string[]} */
	const lines = []
	while (true) {
		const { line, rest } = await fillBuffer(sock, b)
		b = rest
		lines.push(line)
		if (line.length >= 4 && line[3] === ' ') break
		if (line.length >= 4 && line[3] !== '-') throw new Error(`Bad SMTP line: ${line}`)
	}
	return { lines, buf: b }
}

/**
 * @param {net.Socket} sock
 */
async function smtpDeliver(sock) {
	let buf = ''
	let r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines[0].startsWith('220')).toBe(true)

	sock.write('EHLO tester\r\n')
	r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines.some((l) => l.startsWith('250'))).toBe(true)

	sock.write('MAIL FROM:<sender@remote.example>\r\n')
	r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines[0].startsWith('250')).toBe(true)

	sock.write('RCPT TO:<inbox@example.com>\r\n')
	r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines[0].startsWith('250')).toBe(true)

	sock.write('DATA\r\n')
	r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines[0].startsWith('354')).toBe(true)

	const msg =
		'Subject: SMTP test\r\nFrom: sender@remote.example\r\nDate: Wed, 1 Jan 2025 00:00:00 +0000\r\n\r\nhello-smtp\r\n'
	sock.write(`${msg}\r\n.\r\n`)

	r = await readSmtpResponse(sock, buf)
	expect(r.lines[0].startsWith('250')).toBe(true)

	sock.write('QUIT\r\n')
	sock.end()
}

const tinyPdfB64 =
	'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94W0AgMCAzIDNdPj4KZW5kb2JqCnhyZWYKMCAKdHJhaWxlcgo8PC9TaXplIDQ+PgolJUVPRgo='

/**
 * @param {net.Socket} sock
 */
async function smtpDeliverWithPdf(sock) {
	let buf = ''
	let r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines[0].startsWith('220')).toBe(true)

	sock.write('EHLO tester\r\n')
	r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines.some((l) => l.startsWith('250'))).toBe(true)

	sock.write('MAIL FROM:<sender@remote.example>\r\n')
	r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines[0].startsWith('250')).toBe(true)

	sock.write('RCPT TO:<inbox@example.com>\r\n')
	r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines[0].startsWith('250')).toBe(true)

	sock.write('DATA\r\n')
	r = await readSmtpResponse(sock, buf)
	buf = r.buf
	expect(r.lines[0].startsWith('354')).toBe(true)

	const msg = [
		'Subject: PDF attached',
		'From: sender@remote.example',
		'Date: Wed, 1 Jan 2025 00:00:00 +0000',
		'MIME-Version: 1.0',
		'Content-Type: multipart/mixed; boundary="smtp-b"',
		'',
		'--smtp-b',
		'Content-Type: text/plain; charset=utf-8',
		'',
		'See PDF',
		'--smtp-b',
		'Content-Type: application/pdf',
		'Content-Disposition: attachment; filename="smtp-test.pdf"',
		'Content-Transfer-Encoding: base64',
		'',
		tinyPdfB64,
		'--smtp-b--'
	].join('\r\n')
	sock.write(`${msg}\r\n.\r\n`)

	r = await readSmtpResponse(sock, buf)
	expect(r.lines[0].startsWith('250')).toBe(true)

	sock.write('QUIT\r\n')
	sock.end()
}

describe('createInboundSmtpServer', () => {
	test('accepts RCPT for hosted domain and ingests message', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		await smtpDeliver(sock)
		await srv.close()

		const list = listMessageSummaries(store)
		expect(list.length).toBe(1)
		expect(list[0].subject).toBe('SMTP test')
	})

	test('ingests multipart message with PDF attachment and exposes filename', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 500_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		await smtpDeliverWithPdf(sock)
		await srv.close()

		const list = listMessageSummaries(store)
		expect(list.length).toBe(1)
		expect(list[0].subject).toBe('PDF attached')
		expect(list[0].attachments).toEqual(['smtp-test.pdf'])
	})

	test('rejects RCPT for unknown domain', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			port: 0,
			host: '127.0.0.1'
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO x\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<a@b.c>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('RCPT TO:<u@other.org>\r\n')
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('550') || r.lines[0].startsWith('5')).toBe(true)
		sock.destroy()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(0)
	})

	test('rejects RCPT when address not in allowedRcpts', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			allowedRcpts: ['in@example.com'],
			port: 0,
			host: '127.0.0.1'
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO x\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<a@b.c>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('RCPT TO:<inbox@example.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('550') || r.lines[0].startsWith('5')).toBe(true)
		sock.destroy()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(0)
	})

	test('rejects MAIL FROM when sender not in whitelistedMails (@domain prefix)', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['@trusted.example'],
			port: 0,
			host: '127.0.0.1'
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO x\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<spam@evil.org>\r\n')
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('550')).toBe(true)
		sock.destroy()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(0)
	})

	test('accepts MAIL FROM for any local part on @whitelisted domain', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['@andert.me', '@trusted.example'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('220')).toBe(true)
		sock.write('EHLO t\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<anyone@andert.me>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('RCPT TO:<inbox@example.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('DATA\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write(
			'Subject: ok\r\nFrom: anyone@andert.me\r\nDate: Wed, 1 Jan 2025 00:00:00 +0000\r\n\r\nhi\r\n.\r\n'
		)
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('QUIT\r\n')
		sock.end()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(1)
	})

	test('@whitelisted domain allows MAIL FROM on subdomains of that domain', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['@andert.me'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO t\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<relay@mail.andert.me>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('RCPT TO:<inbox@example.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('DATA\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write(
			'Subject: sub\r\nFrom: relay@mail.andert.me\r\nDate: Wed, 1 Jan 2025 00:00:00 +0000\r\n\r\nhi\r\n.\r\n'
		)
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('QUIT\r\n')
		sock.end()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(1)
	})

	test('rejects MAIL FROM when exact address required (other address on same domain)', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['@andert.me', 'fizzyfritzi@gmail.com'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO t\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<other@gmail.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('550')).toBe(true)
		sock.destroy()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(0)
	})

	test('delivers when MAIL FROM matches exact whitelisted address', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['@andert.me', 'fizzyfritzi@gmail.com'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO t\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<fizzyfritzi@gmail.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('RCPT TO:<inbox@example.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('DATA\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write(
			'Subject: ok\r\nFrom: fizzyfritzi@gmail.com\r\nDate: Wed, 1 Jan 2025 00:00:00 +0000\r\n\r\nhi\r\n.\r\n'
		)
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('QUIT\r\n')
		sock.end()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(1)
	})

	test('gmail/googlemail: exact @gmail.com allows same local part @googlemail.com', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['fizzyfritzi@gmail.com'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO t\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<fizzyfritzi@googlemail.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('RCPT TO:<inbox@example.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('DATA\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write(
			'Subject: ok\r\nFrom: fizzyfritzi@googlemail.com\r\nDate: Wed, 1 Jan 2025 00:00:00 +0000\r\n\r\nhi\r\n.\r\n'
		)
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('QUIT\r\n')
		sock.end()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(1)
	})

	test('gmail/googlemail: @gmail.com wildcard allows envelope @googlemail.com', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['@gmail.com'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO t\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<anyone@googlemail.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('RCPT TO:<inbox@example.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('DATA\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write(
			'Subject: ok\r\nFrom: anyone@googlemail.com\r\nDate: Wed, 1 Jan 2025 00:00:00 +0000\r\n\r\nhi\r\n.\r\n'
		)
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('QUIT\r\n')
		sock.end()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(1)
	})

	test('gmail/googlemail: @googlemail.com wildcard allows envelope @gmail.com', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['@googlemail.com'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO t\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<anyone@gmail.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('RCPT TO:<inbox@example.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('DATA\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write(
			'Subject: ok\r\nFrom: anyone@gmail.com\r\nDate: Wed, 1 Jan 2025 00:00:00 +0000\r\n\r\nhi\r\n.\r\n'
		)
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('QUIT\r\n')
		sock.end()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(1)
	})

	test('gmail/googlemail: dotted +tag MAIL FROM matches whitelisted Gmail local (consumer semantics)', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['fizzyfritzi@gmail.com'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO t\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<fizzy.fritzi+news@gmail.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('RCPT TO:<inbox@example.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('DATA\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write(
			'Subject: ok\r\nFrom: fizzy.fritzi+news@gmail.com\r\nDate: Wed, 1 Jan 2025 00:00:00 +0000\r\n\r\nhi\r\n.\r\n'
		)
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('QUIT\r\n')
		sock.end()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(1)
	})

	test('whitelistedMails exact address does not permit rest of domain', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['only@allowed.org'],
			port: 0,
			host: '127.0.0.1'
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO x\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<u@allowed.org>\r\n')
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('550')).toBe(true)
		sock.destroy()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(0)
	})

	test('rejects MAIL FROM null sender (<>) when whitelistedMails is set', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			whitelistedMails: ['a@b.c'],
			port: 0,
			host: '127.0.0.1'
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO b\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<>\r\n')
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('550')).toBe(true)
		sock.destroy()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(0)
	})

	test('allows MAIL FROM null sender (<>) when no whitelistedMails', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			port: 0,
			host: '127.0.0.1',
			maxBytes: 50_000
		})
		const { port } = await srv.listen()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO b\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('RCPT TO:<inbox@example.com>\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('DATA\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write(
			'Subject: bounce\r\nFrom: mailer-daemon@x\r\nDate: Wed, 1 Jan 2025 00:00:00 +0000\r\n\r\nb\r\n.\r\n'
		)
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('250')).toBe(true)
		sock.write('QUIT\r\n')
		sock.end()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(1)
	})

	test('rate-limits MAIL FROM per client IP', async () => {
		const store = createInMemoryMailStore()
		const srv = createInboundSmtpServer({
			store,
			hostedDomains: ['example.com'],
			port: 0,
			host: '127.0.0.1',
			smtpMaxMailFromPerIpPerWindow: 2,
			smtpRateWindowMs: 60_000,
			maxBytes: 20_000
		})
		const { port } = await srv.listen()
		async function oneMail() {
			const sock = net.createConnection({ port, host: '127.0.0.1' })
			await once(sock, 'connect')
			let buf = ''
			let r = await readSmtpResponse(sock, buf)
			buf = r.buf
			sock.write('EHLO r\r\n')
			r = await readSmtpResponse(sock, buf)
			buf = r.buf
			sock.write('MAIL FROM:<a@b.c>\r\n')
			r = await readSmtpResponse(sock, buf)
			buf = r.buf
			expect(r.lines[0].startsWith('250')).toBe(true)
			sock.write('RCPT TO:<inbox@example.com>\r\n')
			r = await readSmtpResponse(sock, buf)
			buf = r.buf
			sock.write('DATA\r\n')
			r = await readSmtpResponse(sock, buf)
			buf = r.buf
			sock.write('Subject: R\r\nFrom: a@b.c\r\n\r\nx\r\n.\r\n')
			r = await readSmtpResponse(sock, buf)
			buf = r.buf
			expect(r.lines[0].startsWith('250')).toBe(true)
			sock.write('QUIT\r\n')
			sock.end()
		}
		await oneMail()
		await oneMail()
		const sock = net.createConnection({ port, host: '127.0.0.1' })
		await once(sock, 'connect')
		let buf = ''
		let r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('EHLO r\r\n')
		r = await readSmtpResponse(sock, buf)
		buf = r.buf
		sock.write('MAIL FROM:<a@b.c>\r\n')
		r = await readSmtpResponse(sock, buf)
		expect(r.lines[0].startsWith('452')).toBe(true)
		sock.destroy()
		await srv.close()
		expect(listMessageSummaries(store).length).toBe(2)
	})
})
