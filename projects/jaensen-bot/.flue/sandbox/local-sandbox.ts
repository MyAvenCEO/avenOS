import { execFile } from 'child_process'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { promisify } from 'util'
import type { Sandbox, SandboxFactory } from './types.js'

const execFileAsync = promisify(execFile)
const BWRAP_BIN = '/usr/bin/bwrap'
const SANDBOX_WORKDIR = '/workspace'
const SANDBOX_DOCUMENTS_DIR = '/documents'

export class LocalSandboxFactory implements SandboxFactory {
	constructor(private rootDir: string, private documentDir?: string) {}
	async createSandbox(input: { skill: 'memory' | 'ingest' | 'extract'; intentId: string; workerType: string }): Promise<Sandbox> {
		const dir = resolve(this.rootDir, `${input.intentId}-${input.skill}-${input.workerType}`)
		await mkdir(dir, { recursive: true })
		console.log('[jaensen] sandbox:create', { ...input, dir, documentDir: this.documentDir })
		return new LocalSandbox(dir, this.documentDir)
	}
}

class LocalSandbox implements Sandbox {
	constructor(private rootDir: string, private documentDir?: string) {}
	async run(command: string, options?: { cwd?: string; env?: Record<string, string> }) {
		const requestedCwd = options?.cwd ? this.resolveSandboxPath(options.cwd) : this.rootDir
		const shellEnv = sanitizeEnv(options?.env)
		console.log('[jaensen] sandbox:run', { cwd: requestedCwd, command })
		try {
			const { stdout, stderr } = await execFileAsync(BWRAP_BIN, buildBubblewrapArgs(this.rootDir, requestedCwd, command, this.documentDir), {
				env: shellEnv,
				maxBuffer: 1024 * 1024
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
	async writeFile(path: string, content: string | Uint8Array) {
		const resolved = this.resolveSandboxPath(path)
		await mkdir(dirname(resolved), { recursive: true })
		await writeFile(resolved, content)
	}
	async readFile(path: string) { return new Uint8Array(await readFile(this.resolveSandboxPath(path))) }
	async exists(path: string) { try { await stat(this.resolveSandboxPath(path)); return true } catch { return false } }

	private resolveSandboxPath(path: string) {
		const resolved = resolve(this.rootDir, path)
		if (resolved !== this.rootDir && !resolved.startsWith(`${this.rootDir}/`)) {
			throw new Error(`Sandbox path escape blocked: ${path}`)
		}
		return resolved
	}
}

function buildBubblewrapArgs(rootDir: string, cwd: string, command: string, documentDir?: string): string[] {
	const cwdInsideSandbox = toSandboxCwd(rootDir, cwd)
	const args = [
		'--die-with-parent',
		'--new-session',
		'--unshare-all',
		'--hostname', 'jaensen-sandbox',
		'--ro-bind', '/usr', '/usr',
		'--ro-bind', '/bin', '/bin',
		'--ro-bind', '/lib', '/lib',
		'--ro-bind', '/lib64', '/lib64',
		'--ro-bind-try', '/sbin', '/sbin',
		'--ro-bind-try', '/etc/alternatives', '/etc/alternatives',
	]
	if (documentDir) {
		args.push(
			'--ro-bind',
			documentDir,
			SANDBOX_DOCUMENTS_DIR,
			'--setenv',
			'JAENSEN_DOCUMENTS_DIR',
			SANDBOX_DOCUMENTS_DIR
		)
	}
	args.push(
		'--proc', '/proc',
		'--dev', '/dev',
		'--tmpfs', '/tmp',
		'--tmpfs', '/var/tmp',
		'--dir', '/workspace',
		'--bind', rootDir, '/workspace',
		'--chdir', cwdInsideSandbox,
		'--setenv', 'HOME', '/workspace',
		'--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
		'--setenv', 'TMPDIR', '/tmp',
		'--',
		'/bin/bash',
		'--noprofile',
		'--norc',
		'-c',
		command
	)
	return args
}

function toSandboxCwd(rootDir: string, cwd: string): string {
	if (cwd === rootDir) return SANDBOX_WORKDIR
	const relative = cwd.slice(rootDir.length).replace(/^\/+/, '')
	return relative ? `${SANDBOX_WORKDIR}/${relative}` : SANDBOX_WORKDIR
}

function sanitizeEnv(extra?: Record<string, string>): Record<string, string> {
	return {
		PATH: '/usr/local/bin:/usr/bin:/bin',
		LANG: process.env.LANG ?? 'C.UTF-8',
		LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
		...(extra ?? {})
	}
}