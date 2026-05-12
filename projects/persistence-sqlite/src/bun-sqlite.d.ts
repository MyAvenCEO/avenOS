declare module 'bun:sqlite' {
	export interface Statement<ReturnType = unknown> {
		run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
		get(...params: unknown[]): ReturnType | null
		all(...params: unknown[]): ReturnType[]
	}

	export class Database {
		constructor(filename?: string)
		exec(sql: string): this
		query<ReturnType = unknown>(sql: string): Statement<ReturnType>
	}
}