// Vite's `?raw` import (the todos vibe loads its QuickJS logic as a raw string).
declare module '*?raw' {
	const content: string
	export default content
}
