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

	type Props = {
		phase: PeerMeshPhase
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
		displayName = '',
		title = '',
		monospaceName = false,
		variant = 'header',
	}: Props = $props()

	const animating = $derived(peerMeshPhaseAnimating(phase))
	const dotClass = $derived(peerMeshDotClass(phase))
	const textClass = $derived(peerMeshTextClass(phase))
	const headerName = $derived(displayName.trim())
	const headerAriaLabel = $derived(
		headerName
			? monospaceName
				? `Invite code ${headerName}: ${peerMeshPhaseUserLabel(phase)}`
				: `${headerName}: ${peerMeshPhaseUserLabel(phase)}`
			: peerMeshPhaseUserLabel(phase),
	)
</script>

{#if variant === 'rail'}
	<div
		class="flex w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1.5 border-r px-2 py-3 {peerMeshRailClass(
			phase,
		)}"
		role="status"
		aria-live="polite"
		aria-label="Peer sync: {peerMeshPhaseUserLabel(phase)}"
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
			{peerMeshShortLabel(phase)}
		</span>
	</div>
{:else}
	<span
		class="inline-flex min-w-0 max-w-full items-center gap-2 truncate rounded-full px-2 py-1 text-[11px] font-medium leading-tight tracking-tight text-foreground/90 transition-colors {peerMeshHeaderPillSurfaceClass(
			phase,
		)}"
		role="status"
		aria-live="polite"
		aria-label="Peer mesh: {headerAriaLabel}"
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
