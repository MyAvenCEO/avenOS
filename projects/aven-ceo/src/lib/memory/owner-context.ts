import fs from 'node:fs'
import path from 'node:path'
import {
	assertVaultRelativePath,
	ensureVaultDir,
	vaultAbsolutePath
} from '$lib/memory/vault'

const OWNER_MD_RE = /^OWNER_.+\.md$/i

/** Canonical vault folder for individual humans (identity + preference notes). */
export const VAULT_HUMANS_DIR = 'Humans'

/** How the vault owner note should be structured (injected once per turn; not a separate file). */
const OWNER_NOTE_GUIDE = `## Vault owner (under **Humans/**)

Everything about the **vault owner** — identity and preferences — lives in **one** Markdown file: **\`Humans/OWNER_<slug>.md\`**. Use **\`##\`** headings inside that file to separate concerns, for example:

- **\`## Identity\`** — name, roles, how they want to be addressed
- **\`## Preferences\`** — style, habits, timezone, likes, durable tastes

Do **not** maintain **\`Concepts/Preferences.md\`** for owner-scoped material; merge it into **\`Humans/OWNER_*.md\`** under the appropriate **\`##\`** sections with **\`memory_edit\`**.`

function envOwnerBasename(): string | null {
	const v =
		typeof process !== 'undefined' &&
		process.env &&
		typeof process.env.AVEN_VAULT_OWNER_HUMANS_FILE === 'string'
			? process.env.AVEN_VAULT_OWNER_HUMANS_FILE.trim()
			: ''
	if (!v) return null
	if (!v.endsWith('.md') || v.includes('..') || v.includes('/')) return null
	if (!OWNER_MD_RE.test(v)) return null
	return v
}

function listOwnerBasenames(relDir: string): string[] {
	const dir = path.join(vaultAbsolutePath(), relDir)
	if (!fs.existsSync(dir)) return []
	return fs
		.readdirSync(dir)
		.filter((f) => OWNER_MD_RE.test(f) && fs.statSync(path.join(dir, f)).isFile())
}

/** First matching \`OWNER_*.md\` under \`Humans/\` (sorted). */
function discoverOwnerBasenameFromVault(): string | null {
	const names = listOwnerBasenames(VAULT_HUMANS_DIR)
	names.sort((a, b) => a.localeCompare(b))
	const n0 = names[0]
	return n0 !== undefined ? n0 : null
}

function resolveOwnerVaultRelPath(): { path: string; basename: string } | null {
	const fromEnv = envOwnerBasename()
	if (fromEnv) {
		return { path: `${VAULT_HUMANS_DIR}/${fromEnv}`, basename: fromEnv }
	}
	const b = discoverOwnerBasenameFromVault()
	if (!b) return null
	return { path: `${VAULT_HUMANS_DIR}/${b}`, basename: b }
}

/**
 * Basename of the vault-owner note (`OWNER_<slug>.md`), or `null` if unset.
 * Order: **`AVEN_VAULT_OWNER_HUMANS_FILE`** → discovery under **`Humans/OWNER_*.md`**.
 */
export function vaultOwnerHumansFilename(): string | null {
	return resolveOwnerVaultRelPath()?.basename ?? null
}

export function vaultOwnerHumansVaultPath(): string | null {
	return resolveOwnerVaultRelPath()?.path ?? null
}

function tryReadVaultRel(posixRel: string): string | null {
	try {
		assertVaultRelativePath(posixRel)
		const full = path.join(vaultAbsolutePath(), ...posixRel.split('/'))
		return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
	} catch {
		return null
	}
}

/**
 * Injected into the system prompt **after** SOUL and **before** RULES.
 * Static conventions plus the live **`Humans/OWNER_*.md`** body (identity + preferences as ## sections).
 */
export function buildOwnerContextMarkdown(): string {
	ensureVaultDir()
	const resolved = resolveOwnerVaultRelPath()
	const ownerPath = resolved?.path ?? null
	const owner = ownerPath ? tryReadVaultRel(ownerPath) : null

	const ownerFiles = listOwnerBasenames(VAULT_HUMANS_DIR)
	const sortedOwners = [...ownerFiles].sort((a, b) => a.localeCompare(b))
	const multiOwner =
		sortedOwners.length > 1
			? `\n_(Several \`Humans/OWNER_*.md\` files exist (${sortedOwners.join(', ')}); active file follows env override, else first sort order — keep a single owner note.)_`
			: ''

	let liveBlock: string[]
	if (ownerPath) {
		if (owner?.trim()) {
			liveBlock = [`### \`${ownerPath}\` (live)${multiOwner}`, owner.trim()]
		} else {
			liveBlock = [
				`### \`${ownerPath}\` (live)${multiOwner}`,
				`_(missing or empty — add **\`## Identity\`** and **\`## Preferences\`** sections as needed.)_`
			]
		}
	} else {
		liveBlock = [
			'### `Humans/OWNER_<slug>.md` (not created yet)',
			`_(No \`Humans/OWNER_*.md\` and no valid **\`AVEN_VAULT_OWNER_HUMANS_FILE\`**. Learn the human’s name from **conversation**, then create **one** note under **\`Humans/\`** with **\`## Identity\`** (and **\`## Preferences\`** when relevant). Choose **\`<slug>\`** from how they introduce themselves.)_${multiOwner}`
		]
	}

	return [OWNER_NOTE_GUIDE, '', ...liveBlock].join('\n')
}
