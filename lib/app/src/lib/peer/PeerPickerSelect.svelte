<script lang="ts">
	import type { PeerRowReply } from './api'
	import { peerPickerLines } from './display-label'

	let {
		peers,
		value = $bindable(''),
		localPairingLabel,
		placeholder = 'Select a paired peer…',
		disabled = false,
	}: {
		peers: PeerRowReply[]
		value?: string
		localPairingLabel?: string
		placeholder?: string
		disabled?: boolean
	} = $props()

	let open = $state(false)
	let rootEl = $state<HTMLDivElement | undefined>()

	const selectedPeer = $derived(peers.find((p) => p.peerDid === value))
	const selectedLines = $derived(
		selectedPeer
			? peerPickerLines(selectedPeer.peerDid, selectedPeer.deviceLabel, localPairingLabel)
			: null,
	)

	function select(peerDid: string): void {
		value = peerDid
		open = false
	}

	function toggle(): void {
		if (disabled) return
		open = !open
	}

	$effect(() => {
		if (!open) return
		function onDocClick(event: MouseEvent): void {
			if (rootEl && !rootEl.contains(event.target as Node)) open = false
		}
		function onKey(event: KeyboardEvent): void {
			if (event.key === 'Escape') open = false
		}
		document.addEventListener('click', onDocClick, true)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('click', onDocClick, true)
			document.removeEventListener('keydown', onKey)
		}
	})
</script>

<div bind:this={rootEl} class="relative min-w-0 flex-1">
	<button
		type="button"
		class="border-input bg-background hover:bg-surface-card-hover flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
		aria-expanded={open}
		aria-haspopup="listbox"
		{disabled}
		onclick={toggle}
	>
		<span class="min-w-0 flex-1">
			{#if selectedLines}
				<span class="block truncate font-medium">{selectedLines.title}</span>
				{#if selectedLines.device}
					<span class="text-muted-foreground block truncate text-[11px] leading-snug">
						{selectedLines.device}
					</span>
				{/if}
			{:else}
				<span class="text-muted-foreground block truncate">{placeholder}</span>
			{/if}
		</span>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="text-muted-foreground size-4 shrink-0 transition-transform {open ? 'rotate-180' : ''}"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>

	{#if open}
		<ul
			class="border-border bg-background absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border py-1 shadow-md"
			role="listbox"
			aria-label={placeholder}
		>
			{#each peers as peer (peer.id)}
				{@const lines = peerPickerLines(peer.peerDid, peer.deviceLabel, localPairingLabel)}
				{@const selected = peer.peerDid === value}
				<li role="presentation">
					<button
						type="button"
						class="hover:bg-surface-card-hover flex w-full flex-col items-stretch gap-0 px-3 py-2 text-left text-sm transition-colors
							{selected ? 'bg-surface-card-selected' : ''}"
						role="option"
						aria-selected={selected}
						onclick={() => select(peer.peerDid)}
					>
						<span class="block truncate font-medium">{lines.title}</span>
						{#if lines.device}
							<span class="text-muted-foreground block truncate text-[11px] leading-snug">
								{lines.device}
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
