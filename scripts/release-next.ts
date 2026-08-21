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
import { appendFileSync } from 'node:fs'
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

function fetchRemoteNext(): string {
	run('git fetch --quiet origin +refs/heads/next:refs/remotes/origin/next')
	return capture('git rev-parse refs/remotes/origin/next')
}

function emitReleaseOutcome(released: boolean, tag?: string, commit?: string): void {
	const outputFile = process.env.GITHUB_OUTPUT
	if (!outputFile) return

	appendFileSync(outputFile, `released=${released}\n`)
	if (tag) appendFileSync(outputFile, `tag=${tag}\n`)
	if (commit) appendFileSync(outputFile, `commit=${commit}\n`)
}

function skipSupersededRelease(sourceSha: string, remoteSha: string): void {
	console.log(
		`[release-next] superseded: origin/next moved from ${sourceSha} to ${remoteSha}; skipping this release.`
	)
	emitReleaseOutcome(false)
}

function main(): void {
	const sourceSha = dryRun ? undefined : process.env.GITHUB_SHA?.trim()
	if (!dryRun) {
		if (!sourceSha) {
			throw new Error('GITHUB_SHA is required for a non-dry-run release')
		}

		const remoteSha = fetchRemoteNext()
		if (remoteSha !== sourceSha) {
			skipSupersededRelease(sourceSha, remoteSha)
			return
		}
	}

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
	const releaseSha = capture('git rev-parse HEAD')
	// Publish the branch and annotated tag atomically so neither can land without the
	// other. A newer push may still win after the freshness check; detect that specific
	// race and let the newer workflow run release the now-current commit.
	run(`git tag -a ${tag} -m ${tag}`)
	try {
		run(`git push --atomic origin HEAD:refs/heads/next refs/tags/${tag}`)
	} catch (error) {
		if (!sourceSha) throw error
		const remoteSha = fetchRemoteNext()
		if (remoteSha !== sourceSha) {
			skipSupersededRelease(sourceSha, remoteSha)
			return
		}
		throw error
	}

	// GitHub prerelease for the `next` channel (gh is preinstalled on GitHub runners).
	run(`gh release create ${tag} --prerelease --title ${tag} --generate-notes`)

	emitReleaseOutcome(true, tag, releaseSha)
	console.log(`[release-next] done → ${tag}`)
}

main()
