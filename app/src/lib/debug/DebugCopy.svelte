<script lang="ts">
import { AUTH_BASE_URL, getBearerToken } from '$lib/auth/auth-client'
import { capturedLogs, formatDebugReport, recentRustLogs } from '$lib/debug/console-capture'
import { copyToClipboard } from '$lib/runtime/clipboard'

// "Copy debug logs" affordance for shipped builds (no devtools). Assembles the shared debug
// report — auth/env state + Rust sync log + the captured console/fetch/error ring — and copies
// it; if the clipboard is blocked, reveals a read-only textarea to select + copy. board 0050.
let { compact = false }: { compact?: boolean } = $props()

let status = $state<'idle' | 'copied' | 'failed'>('idle')
let show = $state(false)
let report = $state('')

async function build(): Promise<string> {
	const state = {
		PUBLIC_BETTER_AUTH_URL: (import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined) ?? null,
		AUTH_BASE_URL,
		hasBearer: getBearerToken().length > 0,
		href: typeof location !== 'undefined' ? location.href : null,
		mode: import.meta.env.MODE,
		prod: import.meta.env.PROD
	}
	return formatDebugReport(state, await recentRustLogs())
}

async function copy(): Promise<void> {
	report = await build()
	const ok = await copyToClipboard(report)
	status = ok ? 'copied' : 'failed'
	if (!ok) show = true
	setTimeout(() => (status = 'idle'), 2500)
}

async function toggle(): Promise<void> {
	report = await build()
	show = !show
}
</script>

<div class="flex flex-col items-center gap-1.5">
	<div
		class="text-muted-foreground flex items-center gap-2 {compact ? 'text-[10px]' : 'text-[11px]'}"
	>
		<button
			type="button"
			class="hover:text-foreground font-semibold underline-offset-2 hover:underline"
			onclick={copy}
		>
			{status === 'copied'
				? 'Copied ✓'
				: status === 'failed'
					? 'Copy failed — select below'
					: 'Copy debug logs'}
		</button>
		<span class="opacity-50">·</span>
		<button
			type="button"
			class="hover:text-foreground underline-offset-2 hover:underline"
			onclick={toggle}
		>
			{show ? 'hide' : 'show'}
			({capturedLogs().length})
		</button>
	</div>
	{#if show}
		<textarea
			class="border-border bg-card text-foreground h-44 w-full max-w-md rounded-[var(--radius)] border p-2 text-[10px] leading-snug"
			readonly
			onfocus={(e) => e.currentTarget.select()}
		>
			{report}
		</textarea>
	{/if}
</div>
