<script lang="ts">
import { browser } from '$app/environment'
import { t } from '$lib/i18n'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import InviteAdminPanel from '$lib/self/InviteAdminPanel.svelte'
import {
	checkInvite,
	type RegisterResult,
	register,
	resolveAuthBaseUrl,
	siteStatus
} from '$lib/self/network-auth'
import { deviceSession } from '$lib/settings/device-session-store'

// TODO(deep-link): register the `avenos://invite?invite=…` scheme via the Tauri deep-link
// plugin and route it to `goto('/invite?invite=…')`. Until then `/invite?invite=TOKEN` works
// in-app (query param read in +page.ts).

let { data } = $props<{ data: { inviteToken?: string } }>()

// Returning devices sign in silently; newcomers see onboarding — never a raw error.
type Phase = 'loading' | 'admin' | 'member' | 'redeem' | 'bootstrap' | 'inviteOnly' | 'error'

let phase = $state<Phase>('loading')
let working = $state(false)
let errorMsg = $state<string | undefined>()
let inviteValid = $state<boolean | undefined>()
let result = $state<RegisterResult | undefined>()

const inviteToken = $derived(data.inviteToken)
const sessionKind = $derived($deviceSession.kind)
const isLocked = $derived(sessionKind === 'locked')

let started = false
$effect(() => {
	if (!browser || !isTauriRuntime() || isLocked) return
	if (started) return
	started = true
	void init()
})

async function init(): Promise<void> {
	phase = 'loading'
	errorMsg = undefined
	try {
		const status = await siteStatus()

		if (!status.bootstrapped) {
			// Fresh network — no founder yet.
			phase = 'bootstrap'
			return
		}

		// Silent return sign-in: succeeds for any already-registered device (admin or member).
		try {
			result = await register({ flow: 'bootstrap' })
			phase = result.isAdmin ? 'admin' : 'member'
			return
		} catch {
			// Not a registered device on this network — newcomer.
		}

		if (inviteToken) {
			const check = await checkInvite(inviteToken)
			inviteValid = check.valid
			phase = 'redeem'
		} else {
			phase = 'inviteOnly'
		}
	} catch (e) {
		errorMsg = e instanceof Error ? e.message : String(e)
		phase = 'error'
	}
}

async function acceptInvite(): Promise<void> {
	working = true
	errorMsg = undefined
	try {
		result = await register({ flow: 'invite', inviteToken })
		phase = result.isAdmin ? 'admin' : 'member'
	} catch (e) {
		errorMsg = e instanceof Error ? e.message : String(e)
	} finally {
		working = false
	}
}

async function becomeFounder(): Promise<void> {
	working = true
	errorMsg = undefined
	try {
		result = await register({ flow: 'bootstrap' })
		phase = result.isAdmin ? 'admin' : 'member'
	} catch (e) {
		errorMsg = e instanceof Error ? e.message : String(e)
	} finally {
		working = false
	}
}
</script>

<svelte:head>
	<title>{t('invite.signInTitle')}{t('common.titleSuffix')}</title>
</svelte:head>

{#if browser && !isTauriRuntime()}
	<div class="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-12">
		<p class="text-muted-foreground rounded-lg border px-4 py-3 text-sm leading-relaxed">
			{t('invite.tauriOnly')}
		</p>
	</div>
{:else if isLocked}
	<div class="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-3 px-6 py-12">
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
	<div class="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-12">
		<p class="text-muted-foreground text-sm">{t('common.loading')}</p>
	</div>
{:else if phase === 'admin' && result}
	<!-- Admin: identity on the left, invite management in the main area. -->
	<div class="mx-auto w-full max-w-5xl px-6 py-12">
		<div class="grid gap-8 lg:grid-cols-[20rem_1fr] lg:items-start">
			<aside class="space-y-4 lg:sticky lg:top-12">
				<header class="space-y-1.5">
					<h1 class="text-2xl font-semibold tracking-tight">{t('invite.signInTitle')}</h1>
					<p class="text-muted-foreground text-sm leading-relaxed">{t('invite.signInSubtitle')}</p>
					<p class="text-muted-foreground/70 text-[11px]">{resolveAuthBaseUrl()}</p>
				</header>
				<p
					class="rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm leading-relaxed text-green-700 dark:text-green-400"
				>
					{t('invite.successAdmin')}
				</p>
				<pre
					class="text-muted-foreground overflow-x-auto rounded-lg border px-4 py-3 font-mono text-[11px] leading-snug select-text"
				>{result.user.did}</pre>
			</aside>
			<main>
				<InviteAdminPanel />
			</main>
		</div>
	</div>
{:else if phase === 'member' && result}
	<div class="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 px-6 py-12">
		<h1 class="text-3xl font-semibold tracking-tight">{t('invite.memberTitle')}</h1>
		<p class="text-muted-foreground leading-relaxed">{t('invite.memberBody')}</p>
		<pre
			class="text-muted-foreground mt-2 overflow-x-auto rounded-lg border px-4 py-3 font-mono text-[11px] leading-snug select-text"
		>{result.user.did}</pre>
	</div>
{:else if phase === 'redeem'}
	<div class="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-5 px-6 py-12">
		{#if inviteValid === false}
			<h1 class="text-3xl font-semibold tracking-tight">{t('invite.invalidTitle')}</h1>
			<p class="text-muted-foreground leading-relaxed">{t('invite.invalidBody')}</p>
		{:else}
			<h1 class="text-3xl font-semibold tracking-tight">{t('invite.welcomeTitle')}</h1>
			<p class="text-muted-foreground leading-relaxed">{t('invite.welcomeBody')}</p>
			{#if errorMsg}
				<p
					class="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border px-4 py-3 text-xs leading-relaxed select-text"
				>
					{errorMsg}
				</p>
			{/if}
			<button
				type="button"
				disabled={working}
				onclick={() => void acceptInvite()}
				class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50"
			>
				{working ? t('invite.working') : t('invite.acceptAction')}
			</button>
		{/if}
	</div>
{:else if phase === 'bootstrap'}
	<div class="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-5 px-6 py-12">
		<h1 class="text-3xl font-semibold tracking-tight">{t('invite.founderTitle')}</h1>
		<p class="text-muted-foreground leading-relaxed">{t('invite.founderBody')}</p>
		{#if errorMsg}
			<p
				class="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border px-4 py-3 text-xs leading-relaxed select-text"
			>
				{errorMsg}
			</p>
		{/if}
		<button
			type="button"
			disabled={working}
			onclick={() => void becomeFounder()}
			class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50"
		>
			{working ? t('invite.working') : t('invite.founderAction')}
		</button>
	</div>
{:else if phase === 'inviteOnly'}
	<div class="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-6 px-6 py-12">
		<div class="space-y-4">
			<p class="text-muted-foreground/70 text-xs font-semibold tracking-[0.2em] uppercase">
				{t('invite.inviteOnlyKicker')}
			</p>
			<h1 class="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
				{t('invite.inviteOnlyTitle')}
			</h1>
		</div>
		<p class="text-base leading-relaxed">{t('invite.inviteOnlyBody')}</p>
		<p class="text-muted-foreground leading-relaxed">{t('invite.inviteOnlyHow')}</p>
		<p class="text-muted-foreground/70 border-l-2 pl-4 text-sm leading-relaxed italic">
			{t('invite.inviteOnlyFootnote')}
		</p>
	</div>
{:else}
	<div class="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 px-6 py-12">
		<p
			class="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border px-4 py-3 text-xs leading-relaxed select-text"
		>
			{errorMsg}
		</p>
		<button
			type="button"
			onclick={() => {
				started = false
				void init()
			}}
			class="border-input hover:bg-accent inline-flex h-9 w-full items-center justify-center rounded-md border px-4 text-sm"
		>
			{t('common.retry')}
		</button>
	</div>
{/if}
