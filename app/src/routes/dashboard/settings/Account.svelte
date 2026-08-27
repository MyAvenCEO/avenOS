<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'

/**
 * Account — who is signed in, and which aven is theirs.
 *
 * The app never said whose session it was running under. On a machine with
 * more than one avenNAME that is a real question, and the honest answer needs
 * both halves: the person (name, mail) and the aven they reserved.
 *
 * Everything here is read-only. Changing a mail address or releasing a name
 * is an identity operation and belongs to the id service, not to a settings
 * pane that could quietly diverge from it.
 */

interface AuthUser {
	id: string
	name: string
	email: string
}

interface AuthStatus {
	authenticated: boolean
	user: AuthUser | null
}

let user = $state<AuthUser | null>(null)
let names = $state<string[]>([])
let signedIn = $state(false)
let failure = $state<string | null>(null)
let loading = $state(isTauri())

/** "Samuel Andert" → "Samuel". A greeting uses the first name, not the record. */
const firstName = $derived(user?.name?.trim().split(/\s+/)[0] ?? '')

onMount(async () => {
	if (!isTauri()) return
	try {
		const status = await invoke<AuthStatus>('auth_status')
		signedIn = status.authenticated
		user = status.user
		// Only ask for names once a session exists — without one the command
		// fails by design, and an error here would read as something broken.
		if (status.authenticated) names = await invoke<string[]>('auth_names')
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause)
	} finally {
		loading = false
	}
})
</script>

<section class="flex flex-col gap-3">
	<h2 class="text-sm">Account</h2>

	{#if !isTauri()}
		<p
			class="rounded-xl border border-foreground/8 bg-surface-raised px-4 py-3 text-xs opacity-60 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			Die Anmeldung gibt es nur in der App — im Browser ist keine Sitzung zu zeigen.
		</p>
	{:else if loading}
		<p
			class="rounded-xl border border-foreground/8 bg-surface-raised px-4 py-3 text-xs opacity-50 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			Deine Sitzung wird gelesen …
		</p>
	{:else if !signedIn}
		<p
			class="rounded-xl border border-foreground/8 bg-surface-raised px-4 py-3 text-xs opacity-60 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			Du bist gerade nicht angemeldet.
		</p>
	{:else}
		<div
			class="flex flex-col gap-4 rounded-xl border border-foreground/8 bg-surface-raised px-4 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			<div class="flex items-center gap-3">
				<!-- Initials rather than an avatar: we have no picture, and a generic
				     silhouette says less than the two letters of an actual name. -->
				<span
					class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/8 text-sm font-medium"
				>
					{(user?.name || user?.email || '?').slice(0, 2).toUpperCase()}
				</span>
				<div class="min-w-0">
					<p class="truncate text-sm font-medium">{user?.name || 'Ohne Namen'}</p>
					<p class="truncate text-xs opacity-50">{user?.email}</p>
				</div>
			</div>

			<dl class="flex flex-col gap-2 text-xs">
				{#if firstName}
					<div class="flex items-baseline justify-between gap-4">
						<dt class="opacity-40">Vorname</dt>
						<dd class="truncate">{firstName}</dd>
					</div>
				{/if}
				<div class="flex items-baseline justify-between gap-4">
					<dt class="opacity-40">E-Mail</dt>
					<dd class="truncate">{user?.email}</dd>
				</div>
				<div class="flex items-baseline justify-between gap-4">
					<dt class="opacity-40">Konto-ID</dt>
					<dd class="truncate font-mono opacity-60">{user?.id}</dd>
				</div>
			</dl>
		</div>

		<div
			class="flex flex-col gap-2 rounded-xl border border-foreground/8 bg-surface-raised px-4 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			<p class="eyebrow-quiet">
				{names.length > 1 ? 'Deine Aven' : 'Dein Aven'}
			</p>
			{#if names.length}
				<ul class="flex flex-col gap-1">
					{#each names as name (name)}
						<li class="font-mono text-sm">{name}.aven.ceo</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xs opacity-50">Für dieses Konto ist noch kein Name reserviert.</p>
			{/if}
		</div>
	{/if}

	{#if failure}
		<p class="rounded-xl border border-error/25 bg-error-muted px-4 py-3 text-xs text-error-strong">
			{failure}
		</p>
	{/if}
</section>
