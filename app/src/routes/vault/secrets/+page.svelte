<script lang="ts">
	import { secretsDelete, secretsList, secretsReveal, secretsSet, type SecretListEntry } from '$lib/vault/secrets'
	import { t } from '$lib/i18n'
	import { browser } from '$app/environment'

	let secrets = $state<SecretListEntry[]>([])
	let loading = $state(true)
	let error = $state<string | null>(null)
	let newId = $state('')
	let newValue = $state('')
	let busy = $state(false)
	let revealed = $state<Record<string, string>>({})

	async function refresh() {
		loading = true
		error = null
		try {
			secrets = await secretsList()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
			secrets = []
		} finally {
			loading = false
		}
	}

	$effect(() => {
		if (!browser) return
		void refresh()
	})

	async function addSecret() {
		const id = newId.trim()
		if (!id) return
		busy = true
		error = null
		try {
			await secretsSet(id, newValue)
			newId = ''
			newValue = ''
			await refresh()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	async function reveal(id: string) {
		busy = true
		error = null
		try {
			revealed[id] = await secretsReveal(id)
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	async function remove(id: string) {
		busy = true
		error = null
		try {
			await secretsDelete(id)
			const next = { ...revealed }
			delete next[id]
			revealed = next
			await refresh()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}
</script>

<section class="space-y-6 px-4 py-6">
	<header class="space-y-1">
		<h1 class="text-lg font-semibold tracking-tight">{t('vaultNav.secrets')}</h1>
		<p class="text-muted-foreground text-sm">{t('vaultSecrets.description')}</p>
	</header>

	{#if error}
		<p class="text-destructive text-sm" role="alert">{error}</p>
	{/if}

	<form class="space-y-3 rounded-lg border p-4" onsubmit={(e) => { e.preventDefault(); void addSecret() }}>
		<h2 class="text-sm font-medium">{t('vaultSecrets.addTitle')}</h2>
		<label class="block space-y-1">
			<span class="text-muted-foreground text-xs">{t('vaultSecrets.idLabel')}</span>
			<input class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm" bind:value={newId} disabled={busy} />
		</label>
		<label class="block space-y-1">
			<span class="text-muted-foreground text-xs">{t('vaultSecrets.valueLabel')}</span>
			<input class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm" type="password" bind:value={newValue} disabled={busy} />
		</label>
		<button class="bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm disabled:opacity-50" type="submit" disabled={busy || !newId.trim()}>
			{t('common.add')}
		</button>
	</form>

	<div class="space-y-2">
		<h2 class="text-sm font-medium">{t('vaultSecrets.listTitle')}</h2>
		{#if loading}
			<p class="text-muted-foreground text-sm">{t('common.loading')}</p>
		{:else if secrets.length === 0}
			<p class="text-muted-foreground text-sm">{t('vaultSecrets.empty')}</p>
		{:else}
			<ul class="divide-y rounded-lg border">
				{#each secrets as row (row.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
						<div class="min-w-0">
							<p class="truncate font-mono text-sm">{row.id}</p>
							{#if revealed[row.id]}
								<p class="text-muted-foreground mt-1 break-all font-mono text-xs">{revealed[row.id]}</p>
							{/if}
						</div>
						<div class="flex shrink-0 gap-2">
							<button class="text-primary text-sm underline" type="button" disabled={busy} onclick={() => void reveal(row.id)}>
								{t('vaultSecrets.reveal')}
							</button>
							<button class="text-destructive text-sm underline" type="button" disabled={busy} onclick={() => void remove(row.id)}>
								{t('common.delete')}
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>
