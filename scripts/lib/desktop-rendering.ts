/** Scope graphics workarounds to the child process, never the calling shell. */
export function desktopRenderingEnv(
	env: NodeJS.ProcessEnv,
	platform: string,
	mode = 'auto'
): NodeJS.ProcessEnv {
	if (mode !== 'auto' && mode !== 'software') {
		throw new Error(`Unknown desktop rendering mode: ${mode}. Use auto or software.`)
	}
	const result = { ...env }
	if (platform === 'linux' && mode === 'software') {
		result.WEBKIT_DISABLE_DMABUF_RENDERER = '1'
		result.WEBKIT_DISABLE_COMPOSITING_MODE = '1'
	}
	// In auto mode WebKit chooses the available renderer. Explicit operator
	// workarounds remain respected; auto does not force unsupported GPU paths.
	return result
}
