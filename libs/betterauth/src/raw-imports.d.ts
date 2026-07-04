// Vite `?raw` imports (used inside @avenos/aven-vibes for the todos logic seed) — typed as plain strings
// so betterauth's tsc can compile modules that import the aven-vibes root. board 0115.
declare module '*?raw' {
	const content: string
	export default content
}
