import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileMigrationProvider, Migrator } from 'kysely'
import { db } from './db'

// Kysely migrations for OUR tables (token usage + pricing). Run with `bun run db:migrate:usage`.
const migrationFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export async function migrateToLatest(): Promise<void> {
	const migrator = new Migrator({
		db: db(),
		provider: new FileMigrationProvider({ fs, path, migrationFolder })
	})
	const { error, results } = await migrator.migrateToLatest()
	for (const r of results ?? []) {
		console.log(`[migrate] ${r.migrationName}: ${r.status}`)
	}
	if (error) {
		console.error('[migrate] failed:', error)
		throw error
	}
}

if (import.meta.main) {
	await migrateToLatest()
	console.log('[migrate] up to date')
	process.exit(0)
}
