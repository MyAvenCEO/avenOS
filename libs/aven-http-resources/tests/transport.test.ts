import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { httpRequestDigest, parseHttpRequestArtifact } from '../src/contracts'
import { isPublicAddress, pinDestination } from '../src/egress'
import { PinnedHttpResourceTransport } from '../src/transport'

describe('destination policy', () => {
	test.each([
		'0.0.0.0',
		'10.4.3.2',
		'100.100.1.2',
		'127.1.2.3',
		'169.254.169.254',
		'172.20.1.2',
		'192.168.1.2',
		'192.0.0.1',
		'198.19.1.2',
		'198.51.100.1',
		'203.0.113.1',
		'224.0.0.1',
		'255.255.255.255',
		'::',
		'::1',
		'::ffff:127.0.0.1',
		'64:ff9b::a00:1',
		'fc00::1',
		'fe80::1',
		'ff02::1',
		'2001::1',
		'2001:db8::1',
		'2002:c000:201::',
		'3fff::1',
		'invalid'
	])('denies nonpublic address %s', (address) => {
		expect(isPublicAddress(address)).toBe(false)
	})
	test.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
		'recognizes global unicast %s',
		(address) => {
			expect(isPublicAddress(address)).toBe(true)
		}
	)
	test('normalization cannot turn alternate IPv4 spellings into a public destination', async () => {
		for (const value of ['https://2130706433', 'https://0x7f000001', 'https://127.1']) {
			const url = new URL(value)
			await expect(
				pinDestination(url, { allowedOrigins: [url.origin] }, new AbortController().signal)
			).rejects.toThrow('HTTP_ADDRESS_NOT_ADMITTED')
		}
	})
	test('an exception cannot admit a LAN address or a different port', async () => {
		await expect(
			pinDestination(
				new URL('http://10.0.0.1'),
				{ allowedOrigins: [], localTestOrigins: ['http://10.0.0.1'] },
				new AbortController().signal
			)
		).rejects.toThrow('HTTP_EGRESS_POLICY_INVALID')
		await expect(
			pinDestination(
				new URL('http://127.0.0.1:9082'),
				{ allowedOrigins: [], localTestOrigins: ['http://127.0.0.1:9081'] },
				new AbortController().signal
			)
		).rejects.toThrow('HTTP_ORIGIN_NOT_ADMITTED')
	})
})

describe('pinned HTTP transport with real sockets', () => {
	const seen: { path: string; auth?: string; cookie?: string; host?: string }[] = []
	const server = createServer((request, response) => {
		seen.push({
			path: request.url!,
			auth: request.headers.authorization,
			cookie: request.headers.cookie,
			host: request.headers.host
		})
		if (request.url === '/redirect') {
			response.writeHead(302, { location: 'http://169.254.169.254/' })
			response.end('Do not follow')
			return
		}
		if (request.url === '/large') {
			response.writeHead(200)
			response.end('x'.repeat(2048))
			return
		}
		if (request.url === '/declared-large') {
			response.writeHead(200, { 'content-length': '2048' })
			response.end('x'.repeat(2048))
			return
		}
		if (request.url === '/encoded') {
			response.writeHead(200, { 'content-encoding': 'gzip' })
			response.end('untrusted compressed content')
			return
		}
		if (request.url === '/partial') {
			response.writeHead(200, { 'content-length': '900' })
			response.write('short')
			response.socket?.destroy()
			return
		}
		if (request.url === '/stall') {
			response.writeHead(200)
			response.write('waiting')
			return
		}
		if (request.method === 'HEAD') {
			response.writeHead(200, { 'content-length': '999999999' })
			response.end()
			return
		}
		if (request.url === '/missing') {
			response.writeHead(404)
			response.end('No synthetic resource')
			return
		}
		response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '8' })
		response.end('fiction!')
	})
	let origin: string
	beforeAll(async () => {
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
	})
	afterAll(async () => {
		server.closeAllConnections()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	})
	const request = (path: string, method = 'GET', mapped = false) =>
		parseHttpRequestArtifact(
			{
				method,
				url: origin + path,
				authentication: mapped
					? { mode: 'mapped-required', purpose: 'fictional-read' }
					: { mode: 'anonymous' }
			},
			{ allowHttpOrigins: [origin] }
		)
	const transport = (extra = {}) =>
		new PinnedHttpResourceTransport({
			allowedOrigins: [],
			localTestOrigins: [origin],
			maximumBodyBytes: 1024,
			...extra
		})

	test('uses exact public host and complete body without touching proxy environment', async () => {
		const result = await transport().exchange({ request: request('/ok') })
		expect(result.status).toBe(200)
		expect(await new Response(result.body).text()).toBe('fiction!')
		expect(seen.at(-1)?.host).toBe(new URL(origin).host)
	})
	test('does not follow a redirect or retry a missing resource', async () => {
		const before = seen.length
		const redirect = await transport().exchange({ request: request('/redirect') })
		expect(redirect.status).toBe(302)
		expect(await new Response(redirect.body).text()).toBe('Do not follow')
		const missing = await transport().exchange({ request: request('/missing') })
		expect(missing.status).toBe(404)
		expect(await new Response(missing.body).text()).toBe('No synthetic resource')
		expect(seen.length - before).toBe(2)
	})
	test.each(['/large', '/declared-large', '/encoded', '/partial'])(
		'rejects incomplete/oversized/unsupported body %s',
		async (path) => {
			await expect(transport().exchange({ request: request(path) })).rejects.toThrow(/^HTTP_/)
		}
	)
	test('HEAD does not mistake representation size for downloaded bytes', async () => {
		const result = await transport().exchange({ request: request('/head', 'HEAD') })
		expect(await new Response(result.body).text()).toBe('')
	})
	test('timeout and caller cancellation close stalled reads', async () => {
		await expect(
			transport({ maximumTimeMs: 40 }).exchange({ request: request('/stall') })
		).rejects.toThrow('HTTP_REQUEST_ABORTED')
		const controller = new AbortController()
		const reading = transport().exchange({ request: request('/stall'), signal: controller.signal })
		setTimeout(() => controller.abort(), 20)
		await expect(reading).rejects.toThrow('HTTP_REQUEST_ABORTED')
	})
	test('injects a credential only for its bound request; public metadata excludes it', async () => {
		const target = request('/ok', 'GET', true)
		const credential = {
			bindingRef: 'test-binding',
			credentialRef: 'test-credential',
			secretVersion: 1,
			bindingRevision: 1,
			requestDigest: httpRequestDigest(target),
			rule: { kind: 'header' as const, name: 'authorization', prefix: 'Bearer ' },
			secret: 'invented-disposable-token'
		}
		const result = await transport().exchange({ request: target, credential })
		expect(seen.at(-1)?.auth).toBe('Bearer invented-disposable-token')
		expect(JSON.stringify(result)).not.toContain(credential.secret)
		await expect(
			transport().exchange({ request: request('/elsewhere', 'GET', true), credential })
		).rejects.toThrow('HTTP_CREDENTIAL_REQUEST_MISMATCH')
		await expect(transport().exchange({ request: request('/ok'), credential })).rejects.toThrow(
			'HTTP_CREDENTIAL_REQUEST_MISMATCH'
		)
	})
	test('an untrusted TLS certificate fails without a verification bypass', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'aven-http-tls-'))
		let tls: ReturnType<typeof createTlsServer> | undefined
		try {
			execFileSync(
				'openssl',
				[
					'req',
					'-x509',
					'-newkey',
					'rsa:2048',
					'-nodes',
					'-keyout',
					join(directory, 'key.pem'),
					'-out',
					join(directory, 'cert.pem'),
					'-days',
					'1',
					'-subj',
					'/CN=localhost'
				],
				{ stdio: 'ignore' }
			)
			tls = createTlsServer(
				{
					key: await readFile(join(directory, 'key.pem')),
					cert: await readFile(join(directory, 'cert.pem'))
				},
				(_req, res) => res.end('must not arrive')
			)
			await new Promise<void>((resolve) => tls!.listen(0, '127.0.0.1', resolve))
			const url = `https://127.0.0.1:${(tls.address() as { port: number }).port}`
			await expect(
				new PinnedHttpResourceTransport({ allowedOrigins: [], localTestOrigins: [url] }).exchange({
					request: parseHttpRequestArtifact({ method: 'GET', url })
				})
			).rejects.toThrow('HTTP_CONNECTION_FAILED')
		} finally {
			if (tls) {
				tls.closeAllConnections()
				await new Promise<void>((resolve) => tls!.close(() => resolve()))
			}
			await rm(directory, { recursive: true, force: true })
		}
	})
})
