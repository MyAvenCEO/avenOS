import { maiaAgent } from '$lib/aven/maia-agent'

/** Tailwind badge classes per tool name (Talk context aside). Client-safe — no fs / `.data` reads. */
export function memoryToolBadgeClasses(name: string): string {
	const tail = maiaAgent.contextPreview.toolBadgeTailwindClasses as
		| Record<string, string>
		| undefined
	return tail?.[name] ?? 'border-border/70 bg-white/25 text-foreground/85'
}
