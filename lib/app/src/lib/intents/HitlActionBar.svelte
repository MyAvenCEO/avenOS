<script lang="ts">
/**
 * Bottom composer cluster — owns the per-status action pills and the
 * `IntentComposer` mount. Rendered inside the page's fixed bottom bar
 * (the `+page.svelte` template wraps this in the gradient veil + the
 * mobile-only Back button).
 *
 * Three layout variants gated on the selected intent's status:
 *  - `success`  → just the composer + an `Archive` pill on the right
 *  - `hitl` / `error` → `Re-train` pill (left) + composer + `Accept` pill (right)
 *  - none / `working` / `archived` → bare composer
 *
 * Each variant has a `rowCluster` form (when the composer is collapsed)
 * and a stacked form (when the composer expands into typing/listening
 * mode). The `composerMode` and slash-command state stay local to this
 * component — the parent only learns about message submits, retrain
 * submits, archive clicks, and accept clicks via callback props.
 */
import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
import { type ComposerMode, type IntentRow } from './types'

type ComposerApi = { openWithCommand(label: string): void }

let {
	intent,
	onSubmitMessage,
	onRetrain,
	onArchive,
	onAccept
}: {
	intent: IntentRow | null
	onSubmitMessage: (text: string) => void
	/** Called when the composer submits with the active `retrain` slash command. */
	onRetrain: (feedback: string) => void
	/** Archive the currently selected intent. The bar only renders this for `success`. */
	onArchive: () => void
	/** Accept the currently selected HITL/error intent — mark it `success`. */
	onAccept: () => void
} = $props()

/** Mirrors `IntentComposer` mode for bottom-bar layout gating (not bindable in child). */
let composerMode = $state<ComposerMode>('collapsed')

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

function handleCommand(command: string, feedback: string) {
	if (command !== 'retrain') return
	onRetrain(feedback)
}

const isSuccess = $derived(intent?.status === 'success')
const isHitlOrError = $derived(
	intent != null && (intent.status === 'hitl' || intent.status === 'error')
)
</script>

<div class="flex min-w-0 flex-1 items-center justify-center gap-2 sm:gap-3">
	{#if isSuccess}
		{#if composerMode === 'collapsed'}
			<div class="grid min-h-12 w-full grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
				<div class="flex items-center justify-end gap-2"></div>
				<div class="justify-self-center">
					<IntentComposer
						rowCluster
						onSubmitMessage={onSubmitMessage}
						onModeChange={(m: ComposerMode) => {
							composerMode = m
						}}
					/>
				</div>
				<div class="flex items-center justify-start gap-2">
					<button
						type="button"
						class="inline-flex h-10 min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border border-border bg-transparent px-3.5 text-[11px] font-semibold text-foreground/85 transition-colors hover:bg-foreground/5 sm:px-4"
						onclick={onArchive}
						aria-label="Archive"
						title="Archive intent"
					>
						Archive
					</button>
				</div>
			</div>
		{:else}
			<div class="flex w-full flex-col items-stretch gap-2">
				<IntentComposer
					onSubmitMessage={onSubmitMessage}
					onModeChange={(m: ComposerMode) => {
						composerMode = m
					}}
				/>
				<div class="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
					<div class="flex items-center justify-end gap-2"></div>
					<div></div>
					<div class="flex items-center justify-start gap-2">
						<button
							type="button"
							class="inline-flex h-10 min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border border-border bg-transparent px-3.5 text-[11px] font-semibold text-foreground/85 transition-colors hover:bg-foreground/5 sm:px-4"
							onclick={onArchive}
							aria-label="Archive"
							title="Archive intent"
						>
							Archive
						</button>
					</div>
				</div>
			</div>
		{/if}
	{:else if isHitlOrError}
		{#if composerMode === 'collapsed'}
			<div class="grid min-h-12 w-full grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
				<div class="flex items-center justify-end gap-2">
					<button
						type="button"
						class="inline-flex h-10 min-h-10 max-w-full shrink-0 cursor-pointer touch-manipulation items-center justify-center truncate rounded-full border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-status-error border-r-status-error bg-surface-card px-3.5 text-[11px] font-semibold text-status-error transition-colors hover:bg-status-error hover:text-status-error-foreground sm:px-4"
						onclick={() => composerRef?.openWithCommand('retrain')}
						aria-label="Re-train intent — open composer with retrain command"
					>
						Re-train
					</button>
				</div>
				<div class="justify-self-center">
					<IntentComposer
						bind:this={composerRef}
						bind:command={composerCommand}
						rowCluster
						onSubmitMessage={onSubmitMessage}
						onCommandSubmit={handleCommand}
						onModeChange={(m: ComposerMode) => {
							composerMode = m
						}}
					/>
				</div>
				<div class="flex items-center justify-start gap-2">
					{#if intent?.status === 'error'}
						<button
							type="button"
							class="inline-flex h-10 min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-border border-r-border bg-surface-card px-3.5 text-[11px] font-semibold text-foreground/70 transition-colors hover:bg-foreground/5 sm:px-4"
							onclick={onArchive}
							aria-label="Archive intent — dismiss without resolving"
							title="Archive intent"
						>
							Archive
						</button>
					{:else}
						<button
							type="button"
							class="inline-flex h-10 min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-status-success border-r-status-success bg-surface-card px-3.5 text-[11px] font-semibold text-status-success transition-colors hover:bg-status-success hover:text-status-success-foreground sm:px-4"
							onclick={onAccept}
							aria-label="Accept intent — mark completed successfully"
						>
							Accept
						</button>
					{/if}
				</div>
			</div>
		{:else}
			<div class="flex w-full flex-col items-stretch gap-2">
				<IntentComposer
					bind:this={composerRef}
					bind:command={composerCommand}
					onSubmitMessage={onSubmitMessage}
					onCommandSubmit={handleCommand}
					onModeChange={(m: ComposerMode) => {
						composerMode = m
					}}
				/>
				<div class="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
					<div class="flex items-center justify-end gap-2">
						<button
							type="button"
							class="inline-flex h-10 min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-status-error border-r-status-error bg-surface-card px-3.5 text-[11px] font-semibold text-status-error transition-colors hover:bg-status-error hover:text-status-error-foreground sm:px-4"
							onclick={() => composerRef?.openWithCommand('retrain')}
							aria-label="Re-train intent — open composer with retrain command"
						>
							Re-train
						</button>
					</div>
					<div></div>
					<div class="flex items-center justify-start gap-2">
						{#if intent?.status === 'error'}
							<button
								type="button"
								class="inline-flex h-10 min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-border border-r-border bg-surface-card px-3.5 text-[11px] font-semibold text-foreground/70 transition-colors hover:bg-foreground/5 sm:px-4"
								onclick={onArchive}
								aria-label="Archive intent — dismiss without resolving"
								title="Archive intent"
							>
								Archive
							</button>
						{:else}
							<button
								type="button"
								class="inline-flex h-10 min-h-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-y-0 border-l-[4px] border-r-[4px] border-solid border-l-status-success border-r-status-success bg-surface-card px-3.5 text-[11px] font-semibold text-status-success transition-colors hover:bg-status-success hover:text-status-success-foreground sm:px-4"
								onclick={onAccept}
								aria-label="Accept intent — mark completed successfully"
							>
								Accept
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	{:else}
		<IntentComposer
			onSubmitMessage={onSubmitMessage}
			onModeChange={(m: ComposerMode) => {
				composerMode = m
			}}
		/>
	{/if}
</div>
