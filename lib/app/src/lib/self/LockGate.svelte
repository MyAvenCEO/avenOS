<script lang="ts">
	import { invoke } from '@tauri-apps/api/core'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import { getCurrentWindow } from '@tauri-apps/api/window'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { bootstrapJazzAfterUnlock } from '$lib/jazz/bootstrap'
	import {
		clearDeviceSession,
		deviceSession,
		devBypassUnlock,
		setUnlocked,
		DEVICE_PEER_SLOT,
	} from '$lib/self/device-session-store'

	type PeerStatus = {
		platformSupported: boolean
		registered: boolean
		unlocked: boolean
	}

	let loading = $state(false)
	let err = $state<string | undefined>()
	let showBypass = $state(false)

	const gated = $derived(
		browser && isTauriRuntime() && $deviceSession.kind === 'locked',
	)

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
					showBypass = import.meta.env.DEV && !st.platformSupported
					// Rust state survives webview reloads; reflect it if we landed unlocked.
					if (st.unlocked) {
						setUnlocked()
						void bootstrapJazzAfterUnlock()
					}
				}
			} catch {
				if (!cancelled) showBypass = import.meta.env.DEV
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

	async function unlock(): Promise<void> {
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
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}

	function bypass(): void {
		devBypassUnlock()
		void bootstrapJazzAfterUnlock()
	}
</script>

{#if gated}
	<div
		class="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background/95 px-6 py-10 backdrop-blur-md"
		role="dialog"
		aria-modal="true"
		aria-labelledby="lock-title"
	>
		<div class="max-w-md space-y-3 text-center">
			<h1 id="lock-title" class="text-lg font-semibold tracking-tight">Welcome back</h1>
			<p class="text-muted-foreground text-sm leading-relaxed">
				Use Touch ID to unlock your identity on this Mac. Everything stays local — no cloud, no
				account, no password.
			</p>
		</div>

		{#if err}
			<p class="text-destructive max-w-lg text-center text-xs leading-relaxed">{err}</p>
		{/if}

		<div class="flex flex-col gap-3 sm:flex-row">
			<button
				type="button"
				class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-2.5 text-sm font-medium disabled:opacity-50"
				disabled={loading}
				onclick={() => void unlock()}
			>
				{loading ? 'Unlocking…' : 'Unlock with Touch ID'}
			</button>
			{#if showBypass}
				<button
					type="button"
					class="border-input hover:bg-accent rounded-lg border px-6 py-2.5 text-sm font-medium"
					disabled={loading}
					onclick={bypass}
				>
					Continue without Touch ID (dev only)
				</button>
			{/if}
		</div>

		<p class="text-muted-foreground max-w-sm text-center text-[11px] leading-relaxed">
			First launch sets things up automatically. After that, just Touch ID.
		</p>
	</div>
{/if}
