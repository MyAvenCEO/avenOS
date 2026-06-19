#!/usr/bin/env bun
/**
 * Derive the next **CalVer** version — `YY.M.MICRO` (two-digit year, UNPADDED month,
 * monthly-reset micro). Pure: reads the date + existing git tags, prints the next
 * version to stdout, no side effects (so it doubles as the dry-run proof).
 *
 *   bun ./scripts/next-version.ts                 → stable, e.g. 26.6.1
 *   bun ./scripts/next-version.ts --channel next  → prerelease, e.g. 26.6.1-next.1
 *
 * Why unpadded month: semver forbids leading zeros and package.json / Cargo.toml /
 * tauri.conf.json reject non-semver versions, so `26.06.1` is illegal — `26.6.1` is
 * the legal CalVer form (months still sort numerically: 6 < 10 < 12).
 *
 * MICRO = day of month (DD), set automatically from today's date — so the version IS the
 * release date (e.g. 26.6.19 = 2026-06-19). The `-next.<k>` counter climbs across the
 * prereleases cut on that same day, then graduates to plain `vYY.M.DD` on `main`. A new day
 * (or month/year) gives a fresh base, so `-next.<k>` restarts at 1 for it.
 */
import { execSync } from 'node:child_process'
import semver from 'semver'

function gitTags(): string[] {
	try {
		return execSync('git tag', { encoding: 'utf8' })
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean)
	} catch {
		return []
	}
}

function maxMatch(tags: string[], re: RegExp): number {
	let max = 0
	for (const t of tags) {
		const m = t.match(re)
		if (m) max = Math.max(max, Number(m[1]))
	}
	return max
}

function main(): void {
	const channel = process.argv.includes('--channel')
		? process.argv[process.argv.indexOf('--channel') + 1]
		: 'stable'

	const now = new Date()
	const yy = now.getFullYear() % 100
	const m = now.getMonth() + 1

	const tags = gitTags()
	// MICRO = day of month (DD), from today's date — automatic, not a manual counter.
	const micro = now.getDate()

	let version: string
	if (channel === 'next') {
		const preRe = new RegExp(`^v${yy}\\.${m}\\.${micro}-next\\.(\\d+)$`)
		const n = maxMatch(tags, preRe) + 1
		version = `${yy}.${m}.${micro}-next.${n}`
	} else {
		version = `${yy}.${m}.${micro}`
	}

	if (!semver.valid(version)) {
		console.error(`next-version: derived an invalid semver "${version}" — refusing to emit.`)
		process.exit(1)
	}

	console.log(version)
}

main()
