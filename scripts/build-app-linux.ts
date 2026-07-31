#!/usr/bin/env bun
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureLinuxNativeDeps } from './linux-native-deps.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

ensureLinuxNativeDeps('build:app:linux')

const env: NodeJS.ProcessEnv = { ...process.env }
if (!env.AVENOS_APP_ENV_FILE && env.AVENOS_ENV_FILE) {
	const envFile = env.AVENOS_ENV_FILE.trim()
	const absoluteEnvFile = path.isAbsolute(envFile) ? envFile : path.join(repoRoot, envFile)
	env.AVENOS_APP_ENV_FILE = path.relative(path.join(repoRoot, 'app'), absoluteEnvFile)
}

const child = Bun.spawn(['bun', 'run', '--cwd', 'app', 'tauri:build:linux'], {
	cwd: repoRoot,
	stdout: 'inherit',
	stderr: 'inherit',
	stdin: 'inherit',
	env
})

const code = await child.exited
process.exit(typeof code === 'number' ? code : 1)
