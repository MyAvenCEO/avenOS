type OpenptyFn = typeof import('xterm-pty').openpty
type PtySlave = ReturnType<OpenptyFn>['slave']

/**
 * Loads webcm / Cartesi (Emscripten) and boots Linux with the xterm-pty slave.
 * Main thread only: webcm pairs the VM TTY with xterm-pty (upstream webcm index.html pattern).
 */
export async function startWebcmWithPty(slave: PtySlave, webcmMjsUrl: string): Promise<void> {
	const { default: initEmscripten } = await import(/* @vite-ignore */ webcmMjsUrl)
	await initEmscripten({ pty: slave })
}
