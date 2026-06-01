<script lang="ts">
	import { browser } from '$app/environment'
	import { onDestroy } from 'svelte'
	import { AvenUiEngine, type UiEvent } from '@avenos/aven-ui'
	import { createVaultSecretsShell } from '@avenos/aven-ui/fixtures/vault-secrets'
	import {
		listenSandboxQjsState,
		mountRequestFromShell,
		sessionDispatch,
		sessionMount,
		sessionUnmount,
	} from '$lib/aven-ui/sandbox-qjs-session'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { t } from '$lib/i18n'
	import { destroyVaultEmbedWebview } from '$lib/vault/tauri-vault-embed'
	import {
		toStorageId,
		vaultSecretTitleKey,
		type VaultSecretKind,
	} from '$lib/vault/secret-kind'
	import {
		secretsDelete,
		secretsList,
		secretsReveal,
		secretsSet,
		type SecretListEntry,
	} from '$lib/vault/secrets'

	let { kind }: { kind: VaultSecretKind } = $props()

	let hostNode: HTMLElement | null = null
	let mountToken = 0
	let engine: AvenUiEngine | null = null
	let sessionId = $state<string | null>(null)
	let runtimeState = $state<Record<string, unknown> | null>(null)
	let revealed = $state<Record<string, string>>({})
	let panelError = $state<string | null>(null)
	let unlistenState: (() => void) | null = null

	const shell = createVaultSecretsShell()
	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const inTauri = isTauriRuntime()

	function vaultLabels() {
		return {
			description: t('vaultSecrets.description'),
			addTitle: t('vaultSecrets.addTitle'),
			idLabel: t('vaultSecrets.idLabel'),
			valueLabel: t('vaultSecrets.valueLabel'),
			listTitle: t('vaultSecrets.listTitle'),
			empty: t('vaultSecrets.empty'),
			reveal: t('vaultSecrets.reveal'),
			hide: t('vaultSecrets.hide'),
			addButton: t('common.add'),
			delete: t('common.delete'),
			loading: t('common.loading'),
		}
	}

	function buildSource(options: {
		secrets: SecretListEntry[]
		loading?: boolean
		error?: string | null
		busy?: boolean
	}) {
		return {
			kind,
			title: t(vaultSecretTitleKey(kind)),
			secrets: options.secrets,
			labels: vaultLabels(),
			loading: options.loading ?? false,
			error: options.error ?? '',
			busy: options.busy ?? false,
			newId: '',
			newValue: '',
			revealed,
		}
	}

	async function teardownSession(): Promise<void> {
		unlistenState?.()
		unlistenState = null
		if (sessionId) {
			try {
				await sessionUnmount(sessionId)
			} catch {
				// ignore teardown errors
			}
		}
		sessionId = null
	}

	async function teardownEngine(): Promise<void> {
		await teardownSession()
		await engine?.unmount()
		engine = null
	}

	async function mountPanel(options: {
		secrets: SecretListEntry[]
		loading?: boolean
		error?: string | null
		busy?: boolean
	}): Promise<void> {
		if (!hostNode || !browser || !inTauri || !unlocked) return

		const token = ++mountToken
		const host = hostNode
		const currentKind = kind
		panelError = null

		try {
			await teardownEngine()
			if (token !== mountToken || hostNode !== host || kind !== currentKind) return

			const source = buildSource(options)
			const mounted = await sessionMount({ ...mountRequestFromShell(shell), source })
			if (token !== mountToken || hostNode !== host || kind !== currentKind) {
				await sessionUnmount(mounted.sessionId).catch(() => {})
				return
			}

			sessionId = mounted.sessionId
			runtimeState = mounted.state

			engine = new AvenUiEngine({
				container: host,
				containerName: 'aven-ui-vault-secrets',
				onEvent: (event: UiEvent) => {
					void handleEvent(event, token)
				},
			})
			await engine.mount({
				view: shell.view,
				style: shell.style,
				state: mounted.state,
			})
			if (token !== mountToken) {
				await teardownEngine()
				return
			}

			unlistenState = await listenSandboxQjsState((event) => {
				if (event.sessionId !== sessionId || token !== mountToken) return
				runtimeState = event.state
				void engine?.replaceState(event.state)
			})
		} catch (err) {
			if (token !== mountToken) return
			panelError = err instanceof Error ? err.message : String(err)
		}
	}

	async function reloadSecrets(options: {
		error?: string | null
		busy?: boolean
	}): Promise<void> {
		try {
			const secrets = await secretsList()
			await mountPanel({
				secrets,
				loading: false,
				error: options.error ?? null,
				busy: options.busy ?? false,
			})
		} catch (err) {
			await mountPanel({
				secrets: [],
				loading: false,
				error: options.error ?? (err instanceof Error ? err.message : String(err)),
				busy: false,
			})
		}
	}

	async function handleEvent(event: UiEvent, token: number): Promise<void> {
		if (!sessionId || token !== mountToken) return

		if (event.send === 'ADD_SECRET') {
			const storageId = toStorageId(kind, String(event.payload.id ?? ''))
			const value = String(event.payload.value ?? '')
			if (!storageId) return
			try {
				await secretsSet(storageId, value)
				revealed = {}
				await reloadSecrets({ error: null })
			} catch (err) {
				await reloadSecrets({ error: err instanceof Error ? err.message : String(err) })
			}
			return
		}

		if (event.send === 'TOGGLE_REVEAL') {
			const id = String(event.payload.id ?? '')
			if (!id) return
			if (revealed[id]) {
				const next = { ...revealed }
				delete next[id]
				revealed = next
				await reloadSecrets({ error: null })
				return
			}
			try {
				revealed = { ...revealed, [id]: await secretsReveal(id) }
				await reloadSecrets({ error: null })
			} catch (err) {
				await reloadSecrets({ error: err instanceof Error ? err.message : String(err) })
			}
			return
		}

		if (event.send === 'DELETE_SECRET') {
			const id = String(event.payload.id ?? '')
			if (!id) return
			try {
				await secretsDelete(id)
				const next = { ...revealed }
				delete next[id]
				revealed = next
				await reloadSecrets({ error: null })
			} catch (err) {
				await reloadSecrets({ error: err instanceof Error ? err.message : String(err) })
			}
		}
	}

	async function remountIfReady(): Promise<void> {
		if (!hostNode || !browser || !inTauri || !unlocked) return
		await destroyVaultEmbedWebview()
		await reloadSecrets({ error: null })
	}

	function attachHost(element: HTMLElement) {
		hostNode = element
		void remountIfReady()
		return () => {
			if (hostNode === element) hostNode = null
			mountToken += 1
			void teardownEngine()
		}
	}

	onDestroy(() => {
		mountToken += 1
		void teardownEngine()
	})
</script>

<section class="flex h-full min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-6">
	{#if !unlocked}
		<p class="text-muted-foreground py-8 text-sm">{t('vaultNav.lockedHint')}</p>
	{:else}
		{#if panelError}
			<p class="text-destructive mb-4 shrink-0 text-sm" role="alert">{panelError}</p>
		{/if}
		{#key kind}
			<div {@attach attachHost} class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"></div>
		{/key}
	{/if}
</section>
