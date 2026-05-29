#!/usr/bin/env bun
/** Remove app/src-tauri/target — fixes stale proc-macro metadata (E0786) after moves or interrupted builds. */
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const target = path.join(
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
	'app/src-tauri/target',
)

rmSync(target, { recursive: true, force: true })
console.log(`[clean:app:rust] removed ${target}`)
