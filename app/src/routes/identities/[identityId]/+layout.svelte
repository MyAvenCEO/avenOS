<script lang="ts">
import { browser } from '$app/environment'
import { page } from '$app/state'
import { avenDbStore } from '$lib/avendb/store.svelte'
import { t } from '$lib/i18n'
import { createIdentityAgent, setIdentityAgent } from '$lib/identities/identity-agent.svelte'
import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
import type { ComposerMode } from '$lib/intents/types'
import { avendbShell } from '$lib/runtime/avendb-shell'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { deviceSession } from '$lib/settings/device-session-store'
import { mobileActionVeilClass, mobileComposerVeilZClass, navigateApp } from '$lib/shell'
import {
	clearMobileChromeOverrides,
	setMobileChromeOverrides
} from '$lib/shell/mobile-chrome.svelte'
import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'

let { children: pageOutlet } = $props()

const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
const decodedIdentityId = $derived(decodeURIComponent(identityParam))
const identityBase = $derived(`/identities/${encodeURIComponent(decodedIdentityId)}`)

const identitiesStore = avenDbStore('safes')
const messages = avenDbStore('messages')
const todos = avenDbStore('todos')

function idsMatch(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase()
}

const identityMeta = $derived(
	identitiesStore.rows.find((s) => idsMatch(s.owner, decodedIdentityId))
)
const canonicalSparkId = $derived(identityMeta?.owner ?? decodedIdentityId)

const session = $derived($avendbShell.session)
const unlocked = $derived($deviceSession.kind === 'unlocked')
const tauri = $derived(browser && isTauriRuntime())

// The identity-wide agent runtime: created ONCE here, shared with every sub-view via context,
// so the intent bar works the same from talk, todos, files, members, db.
const agent = setIdentityAgent(
	createIdentityAgent({
		messages,
		todos,
		env: () => ({
			canonicalSparkId,
			identityBase,
			authorDid: session?.signerDid,
			tauri,
			unlocked
		})
	})
)

const path = $derived(page.url.pathname)
const isTalkView = $derived(path.includes('/talk'))
const isGalleryView = $derived(path.includes('/gallery'))

// Show the intent bar wherever a submit can actually land (unlocked desktop identity).
const showComposer = $derived(tauri && unlocked && !!canonicalSparkId)
const composerDisabled = $derived(!session?.signerDid?.trim())
let composerMode = $state<ComposerMode>('collapsed')

$effect(() => {
	const typing = composerMode === 'typing'
	setMobileChromeOverrides({ hideProfile: typing, hideAsideNav: typing })
	return () => clearMobileChromeOverrides()
})

const navSections = $derived(
	asideNavSectionsFromRoutes(
		[
			{
				title: t('nav.viewSection'),
				items: [
					{
						href: `${identityBase}/talk`,
						label: t('nav.talk'),
						match: (p) => p.startsWith(`${identityBase}/talk`)
					},
					{
						href: `${identityBase}/todos`,
						label: t('nav.todos'),
						match: (p) => p.startsWith(`${identityBase}/todos`)
					},
					{
						href: `${identityBase}/gallery`,
						label: t('nav.gallery'),
						match: (p) => p.startsWith(`${identityBase}/gallery`)
					},
					{
						href: `${identityBase}/members`,
						label: t('nav.members'),
						match: (p) => p.startsWith(`${identityBase}/members`)
					},
					{
						href: `${identityBase}/db`,
						label: t('nav.db'),
						match: (p) => p.startsWith(`${identityBase}/db`)
					}
				]
			}
		],
		path
	)
)

const mainClass = $derived(
	isTalkView
		? 'relative flex min-h-0 min-w-0 flex-col overflow-hidden'
		: 'relative min-h-0 min-w-0 overflow-y-auto'
)

const contentClass = $derived(
	isTalkView ? 'flex min-h-0 flex-1 flex-col pb-0 md:pb-0' : 'pb-20 md:pb-0'
)

const innerContentClass = $derived(
	[
		'mx-auto flex w-full flex-col px-4 sm:px-6',
		isGalleryView ? 'max-w-5xl' : 'max-w-4xl',
		isTalkView ? 'min-h-0 flex-1 py-3 pb-0 sm:py-6' : 'py-6 sm:py-8'
	].join(' ')
)

</script>

<svelte:head>
	<title>{identityMeta?.name ?? t('identities.identityLabel')}{t('common.titleSuffix')}</title>
</svelte:head>

<AsidePageLayout
	asideLabel={t('nav.identityViews')}
	sections={navSections}
	desktopGridClass="md:grid-cols-[8.5rem_minmax(0,1fr)]"
	sectionLabelClass="px-0 md:px-2"
	{mainClass}
	{contentClass}
	{innerContentClass}
	routeKey={path}
>
	{#snippet header()}
		<div class="mb-3 space-y-2 px-2 pt-2">
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-[10px] font-semibold uppercase tracking-wide"
				onclick={() => navigateApp('/identities')}
			>
				{t('nav.allIdentities')}
			</button>
			<div class="space-y-0.5">
				<h2 class="text-sm font-semibold tracking-tight leading-snug">
					{identityMeta?.name ?? t('identities.identityLabel')}
				</h2>
				{#if identityMeta}
					<p class="text-muted-foreground break-all font-mono text-[10px] leading-snug">
						identity:{identityMeta.owner}
					</p>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet children()}
		{@render pageOutlet()}
	{/snippet}
</AsidePageLayout>

{#if showComposer}
	{#if agent.err}
		<div
			class="pointer-events-none fixed inset-x-0 bottom-24 z-[44] flex justify-center px-4 sm:bottom-28"
		>
			<div
				class="text-destructive border-destructive/40 bg-destructive/10 pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-2xl border px-4 py-3 text-sm leading-snug shadow-lg backdrop-blur"
				role="alert"
			>
				<span class="min-w-0 flex-1">{agent.err}</span>
				<button
					type="button"
					class="hover:text-foreground -mr-1 shrink-0 px-1 font-semibold"
					onclick={() => agent.clearErr()}
					aria-label={t('identities.talk.dismissReply')}
				>
					×
				</button>
			</div>
		</div>
	{/if}

	<!-- Transient agent reply chip — shown on non-talk views (talk renders the reply in-thread),
	     so the agent can act in place without yanking the user to talk. -->
	{#if !isTalkView && agent.lastReply}
		{@const rec = agent.lastReply}
		<div
			class="pointer-events-none fixed inset-x-0 bottom-24 z-[44] flex justify-center px-4 sm:bottom-28"
		>
			<button
				type="button"
				class="border-border/60 bg-card/95 text-foreground pointer-events-auto flex w-full max-w-md flex-col gap-1 rounded-2xl border px-4 py-3 text-left shadow-lg ring-1 ring-primary/15 backdrop-blur transition hover:bg-card"
				onclick={() => agent.dismissReply()}
				aria-label={t('identities.talk.dismissReply')}
			>
				{#if rec.response?.trim()}
					<p class="text-sm leading-relaxed">{rec.response}</p>
				{/if}
				<div class="text-muted-foreground/80 flex items-center gap-1.5 text-[11px]">
					<svg
						class="text-primary/70 size-3 shrink-0"
						viewBox="0 0 16 16"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M11.5 1a3.5 3.5 0 0 0-3.36 4.52L1.7 11.96a1.55 1.55 0 1 0 2.19 2.19l6.44-6.44A3.5 3.5 0 1 0 11.5 1Zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"
						/>
					</svg>
					<code class="font-mono font-semibold">{rec.name}</code>
					{#if rec.result}
						<span class="truncate {rec.ok ? '' : 'text-amber-600 dark:text-amber-500'}"
							>· {rec.result}</span
						>
					{/if}
				</div>
			</button>
		</div>
	{/if}

	<!-- Live agent status strip — shown on EVERY sub-view (talk + non-talk), above the intent
	     button. Surfaces "thinking" while the cloud model is called and one pill per tool call
	     (running → done/error) so the user always sees what the agent is doing. -->
	{#if agent.phase !== 'idle' || agent.toolBadges.length > 0}
		<div
			class="pointer-events-none fixed inset-x-0 bottom-36 z-[44] flex justify-center px-4 sm:bottom-40"
		>
			<div class="flex max-w-md flex-wrap items-center justify-center gap-1.5">
				{#if agent.phase === 'thinking'}
					<span
						class="border-border/60 bg-card/95 text-muted-foreground flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur"
					>
						<span class="bg-primary size-1.5 animate-pulse rounded-full"></span>
						{t('identities.talk.agentThinking')}
					</span>
				{/if}
				{#each agent.toolBadges as badge (badge.id)}
					<span
						class="bg-card/95 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur
							{badge.status === 'running'
							? 'border-primary/40 text-foreground ring-1 ring-primary/15'
							: badge.status === 'error'
								? 'border-amber-500/40 text-amber-700 dark:text-amber-500'
								: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-500'}"
					>
						{#if badge.status === 'running'}
							<svg
								class="text-primary size-3 shrink-0 animate-spin"
								viewBox="0 0 16 16"
								aria-hidden="true"
							>
								<circle
									cx="8"
									cy="8"
									r="6"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-opacity="0.25"
								/>
								<path
									d="M8 2a6 6 0 0 1 6 6"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
						{/if}
						<span class="max-w-[12rem] truncate">{badge.label}</span>
					</span>
				{/each}
			</div>
		</div>
	{/if}

	<div
		class={`pointer-events-none fixed inset-x-0 bottom-0 ${mobileComposerVeilZClass} flex justify-center max-sm:px-2 sm:px-5 sm:pt-3 sm:pb-5 ${mobileActionVeilClass}`}
	>
		<div
			class="relative flex w-full max-w-none items-center justify-center max-sm:px-0 sm:pl-0 sm:pr-0"
		>
			<!-- When collapsed (just the round FAB), hug the button so the pointer-events-auto hit
				 area doesn't blanket the full width. Expanded modes still take the full width. -->
			<div
				class={`pointer-events-auto min-w-0 ${composerMode === 'collapsed' ? 'w-fit' : 'w-full'}`}
			>
				<IntentComposer
					placeholder={t('identities.composer.placeholder')}
					disabled={composerDisabled}
					submitBusy={agent.busy}
					enableAttachments={true}
					embedAttachmentNamesInMessage={false}
					onSubmitMessage={(message, files) => agent.submit(message, files)}
					onModeChange={(mode) => {
						composerMode = mode
					}}
					onTranscribeError={(message) => agent.setErr(message)}
				/>
			</div>
		</div>
	</div>
{/if}
