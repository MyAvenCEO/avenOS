<script lang="ts">
	import { invoke } from '@tauri-apps/api/core'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import { getCurrentWindow } from '@tauri-apps/api/window'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { bootstrapJazzAfterUnlock } from '$lib/jazz/bootstrap'
	import { clearDeviceSession, deviceSession, setUnlocked, DEVICE_PEER_SLOT } from '$lib/self/device-session-store'
	import {
		vaultCardTitle,
		vaultCreate,
		vaultList,
		vaultSelect,
		vaultSlugPreview,
		type VaultListEntry,
	} from '$lib/self/vault'

	type PeerStatus = {
		platformSupported: boolean
		registered: boolean
		unlocked: boolean
	}

	let loading = $state(false)
	let err = $state<string | undefined>()
	let vaults = $state<VaultListEntry[]>([])
	let mode = $state<'pick' | 'create'>('create')
	let firstName = $state('')
	let deviceName = $state('')
	let slugPreview = $state('')
	let selectedSlug = $state<string | undefined>()

	const gated = $derived(
		browser && isTauriRuntime() && $deviceSession.kind === 'locked',
	)

	async function refreshSlugPreview(): Promise<void> {
		const raw = firstName.trim()
		if (!raw) {
			slugPreview = ''
			return
		}
		try {
			slugPreview = await vaultSlugPreview(raw)
		} catch {
			slugPreview = '(invalid name)'
		}
	}

	$effect(() => {
		if (vaults.length === 0 && mode === 'pick') mode = 'create'
	})

	$effect(() => {
		firstName
		void (async () => {
			await refreshSlugPreview()
		})()
	})

	onMount(() => {
		if (!browser || !isTauriRuntime()) return

		let cancelled = false
		let unlistenClose: (() => void) | undefined

		void (async () => {
			try {
				const st = await invoke<PeerStatus>('plugin:self|peer_status', {
					slot: DEVICE_PEER_SLOT,
				})
				if (!cancelled) {
					vaults = await vaultList()
					if (vaults.length === 0) {
						mode = 'create'
					} else {
						mode = 'pick'
						selectedSlug = vaults.find((v) => v.hasIdentityBlob)?.usernameSlug ?? vaults[0]?.usernameSlug
					}
					if (st.unlocked) {
						setUnlocked()
						void bootstrapJazzAfterUnlock()
					}
				}
			} catch {
				/* peer_status / vault_list may fail before bridge ready */
			}

			if (!cancelled) {
				unlistenClose = await getCurrentWindow().onCloseRequested(() => {
					void clearDeviceSession()
				})
			}
		})()

		return () => {
			cancelled = true
			unlistenClose?.()
		}
	})

	async function runUnlockPipeline(): Promise<void> {
		if (!browser || !isTauriRuntime()) return
		loading = true
		err = undefined
		try {
			await invoke('plugin:self|register', { slot: DEVICE_PEER_SLOT })
			const genesisNetworkId = await invoke<number[]>('genesis_network_id')
			await invoke('plugin:self|unlock', {
				slot: DEVICE_PEER_SLOT,
				genesisNetworkId,
			})
			setUnlocked()
			await bootstrapJazzAfterUnlock()
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}

	async function unlockExisting(): Promise<void> {
		if (!selectedSlug) {
			err = 'Pick someone to continue.'
			return
		}
		loading = true
		err = undefined
		try {
			await vaultSelect(selectedSlug)
			await runUnlockPipeline()
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}

	async function createPerson(): Promise<void> {
		if (!firstName.trim()) {
			err = 'Add a first name.'
			return
		}
		if (!deviceName.trim()) {
			err = 'Tell us which Mac this is (e.g. MacBook Air).'
			return
		}
		loading = true
		err = undefined
		try {
			const created = await vaultCreate(firstName.trim(), deviceName.trim())
			vaults = await vaultList()
			mode = 'pick'
			selectedSlug = created.usernameSlug
			await vaultSelect(created.usernameSlug)
			await runUnlockPipeline()
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
</script>

{#if gated}
	<div
		class="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background px-6 py-10"
		role="dialog"
		aria-modal="true"
		aria-labelledby="lock-title"
	>
		<div class="max-w-md space-y-2 text-center">
			<h1 id="lock-title" class="text-lg font-semibold tracking-tight">Who are you?</h1>
			<p class="text-muted-foreground text-sm leading-relaxed">
				Your stuff stays on this Mac — no cloud account. Pick your space, then use Touch ID.
			</p>
		</div>

		{#if err}
			<p class="text-destructive max-w-lg text-center text-xs leading-relaxed">{err}</p>
		{/if}

		{#if mode === 'pick'}
			<div class="flex w-full max-w-md flex-col gap-3">
				<ul class="max-h-[40vh] space-y-2 overflow-y-auto">
						{#each vaults as v (v.usernameSlug)}
							<li>
								<label
									class="hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 px-4 py-3"
								>
									<input
										type="radio"
										class="mt-1"
										name="vaultSlug"
										checked={selectedSlug === v.usernameSlug}
										onchange={() => {
											selectedSlug = v.usernameSlug
										}}
									/>
									<div class="min-w-0 text-left">
										<div class="font-medium">{vaultCardTitle(v)}</div>
										<div class="text-muted-foreground text-[11px]">
											{#if v.deviceLabel}
												{v.deviceLabel}
											{:else}
												{v.usernameSlug}
											{/if}
											{#if !v.hasIdentityBlob}
												<span class="text-amber-600"> · Finish setup below</span>
											{/if}
										</div>
									</div>
								</label>
							</li>
						{/each}
					</ul>
				<div class="flex w-full flex-col gap-2">
					{#if vaults.length > 0}
						<button
							type="button"
							class="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg px-6 py-2.5 text-sm font-medium disabled:opacity-50"
							disabled={loading}
							onclick={() => void unlockExisting()}
						>
							{loading ? 'Unlocking…' : 'Log in with existing'}
						</button>
					{/if}
					<button
						type="button"
						class="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg px-6 py-2.5 text-sm font-medium disabled:opacity-50"
						disabled={loading}
						onclick={() => {
							mode = 'create'
							err = undefined
						}}
					>
						Create new self
					</button>
				</div>
			</div>
		{:else}
			<form
				class="flex w-full max-w-md flex-col gap-4"
				onsubmit={(e) => {
					e.preventDefault()
					void createPerson()
				}}
			>
				<label class="flex flex-col gap-1 text-left text-sm">
					<span class="text-muted-foreground">First name</span>
					<input
						class="border-input bg-background rounded-md border px-3 py-2"
						bind:value={firstName}
						autocomplete="given-name"
						placeholder="Alice"
					/>
				</label>
				<label class="flex flex-col gap-1 text-left text-sm">
					<span class="text-muted-foreground">Which device is this?</span>
					<input
						class="border-input bg-background rounded-md border px-3 py-2"
						bind:value={deviceName}
						autocomplete="off"
						placeholder="MacBook Air"
					/>
				</label>
				{#if slugPreview}
					<p class="text-muted-foreground text-[11px]">
						Folder: <span class="font-mono text-foreground">{slugPreview}</span>
					</p>
				{/if}
				<div class="flex w-full flex-col gap-2">
					<button
						type="submit"
						class="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg px-6 py-2.5 text-sm font-medium disabled:opacity-50"
						disabled={loading}
					>
						{loading ? 'Setting up…' : 'Continue with Touch ID'}
					</button>
					{#if vaults.length > 0}
						<button
							type="button"
							class="border-input hover:bg-accent w-full rounded-lg border px-6 py-2.5 text-sm font-medium"
							disabled={loading}
							onclick={() => {
								mode = 'pick'
								err = undefined
							}}
						>
							Back to sign-in
						</button>
					{/if}
				</div>
			</form>
		{/if}
	</div>
{/if}
