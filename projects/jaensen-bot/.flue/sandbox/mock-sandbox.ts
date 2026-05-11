import type { Sandbox, SandboxFactory } from './types.js'

export class MockSandboxFactory implements SandboxFactory {
	constructor(private handler?: (command: string) => { stdout?: string; stderr?: string; exitCode?: number }) {}
	async createSandbox(): Promise<Sandbox> {
		const files = new Map<string, Uint8Array>()
		return {
			run: async (command: string) => {
				const result = this.handler?.(command)
				return { stdout: result?.stdout ?? '', stderr: result?.stderr ?? '', exitCode: result?.exitCode ?? 0 }
			},
			writeFile: async (path: string, content: string | Uint8Array) => {
				files.set(path, typeof content === 'string' ? new TextEncoder().encode(content) : content)
			},
			readFile: async (path: string) => files.get(path) ?? new Uint8Array(),
			exists: async (path: string) => files.has(path)
		}
	}
}