<script lang="ts">
	import {
		peerMeshDotClass,
		peerMeshPhaseAnimating,
		peerMeshPhaseUserLabel,
		peerMeshHeaderPillSurfaceClass,
		peerMeshRailClass,
		peerMeshShortLabel,
		peerMeshTextClass,
		type PeerMeshPhase,
	} from '$lib/peer/mesh-state'

	import type { LinkHealth, PeerUsability } from '$lib/peer/mesh-state'
	import { peerMeshDisplayPhase } from '$lib/peer/mesh-state'
	import { t } from '$lib/i18n'

	type Props = {
		phase: PeerMeshPhase
		usability?: PeerUsability | null
		/** Global or per-device link health — half/none downgrades “ready” chips. */
		linkHealth?: LinkHealth | null
		/** Person name shown in header chips — phase is color-only unless `rail`. */
		displayName?: string
		title?: string
		/** Monospace + invite-code wording (during pairing before we know peer label). */
		monospaceName?: boolean
		/** `header` — top bar pill; `rail` — left column in peers list. */
		variant?: 'header' | 'rail'
	}

	let {
		phase,
		usability = null,
		linkHealth = null,
		displayName = '',
		title = '',
		monospaceName = false,
		variant = 'header',
	}: Props = $props()

	const displayPhase = $derived(peerMeshDisplayPhase(phase, usability, { linkHealth }))
	const labelOpts = $derived({ linkHealth })
	const animating = $derived(peerMeshPhaseAnimating(displayPhase))
	const dotClass = $derived(peerMeshDotClass(displayPhase))
	const textClass = $derived(peerMeshTextClass(displayPhase))
	const headerName = $derived(displayName.trim())
	const headerAriaLabel = $derived(
		headerName
			? monospaceName
				? t('peer.inviteCodeChip', {
						code: headerName,
						label: peerMeshPhaseUserLabel(phase, null, labelOpts),
					})
				: t('peer.peerChip', {
						name: headerName,
						label: peerMeshPhaseUserLabel(phase, usability, labelOpts),
					})
			: peerMeshPhaseUserLabel(phase, usability, labelOpts),
	)
</script>

{#if variant === 'rail'}
	<div
		class="flex w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1.5 border-r px-2 py-3 {peerMeshRailClass(
			displayPhase,
		)}"
		role="status"
		aria-live="polite"
		aria-label={t('peer.peerSyncStatus', {
			label: peerMeshPhaseUserLabel(phase, usability, labelOpts),
		})}
		{title}
	>
		{#if animating}
			<svg
				class="h-3.5 w-3.5 shrink-0 animate-spin opacity-90 {textClass}"
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
			<span class="h-2 w-2 shrink-0 rounded-full {dotClass}" aria-hidden="true"></span>
		{/if}
		<span
			class="text-center text-[9px] font-bold leading-tight tracking-widest uppercase {textClass}"
		>
			{peerMeshShortLabel(phase, { usability, linkHealth })}
		</span>
	</div>
{:else}
	<span
		class="inline-flex min-w-0 max-w-full items-center gap-2 truncate rounded-full px-2 py-1 text-[11px] font-medium leading-tight tracking-tight text-foreground/90 transition-colors {peerMeshHeaderPillSurfaceClass(
			displayPhase,
		)}"
		role="status"
		aria-live="polite"
		aria-label={t('peer.peerMeshChip', { label: headerAriaLabel })}
		{title}
	>
		{#if animating}
			<svg
				class="h-2 w-2 shrink-0 animate-spin opacity-90 {textClass}"
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
		{#if headerName}
			<span
				class={monospaceName
					? 'truncate font-mono text-[11px] font-semibold tracking-[0.14em]'
					: 'truncate'}
			>{headerName}</span>
		{/if}
	</span>
{/if}
