<script lang="ts">
/**
 * Bottom composer cluster — owns the per-status action pills and the
 * `IntentComposer` mount. Rendered inside the page's fixed bottom bar
 * (the `+page.svelte` template wraps this in the gradient veil + the
 * mobile-only Back button).
 *
 * Three layout variants gated on the selected intent's status:
 *  - `success`  → composer + `Archive` pill on the right
 *  - `hitl` / `error` → `Re-train` pill (left) + composer + `Accept` pill (right)
 *  - none / `working` / `archived` → bare composer
 *
 * The composer is mounted ONCE per branch and the surrounding pills are
 * conditionally rendered based on `composerMode`. We deliberately do not
 * unmount + remount the composer between collapsed / typing / listening
 * because remounting drops voice/keyboard input in HITL: a fresh instance
 * seeds `mode` from the `command` prop only — without a slash command it
 * starts in `collapsed`, fires `onModeChange('collapsed')` immediately,
 * and the parent reverts the user's mic click or first keystroke. Keeping
 * the composer stable lets free-form intent submission (voice and text)
 * coexist with the HITL action pills.
 */
import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
import { focusShellWebview } from '$lib/intent-mock/focus-shell-webview'
import { tick } from 'svelte'
import { type ComposerMode, type IntentRow } from './types'

type ComposerApi = { openWithCommand(label: string): void; openWithFiles(files: File[] | FileList): void }

let {
	intent,
	onSubmitMessage,
	onRetrain,
	onArchive,
	onAccept,
	composerMode = $bindable<ComposerMode>('collapsed')
}: {
	intent: IntentRow | null
	onSubmitMessage: (text: string, files: File[]) => void | Promise<void>
	/** Called when the composer submits with the active `retrain` slash command. */
	onRetrain: (feedback: string, files: File[]) => void | Promise<void>
	/** Archive the currently selected intent. The bar only renders this for `success`. */
	onArchive: () => void
	/** Accept the currently selected HITL/error intent — mark it `success`. */
	onAccept: () => void
	composerMode?: ComposerMode
} = $props()

/**
 * `$bindable` slash-command badge owned by the bar so it survives the
 * composer's mount/unmount when `composerMode` flips between `collapsed`
 * and `typing` (the two layouts swap which `IntentComposer` instance is in
 * the DOM). The freshly-mounted instance reads this on mount and auto-opens
 * to typing mode with the badge pre-rendered.
 */
let composerCommand = $state<string | null>(null)

/**
 * Ref to the currently-mounted `IntentComposer` in the HITL / error
 * branch. The Re-train button calls `composerRef?.openWithCommand('retrain')`
 * instead of running the re-train action directly — the actual re-train
 * fires later from `handleCommand` when the user submits the composer
 * (Enter / send), giving them a chance to type accompanying feedback after
 * the badge.
 */
let composerRef = $state<ComposerApi | null>(null)

function handleCommand(command: string, feedback: string, files: File[]) {
	if (command !== 'retrain') return
	onRetrain(feedback, files)
}

/** Called from the page when the user drops files on the window. */
export function ingestDroppedFiles(files: File[] | FileList) {
	const list = Array.from(files)
	if (!list.length) return
	void tick().then(() => composerRef?.openWithFiles(list))
}

const isSuccess = $derived(intent?.status === 'success')
const isHitlOrError = $derived(
	intent != null && (intent.status === 'hitl' || intent.status === 'error')
)

const collapsedBarClass =
	'w-full max-sm:grid max-sm:grid-cols-[1fr_auto_1fr] max-sm:items-center max-sm:gap-1 sm:flex sm:min-h-12 sm:items-center sm:justify-center sm:gap-3'
const expandedBarClass =
	'flex w-full min-w-0 max-sm:min-h-0 items-center justify-center gap-2 sm:min-h-12 sm:gap-3'
const sideLeftClass = 'flex min-w-0 items-center justify-end gap-1 max-sm:justify-end sm:flex-1 sm:justify-end sm:gap-2'
const sideRightClass = 'flex min-w-0 items-center justify-start gap-1 max-sm:justify-start sm:flex-1 sm:justify-start sm:gap-2'
const composerWrapCollapsed = 'shrink-0 justify-self-center max-sm:col-start-2 max-sm:row-start-1'
const composerWrapExpanded = 'flex min-w-0 flex-1 items-center justify-center'
const mobileIconBtn =
	'inline-flex h-10 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full sm:h-10 sm:min-h-10 sm:w-auto'
</script>

{#snippet archiveIcon()}
	<svg
		class="size-[1.05rem] shrink-0 sm:hidden"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		viewBox="0 0 24 24"
		aria-hidden="true"
	>
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3.75-3.75m3.75 3.75 3.75-3.75M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5a1.125 1.125 0 0 0-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
		/>
	</svg>
{/snippet}

{#snippet acceptIcon()}
	<svg
		class="size-[1.05rem] shrink-0 sm:hidden"
		fill="none"
		stroke="currentColor"
		stroke-width="2.5"
		viewBox="0 0 24 24"
		aria-hidden="true"
	>
		<path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
	</svg>
{/snippet}

{#snippet retrainIcon()}
	<svg
		class="size-[1.05rem] shrink-0 sm:hidden"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		viewBox="0 0 24 24"
		aria-hidden="true"
	>
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
		/>
	</svg>
{/snippet}

<div
	role="group"
	aria-label="Intent composer"
	class="flex min-w-0 flex-1 items-center justify-center gap-2 sm:gap-3"
	onpointerdown={() => void focusShellWebview()}
>
	{#if isSuccess}
		<div class={composerMode === 'collapsed' ? collapsedBarClass : expandedBarClass}>
			{#if composerMode === 'collapsed'}
				<div class="{sideLeftClass} max-sm:col-start-1"></div>
			{/if}
			<div class={composerMode === 'collapsed' ? composerWrapCollapsed : composerWrapExpanded}>
				<IntentComposer
					bind:this={composerRef}
					rowCluster={composerMode === 'collapsed'}
					onSubmitMessage={onSubmitMessage}
					onModeChange={(m: ComposerMode) => {
						composerMode = m
					}}
				/>
			</div>
			{#if composerMode === 'collapsed'}
				<div class="{sideRightClass} max-sm:col-start-3">
					<button
						type="button"
						class="{mobileIconBtn} border border-border bg-transparent text-foreground/85 transition-colors hover:bg-foreground/5 sm:border sm:px-3.5 sm:text-[11px] sm:font-semibold"
						onclick={onArchive}
						aria-label="Archive"
						title="Archive intent"
					>
						{@render archiveIcon()}
						<span class="hidden sm:inline">Archive</span>
					</button>
				</div>
			{/if}
		</div>
	{:else if isHitlOrError}
		<div class={composerMode === 'collapsed' ? collapsedBarClass : expandedBarClass}>
			{#if composerMode === 'collapsed'}
				<div class="{sideLeftClass} max-sm:col-start-1">
					<button
						type="button"
						class="{mobileIconBtn} max-w-full border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-status-error border-r-status-error bg-surface-card text-status-error transition-colors hover:bg-status-error hover:text-status-error-foreground sm:truncate sm:px-3.5 sm:text-[11px] sm:font-semibold"
						onclick={() => composerRef?.openWithCommand('retrain')}
						aria-label="Re-train intent — open composer with retrain command"
					>
						{@render retrainIcon()}
						<span class="hidden sm:inline">Re-train</span>
					</button>
				</div>
			{/if}
			<div class={composerMode === 'collapsed' ? composerWrapCollapsed : composerWrapExpanded}>
				<IntentComposer
					bind:this={composerRef}
					bind:command={composerCommand}
					rowCluster={composerMode === 'collapsed'}
					onSubmitMessage={onSubmitMessage}
					onCommandSubmit={handleCommand}
					onModeChange={(m: ComposerMode) => {
						composerMode = m
					}}
				/>
			</div>
			{#if composerMode === 'collapsed'}
				<div class="{sideRightClass} max-sm:col-start-3">
					{#if intent?.status === 'error'}
						<button
							type="button"
							class="{mobileIconBtn} border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-border border-r-border bg-surface-card text-foreground/70 transition-colors hover:bg-foreground/5 sm:px-3.5 sm:text-[11px] sm:font-semibold"
							onclick={onArchive}
							aria-label="Archive intent — dismiss without resolving"
							title="Archive intent"
						>
							{@render archiveIcon()}
							<span class="hidden sm:inline">Archive</span>
						</button>
					{:else}
						<button
							type="button"
							class="{mobileIconBtn} border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-status-success border-r-status-success bg-surface-card text-status-success transition-colors hover:bg-status-success hover:text-status-success-foreground sm:px-3.5 sm:text-[11px] sm:font-semibold"
							onclick={onAccept}
							aria-label="Accept intent — mark completed successfully"
						>
							{@render acceptIcon()}
							<span class="hidden sm:inline">Accept</span>
						</button>
						<button
							type="button"
							class="{mobileIconBtn} border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-border border-r-border bg-surface-card text-foreground/70 transition-colors hover:bg-foreground/5 sm:px-3.5 sm:text-[11px] sm:font-semibold"
							onclick={onArchive}
							aria-label="Archive intent — dismiss without resolving"
							title="Archive intent"
						>
							{@render archiveIcon()}
							<span class="hidden sm:inline">Archive</span>
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<IntentComposer
			bind:this={composerRef}
			onSubmitMessage={onSubmitMessage}
			onModeChange={(m: ComposerMode) => {
				composerMode = m
			}}
		/>
	{/if}
</div>
