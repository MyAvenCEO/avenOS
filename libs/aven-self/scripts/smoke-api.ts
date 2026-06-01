#!/usr/bin/env bun
/**
 * M1 API smoke test — HTTP against a running server (Node + better-sqlite3).
 *
 * Usage:
 *   Terminal A: bun run dev:aven-self
 *   Terminal B: bun run test:aven-self
 *
 * Or one-shot (starts server, runs tests, stops):
 *   bun run test:aven-self:once
 */
import { getPublicKeyAsync, signAsync, utils } from '@noble/ed25519'
import bs58 from 'bs58'
import fs from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.AVEN_SELF_TEST_URL ?? 'http://localhost:3010'
const DEV_PORT = process.env.AVEN_SELF_DEV_PORT ?? '3010'

async function keypair(): Promise<{ privKey: Uint8Array; did: string }> {
	const privKey = utils.randomPrivateKey()
	const pubKey = await getPublicKeyAsync(privKey)
	const buf = new Uint8Array(34)
	buf[0] = 0xed
	buf[1] = 0x01
	buf.set(pubKey, 2)
	const did = `did:key:${bs58.encode(buf)}`
	return { privKey, did }
}

function parseCookies(res: Response): string {
	const raw = res.headers.getSetCookie?.() ?? []
	return raw.map((c) => c.split(';')[0]).join('; ')
}

async function registerFlow(
	flow: 'bootstrap' | 'invite',
	opts: { privKey: Uint8Array; did: string; inviteToken?: string; cookie?: string },
): Promise<{ cookie: string; body: Record<string, unknown> }> {
	const { did, privKey } = opts
	const nonceRes = await fetch(`${BASE}/api/auth/aven-self/nonce`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(opts.cookie ? { cookie: opts.cookie } : {}),
		},
		body: JSON.stringify({ did, flow, inviteToken: opts.inviteToken }),
	})
	if (!nonceRes.ok) throw new Error(`nonce failed: ${nonceRes.status} ${await nonceRes.text()}`)
	const { message } = (await nonceRes.json()) as { message: string }
	const signatureBytes = await signAsync(new TextEncoder().encode(message), privKey)
	const signature = Buffer.from(signatureBytes).toString('base64url')

	const verifyRes = await fetch(`${BASE}/api/auth/aven-self/verify`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			origin: BASE,
			...(opts.cookie ? { cookie: opts.cookie } : {}),
		},
		body: JSON.stringify({ did, message, signature, flow, inviteToken: opts.inviteToken }),
	})
	if (!verifyRes.ok) throw new Error(`verify failed: ${verifyRes.status} ${await verifyRes.text()}`)
	const cookie = parseCookies(verifyRes)
	const body = (await verifyRes.json()) as Record<string, unknown>
	return { cookie, body }
}

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${BASE}/health`)
			if (res.ok) return
		} catch {
			/* retry */
		}
		await Bun.sleep(300)
	}
	throw new Error(`server not ready at ${BASE}/health`)
}

async function runSmoke(): Promise<void> {
	const health = await fetch(`${BASE}/health`)
	if (!health.ok) throw new Error(`/health ${health.status}`)
	console.log('[smoke] /health ok')

	const status0 = await fetch(`${BASE}/api/auth/aven-self/site/status`)
	const s0 = (await status0.json()) as { bootstrapped: boolean }
	if (s0.bootstrapped) throw new Error('expected fresh db (bootstrapped=false)')
	console.log('[smoke] site/status bootstrapped=false')

	const adminKeys = await keypair()
	const admin = await registerFlow('bootstrap', adminKeys)
	if (!admin.body.isAdmin) throw new Error('expected admin bootstrap')
	console.log('[smoke] bootstrap admin ok')

	const inviteRes = await fetch(`${BASE}/api/auth/aven-self/invite/create`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie: admin.cookie, origin: BASE },
		body: JSON.stringify({}),
	})
	if (!inviteRes.ok) throw new Error(`invite/create ${inviteRes.status}`)
	const invite = (await inviteRes.json()) as { inviteToken: string; inviteDeepLink: string }
	if (!invite.inviteDeepLink.startsWith('avenos://invite?invite=')) {
		throw new Error('unexpected inviteDeepLink')
	}
	console.log('[smoke] invite/create ok')

	const userKeys = await keypair()
	const user = await registerFlow('invite', { ...userKeys, inviteToken: invite.inviteToken })
	if (user.body.isAdmin) throw new Error('invite user should not be admin')
	console.log('[smoke] invite redeem ok')

	const reauth = await registerFlow('bootstrap', userKeys)
	if (!reauth.body.success) throw new Error('re-auth failed')
	console.log('[smoke] return sign-in ok')

	console.log('[smoke] all passed')
}

async function startServer(): Promise<ChildProcess> {
	const child = spawn('bun', ['--env-file=../../.env', './scripts/dev-server.ts'], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, AVEN_SELF_DEV_PORT: DEV_PORT },
	})
	return child
}

const once = process.argv.includes('--once')

async function main() {
	if (once) {
		const testDb = path.join(root, '.tmp', 'smoke-aven-self.db')
		process.env.AVEN_SELF_DB_PATH = testDb
		process.env.BETTER_AUTH_SECRET ||= 'test-secret-must-be-at-least-32-chars-long'
		process.env.BETTER_AUTH_URL = BASE
		process.env.AVEN_SELF_DOMAIN = `localhost:${DEV_PORT}`
		fs.mkdirSync(path.dirname(testDb), { recursive: true })
		if (fs.existsSync(testDb)) fs.unlinkSync(testDb)
		const { execFileSync } = await import('node:child_process')
		execFileSync('bun', ['--env-file=../../.env', './scripts/migrate.ts'], {
			cwd: root,
			stdio: 'inherit',
			env: process.env,
		})

		const child = await startServer()
		try {
			await waitForHealth()
			await runSmoke()
		} finally {
			child.kill('SIGTERM')
		}
		return
	}
	await runSmoke()
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
