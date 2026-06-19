import { createLogger } from '@MaiaOS/logs'
import { domainToUnicode } from 'node:url'
import { SMTPServer } from 'smtp-server'
import { ingestRfc822 } from './ingest.js'

const inboundLog = createLogger('mail:inbound-smtp')

/**
 * @param {*} session
 * @returns {string}
 */
function clientIp(session) {
	let ip = session.remoteAddress ?? ''
	if (typeof ip === 'string' && ip.startsWith('::ffff:')) ip = ip.slice(7)
	return ip || 'unknown'
}

/**
 * @param {string[] | undefined} raw
 * @returns {Set<string> | null}
 */
function normalizeAllowedRcpts(raw) {
	if (!raw || raw.length === 0) return null
	const set = new Set(raw.map((a) => String(a).toLowerCase().trim()).filter(Boolean))
	return set.size ? set : null
}

/** Consumer Gmail hostnames (envelope may use either). */
const GMAIL_GOOGLEMAIL_HOSTS = ['gmail.com', 'googlemail.com']

/**
 * Match smtp-server: domain part of MAIL FROM is punycode-decoded to Unicode.
 * @param {string} raw
 * @returns {string}
 */
function whitelistHostDom(raw) {
	const d = String(raw).toLowerCase().trim()
	if (!d) return d
	try {
		const u = domainToUnicode(d)
		return u?.length ? u : d
	} catch {
		return d
	}
}

/**
 * Gmail treats `a.b` and `ab` as the same mailbox; `a+tag` delivers to `a`.
 * @param {string} local lowercased local-part
 * @returns {string}
 */
function gmailLocalCanonicalLocal(local) {
	const plus = local.indexOf('+')
	const base = plus === -1 ? local : local.slice(0, plus)
	return base.replaceAll('.', '')
}

/**
 * @param {Set<string>} addresses
 * @returns {Set<string> | null}
 */
function buildGmailCanonicalLocalSet(addresses) {
	/** @type {Set<string>} */
	const set = new Set()
	for (const a of addresses) {
		const at = a.lastIndexOf('@')
		if (at <= 0) continue
		const dom = a.slice(at + 1)
		if (!GMAIL_GOOGLEMAIL_HOSTS.includes(dom)) continue
		set.add(gmailLocalCanonicalLocal(a.slice(0, at)))
	}
	return set.size ? set : null
}

/**
 * If whitelist includes `@gmail.com` or `@googlemail.com`, both domains are allowed (wildcard). Exact `user@…` on either host also allows the same local-part on the paired host — without opening the whole domain.
 * @param {Set<string>} addresses
 * @param {Set<string>} domains
 */
function expandGmailGooglemailMirror(addresses, domains) {
	for (const h of GMAIL_GOOGLEMAIL_HOSTS) {
		if (domains.has(h)) {
			for (const x of GMAIL_GOOGLEMAIL_HOSTS) domains.add(x)
			break
		}
	}
	const paired = []
	for (const a of addresses) {
		const at = a.lastIndexOf('@')
		if (at <= 0 || at === a.length - 1) continue
		const local = a.slice(0, at)
		const dom = a.slice(at + 1)
		if (GMAIL_GOOGLEMAIL_HOSTS.includes(dom)) {
			for (const h of GMAIL_GOOGLEMAIL_HOSTS) {
				paired.push(`${local}@${h}`)
			}
		}
	}
	for (const x of paired) addresses.add(x)
}

/**
 * Envelope sender whitelist: `@domain` = any address on that domain or its subdomains; `user@domain` = that address only.
 * @param {string[] | undefined} raw
 * @returns {{ addresses: Set<string>, domains: Set<string>, gmailCanonicalLocals: Set<string> | null } | null}
 */
function normalizeWhitelistedMails(raw) {
	if (!raw || raw.length === 0) return null
	/** @type {Set<string>} */
	const addresses = new Set()
	/** @type {Set<string>} */
	const domains = new Set()
	for (const item of raw) {
		const s = String(item).trim().toLowerCase()
		if (!s) continue
		if (s.startsWith('@')) {
			const dom = whitelistHostDom(s.slice(1).trim())
			if (dom) domains.add(dom)
			continue
		}
		const at = s.lastIndexOf('@')
		if (at > 0 && at < s.length - 1) {
			const local = s.slice(0, at)
			const dom = whitelistHostDom(s.slice(at + 1))
			addresses.add(`${local}@${dom}`)
		}
	}
	if (addresses.size === 0 && domains.size === 0) return null
	expandGmailGooglemailMirror(addresses, domains)
	const gmailCanonicalLocals = buildGmailCanonicalLocalSet(addresses)
	return { addresses, domains, gmailCanonicalLocals }
}

/**
 * `@domain` whitelist: match that host and any subdomain (e.g. @andert.me allows mail.andert.me).
 * @param {string} envelopeDomain lowercase
 * @param {Set<string>} domainSet
 * @returns {boolean}
 */
function envelopeDomainMatchesWildcard(envelopeDomain, domainSet) {
	for (const w of domainSet) {
		if (envelopeDomain === w || envelopeDomain.endsWith(`.${w}`)) return true
	}
	return false
}

/**
 * @typedef {{ kind: 'null' } | { kind: 'invalid' } | { kind: 'domain'; domain: string }} MailFromParse
 * @param {*} addressObj smtp-server parsed MAIL FROM
 * @returns {MailFromParse}
 */
function parseEnvelopeMailFrom(addressObj) {
	if (!addressObj || addressObj.address === false) {
		return { kind: 'null' }
	}
	const a = addressObj.address
	if (a == null || a === '') {
		return { kind: 'null' }
	}
	const addr = String(a).toLowerCase().trim()
	if (addr === '' || addr === '<>') {
		return { kind: 'null' }
	}
	const at = addr.lastIndexOf('@')
	if (at <= 0 || at === addr.length - 1) {
		return { kind: 'invalid' }
	}
	return { kind: 'domain', domain: addr.slice(at + 1) }
}

/**
 * @param {Map<string, { n: number; resetAt: number }>} buckets
 * @param {string} ip
 * @param {number} limit
 * @param {number} windowMs
 * @returns {boolean}
 */
function takeMailFromRateSlot(buckets, ip, limit, windowMs) {
	const now = Date.now()
	let b = buckets.get(ip)
	if (!b || now >= b.resetAt) {
		b = { n: 0, resetAt: now + windowMs }
		buckets.set(ip, b)
	}
	if (b.n >= limit) return false
	b.n += 1
	return true
}

/**
 * @typedef {{
 *   store: import('./store-memory.js').InMemoryMailStore
 *   hostedDomains: string[]
 *   port: number
 *   maxBytes?: number
 *   host?: string
 *   key?: Buffer
 *   cert?: Buffer
 *   allowedRcpts?: string[]
 *   whitelistedMails?: string[]
 *   smtpMaxClients?: number
 *   smtpSocketTimeoutMs?: number
 *   smtpMaxConcurrentPerIp?: number
 *   smtpMaxMailFromPerIpPerWindow?: number
 *   smtpRateWindowMs?: number
 * }} InboundSmtpOptions
 */

/**
 * @param {InboundSmtpOptions} options
 */
export function createInboundSmtpServer(options) {
	const {
		store,
		hostedDomains,
		port,
		maxBytes = 2_097_152,
		host = '0.0.0.0',
		key,
		cert,
		allowedRcpts: allowedRcptsRaw,
		whitelistedMails: whitelistedMailsRaw,
		smtpMaxClients = 64,
		smtpSocketTimeoutMs = 120_000,
		smtpMaxConcurrentPerIp = 8,
		smtpMaxMailFromPerIpPerWindow = 60,
		smtpRateWindowMs = 60_000
	} = options

	const allowed = new Set(hostedDomains.map((d) => d.toLowerCase().trim()).filter(Boolean))
	const rcptWhitelist = normalizeAllowedRcpts(allowedRcptsRaw)
	const whitelistedMail = normalizeWhitelistedMails(whitelistedMailsRaw)
	const mailFromBuckets = new Map()
	const ipConn = new Map()

	const serverOpts = {
		disabledCommands: ['AUTH'],
		maxClients: smtpMaxClients,
		socketTimeout: smtpSocketTimeoutMs,
		size: maxBytes,
		onConnect(session, callback) {
			const ip = clientIp(session)
			const cur = ipConn.get(ip) ?? 0
			if (cur >= smtpMaxConcurrentPerIp) {
				inboundLog.warn('SMTP connect rejected (per-IP concurrent limit)', { ip })
				callback(Object.assign(new Error('Too many concurrent connections'), { responseCode: 421 }))
				return
			}
			ipConn.set(ip, cur + 1)
			callback()
		},
		onClose(session) {
			const ip = clientIp(session)
			const c = ipConn.get(ip) ?? 1
			if (c <= 1) ipConn.delete(ip)
			else ipConn.set(ip, c - 1)
		},
		onMailFrom(address, session, callback) {
			if (whitelistedMail) {
				const parsed = parseEnvelopeMailFrom(address)
				if (parsed.kind !== 'domain') {
					inboundLog.warn('MAIL FROM rejected (envelope address required)')
					callback(Object.assign(new Error('Envelope sender required'), { responseCode: 550 }))
					return
				}
				const full = String(address.address).toLowerCase().trim()
				let ok =
					whitelistedMail.addresses.has(full) ||
					envelopeDomainMatchesWildcard(parsed.domain, whitelistedMail.domains)
				if (
					!ok &&
					whitelistedMail.gmailCanonicalLocals &&
					GMAIL_GOOGLEMAIL_HOSTS.includes(parsed.domain)
				) {
					const at = full.lastIndexOf('@')
					if (at > 0) {
						ok = whitelistedMail.gmailCanonicalLocals.has(
							gmailLocalCanonicalLocal(full.slice(0, at))
						)
					}
				}
				if (!ok) {
					inboundLog.warn('MAIL FROM rejected (sender not whitelisted)', {
						full,
						domain: parsed.domain
					})
					callback(Object.assign(new Error('Sender not permitted'), { responseCode: 550 }))
					return
				}
			}
			const ip = clientIp(session)
			if (
				!takeMailFromRateSlot(mailFromBuckets, ip, smtpMaxMailFromPerIpPerWindow, smtpRateWindowMs)
			) {
				inboundLog.warn('MAIL FROM rejected (rate limit)', { ip })
				callback(
					Object.assign(new Error('Too many messages from this host'), { responseCode: 452 })
				)
				return
			}
			callback()
		},
		onRcptTo(address, _session, callback) {
			const raw = String(address?.address ?? '').toLowerCase()
			const at = raw.lastIndexOf('@')
			if (at <= 0 || at === raw.length - 1) {
				callback(new Error('Invalid recipient'))
				return
			}
			const dom = raw.slice(at + 1)
			if (!allowed.has(dom)) {
				inboundLog.warn('RCPT rejected (not hosted domain)', { raw, dom })
				callback(new Error('5.1.1 Mailbox unavailable'))
				return
			}
			if (rcptWhitelist && !rcptWhitelist.has(raw)) {
				inboundLog.warn('RCPT rejected (not in allowlist)', { raw })
				callback(new Error('5.1.1 Mailbox unavailable'))
				return
			}
			callback()
		},
		onData(stream, _session, callback) {
			const chunks = []
			let size = 0
			stream.on('data', (chunk) => {
				size += chunk.length
				if (size > maxBytes) {
					stream.destroy()
					callback(new Error('Message exceeds max size'))
					return
				}
				chunks.push(chunk)
			})
			stream.on('end', () => {
				try {
					const buf = Buffer.concat(chunks)
					ingestRfc822(store, buf)
					callback(null)
				} catch (e) {
					const err = e instanceof Error ? e : new Error(String(e))
					inboundLog.error('ingest failed', { message: err.message })
					callback(err)
				}
			})
			stream.on('error', (e) => {
				const err = e instanceof Error ? e : new Error(String(e))
				callback(err)
			})
		}
	}

	if (key && cert) {
		serverOpts.key = key
		serverOpts.cert = cert
	}

	const server = new SMTPServer(serverOpts)

	server.on('error', (err) => {
		inboundLog.error('SMTP server error', { message: err.message })
	})

	return {
		/**
		 * @returns {Promise<{ port: number }>}
		 */
		listen() {
			return new Promise((resolve, reject) => {
				const onErr = (err) => {
					reject(err)
				}
				server.once('error', onErr)
				server.listen(port, host, () => {
					server.removeListener('error', onErr)
					const addr = server.server.address()
					const p = addr && typeof addr === 'object' ? addr.port : port
					inboundLog.log('SMTP listening', { host, port: p })
					resolve({ port: p })
				})
			})
		},
		close() {
			return new Promise((resolve, reject) => {
				server.close((err) => {
					if (err) reject(err)
					else resolve()
				})
			})
		}
	}
}
