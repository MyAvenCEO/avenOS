#!/usr/bin/env bun
/**
 * Stamp the unified version across the **visible** version surfaces:
 *   - every workspace package.json (app, libs/*, docs — NOT ARCHIVE/* or root)
 *   - app/src-tauri/tauri.conf.json  (this is what the app actually ships as its version)
 *
 * Rust crate versions in Cargo.toml are deliberately NOT touched: they're internal and
 * unpublished, so bumping them is invisible — but it churns the relay's warm build cache
 * (forcing a full recompile of heavy crates like aven-caps on every release) and creates
 * cargo path-dep version mismatches. Keeping them at 0.0.1 keeps relay builds fast + stable.
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

	let count = 0
	for (const rel of jsonTargets) if (setJsonVersion(rel, version)) count++
	if (setJsonVersion('app/src-tauri/tauri.conf.json', version)) count++

	console.log(
		`set-version: stamped ${version} across ${count} files (package.json + tauri.conf.json)`
	)
}

main()
