import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { SqlitePersistence } from '@jaensen/persistence-sqlite'

export interface CreateSqlitePersistenceInput {
	path: string
}

export async function createSqlitePersistence(
	input: CreateSqlitePersistenceInput
): Promise<SqlitePersistence> {
	const directory = path.dirname(input.path)
	if (directory && directory !== '.') {
		await mkdir(directory, { recursive: true })
	}

	return new SqlitePersistence({ filename: input.path })
}