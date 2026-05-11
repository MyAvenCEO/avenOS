import { exec } from 'child_process'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'
import type { Sandbox, SandboxFactory } from './types.js'

const execAsync = promisify(exec)

export class LocalSandboxFactory implements SandboxFactory {
	constructor(private rootDir: string) {}
	async createSandbox(input: { skill: 'memory' | 'ingest' | 'extract'; intentId: string; workerType: string }): Promise<Sandbox> {
		const dir = join(this.rootDir, `${input.intentId}-${input.skill}-${input.workerType}`)
		await mkdir(dir, { recursive: true })
		console.log('[jaensen] sandbox:create', { ...input, dir })
		return new LocalSandbox(dir)
	}
}

class LocalSandbox implements Sandbox {
	constructor(private rootDir: string) {}
	async run(command: string, options?: { cwd?: string; env?: Record<string, string> }) {
		console.log('[jaensen] sandbox:run', { cwd: options?.cwd ?? this.rootDir, command })
		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd: options?.cwd ?? this.rootDir,
				env: { ...process.env, ...options?.env },
				shell: '/bin/bash'
			})
			console.log('[jaensen] sandbox:result', { exitCode: 0, stdout: stdout.slice(0, 400), stderr: stderr.slice(0, 400) })
			return { stdout, stderr, exitCode: 0 }
		} catch (error) {
			const err = error as { stdout?: string; stderr?: string; code?: number }
			console.warn('[jaensen] sandbox:error', {
				exitCode: err.code ?? 1,
				stdout: (err.stdout ?? '').slice(0, 400),
				stderr: (err.stderr ?? '').slice(0, 400)
			})
			return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', exitCode: err.code ?? 1 }
		}
	}
	async writeFile(path: string, content: string | Uint8Array) { await writeFile(join(this.rootDir, path), content) }
	async readFile(path: string) { return new Uint8Array(await readFile(join(this.rootDir, path))) }
	async exists(path: string) { try { await stat(join(this.rootDir, path)); return true } catch { return false } }
}