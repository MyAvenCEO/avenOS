#!/usr/bin/env bun

/**
 * Generate Agent Credentials for MaiaOS
 *
 * Output: AVEN_OS_ACCOUNT, AVEN_OS_SECRET, VITE_AVEN_TEST_MODE, VITE_AVEN_TEST_ACCOUNT, VITE_AVEN_TEST_SECRET
 * (No AVEN_TEST_ACCOUNT/AVEN_TEST_SECRET - client uses VITE_ prefixed vars only)
 *
 * Modes:
 *   sync  - Sync server (hosts /sync). Never connects to another. Default.
 *   agent - Client agent (connects to sync at AVEN_OS_SERVER). For future pure agent workers.
 *   passkey client - Browser SPA: `getStorage` human bucket; passkey users and secret key dev share it (`VITE_AVEN_TEST_*`).
 *
 * Usage:
 *   bun agent:generate
 *   bun agent:generate --mode=agent  # For agent workers that connect to sync
 *   bun agent:generate --no-write
 *
 * Programmatic: writeTesterCredentialsToEnv (exported) for local AVEN_OS_SEED flow.
 */

import { bootstrapNodeLogging, createLogger } from '@MaiaOS/logs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import * as nodeUrl from 'node:url'
import { cojsonInternals } from 'cojson'
import { WasmCrypto } from 'cojson/crypto/WasmCrypto'

/** Repo root for `.env` writes. Prefer real `process.cwd()` (Bun/Node/sync) so browser bundles never call `fileURLToPath`. */
export const defaultCredentialsRootDir =
	typeof process !== 'undefined' && typeof process.cwd === 'function'
		? process.cwd()
		: resolve(dirname(nodeUrl.fileURLToPath(import.meta.url)), '../../..')

const { accountHeaderForInitialAgentSecret, idforHeader } = cojsonInternals

bootstrapNodeLogging()
const credLog = createLogger('credentials')

/**
 * @param {{ name?: string } | undefined} options
 * @returns {Promise<{ accountID: string, agentSecret: string, name: string }>}
 */
export async function generateAgentCredentials({ name = 'Maia Agent' } = {}) {
	const crypto = await WasmCrypto.create()
	const agentSecret = crypto.newRandomAgentSecret()
	const accountHeader = accountHeaderForInitialAgentSecret(agentSecret, crypto)
	const accountID = idforHeader(accountHeader, crypto)
	return { accountID, agentSecret, name }
}

/**
 * Write **existing** secret-key dev tester credentials into repo `.env` (duplicate literals for `VITE_AVEN_TEST_ACCOUNT` + `AVEN_OS_GUARDIAN`).
 * Used after sync boot so editing `.env` does not restart the dev process mid-startup.
 *
 * @param {string} rootDir - Repo root (directory containing `.env`)
 * @param {{ testAccountID: string, testAgentSecret: string }} creds
 * @param {string} [envPath] - Optional path to `.env`
 */
export function applyTesterCredentialsToEnvFile(
	rootDir,
	{ testAccountID, testAgentSecret },
	envPathOption
) {
	const envPath = envPathOption ?? join(rootDir, '.env')
	let content = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : ''

	const hasViteTestMode = /^VITE_AVEN_TEST_MODE=/m.test(content)
	const hasViteTestAccount = /^VITE_AVEN_TEST_ACCOUNT=/m.test(content)
	const hasViteTestSecret = /^VITE_AVEN_TEST_SECRET=/m.test(content)
	const hasGuardian = /^AVEN_OS_GUARDIAN=/m.test(content)

	if (hasViteTestMode) {
		content = content.replace(/^VITE_AVEN_TEST_MODE=.*/m, 'VITE_AVEN_TEST_MODE=true')
	}
	if (hasViteTestAccount) {
		content = content.replace(
			/^VITE_AVEN_TEST_ACCOUNT=.*/m,
			`VITE_AVEN_TEST_ACCOUNT=${testAccountID}`
		)
	}
	if (hasViteTestSecret) {
		content = content.replace(
			/^VITE_AVEN_TEST_SECRET=.*/m,
			`VITE_AVEN_TEST_SECRET=${testAgentSecret}`
		)
	}
	if (hasGuardian) {
		content = content.replace(/^AVEN_OS_GUARDIAN=.*/m, `AVEN_OS_GUARDIAN=${testAccountID}`)
	}

	if (!hasGuardian && content.includes('AVEN_OS_SECRET')) {
		content = content.replace(/(AVEN_OS_SECRET=.*\n)/, `$1AVEN_OS_GUARDIAN=${testAccountID}\n`)
	}

	const needsViteTestVars =
		(!hasViteTestMode || !hasViteTestAccount || !hasViteTestSecret) &&
		content.includes('AVEN_OS_ACCOUNT')
	if (needsViteTestVars && !content.includes('VITE_AVEN_TEST_SECRET')) {
		const viteTestBlock = `

VITE_AVEN_TEST_MODE=true
VITE_AVEN_TEST_ACCOUNT=${testAccountID}
VITE_AVEN_TEST_SECRET=${testAgentSecret}
`
		if (/^AVEN_OS_GUARDIAN=/m.test(content)) {
			content = content.replace(
				/(AVEN_OS_GUARDIAN=.*\n)/,
				`AVEN_OS_GUARDIAN=${testAccountID}\n${viteTestBlock}`
			)
		} else {
			content = `${content.trimEnd()}\n${viteTestBlock}\n`
		}
	}

	content = content.replace(/(AVEN_OS_GUARDIAN=.*)\n(?!\n)(VITE_AVEN_TEST_MODE=)/m, '$1\n\n$2')

	if (!content.includes('VITE_AVEN_TEST_ACCOUNT')) {
		const block = `# Secret-key dev browser login — VITE_AVEN_* (AVEN_OS_SEED)
VITE_AVEN_TEST_MODE=true
VITE_AVEN_TEST_ACCOUNT=${testAccountID}
VITE_AVEN_TEST_SECRET=${testAgentSecret}
AVEN_OS_GUARDIAN=${testAccountID}

`
		content = content ? `${block}${content}` : block.trimEnd()
	}

	content = content.replace(/\n{3,}/g, '\n\n').trim()

	writeFileSync(envPath, `${content}\n`, 'utf-8')
}

/**
 * Generate a fresh **secret-key dev** browser identity (`VITE_AVEN_*`) and overwrite tester + guardian lines in `.env`.
 * Does not rotate AVEN_OS_ACCOUNT / AVEN_OS_SECRET.
 *
 * @param {{ rootDir?: string, envPath?: string }} [options]
 * @returns {Promise<{ testAccountID: string, testAgentSecret: string }>}
 */
export async function writeTesterCredentialsToEnv({
	rootDir = defaultCredentialsRootDir,
	envPath: envPathOption
} = {}) {
	const { accountID: testAccountID, agentSecret: testAgentSecret } = await generateAgentCredentials(
		{
			name: 'Secret key dev'
		}
	)
	applyTesterCredentialsToEnvFile(rootDir, { testAccountID, testAgentSecret }, envPathOption)
	return { testAccountID, testAgentSecret }
}

const args = process.argv.slice(2)
const nameArg = args.find((arg) => arg.startsWith('--name='))
const name = nameArg ? nameArg.split('=')[1] : 'Maia Agent'
const shouldWrite = !args.includes('--no-write')

async function main() {
	try {
		credLog.log('🔑 Generating agent credentials...\n')

		const { accountID, agentSecret } = await generateAgentCredentials({ name })
		const { accountID: testAccountID, agentSecret: testAgentSecret } =
			await generateAgentCredentials({ name: 'Secret key dev' })

		if (!shouldWrite) {
			credLog.log(`# AVENS
AVEN_OS_ACCOUNT=${accountID}
AVEN_OS_SECRET=${agentSecret}
AVEN_OS_GUARDIAN=${testAccountID}

VITE_AVEN_TEST_MODE=true
VITE_AVEN_TEST_ACCOUNT=${testAccountID}
VITE_AVEN_TEST_SECRET=${testAgentSecret}
`)
			return
		}

		credLog.log('📋 Writing credentials to .env file...\n')
		const envPath = join(defaultCredentialsRootDir, '.env')
		let content = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : ''

		// Replace existing credentials in place (preserves .env layout)
		const hasAccount = /^AVEN_OS_ACCOUNT=/m.test(content)
		const hasSecret = /^AVEN_OS_SECRET=/m.test(content)
		const hasViteTestMode = /^VITE_AVEN_TEST_MODE=/m.test(content)
		const hasViteTestAccount = /^VITE_AVEN_TEST_ACCOUNT=/m.test(content)
		const hasViteTestSecret = /^VITE_AVEN_TEST_SECRET=/m.test(content)
		const hasGuardian = /^AVEN_OS_GUARDIAN=/m.test(content)

		if (hasAccount) {
			content = content.replace(/^AVEN_OS_ACCOUNT=.*/m, `AVEN_OS_ACCOUNT=${accountID}`)
		}
		if (hasSecret) {
			content = content.replace(/^AVEN_OS_SECRET=.*/m, `AVEN_OS_SECRET=${agentSecret}`)
		}
		if (hasViteTestMode) {
			content = content.replace(/^VITE_AVEN_TEST_MODE=.*/m, 'VITE_AVEN_TEST_MODE=true')
		}
		if (hasViteTestAccount) {
			content = content.replace(
				/^VITE_AVEN_TEST_ACCOUNT=.*/m,
				`VITE_AVEN_TEST_ACCOUNT=${testAccountID}`
			)
		}
		if (hasViteTestSecret) {
			content = content.replace(
				/^VITE_AVEN_TEST_SECRET=.*/m,
				`VITE_AVEN_TEST_SECRET=${testAgentSecret}`
			)
		}
		if (hasGuardian) {
			content = content.replace(/^AVEN_OS_GUARDIAN=.*/m, `AVEN_OS_GUARDIAN=${testAccountID}`)
		}

		// If section missing, add # AVENS block
		if (!hasAccount || !hasSecret) {
			const avensBlock = `# AVENS
AVEN_OS_ACCOUNT=${accountID}
AVEN_OS_SECRET=${agentSecret}
AVEN_OS_GUARDIAN=${testAccountID}

VITE_AVEN_TEST_MODE=true
VITE_AVEN_TEST_ACCOUNT=${testAccountID}
VITE_AVEN_TEST_SECRET=${testAgentSecret}

`
			const hasAvensSection = /^# AVENS$/m.test(content)
			if (content.includes('# SYNC SERVICE') && !hasAvensSection) {
				content = content.replace(/(# SYNC SERVICE\n(?:[^\n#]*\n)*)/, `$1\n${avensBlock}`)
			} else if (!content.includes('AVEN_OS_ACCOUNT')) {
				content = content ? `${avensBlock}${content}` : avensBlock.trim()
			}
		}

		// Add AVEN_OS_GUARDIAN if missing (set to VITE_AVEN_TEST_ACCOUNT)
		if (!hasGuardian && content.includes('AVEN_OS_SECRET')) {
			content = content.replace(/(AVEN_OS_SECRET=.*\n)/, `$1AVEN_OS_GUARDIAN=${testAccountID}\n`)
		}

		// Add VITE_AVEN_TEST_* if missing (client-only; no AVEN_TEST_*)
		const needsViteTestVars =
			(!hasViteTestMode || !hasViteTestAccount || !hasViteTestSecret) &&
			content.includes('AVEN_OS_ACCOUNT')
		if (needsViteTestVars && !content.includes('VITE_AVEN_TEST_SECRET')) {
			const viteTestBlock = `

VITE_AVEN_TEST_MODE=true
VITE_AVEN_TEST_ACCOUNT=${testAccountID}
VITE_AVEN_TEST_SECRET=${testAgentSecret}
`
			content = content.replace(
				/(AVEN_OS_GUARDIAN=.*\n)/,
				`AVEN_OS_GUARDIAN=${testAccountID}\n${viteTestBlock}`
			)
		}

		// Ensure one blank line between avens (Maia block vs VITE test block)
		content = content.replace(/(AVEN_OS_GUARDIAN=.*)\n(?!\n)(VITE_AVEN_TEST_MODE=)/m, '$1\n\n$2')

		// Migrate ## AVEN SERVICE → # AVENS; normalize section header
		content = content.replace(/^## AVEN SERVICE$/m, '# AVENS')
		content = content.replace(/^##AVENS$/m, '# AVENS')
		content = content.replace(/^## AVENS$/m, '# AVENS')

		// Remove duplicate/orphan # AVENS (empty section before APP SERVICE)
		content = content.replace(/\n# AVENS\s*\n(?=# APP SERVICE)/, '\n')

		// Remove legacy vars if present (one-time cleanup)
		content = content
			.replace(/^PEER_MODE=.*\n?/gm, '')
			.replace(/^PEER_STORAGE=.*\n?/gm, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()

		writeFileSync(envPath, `${content}\n`, 'utf-8')
		credLog.log(`✅ Credentials written to ${envPath}\n`)
		credLog.log(
			'🔒 Keep AVEN_OS_SECRET and VITE_AVEN_TEST_SECRET secure. Never commit to version control.\n'
		)
	} catch (_error) {
		process.exit(1)
	}
}

if (import.meta.main) {
	main()
}
