#!/usr/bin/env bun
/**
 * Loads `<repo-root>/.env.apple.local`, then runs `tauri ios build` App Store Connect export from lib/app.
 *
 * Maps `AVEN_IOS_APP_STORE_MOBILEPROVISION` → `IOS_MOBILE_PROVISION` (read by Tauri CLI for signing).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyAppleEnvLocal } from './apple-env'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

applyAppleEnvLocal(repoRoot)

const appDir = path.join(repoRoot, 'lib/app')
const team = process.env.APPLE_DEVELOPMENT_TEAM?.trim()
if (!team) {
	console.error(
		'tauri-ios-asc: set APPLE_DEVELOPMENT_TEAM in .env.apple.local (or shell) — see scripts/apple-env.local.template',
	)
	process.exit(1)
}

const iosProfile =
	process.env.IOS_MOBILE_PROVISION?.trim() ||
	process.env.AVEN_IOS_APP_STORE_MOBILEPROVISION?.trim()
if (!iosProfile) {
	console.error(
		'tauri-ios-asc: set AVEN_IOS_APP_STORE_MOBILEPROVISION in .env.apple.local — see scripts/apple-env.local.template',
	)
	process.exit(1)
}

console.log('[tauri-ios-asc] team=%s profile=%s', team, iosProfile)

const r = spawnSync(
	'bunx',
	['--bun', 'tauri', 'ios', 'build', '--export-method', 'app-store-connect', '--ci'],
	{
		cwd: appDir,
		stdio: 'inherit',
		env: {
			...process.env,
			APPLE_DEVELOPMENT_TEAM: team,
			IOS_MOBILE_PROVISION: iosProfile,
		},
	},
)
process.exit(r.status ?? 1)
