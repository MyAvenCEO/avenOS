import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import type { HttpResourceTransport, HttpTransportExchange } from './acquisition'
import { httpRequestDigest, parseHttpRequestArtifact } from './contracts'
import { HttpTransportError, type NetworkPolicy, pinDestination } from './egress'

export interface HttpTransportPolicy extends NetworkPolicy {
	maximumBodyBytes?: number
	maximumTimeMs?: number
}

/** Fixed host transport: no proxy env, redirect following, cookie jar, retries,
 * caller TLS overrides or second DNS resolution. Buffers one complete bounded body
 * before releasing it. It is not a credential authorization or publication boundary. */
export class PinnedHttpResourceTransport implements HttpResourceTransport {
	private readonly policy: HttpTransportPolicy
	private readonly maximumBodyBytes: number
	private readonly maximumTimeMs: number
	constructor(policy: HttpTransportPolicy) {
		this.policy = structuredClone(policy)
		this.maximumBodyBytes = policy.maximumBodyBytes ?? 8 * 1024 * 1024
		this.maximumTimeMs = policy.maximumTimeMs ?? 30_000
		if (
			!Number.isSafeInteger(this.maximumBodyBytes) ||
			this.maximumBodyBytes < 0 ||
			this.maximumBodyBytes > 32 * 1024 * 1024 ||
			!Number.isSafeInteger(this.maximumTimeMs) ||
			this.maximumTimeMs < 1 ||
			this.maximumTimeMs > 120_000
		)
			throw new HttpTransportError('HTTP_TRANSPORT_LIMIT_INVALID')
	}

	async exchange(
		input: Parameters<HttpResourceTransport['exchange']>[0]
	): Promise<HttpTransportExchange> {
		const request = parseHttpRequestArtifact(input.request, {
			allowHttpOrigins: this.policy.localTestOrigins
		})
		const url = new URL(request.url)
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), this.maximumTimeMs)
		const abort = () => controller.abort()
		input.signal?.addEventListener('abort', abort, { once: true })
		if (input.signal?.aborted) abort()
		let requestClosed: Promise<void> | undefined
		try {
			const pinned = await pinDestination(url, this.policy, controller.signal)
			const headers: Record<string, string> = Object.fromEntries(
				request.headers.map((header) => [header.name, header.value])
			)
			if (input.conditional?.ifNoneMatch) headers['if-none-match'] = input.conditional.ifNoneMatch
			if (input.conditional?.ifModifiedSince)
				headers['if-modified-since'] = input.conditional.ifModifiedSince
			if (input.credential) {
				if (
					request.authentication.mode === 'anonymous' ||
					input.credential.requestDigest !== httpRequestDigest(request)
				)
					throw new HttpTransportError('HTTP_CREDENTIAL_REQUEST_MISMATCH')
				const { rule, secret } = input.credential
				if (!secret || hasControlCharacters(secret) || Buffer.byteLength(secret) > 32768)
					throw new HttpTransportError('HTTP_CREDENTIAL_ATTACHMENT_INVALID')
				if (rule.kind === 'header') {
					if (
						!['authorization', 'x-api-key', 'api-key'].includes(rule.name.toLowerCase()) ||
						hasControlCharacters(rule.prefix)
					)
						throw new HttpTransportError('HTTP_CREDENTIAL_ATTACHMENT_INVALID')
					headers[rule.name.toLowerCase()] = `${rule.prefix}${secret}`
				} else if (rule.kind === 'cookie') {
					if (
						!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(rule.name) ||
						!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(secret)
					)
						throw new HttpTransportError('HTTP_CREDENTIAL_ATTACHMENT_INVALID')
					headers.cookie = `${rule.name}=${secret}`
				} else {
					if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(rule.name))
						throw new HttpTransportError('HTTP_CREDENTIAL_ATTACHMENT_INVALID')
					url.searchParams.set(rule.name, secret)
				}
			}
			headers.host = url.host
			headers['accept-encoding'] = 'identity'
			headers.connection = 'close'
			const hostname = url.hostname.replace(/^\[|\]$/g, '')
			return await new Promise<HttpTransportExchange>((resolve, reject) => {
				const fail = (code: string) => reject(new HttpTransportError(code))
				let receivedResponse = false
				const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
					{
						protocol: url.protocol,
						hostname: pinned.address,
						family: pinned.family,
						port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
						path: url.pathname + url.search,
						method: request.method,
						headers,
						agent: false,
						signal: controller.signal,
						maxHeaderSize: 32 * 1024,
						// An IP connection still verifies the original DNS/IP certificate name.
						servername: isIP(hostname) ? '' : hostname,
						rejectUnauthorized: true,
						checkServerIdentity: (_host, certificate) => checkServerIdentity(hostname, certificate)
					},
					(response) => {
						receivedResponse = true
						const status = response.statusCode ?? 0
						const bodyPermitted = request.method !== 'HEAD' && status !== 204 && status !== 304
						const declared = response.headers['content-length']
						const encoding = response.headers['content-encoding']
						const stop = (code: string) => {
							response.destroy()
							req.destroy()
							fail(code)
						}
						if (bodyPermitted && encoding && encoding !== 'identity')
							return stop('HTTP_CONTENT_ENCODING_UNSUPPORTED')
						if (
							bodyPermitted &&
							declared !== undefined &&
							(!/^\d+$/.test(declared) || Number(declared) > this.maximumBodyBytes)
						)
							return stop('HTTP_BODY_LIMIT_EXCEEDED')
						let length = 0
						const chunks: Buffer[] = []
						response.on('data', (chunk: Buffer) => {
							length += chunk.length
							if (length > this.maximumBodyBytes || (!bodyPermitted && length))
								return stop('HTTP_BODY_LIMIT_EXCEEDED')
							chunks.push(chunk)
						})
						response.on('error', () =>
							fail(controller.signal.aborted ? 'HTTP_REQUEST_ABORTED' : 'HTTP_RESPONSE_INCOMPLETE')
						)
						response.once('close', () => {
							if (!response.complete)
								fail(
									controller.signal.aborted ? 'HTTP_REQUEST_ABORTED' : 'HTTP_RESPONSE_INCOMPLETE'
								)
						})
						response.on('end', () => {
							if (
								!response.complete ||
								(bodyPermitted && declared !== undefined && Number(declared) !== length)
							)
								return fail('HTTP_RESPONSE_INCOMPLETE')
							const retained = new Headers()
							for (const [name, value] of Object.entries(response.headers)) {
								if (value !== undefined)
									for (const item of Array.isArray(value) ? value : [value])
										retained.append(name, item)
							}
							const bytes = Buffer.concat(chunks, length)
							resolve({
								status,
								statusText: '',
								headers: retained,
								protocol: `http/${response.httpVersion}`,
								body: new ReadableStream({
									start(c) {
										if (bytes.length) c.enqueue(bytes)
										c.close()
									}
								})
							})
						})
					}
				)
				req.on('error', () =>
					fail(controller.signal.aborted ? 'HTTP_REQUEST_ABORTED' : 'HTTP_CONNECTION_FAILED')
				)
				requestClosed = new Promise<void>((done) => req.once('close', () => done()))
				// Bun may close an aborted ClientRequest without emitting `error`.
				// On successful Bun reads, request close can precede response end. Leave
				// body completion to the response events instead of rejecting those reads.
				req.once('close', () => {
					if (controller.signal.aborted) fail('HTTP_REQUEST_ABORTED')
					else if (!receivedResponse) fail('HTTP_RESPONSE_INCOMPLETE')
				})
				req.end()
			})
		} catch (error) {
			// Raw network errors can embed the credential-bearing path or headers.
			if (error instanceof HttpTransportError) throw error
			throw new HttpTransportError('HTTP_TRANSPORT_FAILED')
		} finally {
			await requestClosed
			clearTimeout(timer)
			input.signal?.removeEventListener('abort', abort)
		}
	}
}
function hasControlCharacters(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0)
		if (code <= 31 || code === 127) return true
	}
	return false
}
