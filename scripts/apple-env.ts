/**
 * Optional repo-root **`.env.apple.local`** loader (quotes + spaces OK).
 *
 * Populate from `scripts/apple-env.local.template` — file is matched by `.gitignore` `.env.*` and must never be committed.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function stripQuotes(v: string): string {
	let s = v.trim()
	if (
		(s.startsWith('"') && s.endsWith('"')) ||
		(s.startsWith("'") && s.endsWith("'"))
	) {
		s = s.slice(1, -1)
	}
	return s.replace(/\\n/g, '\n')
}

export function readEnvFileValue(filePath: string, key: string): string | undefined {
	if (!existsSync(filePath)) return undefined
	const raw = readFileSync(filePath, 'utf8')
	for (let line of raw.split(/\r?\n/)) {
		line = line.trim()
		if (!line || line.startsWith('#')) continue
		const eq = line.indexOf('=')
		if (eq < 1) continue
		const k = line.slice(0, eq).trim()
		if (k !== key) continue
		const val = stripQuotes(line.slice(eq + 1).trim())
		return val.trim() || undefined
	}
	return undefined
}

/** Does not overwrite existing `process.env` keys. */
export function applyAppleEnvLocal(repoRoot: string): void {
	const p = path.join(repoRoot, '.env.apple.local')
	if (!existsSync(p)) return
	const raw = readFileSync(p, 'utf8')
	for (let line of raw.split(/\r?\n/)) {
		line = line.trim()
		if (!line || line.startsWith('#')) continue
		const eq = line.indexOf('=')
		if (eq < 1) continue
		const key = line.slice(0, eq).trim()
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
		const valRaw = line.slice(eq + 1).trim()
		let val = stripQuotes(valRaw)
		if (process.env[key] === undefined) process.env[key] = val
	}
}
