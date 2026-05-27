<script lang="ts">
	import { browser } from '$app/environment'
	import { get } from 'svelte/store'
	import { listen } from '@tauri-apps/api/event'
	import { copyToClipboard } from '$lib/runtime/clipboard'
	import {
		peerInviteAccept,
		peerInviteCancel,
		peerInviteCreate,
		peerRevoke,
		peerSwarmRetry,
		avenosDhtTraceSnapshot,
		avenosRelayHttpsProbe,
		avenosRecentRustLogs,
		type DhtTraceSnapshot,
		type RelayHttpsProbe,
	} from '$lib/peer/api'
	import { deviceSession } from '$lib/self/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { pairingLabelForSession } from '$lib/self/active-vault-ui'
	import { peerPersonName } from '$lib/peer/display-label'
	import PeerMeshPhaseBadge from '$lib/peer/PeerMeshPhaseBadge.svelte'
	import { findPeerMeshPhase, peerMeshDetailSubLabel, peerMeshDetailSubTitle, peerMeshPhaseLabel } from '$lib/peer/mesh-state'
	import type { PeerRowReply } from '$lib/peer/api'
	import { peerMeshSnapshot, peerRows } from '$lib/peer/peer-mesh-store'
	import { vaultList } from '$lib/self/vault'

	let err = $state<string | undefined>()
	/** Full-panel spinner only for the first load — not background polls. */
	let initialLoading = $state(false)
	let loadGeneration = 0

	const mesh = $derived($peerMeshSnapshot)
	const rows = $derived($peerRows)
	let inviteCode = $state<string | undefined>()
	let copiedPairingCode = $state<string | undefined>()
	let acceptCode = $state('')
	let actionErr = $state<string | undefined>()
	let actionBusy = $state(false)
	let localPairingLabel = $state<string | undefined>(undefined)
	let rustLogs = $state<string[]>([])
	let diagnosticsCopied = $state(false)
	let diagnosticsCopying = $state(false)
	let diagnosticsCopyError = $state<string | undefined>(undefined)
	let dhtTrace = $state<DhtTraceSnapshot | undefined>(undefined)
	let httpsProbe = $state<RelayHttpsProbe | undefined>(undefined)
	let httpsProbeBusy = $state(false)

	function diagnosticsPayload() {
		if (!mesh?.p2pDiagnostics) return null
		return {
			hyperswarmRunning: mesh.hyperswarmRunning,
			hyperswarmStartError: mesh.hyperswarmStartError ?? null,
			localPkPrefixHex: mesh.localPkPrefixHex || null,
			pairingCodePending: mesh.pairingCodePending ?? null,
			dhtTrace: dhtTrace ?? null,
			relayHttpsProbe: httpsProbe ?? null,
			recentRustLogs: rustLogs,
			...mesh.p2pDiagnostics,
		}
	}

	const diagnosticsJson = $derived.by(() => {
		const payload = diagnosticsPayload()
		return payload ? JSON.stringify(payload, null, 2) : ''
	})

	async function loadRustLogs(): Promise<void> {
		if (!tauri) return
		try {
			rustLogs = await avenosRecentRustLogs()
		} catch {
			rustLogs = []
		}
		try {
			dhtTrace = await avenosDhtTraceSnapshot()
		} catch {
			dhtTrace = undefined
		}
	}

	async function runHttpsProbe(): Promise<void> {
		if (!tauri || httpsProbeBusy) return
		httpsProbeBusy = true
		const startMs = Date.now()
		try {
			httpsProbe = await avenosRelayHttpsProbe()
		} catch (e) {
			httpsProbe = {
				ok: false,
				error: e instanceof Error ? e.message : String(e),
				latencyMs: Date.now() - startMs,
			}
		} finally {
			httpsProbeBusy = false
		}
	}

	const httpsProbeSummary = $derived.by(() => {
		if (httpsProbeBusy) return 'probing TCP/443…'
		if (!httpsProbe) return 'TCP/443 probe not run yet'
		if (httpsProbe.ok) {
			return `TCP/443 ok · ${httpsProbe.status ?? '???'} · ${httpsProbe.latencyMs ?? '?'}ms`
		}
		return `TCP/443 FAILED · ${httpsProbe.error ?? 'unknown'}`
	})

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	const pairingPending = $derived(
		Boolean(inviteCode) || Boolean(mesh?.pairingCodePending),
	)

	const hostingInvite = $derived(Boolean(inviteCode?.trim()))

	type TrustedDeviceRow = PeerRowReply & {
		placeholder?: boolean
		pairingDetail?: string
		/** Outgoing invite code for this pairing ritual (host path). */
		pairingCode?: string
	}

	const activePairingCode = $derived(
		inviteCode?.trim() || mesh?.pairingCodePending?.trim() || undefined,
	)

	function pairingPlaceholderCopy(
		hostWaiting: boolean,
		linkedCount: number,
	): { title: string; detail: string } {
		if (linkedCount > 0) {
			return {
				title: 'Almost there…',
				detail: 'Finishing pairing and saving your connection on this device.',
			}
		}
		if (hostWaiting) {
			return {
				title: '',
				detail: 'Waiting for the other device — usually about 1–3 minutes.',
			}
		}
		return {
			title: 'Connecting to the other device…',
			detail: 'Usually about 1–3 minutes on the open internet.',
		}
	}

	const trustedRows = $derived.by((): TrustedDeviceRow[] => {
		if (!pairingPending) return rows

		const hasPairingRow = rows.some((r) => r.status === 'pairing')
		if (hasPairingRow) return rows

		const isHosting = Boolean(inviteCode?.trim())
		const savedActivePeers = rows.filter((r) => r.status === 'active')

		if (
			mesh &&
			savedActivePeers.length > 0 &&
			savedActivePeers.every((r) => {
				const ph = findPeerMeshPhase(mesh, r.peerDid, 'active')
				return ph === 'ready' || ph === 'syncing'
			})
		) {
			return rows
		}

		if (savedActivePeers.length > 0 && !isHosting) return rows

		const linked =
			mesh?.peers.filter((p) => p.phase === 'ready' || p.phase === 'syncing').length ?? 0
		const copy = pairingPlaceholderCopy(isHosting, linked)
		const placeholder: TrustedDeviceRow = {
			id: '__pairing_placeholder__',
			peerDid: '',
			deviceLabel: copy.title,
			pairingDetail: copy.detail,
			pairingCode: isHosting ? activePairingCode : undefined,
			kind: 'remote',
			addedAtMs: 0,
			status: 'pairing',
			placeholder: true,
		}

		return isHosting ? [placeholder, ...rows] : [...rows, placeholder]
	})

	function syncInviteCodeFromMesh(): void {
		const pending = get(peerMeshSnapshot)?.pairingCodePending?.trim()
		if (!pending) {
			if (inviteCode) {
				inviteCode = undefined
				copiedPairingCode = undefined
			}
			return
		}
		if (!inviteCode) inviteCode = pending
		if (get(peerRows).some((r) => r.status === 'active')) return
	}

	async function retryPeerNetwork(): Promise<void> {
		actionBusy = true
		actionErr = undefined
		try {
			await peerSwarmRetry()
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
		} finally {
			actionBusy = false
		}
	}

	async function trustNewPeer(): Promise<void> {
		if (pairingPending && hostingInvite) return
		actionBusy = true
		actionErr = undefined
		try {
			const r = await peerInviteCreate()
			inviteCode = r.code.trim()
			actionBusy = false
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
			actionBusy = false
		}
	}

	async function acceptInvite(): Promise<void> {
		actionBusy = true
		actionErr = undefined
		const code = acceptCode.trim()
		try {
			if (!mesh?.hyperswarmRunning) {
				throw new Error(
					'Peer network is still starting — wait a few seconds after unlock, then try again.',
				)
			}
			await peerInviteAccept(code)
			acceptCode = ''
			actionBusy = false
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
			actionBusy = false
		}
	}

	async function copyPairingCode(code: string): Promise<void> {
		const normalized = code.trim()
		if (!normalized) return
		const ok = await copyToClipboard(normalized)
		if (ok) {
			copiedPairingCode = normalized
			window.setTimeout(() => {
				if (copiedPairingCode === normalized) copiedPairingCode = undefined
			}, 2000)
		} else {
			copiedPairingCode = undefined
		}
	}

	/**
	 * Single-shot "Copy diagnostics" — always re-fetches every diagnostic source first
	 * (Rust logs, DHT trace counters, HTTPS reachability probe) so the clipboard payload
	 * captures the CURRENT state of the box rather than whatever was lazy-loaded earlier.
	 * On macOS App Sandbox the native clipboard plugin is required because
	 * `navigator.clipboard.writeText()` silently fails — see `copyToClipboard`.
	 */
	async function copyDiagnostics(): Promise<void> {
		if (!mesh?.p2pDiagnostics) return
		diagnosticsCopying = true
		diagnosticsCopyError = undefined
		try {
			if (tauri) {
				const [logsResult, traceResult] = await Promise.allSettled([
					avenosRecentRustLogs(),
					avenosDhtTraceSnapshot(),
				])
				if (logsResult.status === 'fulfilled') rustLogs = logsResult.value
				if (traceResult.status === 'fulfilled') dhtTrace = traceResult.value
				await runHttpsProbe()
			}
			const payload = diagnosticsPayload()
			if (!payload) {
				diagnosticsCopyError = 'no diagnostics available'
				return
			}
			const text = JSON.stringify(payload, null, 2)
			const ok = await copyToClipboard(text)
			if (ok) {
				diagnosticsCopied = true
				window.setTimeout(() => {
					diagnosticsCopied = false
				}, 2500)
			} else {
				diagnosticsCopyError = 'clipboard write failed (check OS permissions)'
			}
		} catch (e) {
			diagnosticsCopyError = e instanceof Error ? e.message : String(e)
		} finally {
			diagnosticsCopying = false
		}
	}

	async function cancelInvite(): Promise<void> {
		actionBusy = true
		actionErr = undefined
		try {
			await peerInviteCancel()
			inviteCode = undefined
			copiedPairingCode = undefined
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
		} finally {
			actionBusy = false
		}
	}

	async function revoke(did: string): Promise<void> {
		actionBusy = true
		actionErr = undefined
		try {
			await peerRevoke(did)
		} catch (e) {
			actionErr = e instanceof Error ? e.message : String(e)
		} finally {
			actionBusy = false
		}
	}

	$effect(() => {
		if (!unlocked || !tauri) {
			inviteCode = undefined
			initialLoading = false
			return
		}
		if (mesh !== undefined) {
			initialLoading = false
			return
		}
		initialLoading = true
		const gen = ++loadGeneration
		const t = window.setTimeout(() => {
			if (gen === loadGeneration) initialLoading = false
		}, 2500)
		return () => window.clearTimeout(t)
	})

	$effect(() => {
		if (!browser || !tauri || !unlocked) return

		const p = listen('peer:invite-paired', () => {
			inviteCode = undefined
			copiedPairingCode = undefined
		})

		return () => {
			void p.then((u) => u())
		}
	})

	$effect(() => {
		if (mesh) syncInviteCodeFromMesh()
	})

	$effect(() => {
		if (!browser || !tauri || !unlocked) {
			localPairingLabel = undefined
			return
		}
		void $deviceSession
		void (async () => {
			try {
				const vaultRows = await vaultList()
				localPairingLabel = pairingLabelForSession(vaultRows, $deviceSession)
			} catch {
				localPairingLabel = undefined
			}
		})()
	})
</script>

<section class="space-y-4">
	<h2 class="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/75">
		Connect with peer
	</h2>

	{#if err}
		<p class="text-destructive text-sm">{err}</p>
	{/if}

	{#if initialLoading}
		<p class="text-muted-foreground flex items-center gap-2 text-sm">
			<span class="peers-spinner shrink-0 opacity-60" aria-hidden="true"></span>
			<span>Getting things ready…</span>
		</p>
	{/if}

	<div class="rounded-xl border border-border/60 bg-card/30 p-3 sm:p-4">
		<h3 class="text-muted-foreground/75 mb-3 text-[10px] font-semibold tracking-wider uppercase">
			Join
		</h3>

		<div class="flex flex-col items-center gap-4 px-1 py-2 sm:py-4">
			{#if mesh?.p2pDiagnostics}
				<details
					class="text-muted-foreground w-full max-w-md text-left text-[10px] leading-relaxed"
					ontoggle={(e) => {
						if ((e.currentTarget as HTMLDetailsElement).open) void loadRustLogs()
					}}
				>
					<summary class="flex cursor-pointer list-none items-center justify-between gap-2 select-none font-medium [&::-webkit-details-marker]:hidden">
						<span>P2P diagnostics</span>
						<button
							type="button"
							class="text-primary hover:text-primary/80 shrink-0 text-[9px] font-semibold tracking-wide uppercase disabled:opacity-50"
							disabled={diagnosticsCopying}
							onclick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								void copyDiagnostics()
							}}
						>
							{#if diagnosticsCopying}
								copying…
							{:else if diagnosticsCopied}
								Copied
							{:else}
								Copy all
							{/if}
						</button>
					</summary>
					<div class="mt-2 space-y-1.5">
						{#if diagnosticsCopyError}
							<p class="text-destructive text-[10px]">{diagnosticsCopyError}</p>
						{/if}
						<p
							class="text-muted-foreground/80 text-[10px] tracking-tight"
							title="Set after the next Copy all click — runs an HTTPS GET against the relay's /.well-known/aven-relay.json"
						>
							{httpsProbeSummary}
						</p>
						<pre
							class="overflow-x-auto rounded-lg border border-border/50 bg-muted/20 p-2 font-mono text-[10px] whitespace-pre-wrap select-text">{diagnosticsJson}</pre>
					</div>
				</details>
			{/if}

			{#if mesh?.hyperswarmStartError}
				<div class="max-w-sm space-y-2 text-center">
					<p class="text-destructive text-xs leading-relaxed">{mesh.hyperswarmStartError}</p>
					<button
						type="button"
						class="text-primary text-xs font-semibold underline"
						disabled={actionBusy}
						onclick={() => void retryPeerNetwork()}
					>
						Retry peer network
					</button>
				</div>
			{:else if !initialLoading && mesh && !mesh.hyperswarmRunning}
				<p class="text-muted-foreground max-w-sm text-center text-xs leading-relaxed">
					Peer network is still starting — wait a few seconds after unlock.
				</p>
			{/if}

			<div class="mx-auto w-full max-w-md space-y-3">
				<label class="flex flex-col gap-2 text-xs">
					<span class="text-muted-foreground text-center font-medium">Code from other device</span>
					<input
						class="border-input bg-background placeholder:text-muted-foreground/35 h-14 w-full rounded-xl border px-4 text-center font-mono text-2xl font-semibold tracking-[0.35em] uppercase shadow-sm placeholder:tracking-normal"
						placeholder="ABC12X"
						maxlength={6}
						bind:value={acceptCode}
						autocomplete="off"
						autocorrect="off"
						spellcheck="false"
						inputmode="text"
						aria-label="Invite code from other device"
					/>
				</label>

				<button
					type="button"
					class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring mx-auto block min-h-11 min-w-[11rem] rounded-full px-8 text-sm font-semibold shadow-sm ring-offset-background focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
					disabled={actionBusy || acceptCode.trim().length < 6 || !mesh?.hyperswarmRunning}
					onclick={() => void acceptInvite()}
				>
					{actionBusy ? '…' : 'Accept'}
				</button>
			</div>
		</div>

		{#if actionErr}
			<p class="text-destructive mt-2 text-center text-xs">{actionErr}</p>
		{/if}
	</div>

	<div class="space-y-2">
		<h3 class="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground/75">
			Trusted peers
		</h3>

		<button
			type="button"
			class="group border-border/70 hover:bg-muted/35 hover:border-border focus-visible:ring-ring flex w-full flex-col items-center gap-2 rounded-xl border border-dashed bg-card/15 px-4 py-4 text-center transition-[background-color,border-color] ring-offset-background focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
			disabled={actionBusy || initialLoading || !mesh?.hyperswarmRunning || pairingPending}
			title={hostingInvite ? 'Cancel the active invite first' : 'Generate a code for another device'}
			onclick={() => void trustNewPeer()}
		>
			<span
				class="text-muted-foreground/80 group-hover:text-muted-foreground border-border/60 group-hover:border-border/80 flex size-9 shrink-0 items-center justify-center rounded-full border bg-background/60 text-xl font-light leading-none transition-colors"
				aria-hidden="true"
			>+</span
			>
			<span class="max-w-sm space-y-0.5">
				<span class="text-muted-foreground/90 block text-sm font-medium tracking-tight"
					>Trust new peer</span
				>
				<span class="text-muted-foreground/65 block text-[11px] leading-snug">
					{#if hostingInvite}
						Share the code below — or cancel to start over.
					{:else}
						Show a pairing code they can enter under Join.
					{/if}
				</span>
			</span>
		</button>

		{#if trustedRows.length === 0 && !hostingInvite}
			<p class="text-muted-foreground px-1 text-xs leading-snug">
				No trusted peers yet. Tap <span class="font-medium">Trust new peer</span> or enter a code
				above, then share sparks under
				<a href="/self/workspaces" class="text-primary font-medium underline">Self → Share</a>.
			</p>
		{:else if trustedRows.length > 0 || hostingInvite}
			<ul class="divide-border/60 divide-y overflow-hidden rounded-xl border border-border/60">
				{#each trustedRows as r (r.id)}
					{@const rowPhase = r.placeholder
						? 'pairing'
						: findPeerMeshPhase(mesh, r.peerDid, r.status)}
					{@const rowSubLabel = r.placeholder || !r.peerDid
						? null
						: peerMeshDetailSubLabel(mesh, r.peerDid, rowPhase)}
					{@const rowSubTitle = r.placeholder || !r.peerDid
						? null
						: peerMeshDetailSubTitle(mesh, r.peerDid, rowPhase)}
					<li
						class="flex overflow-hidden first:rounded-t-xl last:rounded-b-xl sm:items-stretch
							{r.placeholder ? 'bg-[color-mix(in_srgb,var(--color-status-pairing-base)_7%,transparent)]' : ''}"
					>
						<PeerMeshPhaseBadge
							phase={rowPhase}
							variant="rail"
							title={r.peerDid
								? `${r.peerDid} · ${peerMeshPhaseLabel(rowPhase)}`
								: peerMeshPhaseLabel(rowPhase)}
						/>
						<div
							class="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
						>
							<div class="min-w-0 flex-1">
								{#if r.placeholder && r.pairingCode}
									<div class="flex flex-wrap items-center gap-2">
										<span
											class="font-mono text-base font-bold tracking-[0.18em] text-foreground uppercase sm:text-lg"
											aria-label="Pairing code"
										>
											{r.pairingCode}
										</span>
										<button
											type="button"
											class="text-muted-foreground/80 border-border/70 hover:bg-muted/40 hover:text-foreground rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-[0.12em] uppercase transition-colors"
											onclick={() => void copyPairingCode(r.pairingCode!)}
										>
											{copiedPairingCode === r.pairingCode ? 'Copied' : 'Copy'}
										</button>
									</div>
									{#if r.pairingDetail}
										<p class="text-muted-foreground/65 mt-1 text-[11px] leading-snug">
											{r.pairingDetail}
										</p>
									{/if}
								{:else}
									<div class="font-medium">
										{r.placeholder
											? r.deviceLabel || '(no label)'
											: peerPersonName(r.peerDid, r.deviceLabel, localPairingLabel)}
									</div>
									{#if rowSubLabel}
										<p
											class="text-muted-foreground/75 mt-0.5 text-[10px] font-medium tracking-wide"
											title={rowSubTitle ?? undefined}
										>
											{rowSubLabel}
										</p>
									{/if}
									{#if r.pairingDetail}
										<p class="text-muted-foreground/65 mt-0.5 text-[11px] leading-snug">
											{r.pairingDetail}
										</p>
									{:else if r.peerDid}
										<div class="text-muted-foreground/65 font-mono text-[11px] break-all">
											{r.peerDid}
										</div>
									{/if}
								{/if}
							</div>
							{#if r.placeholder && r.pairingCode}
								<button
									type="button"
									class="text-muted-foreground border-border hover:bg-destructive/8 hover:border-destructive/45 hover:text-destructive shrink-0 self-center rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
									disabled={actionBusy}
									aria-label="Cancel outgoing invite"
									onclick={() => void cancelInvite()}
								>
									Cancel
								</button>
							{:else if r.status === 'active' && !r.placeholder}
								<button
									type="button"
									class="text-destructive border-destructive/40 hover:bg-destructive/10 shrink-0 rounded-md border px-3 py-1 text-xs"
									disabled={actionBusy}
									onclick={() => void revoke(r.peerDid)}
								>
									Remove
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>
