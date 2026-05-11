export interface Sandbox {
	run(command: string, options?: { cwd?: string; env?: Record<string, string> }): Promise<{
		stdout: string
		stderr: string
		exitCode: number
	}>
	writeFile(path: string, content: string | Uint8Array): Promise<void>
	readFile(path: string): Promise<Uint8Array>
	exists(path: string): Promise<boolean>
}

export interface SandboxFactory {
	createSandbox(input: { skill: 'memory' | 'ingest' | 'extract'; intentId: string; workerType: string }): Promise<Sandbox>
}