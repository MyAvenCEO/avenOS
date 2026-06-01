#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(root, '../..')
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')

const child = spawn('node', [viteBin, 'preview', '--port', '3000'], {
	cwd: root,
	stdio: 'inherit',
	env: process.env,
})

child.on('exit', (code) => process.exit(code ?? 0))
