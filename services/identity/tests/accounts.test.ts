import type pg from 'pg'
import { describe, expect, it } from 'vitest'
import { AccountService, type IdentityAccount } from '../src/lib/server/accounts.js'

describe('identity account provisioning', () => {
	it('stores the browser language when it creates the user', async () => {
		const account: IdentityAccount = {
			id: '3f7b0f1e-7850-4902-a7b0-093f8604a0dd',
			name: 'user',
			email: 'user@example.test',
			role: 'user'
		}
		const calls: Array<{ sql: string; parameters: unknown[] }> = []
		let selection = 0
		const pool = {
			async query(sql: string, parameters: unknown[] = []) {
				calls.push({ sql, parameters })
				if (sql.startsWith('SELECT')) {
					selection += 1
					return { rows: selection === 1 ? [] : [account] }
				}
				return { rows: [] }
			}
		} as unknown as pg.Pool

		expect(
			await new AccountService(pool).provisionVerified(' User@Example.Test ', 'de-DE')
		).toEqual(account)
		const insert = calls.find((call) => call.sql.startsWith('INSERT'))
		expect(insert?.sql).toContain('browser_language')
		expect(insert?.parameters.slice(1)).toEqual(['user', 'user@example.test', 'de-DE'])
	})
})
