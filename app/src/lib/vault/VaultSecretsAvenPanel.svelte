<script lang="ts">
	/**
	 * Vault secrets panel — renders the `vault-secrets` aven-ui vibe through the
	 * shared `AvenUiView`. View events (ADD / TOGGLE_REVEAL / DELETE) are
	 * host-handled here against the Tauri vault commands; each mutation reloads
	 * the secret list, which rebuilds `source` and re-mounts the view with fresh
	 * state. Desktop-only (the QuickJS + vault plugins live in Tauri) — handled
	 * by the `unlocked` gate and `AvenUiView`'s own guard.
	 */
	import type { UiEvent } from '@avenos/aven-ui'
	import { createVaultSecretsShell } from '@avenos/aven-ui/vibes/vault-secrets'
	import AvenUiView from '$lib/aven-ui/AvenUiView.svelte'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { t } from '$lib/i18n'
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

	const shell = createVaultSecretsShell()
	const unlocked = $derived($deviceSession.kind === 'unlocked')

	let secrets = $state<SecretListEntry[]>([])
	let revealed = $state<Record<string, string>>({})
	let panelError = $state<string | null>(null)
	let loadedKind: string | null = null

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

	const source = $derived({
		kind,
		title: t(vaultSecretTitleKey(kind)),
		secrets,
		labels: vaultLabels(),
		loading: false,
		error: panelError ?? '',
		busy: false,
		newId: '',
		newValue: '',
		revealed,
	})

	async function reload(): Promise<void> {
		try {
			secrets = await secretsList()
			panelError = null
		} catch (err) {
			secrets = []
			panelError = err instanceof Error ? err.message : String(err)
		}
	}

	async function handleEvent(event: UiEvent): Promise<void> {
		if (event.send === 'ADD_SECRET') {
			const storageId = toStorageId(kind, String(event.payload.id ?? ''))
			const value = String(event.payload.value ?? '')
			if (!storageId) return
			try {
				await secretsSet(storageId, value)
				revealed = {}
				await reload()
			} catch (err) {
				panelError = err instanceof Error ? err.message : String(err)
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
				return
			}
			try {
				revealed = { ...revealed, [id]: await secretsReveal(id) }
			} catch (err) {
				panelError = err instanceof Error ? err.message : String(err)
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
				await reload()
			} catch (err) {
				panelError = err instanceof Error ? err.message : String(err)
			}
		}
	}

	// Load (once) per unlocked kind; reset reveal state on kind switch.
	$effect(() => {
		const k = kind
		if (!unlocked) {
			loadedKind = null
			return
		}
		if (loadedKind === k) return
		loadedKind = k
		revealed = {}
		void reload()
	})
</script>

<section class="flex h-full min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-6">
	{#if !unlocked}
		<p class="text-muted-foreground py-8 text-sm">{t('vaultNav.lockedHint')}</p>
	{:else}
		{#key kind}
			<AvenUiView
				shell={shell}
				source={source}
				onEvent={handleEvent}
				containerName="aven-ui-vault-secrets"
			/>
		{/key}
	{/if}
</section>
