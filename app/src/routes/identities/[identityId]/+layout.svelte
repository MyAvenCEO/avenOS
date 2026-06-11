<script lang="ts">
import { browser } from '$app/environment'
import { page } from '$app/state'
import { avenDbStore } from '$lib/avendb/store.svelte'
import { t } from '$lib/i18n'
import AgentLiveState from '$lib/identities/AgentLiveState.svelte'
import { createIdentityAgent, setIdentityAgent } from '$lib/identities/identity-agent.svelte'
import TalkBrainAside from '$lib/identities/TalkBrainAside.svelte'
import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
import { pendingIntentFileDrop } from '$lib/intents/global-file-drop'
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

// Global file-drop → THIS identity's composer. The root layout captures the drop and parks the
// files in `pendingIntentFileDrop`; here we hand them to the mounted composer (which opens typing
// mode + shows the previews above the input), then clear the store so it fires once.
let composerRef = $state<{ openWithFiles(files: File[] | FileList): void } | null>(null)
let pendingDrop = $state<File[] | null>(null)
$effect(() => pendingIntentFileDrop.subscribe((v) => (pendingDrop = v)))
$effect(() => {
	const files = pendingDrop
	if (!files?.length || !composerRef) return
	composerRef.openWithFiles(files)
	pendingIntentFileDrop.set(null)
})

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
	asideRightLabel="Brain roundtrip"
	sections={navSections}
	desktopGridClass="md:grid-cols-[8.5rem_minmax(0,1fr)_420px]"
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

	{#snippet asideRight()}
		<!-- Brain roundtrip (E5): the permanent right aside on EVERY identity sub-view — shows what
		     the brain stored + recalled (the context fed to the AI) for the last message. -->
		<TalkBrainAside identityId={decodedIdentityId} />
	{/snippet}

	{#snippet children()}
		{@render pageOutlet()}
	{/snippet}
</AsidePageLayout>

{#if showComposer}
	<div
		class={`pointer-events-none fixed inset-x-0 bottom-0 ${mobileComposerVeilZClass} flex justify-center max-sm:px-2 sm:px-5 sm:pt-3 sm:pb-5 ${mobileActionVeilClass}`}
	>
		<div
			class="relative flex w-full max-w-none flex-col items-center justify-center max-sm:px-0 sm:pl-0 sm:pr-0"
		>
			<!-- ONE unified live-state indicator (thinking / executing / result / error), a few px
				 above the intent button — replaces the old separate floating chips. -->
			<AgentLiveState {agent} />

			<!-- When collapsed (just the round FAB), hug the button so the pointer-events-auto hit
				 area doesn't blanket the full width. Expanded modes still take the full width. -->
			<div
				class={`pointer-events-auto min-w-0 ${composerMode === 'collapsed' ? 'w-fit' : 'w-full'}`}
			>
				<IntentComposer
					bind:this={composerRef}
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
