<script lang="ts">
	import { browser } from '$app/environment'
	import { deviceSession } from '$lib/self/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { peerList, peerTransportStatus } from '$lib/peer/api'

	type SyncState = 'offline' | 'ready' | 'connecting' | 'pairing' | 'linked'

	let syncState = $state<SyncState>('ready')
	let label = $state('')
	let title = $state('')

	const show = $derived(
		browser && isTauriRuntime() && $deviceSession.kind !== 'locked',
	)

	const animating = $derived(syncState === 'connecting' || syncState === 'pairing')

	function dotClassFor(s: SyncState): string {
		switch (s) {
			case 'offline':
				return 'bg-muted-foreground/50'
			case 'ready':
				return 'bg-foreground/35'
			case 'connecting':
			case 'pairing':
				return 'bg-[var(--color-status-info-base)] animate-pulse'
			case 'linked':
				return 'bg-[var(--color-status-working-base)]'
		}
	}

	function textClassFor(s: SyncState): string {
		switch (s) {
			case 'offline':
				return 'text-muted-foreground/70'
			case 'ready':
				return 'text-foreground/45'
			case 'connecting':
			case 'pairing':
				return 'text-[var(--color-status-info-base)]'
			case 'linked':
				return 'text-[var(--color-status-working-base)]'
		}
	}

	const dotClass = $derived(dotClassFor(syncState))
	const textClass = $derived(textClassFor(syncState))

	async function poll(): Promise<void> {
		if (!browser || !isTauriRuntime()) return
		if ($deviceSession.kind === 'locked') {
			label = ''
			title = ''
			return
		}

		try {
			const st = await peerTransportStatus()
			const peers = await peerList().catch(() => [] as Awaited<ReturnType<typeof peerList>>)
			const allowlisted = peers.filter((p) => p.status === 'active').length
			const linked = st.linkedPeerIds.length

			title = [
				`pk ${st.localPkPrefixHex}`,
				`linked ${linked}`,
				`allowlisted ${allowlisted}`,
				st.pairingCodePending ? `code ${st.pairingCodePending}` : null,
			]
				.filter(Boolean)
				.join(' · ')

			if (st.pairingCodePending) {
				syncState = 'pairing'
				label = 'Pairing…'
			} else if (!st.hyperswarmRunning) {
				syncState = 'offline'
				label = 'Offline'
			} else if (linked > 0) {
				syncState = 'linked'
				label = linked === 1 ? 'Syncing' : `Syncing · ${linked}`
			} else if (allowlisted > 0) {
				syncState = 'connecting'
				label = 'Connecting…'
			} else {
				syncState = 'ready'
				label = 'Ready'
			}
		} catch {
			syncState = 'offline'
			label = ''
			title = ''
		}
	}

	const pollMs = 5000

	$effect(() => {
		if (!show) return
		void poll()
		const id = window.setInterval(() => void poll(), pollMs)
		return () => clearInterval(id)
	})

	$effect(() => {
		if (!browser || !show) return
		const onFocus = () => void poll()
		window.addEventListener('focus', onFocus)
		return () => window.removeEventListener('focus', onFocus)
	})
</script>

{#if show && label}
	<span
		class="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate text-[10px] font-bold tracking-wider uppercase transition-colors {textClass}"
		role="status"
		aria-live="polite"
		aria-label="Peer sync: {label}"
		{title}
	>
		{#if animating}
			<svg
				class="h-2 w-2 shrink-0 animate-spin opacity-70"
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden="true"
			>
				<circle
					class="opacity-25"
					cx="12"
					cy="12"
					r="10"
					stroke="currentColor"
					stroke-width="3"
				/>
				<path
					class="opacity-90"
					fill="currentColor"
					d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
				/>
			</svg>
		{/if}
		{#if syncState !== 'pairing'}
			<span class="h-1.5 w-1.5 shrink-0 rounded-full {dotClass}" aria-hidden="true"></span>
		{/if}
		<span class="truncate">{label}</span>
	</span>
{/if}
