import type {
	McpUiSandboxProxyReadyNotification,
	McpUiSandboxResourceReadyNotification
} from '@modelcontextprotocol/ext-apps/app-bridge'
import { buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge'

/**
 * Two modes (same bundle):
 * - **Browser/iframe** (default): served from a separate origin, validated via `document.referrer`.
 * - **Tauri child WebView** (`?tauri=1&hostOrigin=…&vsLabel=…`): top-level page; bridge to host via Tauri events.
 */
const ALLOWED_REFERRER_PATTERN = /^(https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)|tauri:\/\/|https?:\/\/tauri\.localhost(:|\/|$)|https?:\/\/ipc\.localhost(:|\/|$))/

const params =
	typeof globalThis.window !== 'undefined'
		? new URLSearchParams(globalThis.window.location.search)
		: null
const tauriMode = params?.get('tauri') === '1'

interface ParentLike {
	postMessage(data: unknown, targetOrigin?: string): void
}

let EXPECTED_HOST_ORIGIN: string
let OWN_ORIGIN: string
let parentLike: ParentLike

/** Set in Tauri branch — used to forward composer shortcuts to the shell webview. */
let emitToHost: ((event: string, payload: Record<string, unknown>) => Promise<void>) | null = null

if (tauriMode) {
	const hostOrigin = params!.get('hostOrigin')
	const vsLabel = params!.get('vsLabel')
	if (!hostOrigin?.length || !vsLabel?.length) {
		throw new Error(
			'[vibe-sandbox] Tauri mode requires ?tauri=1&hostOrigin=…&vsLabel=… in the sandbox URL.'
		)
	}
	EXPECTED_HOST_ORIGIN = hostOrigin
	OWN_ORIGIN = new URL(globalThis.window!.location.href).origin

	const { listen, emit } = await import('@tauri-apps/api/event')
	emitToHost = emit
	parentLike = {
		postMessage(data: unknown, _targetOrigin?: string) {
			void emit('vibe-sandbox-out', { label: vsLabel, data })
		}
	}

	// NOTE: WebKit rejects non-Window values for MessageEventInit.source with
	// "TypeError: Type error". Discriminate inbound messages via `origin` instead.
	await listen(`vibe-sandbox-in:${vsLabel}`, (event) => {
		globalThis.window!.dispatchEvent(
			new MessageEvent('message', {
				data: event.payload,
				origin: EXPECTED_HOST_ORIGIN
			})
		)
	})
} else {
	if (globalThis.window !== undefined && window.self === window.top) {
		throw new Error('This file is only to be used in an iframe sandbox.')
	}

	if (!globalThis.document?.referrer) {
		throw new Error('No referrer, cannot validate embedding site.')
	}

	if (!document.referrer.match(ALLOWED_REFERRER_PATTERN)) {
		throw new Error(
			`Embedding domain not allowed in referrer ${document.referrer}. (Update ALLOWED_REFERRER_PATTERN for your domain.)`
		)
	}

	EXPECTED_HOST_ORIGIN = new URL(document.referrer).origin
	OWN_ORIGIN = new URL(window.location.href).origin
	parentLike = window.parent as unknown as ParentLike

	try {
		// biome-ignore lint/style/noNonNullAssertion: deliberate cross-origin probe for sandbox self-test
		window.top!.alert('If you see this, the sandbox is not setup securely.')
		throw 'FAIL'
	} catch (e) {
		if (e === 'FAIL') {
			throw new Error('The sandbox is not setup securely.')
		}
		// Expected: SecurityError confirms proper sandboxing.
	}
}

const SHELL_COMPOSER_SHORTCUT_EVENT = 'vibe-sandbox-shell-composer-shortcut'

function isEditableShortcutTarget(node: EventTarget | null): boolean {
	if (!(node instanceof HTMLElement)) return false
	const tag = node.tagName
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
	if (node.isContentEditable) return true
	return false
}

function shouldForwardShellComposerKeydown(e: KeyboardEvent, target: EventTarget | null): boolean {
	if (!tauriMode || !emitToHost) return false
	if (!(target instanceof Element)) return true
	if (isEditableShortcutTarget(target)) return false
	if (target.closest('button, a[href], [role="button"], summary')) return false
	const isSpace = e.key === ' ' || e.code === 'Space'
	const isPrintable = e.key.length === 1
	if (!isSpace && !isPrintable) return false
	if (isPrintable && (e.metaKey || e.ctrlKey || e.altKey)) return false
	return true
}

function forwardShellComposerShortcut(e: KeyboardEvent): void {
	if (!shouldForwardShellComposerKeydown(e, e.target)) return
	e.preventDefault()
	e.stopPropagation()
	void emitToHost?.(SHELL_COMPOSER_SHORTCUT_EVENT, {
		key: e.key,
		code: e.code,
		metaKey: e.metaKey,
		ctrlKey: e.ctrlKey,
		altKey: e.altKey,
		shiftKey: e.shiftKey
	})
}

const innerDocsWithComposerForward = new WeakSet<Document>()

function attachInnerComposerForward(doc: Document | null | undefined): void {
	if (!tauriMode || !emitToHost || !doc || innerDocsWithComposerForward.has(doc)) return
	innerDocsWithComposerForward.add(doc)
	doc.addEventListener('keydown', forwardShellComposerShortcut, true)
}

document.documentElement.style.cssText = 'height:100%;margin:0;padding:0;box-sizing:border-box'
document.body.style.cssText =
	'min-height:100%;margin:0;padding:0;box-sizing:border-box;display:flex;flex-direction:column'

const shell = document.createElement('div')
shell.className = 'vibe-shell'
// Tauri: outer WKWebView already has matched corner radius — inner radius + border fight the mask.
const shellChrome = tauriMode
	? 'border:1px solid rgba(0,0,0,0.1);border-radius:0;overflow:hidden;'
	: 'border:1px solid rgba(0,0,0,0.1);border-radius:1rem;overflow:hidden;'
shell.style.cssText =
	'flex:1;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;' +
	shellChrome +
	'background:rgba(255,255,255,0.1);'
const inner = document.createElement('iframe')
inner.style.cssText = 'width:100%;flex:1;min-height:0;'
inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
document.body.appendChild(shell)
shell.appendChild(inner)

if (tauriMode) {
	window.addEventListener('keydown', forwardShellComposerShortcut, true)
	inner.addEventListener('load', () => {
		attachInnerComposerForward(inner.contentDocument ?? undefined)
	})
}

const RESOURCE_READY_NOTIFICATION: McpUiSandboxResourceReadyNotification['method'] =
	'ui/notifications/sandbox-resource-ready'
const PROXY_READY_NOTIFICATION: McpUiSandboxProxyReadyNotification['method'] =
	'ui/notifications/sandbox-proxy-ready'

window.addEventListener('message', async (event: MessageEvent) => {
	// Inner iframe → host (relay outward). Match by source: the inner iframe is
	// always a real Window object created by us.
	if (event.source === inner.contentWindow) {
		if (event.origin !== OWN_ORIGIN) {
			console.error(
				'[Sandbox] Rejecting message from inner iframe with unexpected origin:',
				event.origin,
				'expected:',
				OWN_ORIGIN
			)
			return
		}
		parentLike.postMessage(event.data, EXPECTED_HOST_ORIGIN)
		return
	}

	// Host → child. Origin is enough: it's set by the browser for real
	// PostMessage events (iframe path) and explicitly by us for synthetic
	// MessageEvents (Tauri path).
	if (event.origin !== EXPECTED_HOST_ORIGIN) {
		return
	}

	const data = event.data as { method?: string; params?: Record<string, unknown> }
	if (data?.method === RESOURCE_READY_NOTIFICATION) {
		const p = data.params as {
			html?: string
			sandbox?: string
			permissions?: Parameters<typeof buildAllowAttribute>[0]
		}
		const { html, sandbox, permissions } = p
		if (typeof sandbox === 'string') {
			inner.setAttribute('sandbox', sandbox)
		}
		const allowAttribute = buildAllowAttribute(permissions)
		if (allowAttribute) {
			inner.setAttribute('allow', allowAttribute)
		}
		if (typeof html === 'string') {
			const doc = inner.contentDocument ?? inner.contentWindow?.document
			if (doc) {
				doc.open()
				doc.write(html)
				doc.close()
				attachInnerComposerForward(doc)
			} else {
				console.warn('[Sandbox] document.write not available, falling back to srcdoc')
				inner.srcdoc = html
			}
		}
	} else if (inner.contentWindow) {
		inner.contentWindow.postMessage(event.data, '*')
	}
})

parentLike.postMessage(
	{
		jsonrpc: '2.0',
		method: PROXY_READY_NOTIFICATION,
		params: {}
	},
	EXPECTED_HOST_ORIGIN
)
