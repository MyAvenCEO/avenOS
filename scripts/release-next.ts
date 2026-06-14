#!/usr/bin/env bun
/**
 * CI orchestrator for the `next` staging channel (runs in GitHub Actions on push to
 * `next`). Derive CalVer → stamp everywhere → regenerate changelog → commit `[skip
 * ci]` → tag → push → create a GitHub prerelease.
 *
 *   bun ./scripts/release-next.ts            # full run (CI)
 *   bun ./scripts/release-next.ts --dry-run  # derive + stamp + changelog, then REVERT;
 *                                            # prints the tag it WOULD cut. No commit/tag/push/gh.
 *
 * Milestone 1: tags + changelog only. NO app build, NO upload, NO deploy.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

function run(cmd: string): void {
	execSync(cmd, { cwd: repoRoot, stdio: 'inherit' })
}

function capture(cmd: string): string {
	return execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function main(): void {
	const version = capture('bun ./scripts/next-version.ts --channel next')
	const tag = `v${version}`
	console.log(`[release-next] ${dryRun ? 'DRY RUN — would release' : 'releasing'} ${tag}`)

	run(`bun ./scripts/set-version.ts ${version}`)
	run('bun run changelog')

	if (dryRun) {
		// Show the staged effect, then restore ONLY the release-output files (never blow
		// away other uncommitted work) — no commit/tag/push/gh.
		run(
			'git --no-pager diff --stat -- CHANGELOG.md "app/package.json" "docs/package.json" "libs/**/package.json" "app/src-tauri/tauri.conf.json" "app/src-tauri/Cargo.toml" "libs/**/Cargo.toml"'
		)
		run(
			'git checkout -- CHANGELOG.md "app/package.json" "docs/package.json" "libs/**/package.json" "app/src-tauri/tauri.conf.json" "app/src-tauri/Cargo.toml" "libs/**/Cargo.toml"'
		)
		console.log(`[release-next] dry run complete — release files restored. Would have cut ${tag}.`)
		return
	}

	run('git add -A')
	run(`git commit -m "chore(release): ${tag} [skip ci]"`)
	run(`git tag ${tag}`)
	run('git push origin HEAD --follow-tags')

	// GitHub prerelease for the `next` channel (gh is preinstalled on GitHub runners).
	run(`gh release create ${tag} --prerelease --title ${tag} --generate-notes`)

	console.log(`[release-next] done → ${tag}`)
}

main()
