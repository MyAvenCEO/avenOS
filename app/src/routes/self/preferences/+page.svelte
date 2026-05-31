<script lang="ts">
	import { browser } from '$app/environment'
	import { localeDisplayName, setLocale, t, type SupportedLocale } from '$lib/i18n'
	import { deviceSession } from '$lib/self/device-session-store'
	import { vaultUiSettingsGet, vaultUiSettingsSetLocale } from '$lib/self/vault-ui-settings'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	let locale = $state<SupportedLocale>('en')
	let loading = $state(true)
	let saving = $state(false)
	let error = $state<string | null>(null)

	const unlocked = $derived($deviceSession.kind !== 'locked')
	const show = $derived(browser && isTauriRuntime())

	const localeOptions: SupportedLocale[] = ['en', 'de']

	async function load(): Promise<void> {
		if (!show || !unlocked) {
			loading = false
			return
		}
		loading = true
		error = null
		try {
			const res = await vaultUiSettingsGet()
			locale = res.locale
			setLocale(res.locale)
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}

	async function onSelect(next: SupportedLocale): Promise<void> {
		if (!show || !unlocked || saving || next === locale) return
		const prev = locale
		locale = next
		setLocale(next)
		saving = true
		error = null
		try {
			await vaultUiSettingsSetLocale(next)
		} catch (e) {
			locale = prev
			setLocale(prev)
			error = e instanceof Error ? e.message : String(e)
		} finally {
			saving = false
		}
	}

	$effect(() => {
		void show
		void unlocked
		void load()
	})
</script>

<svelte:head>
	<title>{t('preferences.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{t('preferences.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			{t('preferences.subtitle')}
		</p>
	</header>

	{#if !unlocked}
		<p class="text-muted-foreground text-sm">{t('preferences.unlockToChange')}</p>
	{:else if loading}
		<p class="text-muted-foreground text-sm">{t('common.loading')}</p>
	{:else}
		<section class="space-y-4 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex flex-col gap-2 sm:flex-row">
				{#each localeOptions as opt (opt)}
					<label
						class="border-input hover:bg-accent/5 flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors has-disabled:cursor-wait has-disabled:opacity-60"
					>
						<input
							type="radio"
							name="locale"
							value={opt}
							checked={locale === opt}
							disabled={saving}
							onchange={() => void onSelect(opt)}
						/>
						<span>{localeDisplayName(opt, locale)}</span>
					</label>
				{/each}
			</div>
			<p class="text-muted-foreground text-[11px] leading-relaxed">
				{t('preferences.savedHint')}
			</p>
		</section>
	{/if}

	{#if error}
		<p class="text-destructive text-sm" role="alert">{error}</p>
	{/if}
</div>
