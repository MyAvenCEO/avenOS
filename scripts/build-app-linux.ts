#!/usr/bin/env bun
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureOnnxruntimeDylib } from './fetch-onnxruntime.ts'
import { ensureLinuxNativeDeps } from './linux-native-deps.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

ensureLinuxNativeDeps('build:app:linux')

const env: NodeJS.ProcessEnv = { ...process.env }

try {
	env.AVENOS_ORT_DYLIB = ensureOnnxruntimeDylib(process.arch === 'x64' ? 'x86_64' : 'arm64')
} catch (e) {
	console.warn(`[build:app:linux] onnxruntime provisioning skipped: ${e instanceof Error ? e.message : e}`)
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