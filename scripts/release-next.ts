#!/usr/bin/env bun
/**
 * CI orchestrator for the `next` staging channel (runs in GitHub Actions on push to
 * `next`). Derive CalVer → stamp everywhere → regenerate changelog → commit `[skip
 * ci]` → tag → push → create a GitHub prerelease.
 *
 * Milestone 1: tags + changelog only. NO app build, NO upload, NO deploy.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd: string): void {
	execSync(cmd, { cwd: repoRoot, stdio: 'inherit' })
}

function capture(cmd: string): string {
	return execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function main(): void {
	const version = capture('bun ./scripts/next-version.ts --channel next')
	const tag = `v${version}`
	console.log(`[release-next] releasing ${tag}`)

	run(`bun ./scripts/set-version.ts ${version}`)
	run('bun run changelog')

	run('git add -A')
	run(`git commit -m "chore(release): ${tag} [skip ci]"`)
	run(`git tag ${tag}`)
	run('git push origin HEAD --follow-tags')

	// GitHub prerelease for the `next` channel (gh is preinstalled on GitHub runners).
	run(`gh release create ${tag} --prerelease --title ${tag} --generate-notes`)

	console.log(`[release-next] done → ${tag}`)
}

main()
