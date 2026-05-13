import type {
	McpUiSandboxProxyReadyNotification,
	McpUiSandboxResourceReadyNotification
} from '@modelcontextprotocol/ext-apps/app-bridge'
import { buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge'

/**
 * Allow embedding from any local dev origin (Vite picks ports dynamically) and
 * the configured production host(s). Production deployments should narrow this
 * to a strict allowlist.
 */
const ALLOWED_REFERRER_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/

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

const EXPECTED_HOST_ORIGIN = new URL(document.referrer).origin
const OWN_ORIGIN = new URL(window.location.href).origin

/**
 * `document.write`/`srcdoc` inner documents often keep `about:blank` as URL; without a `<base>`,
 * absolute module URLs like `/ext-apps.js` fail to fetch. Inject once into `<head>`.
 */
function withSandboxDocumentBase(html: string, origin: string): string {
	const base = `<base href="${origin}/">`
	if (/<base\s+href=/i.test(html)) return html
	if (/<head(\s[^>]*)?>/i.test(html)) {
		return html.replace(/<head(\s[^>]*)?>/i, `<head$1>${base}`)
	}
	return `<!doctype html><html><head>${base}</head><body>${html}</body></html>`
}

try {
	// Must call `alert` on `top` (not optional) — if this runs, sandbox is broken.
	// biome-ignore lint/style/noNonNullAssertion: deliberate cross-origin probe for sandbox self-test
	window.top!.alert('If you see this, the sandbox is not setup securely.')
	throw 'FAIL'
} catch (e) {
	if (e === 'FAIL') {
		throw new Error('The sandbox is not setup securely.')
	}
	// Expected: SecurityError confirms proper sandboxing.
}

const shell = document.createElement('div')
shell.className = 'vibe-shell'
shell.style.cssText =
	'flex:1;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;' +
	'border:1px solid rgba(0,0,0,0.1);border-radius:2rem;overflow:hidden;' +
	'background:rgba(255,255,255,0.1);'
const inner = document.createElement('iframe')
inner.style.cssText = 'width:100%;flex:1;min-height:0;'
inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
document.body.appendChild(shell)
shell.appendChild(inner)

const RESOURCE_READY_NOTIFICATION: McpUiSandboxResourceReadyNotification['method'] =
	'ui/notifications/sandbox-resource-ready'
const PROXY_READY_NOTIFICATION: McpUiSandboxProxyReadyNotification['method'] =
	'ui/notifications/sandbox-proxy-ready'

window.addEventListener('message', async (event: MessageEvent) => {
	if (event.source === window.parent) {
		if (event.origin !== EXPECTED_HOST_ORIGIN) {
			console.error(
				'[Sandbox] Rejecting message from unexpected origin:',
				event.origin,
				'expected:',
				EXPECTED_HOST_ORIGIN
			)
			return
		}

		const data = event.data as { method?: string; params?: Record<string, unknown> }
		if (data?.method === RESOURCE_READY_NOTIFICATION) {
			const params = data.params as {
				html?: string
				sandbox?: string
				permissions?: Parameters<typeof buildAllowAttribute>[0]
			}
			const { html, sandbox, permissions } = params
			if (typeof sandbox === 'string') {
				inner.setAttribute('sandbox', sandbox)
			}
			const allowAttribute = buildAllowAttribute(permissions)
			if (allowAttribute) {
				inner.setAttribute('allow', allowAttribute)
			}
			if (typeof html === 'string') {
				const htmlWithBase = withSandboxDocumentBase(html, OWN_ORIGIN)
				const doc = inner.contentDocument ?? inner.contentWindow?.document
				if (doc) {
					doc.open()
					doc.write(htmlWithBase)
					doc.close()
				} else {
					console.warn('[Sandbox] document.write not available, falling back to srcdoc')
					inner.srcdoc = htmlWithBase
				}
			}
		} else if (inner.contentWindow) {
			inner.contentWindow.postMessage(event.data, '*')
		}
	} else if (event.source === inner.contentWindow) {
		if (event.origin !== OWN_ORIGIN) {
			console.error(
				'[Sandbox] Rejecting message from inner iframe with unexpected origin:',
				event.origin,
				'expected:',
				OWN_ORIGIN
			)
			return
		}
		window.parent.postMessage(event.data, EXPECTED_HOST_ORIGIN)
	}
})

window.parent.postMessage(
	{
		jsonrpc: '2.0',
		method: PROXY_READY_NOTIFICATION,
		params: {}
	},
	EXPECTED_HOST_ORIGIN
)
