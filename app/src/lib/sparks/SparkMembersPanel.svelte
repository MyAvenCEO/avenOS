<script lang="ts">
	import { browser } from '$app/environment'
	import { withTimeoutMs } from '$lib/async-timeout'
	import {
		jazzSession,
		jazzStatus,
		sparkAdminAdd,
		sparkAdminList,
		type JazzSessionReply,
	} from '$lib/jazz/api'
	import { waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
	import type { PeerRowReply } from '$lib/peer/api'
	import { peerRows } from '$lib/peer/peer-mesh-store'
	import { peerDisplayLabel } from '$lib/peer/display-label'
	import PeerPickerSelect from '$lib/peer/PeerPickerSelect.svelte'
	import { pairingLabelForSession } from '$lib/settings/active-vault-ui'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { vaultList } from '$lib/settings/vault'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { t } from '$lib/i18n'

	let { sparkId }: { sparkId: string } = $props()

	type SparkCapKey = 'owner' | 'admin' | 'read' | 'write' | 'delete' | 'share'

	function sparkCapLabel(key: SparkCapKey): string {
		return t(`sparks.share.capabilities.${key}`)
	}

	const LOCAL_IPC_BUDGET_MS = 12_000

	let session = $state<JazzSessionReply | undefined>()
	let err = $state<string | undefined>()
	let busy = $state(false)
	let adminDids = $state<string[]>([])
	let adminErr = $state<string | undefined>()
	let adminBusy = $state(false)
	let addAdminDid = $state('')
	let addNote = $state<string | undefined>()
	let localPairingLabel = $state<string | undefined>(undefined)

	const sessionKind = $derived($deviceSession.kind)
	const unlocked = $derived(sessionKind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	const peersAllow = $derived<PeerRowReply[]>(
		!tauri || !unlocked || !sparkId.trim() ? [] : $peerRows,
	)

	function peerAccessLabel(
		peerDid: string,
		storedLabel: string | undefined,
		isThisDevice: boolean,
	): string {
		if (isThisDevice) return t('common.thisDevice')
		return peerDisplayLabel(peerDid, storedLabel, localPairingLabel)
	}

	type SparkAccessEntry = {
		did: string
		label: string
		isThisDevice: boolean
		capabilities: SparkCapKey[]
	}

	const accessEntries = $derived.by((): SparkAccessEntry[] => {
		const peersByDid = new Map(
			peersAllow.map((p) => [p.peerDid.trim().toLowerCase(), p] as const),
		)
		const localDid = session?.peerDid?.trim().toLowerCase() ?? ''
		return adminDids.map((did) => {
			const norm = did.trim().toLowerCase()
			const peer = peersByDid.get(norm)
			const isThisDevice = localDid !== '' && norm === localDid
			const label = peerAccessLabel(did, peer?.deviceLabel, isThisDevice)
			const capabilities: SparkCapKey[] = isThisDevice
				? ['owner', 'read', 'write', 'delete', 'share']
				: ['admin', 'read', 'write', 'delete']
			return { did, label, isThisDevice, capabilities }
		})
	})

	const selectablePeers = $derived.by(() => {
		const adminNorm = new Set(adminDids.map((d) => d.trim().toLowerCase()))
		return peersAllow.filter(
			(p) => p.status === 'active' && !adminNorm.has(p.peerDid.trim().toLowerCase()),
		)
	})

	const activeAllowlistPeers = $derived(peersAllow.filter((p) => p.status === 'active'))

	let adminLoadGen = 0

	async function loadSessionAndAdmins(): Promise<void> {
		if (!tauri || !unlocked) {
			session = undefined
			adminDids = []
			return
		}
		const sid = sparkId.trim()
		const gen = ++adminLoadGen
		busy = true
		err = undefined
		try {
			await withTimeoutMs(
				(async () => {
					await waitForGrooveSessionReady()
					const status = await jazzStatus()
					if (!status.ready) {
						throw new Error(t('errors.grooveShellNotReady'))
					}
					const nextSession = await jazzSession()
					if (gen !== adminLoadGen) return
					session = nextSession

					if (sid) {
						const a = await sparkAdminList(sid)
						if (gen !== adminLoadGen) return
						adminDids = a.adminDids
					} else {
						adminDids = []
					}
					addAdminDid = ''
					addNote = undefined
					adminErr = undefined
				})(),
				LOCAL_IPC_BUDGET_MS,
				t('errors.shareLoadingStalled'),
			)
		} catch (e) {
			if (gen !== adminLoadGen) return
			err = e instanceof Error ? e.message : String(e)
		} finally {
			if (gen === adminLoadGen) busy = false
		}
	}

	async function addAdmin(): Promise<void> {
		const did = addAdminDid.trim()
		const sid = sparkId.trim()
		if (!did || !sid) return
		const gen = adminLoadGen
		adminBusy = true
		adminErr = undefined
		addNote = undefined
		try {
			await sparkAdminAdd({ sparkId: sid, peerDid: did })
			if (gen !== adminLoadGen) return
			addAdminDid = ''
			addNote = t('sparks.share.accessGrantedNote')
			const a = await sparkAdminList(sid)
			if (gen !== adminLoadGen) return
			adminDids = a.adminDids
		} catch (e) {
			if (gen !== adminLoadGen) return
			adminErr = e instanceof Error ? e.message : String(e)
		} finally {
			if (gen === adminLoadGen) adminBusy = false
		}
	}

	$effect(() => {
		sessionKind
		void sparkId
		void unlocked
		void tauri
		adminDids = []
		addAdminDid = ''
		void loadSessionAndAdmins()
	})

	$effect(() => {
		if (!browser || !tauri || !unlocked) {
			localPairingLabel = undefined
			return
		}
		void sessionKind
		void $deviceSession
		void (async () => {
			try {
				const sessionVaultRows = await vaultList()
				localPairingLabel = pairingLabelForSession(sessionVaultRows, $deviceSession)
			} catch {
				localPairingLabel = undefined
			}
		})()
	})
</script>

{#if tauri && unlocked && sparkId.trim()}
	<section class="flex flex-col gap-2 px-0 md:px-2">
		<h3 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">
			{t('sparks.share.whoHasAccess')}
		</h3>

		{#if err}
			<p class="text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] select-text">{err}</p>
		{:else if busy && adminDids.length === 0}
			<p class="text-muted-foreground text-xs">{t('common.loadingAdmins')}</p>
		{:else if accessEntries.length === 0}
			<p class="text-muted-foreground text-xs">{t('sparks.share.noOneListed')}</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each accessEntries as entry (entry.did)}
					<li class="rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
						<p class="truncate text-sm font-medium" title={entry.label}>{entry.label}</p>
						{#if !entry.isThisDevice}
							<p class="text-muted-foreground truncate font-mono text-[10px] leading-snug select-text" title={entry.did}>{entry.did}</p>
						{/if}
						<div class="mt-1 flex flex-wrap gap-1">
							{#each entry.capabilities as cap (cap)}
								<span
									class="rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase
										{cap === 'owner' || cap === 'admin'
										? 'bg-primary/10 text-primary'
										: 'bg-muted text-muted-foreground'}">{sparkCapLabel(cap)}</span
								>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="mt-1 flex flex-col gap-1.5">
			<h3 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">
				{t('sparks.share.giveAccess')}
			</h3>
			{#if selectablePeers.length > 0}
				<PeerPickerSelect
					peers={selectablePeers}
					bind:value={addAdminDid}
					{localPairingLabel}
					disabled={adminBusy}
				/>
				<button
					type="button"
					class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
					disabled={adminBusy || !addAdminDid}
					onclick={() => void addAdmin()}
				>
					{adminBusy ? '…' : t('sparks.share.addAsAdmin')}
				</button>
			{:else if activeAllowlistPeers.length === 0}
				<p class="text-muted-foreground text-xs leading-relaxed">{t('sparks.share.noPairedPeersLead')}</p>
			{:else}
				<p class="text-muted-foreground text-xs leading-relaxed">{t('sparks.share.everyoneHasAccess')}</p>
			{/if}
			{#if adminErr}
				<p class="text-destructive text-[11px]">{adminErr}</p>
			{/if}
			{#if addNote}
				<p class="text-muted-foreground text-[11px]">{addNote}</p>
			{/if}
		</div>
	</section>
{/if}
