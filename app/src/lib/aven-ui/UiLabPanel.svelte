<script lang="ts">
	import { onDestroy } from 'svelte'
	import { AvenUiEngine, type UiBundle, type UiEvent, type UiFixtureShell } from '@avenos/aven-ui'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import {
		listenSandboxQjsState,
		mountRequestFromShell,
		sessionDispatch,
		sessionMount,
		sessionUnmount,
		type SandboxQjsStateEvent,
	} from '$lib/aven-ui/sandbox-qjs-session'
	import {
		uiLabFixture,
		uiLabFixtures,
		type UiLabFixtureId,
	} from '$lib/aven-ui/ui-lab-fixtures'
	import { t } from '$lib/i18n'

	type Panel = 'render' | 'view' | 'style' | 'state' | 'logic' | 'source'

	let panel = $state<Panel>('render')
	let selectedId = $state<UiLabFixtureId>('todo')
	let engine: AvenUiEngine | null = null
	let sessionId = $state<string | null>(null)
	let runtimeState = $state<Record<string, unknown> | null>(null)
	let runtimeError = $state<string | null>(null)
	let unlistenState: (() => void) | null = null
	let mountToken = 0
	let sessionFixtureId: UiLabFixtureId | null = null

	/** Plain refs so async handlers always see the active session (not stale $state). */
	const active = {
		sessionId: null as string | null,
		token: 0,
	}

	let hostNode: HTMLElement | null = null

	const fixtures = uiLabFixtures()
	const inTauri = isTauriRuntime()
	const selected = $derived(uiLabFixture(selectedId))
	const shell = $derived(selected.shell)

	const jsonPanels: Panel[] = ['view', 'style', 'state', 'logic', 'source']
	const needsSession = $derived(panel === 'render' || panel === 'state')

	function jsonFor(panelId: Panel, currentShell: UiFixtureShell): string {
		if (panelId === 'view') return JSON.stringify(currentShell.view, null, 2)
		if (panelId === 'style') return JSON.stringify(currentShell.style, null, 2)
		if (panelId === 'source') return JSON.stringify(currentShell.source, null, 2)
		if (panelId === 'logic') return currentShell.logic
		return JSON.stringify(runtimeState ?? {}, null, 2)
	}

	function syncActiveSession(id: string | null, token: number): void {
		active.sessionId = id
		active.token = token
		sessionId = id
	}

	async function teardownSession(): Promise<void> {
		unlistenState?.()
		unlistenState = null
		if (active.sessionId) {
			try {
				await sessionUnmount(active.sessionId)
			} catch {
				// ignore unmount errors during teardown
			}
		}
		syncActiveSession(null, active.token)
		sessionFixtureId = null
	}

	async function teardownEngineOnly(): Promise<void> {
		await engine?.unmount()
		engine = null
	}

	async function teardownAll(): Promise<void> {
		await teardownEngineOnly()
		await teardownSession()
	}

	function applyRuntimeState(state: Record<string, unknown>): void {
		runtimeState = state
		void engine?.replaceState(state)
	}

	async function ensureQuickJsSession(): Promise<void> {
		if (!needsSession) return

		if (!inTauri) {
			runtimeError = t('uiLab.needsDesktop')
			runtimeState = null
			return
		}

		if (sessionFixtureId === selectedId && active.sessionId && runtimeState) return

		const token = ++mountToken
		const fixtureId = selectedId
		const current = uiLabFixture(fixtureId)
		runtimeError = null

		try {
			await teardownSession()
			if (token !== mountToken || selectedId !== fixtureId) return

			const mounted = await sessionMount(mountRequestFromShell(current.shell))
			if (token !== mountToken || selectedId !== fixtureId) {
				await sessionUnmount(mounted.sessionId).catch(() => {})
				return
			}

			syncActiveSession(mounted.sessionId, token)
			sessionFixtureId = fixtureId
			runtimeState = mounted.state

			if (current.interactive) {
				unlistenState = await listenSandboxQjsState((event: SandboxQjsStateEvent) => {
					if (event.sessionId !== active.sessionId || token !== active.token) return
					applyRuntimeState(event.state)
				})
			}
		} catch (err) {
			if (token !== mountToken) return
			runtimeError = err instanceof Error ? err.message : String(err)
			runtimeState = null
		}
	}

	async function mountRenderPanel(): Promise<void> {
		if (panel !== 'render' || !hostNode) return

		const host = hostNode
		const current = uiLabFixture(selectedId)

		await ensureQuickJsSession()
		const token = active.token
		if (hostNode !== host || panel !== 'render' || !runtimeState || token !== active.token) return

		try {
			await teardownEngineOnly()
			if (hostNode !== host || panel !== 'render' || token !== active.token) return

			const bundle: UiBundle = {
				view: current.shell.view,
				style: current.shell.style,
				state: runtimeState,
			}

			engine = new AvenUiEngine({
				container: host,
				containerName: current.containerName,
				onEvent: (e: UiEvent) => {
					void handleEvent(e, current.interactive)
				},
			})
			await engine.mount(bundle)
		} catch (err) {
			if (token !== active.token) return
			runtimeError = err instanceof Error ? err.message : String(err)
		}
	}

	async function handleEvent(event: UiEvent, interactive: boolean): Promise<void> {
		const sid = active.sessionId
		const token = active.token
		if (!interactive || !sid || token !== mountToken) return

		try {
			const result = await sessionDispatch({
				sessionId: sid,
				send: event.send,
				payload: event.payload,
			})
			if (token !== active.token || sid !== active.sessionId) return
			if (result.state && typeof result.state === 'object') {
				applyRuntimeState(result.state as Record<string, unknown>)
			}
		} catch (err) {
			runtimeError = err instanceof Error ? err.message : String(err)
		}
	}

	async function syncPanel(): Promise<void> {
		if (panel === 'render') {
			await ensureQuickJsSession()
			await mountRenderPanel()
			return
		}
		if (panel === 'state') {
			await teardownEngineOnly()
			await ensureQuickJsSession()
			return
		}
		await teardownEngineOnly()
	}

	function selectFixture(id: UiLabFixtureId) {
		if (id === selectedId) return
		mountToken += 1
		sessionFixtureId = null
		runtimeState = null
		selectedId = id
		void syncPanel()
	}

	function selectPanel(next: Panel) {
		if (next === panel) return
		panel = next
		void syncPanel()
	}

	function attachHost(element: HTMLElement) {
		hostNode = element
		if (panel === 'render') void mountRenderPanel()
		return () => {
			if (hostNode === element) hostNode = null
			void teardownEngineOnly()
		}
	}

	onDestroy(() => {
		mountToken += 1
		void teardownAll()
	})
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-[14rem_minmax(0,1fr)] md:gap-6">
	<aside class="shrink-0 md:min-h-0">
		<p class="text-muted-foreground mb-2 px-1 text-[10px] font-bold tracking-wider uppercase">
			{t('uiLab.snippetCategory')}
		</p>
		<nav class="flex flex-row gap-2 md:flex-col md:gap-1" aria-label={t('uiLab.snippetCategory')}>
			{#each fixtures as fixture (fixture.id)}
				<button
					type="button"
					class="rounded-full px-3 py-1.5 text-left text-[11px] font-semibold tracking-wide transition-opacity md:w-full md:rounded-lg md:px-3 md:py-2 md:text-sm md:font-medium {selectedId ===
					fixture.id
						? 'bg-foreground text-background opacity-95'
						: 'bg-white/10 opacity-60 hover:opacity-90'}"
					aria-current={selectedId === fixture.id ? 'page' : undefined}
					onclick={() => selectFixture(fixture.id)}
				>
					{t(fixture.labelKey)}
				</button>
			{/each}
		</nav>
		<p class="text-muted-foreground mt-3 hidden px-1 text-xs leading-snug md:block">
			{t(selected.descriptionKey)}
		</p>
	</aside>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="rounded-full px-3 py-1 text-[10px] font-bold tracking-wider uppercase transition-opacity {panel ===
				'render'
					? 'bg-foreground text-background opacity-95'
					: 'bg-white/10 opacity-60 hover:opacity-90'}"
				onclick={() => selectPanel('render')}
			>
				{t('uiLab.panelRender')}
			</button>
			{#each jsonPanels as p (p)}
				<button
					type="button"
					class="rounded-full px-3 py-1 text-[10px] font-bold tracking-wider uppercase transition-opacity {panel ===
					p
						? 'bg-foreground text-background opacity-95'
						: 'bg-white/10 opacity-60 hover:opacity-90'}"
					onclick={() => selectPanel(p)}
				>
					{t(`uiLab.panel${p.charAt(0).toUpperCase()}${p.slice(1)}`)}
				</button>
			{/each}
		</div>

		{#if runtimeError}
			<p class="text-destructive shrink-0 px-1 text-sm" role="alert">{runtimeError}</p>
		{/if}

		<div
			class="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-white/10 {panel ===
			'render'
				? ''
				: 'hidden'}"
		>
			{#key selectedId}
				<div {@attach attachHost} class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-1"></div>
			{/key}
		</div>

		{#if panel === 'logic'}
			<pre
				class="min-h-[480px] flex-1 overflow-auto rounded-[var(--radius-lg)] border border-dotted border-border/40 bg-black/20 p-4 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90"
			>{jsonFor(panel, shell)}</pre>
		{:else if panel !== 'render'}
			<p class="text-muted-foreground px-1 text-xs leading-snug">
				{panel === 'source' ? t('uiLab.panelSourceHint') : panel === 'state' ? t('uiLab.panelStateHint') : ''}
			</p>
			<pre
				class="min-h-[480px] flex-1 overflow-auto rounded-[var(--radius-lg)] border border-dotted border-border/40 bg-black/20 p-4 text-xs leading-relaxed text-foreground/90"
			>{jsonFor(panel, shell)}</pre>
		{/if}
	</div>
</div>
