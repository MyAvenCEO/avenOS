<script lang="ts">
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import PeerMeshPhaseBadge from '$lib/peer/PeerMeshPhaseBadge.svelte'
	import { peerPersonName } from '$lib/peer/display-label'
	import { peerMeshPhaseLabel, peerMeshPhaseUserLabel } from '$lib/peer/mesh-state'
	import { peerMeshSnapshot } from '$lib/peer/peer-mesh-store'

	const show = $derived(
		browser &&
			isTauriRuntime() &&
			$deviceSession.kind === 'unlocked',
	)

	const mesh = $derived($peerMeshSnapshot)

	const pendingInviteCode = $derived(mesh?.pairingCodePending?.trim() ?? '')

	const title = $derived.by(() => {
		if (!mesh) return ''
		return [
			`pk ${mesh.localPkPrefixHex}`,
			mesh.hyperswarmRunning ? 'swarm up' : 'swarm down',
			mesh.pairingCodePending ? `code ${mesh.pairingCodePending}` : null,
			...mesh.peers.map((p) => {
				const showInviteInstead =
					Boolean(pendingInviteCode) && p.phase === 'pairing' && !p.deviceLabel?.trim()
				const head = showInviteInstead
					? `invite ${pendingInviteCode}`
					: peerPersonName(p.peerDid, p.deviceLabel, undefined)
				return `${head}: ${peerMeshPhaseUserLabel(p.phase)}`
			}),
		]
			.filter(Boolean)
			.join(' · ')
	})
</script>

{#if show && mesh}
	<div
		class="flex min-w-0 max-w-[min(100%,42rem)] flex-row flex-wrap items-center gap-x-3 gap-y-1"
		role="status"
		aria-label={t('peer.meshStatus')}
		title={title}
	>
		{#if mesh.peers.length === 0 && pendingInviteCode}
			{@const hostPairingChipTitle =
				pendingInviteCode + ' · ' + peerMeshPhaseLabel('pairing')}
			<PeerMeshPhaseBadge
				phase="pairing"
				variant="header"
				linkHealth={mesh.p2pDiagnostics.linkHealth}
				displayName={pendingInviteCode}
				monospaceName={true}
				title={hostPairingChipTitle}
			/>
		{:else}
			{#each mesh.peers as p (p.peerDid)}
				{@const showInviteInstead =
					Boolean(pendingInviteCode) && p.phase === 'pairing' && !p.deviceLabel?.trim()}
				{@const peerChipTitle = showInviteInstead
					? `${pendingInviteCode} · ${peerMeshPhaseLabel(p.phase)}`
					: `${p.peerDid} · ${peerMeshPhaseLabel(p.phase)}`}
				<PeerMeshPhaseBadge
					phase={p.phase}
					usability={p.usability}
					linkHealth={mesh.p2pDiagnostics.linkHealth}
					variant="header"
					displayName={showInviteInstead
						? pendingInviteCode
						: peerPersonName(p.peerDid, p.deviceLabel, undefined)}
					monospaceName={showInviteInstead}
					title={peerChipTitle}
				/>
			{/each}
		{/if}
	</div>
{/if}
