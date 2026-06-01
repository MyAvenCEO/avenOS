<script lang="ts">
import { t } from '$lib/i18n'
import { copyToClipboard } from '$lib/runtime/clipboard'
import {
	type CreatedInvite,
	createInvite,
	type InviteSummary,
	listInvites
} from '$lib/self/network-auth'

let invites = $state<InviteSummary[]>([])
let listErr = $state<string | undefined>()
let creating = $state(false)
let createErr = $state<string | undefined>()
let lastCreated = $state<CreatedInvite | undefined>()
let copied = $state(false)

const openInvites = $derived(invites.filter((i) => i.status !== 'claimed'))
const claimedInvites = $derived(invites.filter((i) => i.status === 'claimed'))

$effect(() => {
	void refresh()
})

async function refresh(): Promise<void> {
	listErr = undefined
	try {
		invites = await listInvites()
	} catch (e) {
		listErr = e instanceof Error ? e.message : String(e)
	}
}

async function create(): Promise<void> {
	creating = true
	createErr = undefined
	copied = false
	try {
		lastCreated = await createInvite()
		await refresh()
	} catch (e) {
		createErr = e instanceof Error ? e.message : String(e)
	} finally {
		creating = false
	}
}

async function copyCode(): Promise<void> {
	if (!lastCreated) return
	const ok = await copyToClipboard(lastCreated.inviteToken)
	copied = ok
	if (ok) setTimeout(() => (copied = false), 1500)
}

function fmt(iso: string): string {
	return new Date(iso).toLocaleString()
}

function shortDid(did: string): string {
	return did.length > 24 ? `${did.slice(0, 16)}…${did.slice(-6)}` : did
}

const statusLabel: Record<InviteSummary['status'], string> = {
	get open() {
		return t('invite.statusOpen')
	},
	get claimed() {
		return t('invite.statusClaimed')
	},
	get expired() {
		return t('invite.statusExpired')
	}
}

const statusClass: Record<InviteSummary['status'], string> = {
	open: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
	claimed: 'border-border bg-muted text-muted-foreground',
	expired: 'border-destructive/30 bg-destructive/5 text-destructive'
}
</script>

<section class="space-y-4 border-t pt-6">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-sm font-semibold tracking-tight">{t('invite.manageTitle')}</h2>
		<span class="text-muted-foreground text-[11px]">
			{t('invite.summary', { open: openInvites.length, claimed: claimedInvites.length })}
		</span>
	</div>

	<button
		type="button"
		disabled={creating}
		onclick={() => void create()}
		class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50"
	>
		{creating ? t('invite.creating') : t('invite.createAction')}
	</button>

	{#if createErr}
		<p
			class="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border px-4 py-2 text-xs select-text"
		>
			{createErr}
		</p>
	{/if}

	{#if lastCreated}
		<div class="space-y-2 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3">
			<p class="text-[11px] leading-relaxed text-green-700 dark:text-green-400">
				{t('invite.newCodeLabel')}
			</p>
			<pre
				class="overflow-x-auto rounded-md border bg-background/60 px-3 py-2 font-mono text-sm tracking-wide select-text"
			>{lastCreated.inviteToken}</pre>
			<button
				type="button"
				onclick={() => void copyCode()}
				class="border-input hover:bg-accent inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs"
			>
				{copied ? t('invite.copied') : t('invite.copyCode')}
			</button>
		</div>
	{/if}

	{#if listErr}
		<p
			class="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border px-4 py-2 text-xs select-text"
		>
			{listErr}
		</p>
	{/if}

	<!-- Open invites -->
	<div class="space-y-2">
		<h3 class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
			{t('invite.openSection')}
		</h3>
		{#if openInvites.length === 0}
			<p class="text-muted-foreground text-xs">{t('invite.noneOpen')}</p>
		{:else}
			<ul class="space-y-1.5">
				{#each openInvites as invite (invite.id)}
					<li class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs">
						<span class="text-muted-foreground"
							>{t('invite.expiresLabel', { date: fmt(invite.expiresAt) })}</span
						>
						<span
							class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium {statusClass[invite.status]}"
						>
							{statusLabel[invite.status]}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Claimed invites -->
	<div class="space-y-2">
		<h3 class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
			{t('invite.claimedSection')}
		</h3>
		{#if claimedInvites.length === 0}
			<p class="text-muted-foreground text-xs">{t('invite.noneClaimed')}</p>
		{:else}
			<ul class="space-y-1.5">
				{#each claimedInvites as invite (invite.id)}
					<li class="space-y-1 rounded-lg border px-3 py-2 text-xs">
						<div class="flex items-center justify-between gap-3">
							<span class="text-muted-foreground"
								>{t('invite.createdLabel', { date: fmt(invite.createdAt) })}</span
							>
							<span
								class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium {statusClass[invite.status]}"
							>
								{statusLabel[invite.status]}
							</span>
						</div>
						{#if invite.boundDid}
							<p class="font-mono text-[10px] opacity-70 select-text">
								{shortDid(invite.boundDid)}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>
