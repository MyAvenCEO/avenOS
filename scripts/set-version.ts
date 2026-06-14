#!/usr/bin/env bun
/**
 * Stamp ONE unified version across the whole monorepo — the "standardize across
 * subpackages" core. Rewrites only the version field in:
 *   - every workspace package.json (app, libs/*, docs — NOT ARCHIVE/* or root)
 *   - every first-party Cargo.toml `[package].version` (libs/**, app/src-tauri)
 *   - app/src-tauri/tauri.conf.json
 *
 * Idempotent and surgical: touches nothing but the version line, so a release
 * commit's diff is only version-bearing files.
 *
 *   bun ./scripts/set-version.ts 26.6.1-next.1
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function setJsonVersion(rel: string, version: string): boolean {
	const file = path.join(repoRoot, rel)
	let raw: string
	try {
		raw = readFileSync(file, 'utf8')
	} catch {
		return false
	}
	const next = raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
	if (next === raw) return false
	writeFileSync(file, next)
	return true
}

/** Replace only the version under the first `[package]` table, never a dependency spec. */
function setCargoVersion(rel: string, version: string): boolean {
	const file = path.join(repoRoot, rel)
	let raw: string
	try {
		raw = readFileSync(file, 'utf8')
	} catch {
		return false
	}
	const lines = raw.split('\n')
	let inPackage = false
	let changed = false
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i].trim()
		if (t.startsWith('[')) inPackage = t === '[package]'
		if (inPackage && /^version\s*=/.test(t)) {
			lines[i] = lines[i].replace(/version\s*=\s*"[^"]*"/, `version = "${version}"`)
			changed = true
			break
		}
	}
	if (!changed) return false
	writeFileSync(file, lines.join('\n'))
	return true
}

function scan(pattern: string): string[] {
	const glob = new Bun.Glob(pattern)
	const out: string[] = []
	for (const rel of glob.scanSync({ cwd: repoRoot })) {
		if (rel.includes('node_modules') || rel.includes('/target/') || rel.startsWith('ARCHIVE/'))
			continue
		out.push(rel)
	}
	return out.sort()
}

function main(): void {
	const version = process.argv[2]?.trim()
	if (!version || !semver.valid(version)) {
		console.error(`set-version: pass a valid semver version (got "${version ?? ''}").`)
		process.exit(1)
	}

	const jsonTargets = [
		...scan('app/package.json'),
		...scan('libs/*/package.json'),
		...scan('docs/package.json')
	]
	const cargoTargets = [...scan('libs/**/Cargo.toml'), ...scan('app/src-tauri/Cargo.toml')]

	let count = 0
	for (const rel of jsonTargets) if (setJsonVersion(rel, version)) count++
	for (const rel of cargoTargets) if (setCargoVersion(rel, version)) count++
	if (setJsonVersion('app/src-tauri/tauri.conf.json', version)) count++

	console.log(`set-version: stamped ${version} across ${count} files`)
}

main()
