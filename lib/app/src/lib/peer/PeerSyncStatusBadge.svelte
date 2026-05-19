<script lang="ts">
	import {
		peerSyncDotClass,
		peerSyncLabel,
		peerSyncTextClass,
		type PeerSyncPhase,
	} from '$lib/peer/sync-display'

	type Props = {
		phase: PeerSyncPhase
		title?: string
		compact?: boolean
		/** Live mesh links; when connected, label becomes "{n} connected". */
		connectedCount?: number
	}

	let { phase, title = '', compact = false, connectedCount = 0 }: Props = $props()

	const label = $derived.by(() => {
		if (phase === 'connected' && connectedCount > 0) {
			return `${connectedCount} CONNECTED`
		}
		return peerSyncLabel(phase)
	})
	const animating = $derived(phase === 'pairing')
	const dotClass = $derived(peerSyncDotClass(phase))
	const textClass = $derived(peerSyncTextClass(phase))
	const sizeClass = $derived(compact ? 'text-[11px]' : 'text-[10px]')
</script>

<span
	class="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate font-bold tracking-wider uppercase transition-colors {sizeClass} {textClass}"
	role="status"
	aria-live="polite"
	aria-label="Peer sync: {label}"
	{title}
>
	{#if animating}
		<svg
			class="h-2 w-2 shrink-0 animate-spin opacity-80"
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
			<path
				class="opacity-90"
				fill="currentColor"
				d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
			/>
		</svg>
	{:else}
		<span class="h-1.5 w-1.5 shrink-0 rounded-full {dotClass}" aria-hidden="true"></span>
	{/if}
	<span class="truncate">{label}</span>
</span>
