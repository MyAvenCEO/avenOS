/**
 * Host glue for the vibe-app sandbox.
 *
 * - **Browser:** outer `<iframe>` → separate-origin `sandbox.html` (Bun `serve.ts` or static URL).
 * - **Tauri:** outer **native child WebView** + `TauriSandboxTransport`; inner `sandbox.html` still uses the inner iframe for untrusted HTML.
 */
import {
	AppBridge,
	buildAllowAttribute,
	type McpUiHostContext,
	type McpUiHostContextChangedNotification,
	type McpUiMessageRequest,
	type McpUiResourceCsp,
	type McpUiResourcePermissions,
	type McpUiSandboxProxyReadyNotification,
	type McpUiSizeChangedNotification,
	type McpUiUpdateModelContextRequest,
	PostMessageTransport
} from '@modelcontextprotocol/ext-apps/app-bridge'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const DEFAULT_IMPLEMENTATION = { name: '@avenos/aven-vibe-sandbox host', version: '0.0.1' }

export const DEFAULT_SANDBOX_BASE = 'http://localhost:8081/sandbox.html'

/** Resolve the sandbox proxy URL. Hosts can override per call or via Vite env (`PUBLIC_VIBE_SANDBOX_URL` must match the sandbox server port when non-default). */
function resolveSandboxBase(explicit?: string): string {
	if (explicit && explicit.length > 0) return explicit
	const meta =
		typeof import.meta !== 'undefined'
			? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
			: undefined
	const fromEnv = meta?.PUBLIC_VIBE_SANDBOX_URL ?? meta?.PUBLIC_MCP_SANDBOX_URL
	return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_SANDBOX_BASE
}

function getTheme(): 'light' | 'dark' {
	if (typeof window === 'undefined') return 'light'
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Subset of official MCP host style keys — aligned with Aven CEO `app.css` theme. */
export const HOST_STYLE_VARIABLES: Record<string, string> = {
	'--color-background-primary': '#e8ede1',
	'--color-text-primary': '#1a1a1a',
	'--color-text-secondary': 'rgba(26, 26, 26, 0.45)',
	'--color-border-primary': 'rgba(0, 0, 0, 0.1)',
	'--color-ring-info': '#e6b34d',
	'--color-text-inverse': '#e8ede1',
	'--border-radius-md': '1rem',
	// Note: MCP Apps schema does NOT include `--border-radius-2xl`. Apps can rely on
	// the inline CSS fallback `var(--border-radius-2xl, 2rem)` instead.
	'--font-sans': 'Inter, ui-sans-serif, system-ui, sans-serif'
}

export type AppMessage = McpUiMessageRequest['params']
export type ModelContext = McpUiUpdateModelContextRequest['params']

export const log = {
	info: (...args: unknown[]) => console.log('[vibe-app-sandbox]', ...args),
	warn: (...args: unknown[]) => console.warn('[vibe-app-sandbox]', ...args),
	error: (...args: unknown[]) => console.error('[vibe-app-sandbox]', ...args)
}

export interface AppBridgeCallbacks {
	onContextUpdate?: (context: ModelContext | null) => void
	onMessage?: (message: AppMessage) => void
	onDisplayModeChange?: (mode: 'inline' | 'fullscreen' | 'pip') => void
}

export interface AppBridgeHostOptions {
	implementation?: { name: string; version: string }
	containerDimensions?: { maxHeight?: number; width?: number } | { height: number; width?: number }
	displayMode?: 'inline' | 'fullscreen' | 'pip'
	styleVariables?: Record<string, string>
}

export interface LoadSandboxProxyOptions {
	csp?: McpUiResourceCsp
	permissions?: McpUiResourcePermissions
	sandboxBaseUrl?: string
}

/** Point the outer iframe at the sandbox origin and wait for the proxy script. */
export function loadSandboxProxy(
	iframe: HTMLIFrameElement,
	options?: LoadSandboxProxyOptions
): Promise<boolean> {
	if (iframe.src) return Promise.resolve(false)

	iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
	const allowAttr = buildAllowAttribute(options?.permissions)
	if (allowAttr) iframe.setAttribute('allow', allowAttr)

	const readyMethod: McpUiSandboxProxyReadyNotification['method'] =
		'ui/notifications/sandbox-proxy-ready'

	const readyPromise = new Promise<boolean>((resolve) => {
		const listener = (event: MessageEvent) => {
			if (event.source === iframe.contentWindow && event.data?.method === readyMethod) {
				log.info('Sandbox proxy loaded')
				window.removeEventListener('message', listener)
				resolve(true)
			}
		}
		window.addEventListener('message', listener)
	})

	const sandboxUrl = new URL(resolveSandboxBase(options?.sandboxBaseUrl))
	if (options?.csp) sandboxUrl.searchParams.set('csp', JSON.stringify(options.csp))

	log.info('Loading sandbox proxy', options?.csp ? `(CSP: ${JSON.stringify(options.csp)})` : '')
	iframe.src = sandboxUrl.href

	return readyPromise
}

function hookInitializedCallback(appBridge: AppBridge): Promise<void> {
	const previous = appBridge.oninitialized
	return new Promise((resolve) => {
		appBridge.oninitialized = (params) => {
			resolve()
			appBridge.oninitialized = previous
			appBridge.oninitialized?.(params)
		}
	})
}

export function createAppBridge(
	sizing: HTMLIFrameElement | HTMLElement,
	callbacks?: AppBridgeCallbacks,
	options?: AppBridgeHostOptions
): AppBridge {
	// MCP Client is intentionally null — swap for real server integration later.
	const appBridge = new AppBridge(
		null,
		options?.implementation ?? DEFAULT_IMPLEMENTATION,
		{
			openLinks: {},
			updateModelContext: { text: {}, structuredContent: {} },
			message: { text: {} },
			logging: {}
		},
		{
			hostContext: {
				theme: getTheme(),
				platform: 'web',
				styles: {
					variables: options?.styleVariables ?? HOST_STYLE_VARIABLES
				} as McpUiHostContext['styles'],
				containerDimensions: options?.containerDimensions ?? { maxHeight: 6000 },
				displayMode: options?.displayMode ?? 'inline',
				availableDisplayModes: ['inline', 'fullscreen']
			}
		}
	)

	if (typeof window !== 'undefined') {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			const theme = getTheme()
			log.info('Theme changed:', theme)
			void appBridge.sendHostContextChange({ theme })
		})
	}

	const iframeResizeObserver = new ResizeObserver(([entry]) => {
		const width = Math.round(entry.contentRect.width)
		if (width > 0) {
			void appBridge.sendHostContextChange({
				containerDimensions: { width, maxHeight: 6000 }
			})
		}
	})
	iframeResizeObserver.observe(sizing)

	const prevOnClose = appBridge.onclose
	appBridge.onclose = () => {
		iframeResizeObserver.disconnect()
		prevOnClose?.()
	}

	appBridge.onmessage = async (params, _extra) => {
		log.info('Message from MCP App:', params)
		callbacks?.onMessage?.(params)
		return {}
	}

	appBridge.onopenlink = async (params) => {
		log.info('Open link request:', params)
		window.open(params.url, '_blank', 'noopener,noreferrer')
		return {}
	}

	appBridge.onloggingmessage = (params) => {
		log.info('Log from MCP App:', params)
	}

	appBridge.onupdatemodelcontext = async (params) => {
		log.info('Model context update from MCP App:', params)
		const hasContent = params.content && params.content.length > 0
		const hasStructured =
			params.structuredContent && Object.keys(params.structuredContent).length > 0
		callbacks?.onContextUpdate?.(hasContent || hasStructured ? params : null)
		return {}
	}

	appBridge.onsizechange = async ({ width, height }: McpUiSizeChangedNotification['params']) => {
		const style = getComputedStyle(sizing)
		const isBorderBox = style.boxSizing === 'border-box'
		const from: Keyframe = {}
		const to: Keyframe = {}

		let w = width
		let h = height
		if (w !== undefined && isBorderBox) {
			w += Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth)
		}
		if (h !== undefined && isBorderBox) {
			h += Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth)
		}
		if (w !== undefined) {
			from.minWidth = `${sizing.offsetWidth}px`
			sizing.style.minWidth = to.minWidth = `min(${w}px, 100%)`
		}
		if (h !== undefined) {
			from.height = `${sizing.offsetHeight}px`
			sizing.style.height = to.height = `${h}px`
		}
		if (w !== undefined || h !== undefined) {
			sizing.animate([from, to], { duration: 300, easing: 'ease-out' })
		}
	}

	appBridge.onrequestdisplaymode = async (params) => {
		log.info('Display mode request from MCP App:', params)
		const newMode = params.mode === 'fullscreen' ? 'fullscreen' : 'inline'
		void appBridge.sendHostContextChange({ displayMode: newMode })
		callbacks?.onDisplayModeChange?.(newMode)
		return { mode: newMode }
	}

	appBridge.oncalltool = async (params) => {
		log.warn('View called server tool without MCP client (demo):', params.name)
		return {
			content: [
				{
					type: 'text',
					text: `Demo host: tools/call("${params.name}") is not wired to a server yet.`
				}
			],
			isError: true
		}
	}

	return appBridge
}

export interface RunAppOptions {
	html: string
	csp?: McpUiResourceCsp
	permissions?: McpUiResourcePermissions
	toolArguments: Record<string, unknown>
	toolResult: Promise<CallToolResult>
}

/** Connect `AppBridge` via outer iframe `contentWindow` or a custom MCP `Transport` (e.g. Tauri). */
export async function runApp(
	target: HTMLIFrameElement | { transport: Transport },
	appBridge: AppBridge,
	opts: RunAppOptions
): Promise<void> {
	const initialized = hookInitializedCallback(appBridge)

	if ('transport' in target && target.transport !== undefined) {
		await appBridge.connect(target.transport)
	} else {
		const outerIframe = target as HTMLIFrameElement
		const contentWindow = outerIframe.contentWindow
		if (!contentWindow) {
			throw new Error('Outer iframe has no contentWindow (sandbox not loaded?)')
		}
		await appBridge.connect(new PostMessageTransport(contentWindow, contentWindow))
	}

	await appBridge.sendSandboxResourceReady({
		html: opts.html,
		csp: opts.csp,
		permissions: opts.permissions
	})

	log.info('Waiting for MCP App to initialize...')
	await initialized
	log.info('MCP App initialized')

	log.info('Sending tool input:', opts.toolArguments)
	await appBridge.sendToolInput({ arguments: opts.toolArguments })

	opts.toolResult.then(
		(result) => {
			log.info('Sending tool result:', result)
			void appBridge.sendToolResult(result)
		},
		(error: unknown) => {
			log.error('Tool failed; sending cancellation:', error)
			void appBridge.sendToolCancelled({
				reason: error instanceof Error ? error.message : String(error)
			})
		}
	)
}

export type HostContextChanged = McpUiHostContextChangedNotification['params']

export type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'
