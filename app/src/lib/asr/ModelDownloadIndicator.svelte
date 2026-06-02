<script lang="ts">
import { formatBytesPair } from '$lib/asr/format'
/**
 * Ambient top-left download indicator for the on-device voice model. Mounted
 * once in the root layout (Tauri-guarded). Shows a thin progress bar + a small
 * model-name label while the model is downloading; hidden when idle/ready.
 */
import { asrState, downloadFraction } from '$lib/asr/model-download-store'

const visible = $derived($asrState.status === 'downloading' || $asrState.status === 'error')
const fraction = $derived(downloadFraction($asrState))
const sizeLabel = $derived(formatBytesPair($asrState.receivedBytes, $asrState.totalBytes))
</script>

{#if visible}
	<div
		class="pointer-events-none fixed left-2 top-2 z-50 flex w-56 max-w-[60vw] flex-col gap-1 rounded-lg border border-border/60 bg-background/90 px-2.5 py-1.5 shadow-sm backdrop-blur"
		role="status"
		aria-live="polite"
	>
		<div class="flex items-center justify-between gap-2">
			<span class="truncate text-[11px] font-medium tracking-tight text-foreground/80">
				{$asrState.model}
			</span>
			<span class="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
				{sizeLabel}
			</span>
		</div>
		<div class="h-1 w-full overflow-hidden rounded-full bg-muted">
			{#if fraction == null}
				<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
			{:else}
				<div
					class="h-full rounded-full bg-primary transition-[width] duration-300"
					style={`width: ${Math.round(fraction * 100)}%`}
				></div>
			{/if}
		</div>
		{#if $asrState.status === 'error'}
			<span class="text-[10px] leading-tight text-status-error">{$asrState.error}</span>
		{/if}
	</div>
{/if}
