<script lang="ts">
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/settings/device-session-store'
	import {
		checkInvite,
		register,
		resolveAuthBaseUrl,
		siteStatus,
		type AuthFlow,
		type RegisterResult,
	} from '$lib/self/network-auth'

	// TODO(deep-link): register the `avenos://invite?invite=…` scheme via the Tauri deep-link
	// plugin and route it to `goto('/invite?invite=…')`. Until then `/invite?invite=TOKEN` works
	// in-app (query param read in +page.ts).

	let { data } = $props<{ data: { inviteToken?: string } }>()

	type Phase = 'loading' | 'ready' | 'registering' | 'done' | 'error'

	let phase = $state<Phase>('loading')
	let errorMsg = $state<string | undefined>()
	let bootstrapped = $state(false)
	let inviteValid = $state<boolean | undefined>()
	let inviteExpiresAt = $state<string | undefined>()
	let result = $state<RegisterResult | undefined>()

	const inviteToken = $derived(data.inviteToken)
	const sessionKind = $derived($deviceSession.kind)
	const isLocked = $derived(sessionKind === 'locked')

	/** Bootstrap when the site has no admin or no invite token is supplied; otherwise redeem. */
	const flow = $derived<AuthFlow>(!bootstrapped || !inviteToken ? 'bootstrap' : 'invite')

	$effect(() => {
		if (!browser) return
		void loadStatus()
	})

	async function loadStatus(): Promise<void> {
		phase = 'loading'
		errorMsg = undefined
		try {
			const status = await siteStatus()
			bootstrapped = status.bootstrapped
			if (inviteToken) {
				const check = await checkInvite(inviteToken)
				inviteValid = check.valid
				inviteExpiresAt = check.expiresAt
			}
			phase = 'ready'
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e)
			phase = 'error'
		}
	}

	async function submit(): Promise<void> {
		phase = 'registering'
		errorMsg = undefined
		try {
			result = await register({ flow, inviteToken: flow === 'invite' ? inviteToken : undefined })
			phase = 'done'
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e)
			phase = 'error'
		}
	}

	const headline = $derived(
		inviteToken ? t('invite.redeemTitle') : bootstrapped ? t('invite.signInTitle') : t('invite.bootstrapTitle'),
	)
	const subtitle = $derived(
		inviteToken ? t('invite.redeemSubtitle') : bootstrapped ? t('invite.signInSubtitle') : t('invite.bootstrapSubtitle'),
	)
	const inviteUnusable = $derived(Boolean(inviteToken) && inviteValid === false)
</script>

<svelte:head>
	<title>{headline}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-8 px-6 py-12">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{headline}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">{subtitle}</p>
		<p class="text-muted-foreground/70 text-[11px]">{resolveAuthBaseUrl()}</p>
	</header>

	{#if browser && !isTauriRuntime()}
		<p class="text-muted-foreground rounded-lg border px-4 py-3 text-sm leading-relaxed">
			{t('invite.tauriOnly')}
		</p>
	{:else if isLocked}
		<div class="space-y-3">
			<p class="text-muted-foreground rounded-lg border px-4 py-3 text-sm leading-relaxed">
				{t('invite.unlockFirst')}
			</p>
			<a
				href="/settings"
				class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium"
			>
				{t('invite.goToSettings')}
			</a>
		</div>
	{:else if phase === 'loading'}
		<p class="text-muted-foreground text-sm">{t('common.loading')}</p>
	{:else if phase === 'done' && result}
		<div class="space-y-3">
			<p
				class="rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm leading-relaxed text-green-700 dark:text-green-400"
			>
				{result.isAdmin ? t('invite.successAdmin') : t('invite.success')}
			</p>
			<pre class="text-muted-foreground overflow-x-auto rounded-lg border px-4 py-3 font-mono text-[11px] leading-snug select-text">{result.user.did}</pre>
		</div>
	{:else}
		<div class="space-y-4">
			{#if inviteToken}
				{#if inviteValid === true}
					<p class="text-muted-foreground rounded-lg border px-4 py-3 text-xs leading-relaxed">
						{inviteExpiresAt
							? t('invite.validUntil', { date: new Date(inviteExpiresAt).toLocaleString() })
							: t('invite.valid')}
					</p>
				{:else if inviteUnusable}
					<p
						class="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border px-4 py-3 text-sm leading-relaxed"
					>
						{t('invite.invalid')}
					</p>
				{/if}
			{/if}

			{#if errorMsg}
				<p
					class="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border px-4 py-3 text-xs leading-relaxed select-text"
				>
					{errorMsg}
				</p>
			{/if}

			<button
				type="button"
				disabled={phase === 'registering' || inviteUnusable}
				onclick={() => void submit()}
				class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50"
			>
				{phase === 'registering'
					? t('invite.working')
					: inviteToken
						? t('invite.redeemAction')
						: bootstrapped
							? t('invite.signInAction')
							: t('invite.bootstrapAction')}
			</button>

			{#if phase === 'error'}
				<button
					type="button"
					onclick={() => void loadStatus()}
					class="border-input hover:bg-accent inline-flex h-9 w-full items-center justify-center rounded-md border px-4 text-sm"
				>
					{t('common.retry')}
				</button>
			{/if}
		</div>
	{/if}
</div>
