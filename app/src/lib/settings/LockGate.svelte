<script lang="ts">
	import { invoke } from '@tauri-apps/api/core'
	import { browser } from '$app/environment'
	import { onMount, tick } from 'svelte'
	import { getCurrentWindow } from '@tauri-apps/api/window'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { bootstrapJazzStrict } from '$lib/jazz/bootstrap'
	import { grooveSessionReady } from '$lib/runtime/groove-runtime'
	import {
		getLocale,
		initLocale,
		localeDisplayName,
		setLocale,
		t,
		type SupportedLocale,
	} from '$lib/i18n'
	import {
		applyLockedFrontendState,
		clearDeviceSession,
		deviceSession,
		DEVICE_PEER_SLOT,
		fetchActiveVaultIdentity,
		setUnlockedWithIdentity,
	} from '$lib/settings/device-session-store'
	import { vaultUiSettingsSetLocale } from '$lib/settings/vault-ui-settings'
	import {
		vaultCardTitle,
		vaultCreate,
		vaultList,
		vaultSelect,
		type VaultListEntry,
	} from '$lib/settings/vault'
	import { NETWORK_SEED } from '$lib/settings/network'
	import LanguageIcon from '$lib/i18n/LanguageIcon.svelte'

	type PeerStatus = {
		platformSupported: boolean
		registered: boolean
		unlocked: boolean
	}

	type CreateStep = 'locale' | 'name' | 'device' | 'biometry'

	let loading = $state(false)
	let err = $state<string | undefined>()
	let vaults = $state<VaultListEntry[]>([])
	let vaultsReady = $state(false)
	let mode = $state<'pick' | 'create'>('pick')
	let createStep = $state<CreateStep>('locale')
	let createBiometryStarted = $state(false)
	let resolvingDeviceLabel = $state(false)
	let deviceLabelAutoFilled = $state(false)
	let firstName = $state('')
	let nameInputEl = $state<HTMLInputElement | null>(null)
	let deviceName = $state('')
	let selectedSlug = $state<string | undefined>()
	let unlockingSlug = $state<string | undefined>()
	let selectedLocale = $state<SupportedLocale>(getLocale())

	const gated = $derived(
		browser && isTauriRuntime() && $deviceSession.kind === 'locked',
	)

	const pillInputClass =
		'border-input bg-background/97 w-full min-h-[3.75rem] rounded-full border px-5 py-3 pr-[3.75rem] text-lg shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

	const outlineBtnClass =
		'border-input text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground active:bg-accent active:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-foreground/40 w-full rounded-lg border px-6 py-2.5 text-sm font-medium disabled:opacity-50'

	const localeChoiceClass =
		'hover:bg-accent/10 flex w-full cursor-pointer rounded-lg border border-border/60 bg-background/97 px-4 py-3 text-left shadow-sm backdrop-blur-sm transition-[background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-wait disabled:opacity-70'

	function applyVaultLocaleFromList(list: VaultListEntry[], slug?: string): void {
		const entry = slug
			? list.find((v) => v.usernameSlug === slug)
			: list.find((v) => v.hasIdentityBlob) ?? list[0]
		if (entry?.locale) {
			setLocale(entry.locale === 'de' ? 'de' : 'en')
			selectedLocale = getLocale()
		}
	}

	function applyVaultList(list: VaultListEntry[]): void {
		vaults = list
		if (list.length === 0) {
			startCreate()
		} else {
			mode = 'pick'
			selectedSlug =
				list.find((v) => v.hasIdentityBlob)?.usernameSlug ?? list[0]?.usernameSlug
			applyVaultLocaleFromList(list, selectedSlug)
		}
	}

	function startCreate(): void {
		mode = 'create'
		createStep = 'locale'
		createBiometryStarted = false
		resolvingDeviceLabel = false
		deviceLabelAutoFilled = false
		deviceName = ''
		err = undefined
	}

	function chooseLocale(locale: SupportedLocale): void {
		selectedLocale = locale
		setLocale(locale)
		createStep = 'name'
		err = undefined
	}

	async function loadVaultsWithRetry(maxAttempts = 8): Promise<VaultListEntry[]> {
		let lastErr: unknown
		for (let i = 0; i < maxAttempts; i++) {
			try {
				return await vaultList()
			} catch (e) {
				lastErr = e
				await new Promise((r) => setTimeout(r, 150 * (i + 1)))
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
	}

	$effect(() => {
		if (mode !== 'create' || createStep !== 'biometry' || createBiometryStarted || loading) return
		createBiometryStarted = true
		void finalizeCreate()
	})

	$effect(() => {
		if (mode !== 'create' || createStep !== 'name') return
		void nameInputEl
		void tick().then(() => {
			const el = nameInputEl
			if (!el || mode !== 'create' || createStep !== 'name') return
			el.focus()
		})
	})

	onMount(() => {
		if (!browser || !isTauriRuntime()) return

		let cancelled = false
		let unlistenClose: (() => void) | undefined

		void (async () => {
			try {
				const list = await loadVaultsWithRetry()
				if (!cancelled) {
					applyVaultList(list)
				}
			} catch (e) {
				if (!cancelled) {
					err = e instanceof Error ? e.message : String(e)
					startCreate()
				}
			} finally {
				if (!cancelled) vaultsReady = true
			}

			if (cancelled) return

			try {
				const st = await invoke<PeerStatus>('plugin:self|peer_status', {
					slot: DEVICE_PEER_SLOT,
				})
				if (!cancelled && st.unlocked) {
					try {
						const id = await fetchActiveVaultIdentity()
						if (!id) {
							err = t('lockGate.errUnlockedSessionUnread')
							return
						}
						await bootstrapJazzStrict()
						setUnlockedWithIdentity(id)
						grooveSessionReady.set(true)
					} catch (e) {
						if (!cancelled) {
							err = e instanceof Error ? e.message : String(e)
						}
					}
				}
			} catch {
				/* already unlocked path is optional on cold start */
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
		let unlockedRust = false
		try {
			await invoke('plugin:self|register', { slot: DEVICE_PEER_SLOT })
			await invoke('plugin:self|unlock', {
				slot: DEVICE_PEER_SLOT,
			})
			unlockedRust = true
			const identity = await fetchActiveVaultIdentity()
			if (!identity) {
				throw new Error(t('lockGate.errIdentityAfterUnlock'))
			}
			// Forward into the app the moment identity is known; hydrate the
			// Groove shell (RocksDB open, keyshare/biscuit hydrate, peer transport)
			// in the BACKGROUND. Inside views gate their data on
			// `grooveSessionReady`, so the unlock feels instant instead of blocking
			// several seconds on bootstrap.
			grooveSessionReady.set(false)
			setUnlockedWithIdentity(identity)
			loading = false
			unlockingSlug = undefined
			void bootstrapJazzStrict()
				.then(() => grooveSessionReady.set(true))
				.catch((e) => {
					// Bootstrap failed after we already forwarded — re-lock and
					// surface the error back on the lock screen.
					err = e instanceof Error ? e.message : String(e)
					void invoke('plugin:self|lock').catch(() => {})
					applyLockedFrontendState()
				})
			return
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
			if (unlockedRust) {
				try {
					await invoke('plugin:self|lock')
				} catch {
					/* swallow */
				}
				applyLockedFrontendState()
			}
			loading = false
			unlockingSlug = undefined
		}
	}

	async function unlockExisting(): Promise<void> {
		if (!selectedSlug) {
			err = t('lockGate.errPickYourself')
			return
		}
		loading = true
		unlockingSlug = selectedSlug
		err = undefined
		applyVaultLocaleFromList(vaults, selectedSlug)
		try {
			await vaultSelect(selectedSlug)
			await runUnlockPipeline()
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
			loading = false
			unlockingSlug = undefined
		}
	}

	async function selectAndUnlock(slug: string): Promise<void> {
		if (loading) return
		selectedSlug = slug
		await unlockExisting()
	}

	async function resolveDeviceLabel(): Promise<boolean> {
		if (!browser || !isTauriRuntime()) return false
		try {
			const label = (await invoke<string>('plugin:self|host_device_label')).trim()
			if (!label) return false
			deviceName = label
			deviceLabelAutoFilled = true
			return true
		} catch {
			return false
		}
	}

	async function advanceCreateName(): Promise<void> {
		if (!firstName.trim()) {
			err = t('lockGate.errAddName')
			return
		}
		err = undefined
		resolvingDeviceLabel = true
		deviceName = ''
		deviceLabelAutoFilled = false
		try {
			if (await resolveDeviceLabel()) {
				createStep = 'biometry'
			} else {
				createStep = 'device'
			}
		} finally {
			resolvingDeviceLabel = false
		}
	}

	function advanceCreateDevice(): void {
		if (!deviceName.trim()) {
			err = t('lockGate.errAddDeviceName')
			return
		}
		err = undefined
		createStep = 'biometry'
	}

	function backCreateStep(): void {
		err = undefined
		createBiometryStarted = false
		if (createStep === 'device') {
			createStep = 'name'
		} else if (createStep === 'name') {
			createStep = 'locale'
		} else if (createStep === 'biometry') {
			createStep = deviceLabelAutoFilled ? 'name' : 'device'
		}
	}

	async function finalizeCreate(): Promise<void> {
		if (!firstName.trim() || !deviceName.trim()) {
			err = t('lockGate.errFinishStepsFirst')
			createBiometryStarted = false
			return
		}
		loading = true
		err = undefined
		try {
			const created = await vaultCreate(firstName.trim(), deviceName.trim())
			await vaultUiSettingsSetLocale(selectedLocale)
			applyVaultList(await vaultList())
			selectedSlug = created.usernameSlug
			await vaultSelect(created.usernameSlug)
			await runUnlockPipeline()
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
			createBiometryStarted = false
		} finally {
			loading = false
		}
	}
</script>

{#snippet pillSubmit(label: string, onclick: () => void, disabled = false)}
	<button
		type="button"
		class="absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-brand-navy)] text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-40"
		aria-label={label}
		{disabled}
		{onclick}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M5 12h14" />
			<path d="m12 5 7 7-7 7" />
		</svg>
	</button>
{/snippet}

{#if gated}
	<div
		class="lock-gate fixed inset-0 z-[100] overflow-y-auto"
		role="dialog"
		aria-modal="true"
		aria-labelledby="lock-title"
	>
		<div class="lock-gate__photo" aria-hidden="true"></div>
		<div class="lock-gate__scrim" aria-hidden="true"></div>

		<div class="relative z-10 flex min-h-full flex-col items-center justify-center gap-6 px-6 py-10">
			<div class="max-w-md space-y-2 text-center">
				<h1 id="lock-title" class="avenos-wordmark">avenOS</h1>
				<p class="text-muted-foreground text-sm leading-relaxed">
					{t('lockGate.tagline')}
				</p>
				<p class="font-mono text-muted-foreground/80 text-[10px]">{NETWORK_SEED}</p>
			</div>

			{#if err}
				<p class="text-destructive max-w-lg text-center text-xs leading-relaxed" role="alert">{err}</p>
			{/if}

			{#if !vaultsReady}
				<p class="text-muted-foreground text-sm">{t('common.loadingSavedSelves')}</p>
			{:else if mode === 'pick'}
				<div class="flex w-full max-w-md flex-col gap-3">
					<ul class="max-h-[40vh] space-y-2 overflow-y-auto" role="list" aria-label={t('lockGate.chooseYourselfList')}>
						{#each vaults as v (v.usernameSlug)}
							<li>
								<button
									type="button"
									class="hover:bg-accent/10 flex w-full cursor-pointer rounded-lg border border-border/60 bg-background/97 px-4 py-3 text-left shadow-sm backdrop-blur-sm transition-[background-color] focus-visible:outline-none disabled:cursor-wait disabled:opacity-70"
									aria-busy={unlockingSlug === v.usernameSlug}
									disabled={loading}
									onclick={() => void selectAndUnlock(v.usernameSlug)}
								>
									<div class="min-w-0">
										<div class="font-medium">{vaultCardTitle(v)}</div>
										<div class="text-muted-foreground text-[11px]">
											{#if unlockingSlug === v.usernameSlug}
												{t('common.unlocking')}
											{:else if v.deviceLabel}
												{v.deviceLabel}
											{/if}
											{#if !v.hasIdentityBlob && unlockingSlug !== v.usernameSlug}
												<span class="text-amber-600">{t('lockGate.finishSetupBelow')}</span>
											{/if}
										</div>
									</div>
								</button>
							</li>
						{/each}
					</ul>
					<button
						type="button"
						class={outlineBtnClass}
						disabled={loading}
						onclick={startCreate}
					>
						{t('lockGate.createNewSelf')}
					</button>
				</div>
			{:else if createStep === 'locale'}
				<div class="flex w-full max-w-md flex-col gap-4">
					<div class="space-y-3 text-center">
						<LanguageIcon class="text-foreground mx-auto size-12" />
						<p class="text-muted-foreground text-sm leading-relaxed">
							{t('lockGate.chooseLanguage')}
						</p>
						<p class="text-muted-foreground text-xs leading-relaxed">
							{t('lockGate.chooseLanguageHint')}
						</p>
					</div>
					<div class="flex flex-col gap-2">
						<button
							type="button"
							class={localeChoiceClass}
							disabled={loading}
							onclick={() => chooseLocale('en')}
						>
							<span class="font-medium">{t('preferences.english')}</span>
						</button>
						<button
							type="button"
							class={localeChoiceClass}
							disabled={loading}
							onclick={() => chooseLocale('de')}
						>
							<span class="font-medium">{t('preferences.deutsch')}</span>
						</button>
					</div>
					{#if vaults.length > 0}
						<button
							type="button"
							class={outlineBtnClass}
							disabled={loading}
							onclick={() => {
								mode = 'pick'
								err = undefined
							}}
						>
							{t('lockGate.backToSignIn')}
						</button>
					{/if}
				</div>
			{:else if createStep === 'name'}
				<div class="flex w-full max-w-md flex-col gap-4">
					<div>
						<p class="text-muted-foreground mb-3 text-center text-sm leading-relaxed">
							{t('lockGate.whoAreYou')}
						</p>
						<div class="relative">
							<input
								class={pillInputClass}
								bind:this={nameInputEl}
								bind:value={firstName}
								autocomplete="given-name"
								placeholder={t('lockGate.namePlaceholder')}
								aria-label={t('lockGate.yourName')}
								disabled={resolvingDeviceLabel}
								onkeydown={(e) => {
									if (e.key === 'Enter' && !resolvingDeviceLabel) {
										e.preventDefault()
										void advanceCreateName()
									}
								}}
							/>
							{@render pillSubmit(
								t('common.continue'),
								() => void advanceCreateName(),
								loading || resolvingDeviceLabel,
							)}
						</div>
						{#if resolvingDeviceLabel}
							<p class="text-muted-foreground mt-3 text-sm" aria-live="polite">
								{t('common.detectingDevice')}
							</p>
						{/if}
					</div>
					<button
						type="button"
						class={outlineBtnClass}
						disabled={loading}
						onclick={backCreateStep}
					>
						{t('common.back')}
					</button>
					{#if vaults.length > 0}
						<button
							type="button"
							class={outlineBtnClass}
							disabled={loading}
							onclick={() => {
								mode = 'pick'
								err = undefined
							}}
						>
							{t('lockGate.backToSignIn')}
						</button>
					{/if}
				</div>
			{:else if createStep === 'device'}
				<div class="flex w-full max-w-md flex-col gap-4">
					<div>
						<p class="text-muted-foreground mb-3 text-sm leading-relaxed">
							{t('lockGate.whichDevice')}
						</p>
						<div class="relative">
							<input
								class={pillInputClass}
								bind:value={deviceName}
								autocomplete="off"
								placeholder={t('lockGate.devicePlaceholder')}
								aria-label={t('lockGate.deviceName')}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault()
										advanceCreateDevice()
									}
								}}
							/>
							{@render pillSubmit(t('common.continue'), advanceCreateDevice, loading)}
						</div>
					</div>
					<button
						type="button"
						class={outlineBtnClass}
						disabled={loading}
						onclick={backCreateStep}
					>
						{t('common.back')}
					</button>
				</div>
			{:else}
				<div
					class="flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-border/60 bg-background/97 px-6 py-8 text-center shadow-sm backdrop-blur-sm"
					aria-live="polite"
				>
					<p class="text-muted-foreground text-sm leading-relaxed">
						{t('lockGate.biometryHint')}
					</p>
					{#if loading}
						<p class="text-muted-foreground text-sm">{t('common.unlocking')}</p>
					{/if}
					{#if !loading && err}
						<button
							type="button"
							class={outlineBtnClass}
							onclick={() => {
								createBiometryStarted = false
								backCreateStep()
							}}
						>
							{t('common.back')}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.lock-gate__photo {
		position: absolute;
		inset: 0;
		background-image: url('/login-banner.png');
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
	}

	.lock-gate__scrim {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(
				to bottom,
				color-mix(in srgb, var(--color-surface-cream) 30%, transparent),
				color-mix(in srgb, var(--color-surface-cream) 40%, transparent) 55%,
				color-mix(in srgb, var(--color-surface-cream) 32%, transparent)
			),
			color-mix(in srgb, var(--color-surface-cream) 4%, transparent);
	}
</style>
