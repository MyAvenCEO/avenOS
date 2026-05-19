<script lang="ts">
	import { browser } from '$app/environment'
	import { deviceSession } from '$lib/self/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { peerList, peerTransportStatus } from '$lib/peer/api'
	import PeerSyncStatusBadge from '$lib/peer/PeerSyncStatusBadge.svelte'
	import { derivePeerSyncPhase, type PeerSyncPhase } from '$lib/peer/sync-display'

	let phase = $state<PeerSyncPhase>('offline')
	let title = $state('')
	let connectedCount = $state(0)

	const show = $derived(
		browser && isTauriRuntime() && $deviceSession.kind !== 'locked',
	)

	async function poll(): Promise<void> {
		if (!browser || !isTauriRuntime()) return
		if ($deviceSession.kind === 'locked') {
			title = ''
			phase = 'offline'
			connectedCount = 0
			return
		}

		try {
			const st = await peerTransportStatus()
			const peers = await peerList().catch(() => [] as Awaited<ReturnType<typeof peerList>>)
			const allowlisted = peers.filter((p) => p.status === 'active').length
			connectedCount = st.linkedPeerIds.length

			title = [
				`pk ${st.localPkPrefixHex}`,
				`linked ${st.linkedPeerIds.length}`,
				`allowlisted ${allowlisted}`,
				st.pairingCodePending ? `code ${st.pairingCodePending}` : null,
			]
				.filter(Boolean)
				.join(' · ')

			phase = derivePeerSyncPhase(st, allowlisted)
		} catch {
			phase = 'offline'
			title = ''
			connectedCount = 0
		}
	}

	$effect(() => {
		if (!show) return
		void poll()
		const ms = phase === 'pairing' ? 2500 : 5000
		const id = window.setInterval(() => void poll(), ms)
		return () => clearInterval(id)
	})

	$effect(() => {
		if (!browser || !show) return
		const onFocus = () => void poll()
		window.addEventListener('focus', onFocus)
		return () => window.removeEventListener('focus', onFocus)
	})
</script>

{#if show}
	<PeerSyncStatusBadge {phase} {title} {connectedCount} />
{/if}
