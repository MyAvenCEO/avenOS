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
 * MICRO = "Nth release this month": highest stable `vYY.M.<n>` tag + 1 (or 1 if none).
 * On the `next` channel the micro stays fixed across the prerelease series while the
 * `-next.<k>` counter climbs, then graduates to plain `vYY.M.<micro>` on `main`.
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
	const stableRe = new RegExp(`^v${yy}\\.${m}\\.(\\d+)$`)
	const micro = maxMatch(tags, stableRe) + 1

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
