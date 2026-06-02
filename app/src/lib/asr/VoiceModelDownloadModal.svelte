<script lang="ts">
import { formatBytesPair } from '$lib/asr/format'
/**
 * Mini modal shown when the user clicks the mic before the on-device voice
 * model is ready. Renders the download progress bar + a short description of
 * what's happening (instead of recording). Dismissible; if the model becomes
 * ready while open it flips to a "ready — tap the mic" state.
 */
import { asrState, downloadFraction } from '$lib/asr/model-download-store'

let { open = $bindable(false) }: { open?: boolean } = $props()

const fraction = $derived(downloadFraction($asrState))
const sizeLabel = $derived(formatBytesPair($asrState.receivedBytes, $asrState.totalBytes))
const status = $derived($asrState.status)

function close() {
	open = false
}

function onKeydown(e: KeyboardEvent) {
	if (e.key === 'Escape') {
		e.preventDefault()
		close()
	}
}

const description = $derived.by(() => {
	switch (status) {
		case 'ready':
			return 'The voice model is ready — tap the mic to record your note.'
		case 'error':
			return `Couldn't set up on-device transcription. ${$asrState.error ?? ''}`.trim()
		case 'unavailable':
			return 'On-device voice transcription is not available in this build.'
		default:
			return 'Setting up on-device voice transcription. This runs once and works offline afterwards — your audio never leaves the device.'
	}
})
</script>

<svelte:window on:keydown={open ? onKeydown : undefined} />

{#if open}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
		<!-- backdrop: real button so the click-to-close target is keyboard-accessible -->
		<button
			type="button"
			class="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
			aria-label="Close"
			onclick={close}
		></button>
		<div
			class="relative w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-label="On-device voice model"
			tabindex="-1"
		>
			<div class="mb-3 flex items-center justify-between gap-3">
				<h2 class="text-sm font-semibold tracking-tight text-foreground">
					{status === 'ready' ? 'Voice model ready' : 'Preparing voice transcription'}
				</h2>
				<button
					type="button"
					class="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35"
					onclick={close}
					aria-label="Close"
				>
					<svg
						class="size-4"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			{#if status === 'downloading' || status === 'idle'}
				<div class="mb-2 flex items-center justify-between gap-2">
					<span class="text-xs font-medium text-foreground/80">{$asrState.model}</span>
					<span class="font-mono text-[11px] tabular-nums text-muted-foreground">{sizeLabel}</span>
				</div>
				<div class="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
					{#if fraction == null}
						<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
					{:else}
						<div
							class="h-full rounded-full bg-primary transition-[width] duration-300"
							style={`width: ${Math.round(fraction * 100)}%`}
						></div>
					{/if}
				</div>
			{/if}

			<p class="text-xs leading-relaxed text-muted-foreground">{description}</p>
		</div>
	</div>
{/if}
