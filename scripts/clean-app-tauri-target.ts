#!/usr/bin/env bun
/** Remove repo-wide Rust target + legacy per-crate dirs (see `.cargo/config.toml`). */
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dirs = [
	path.join(root, 'target/rust'),
	path.join(root, 'app/src-tauri/target'),
	path.join(root, 'libs/aven-db/target'),
	// Legacy wrong target-dir (../../../target/rust from app/src-tauri).
	path.join(root, '..', 'target/rust')
]

for (const dir of dirs) {
	rmSync(dir, { recursive: true, force: true })
	console.log(`[clean:app:rust] removed ${dir}`)
}
