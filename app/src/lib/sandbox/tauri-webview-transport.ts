import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js'
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'

/** Host-side MCP transport ↔ Tauri child sandbox webview (`vibe-sandbox-out` / `vibe-sandbox-in`). */
export class TauriSandboxTransport implements Transport {
	private readonly label: string
	private unlisten: UnlistenFn | undefined

	onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void
	onclose?: () => void
	onerror?: (error: Error) => void

	constructor(label: string) {
		this.label = label
	}

	async start(): Promise<void> {
		this.unlisten = await listen<{ label: string; data: unknown }>('vibe-sandbox-out', (event) => {
			const pl = event.payload
			if (!pl || pl.label !== this.label) return
			try {
				this.onmessage?.(pl.data as JSONRPCMessage, {})
			} catch (err) {
				this.onerror?.(err instanceof Error ? err : new Error(String(err)))
			}
		})
	}

	async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
		await emit(`vibe-sandbox-in:${this.label}`, message)
	}

	async close(): Promise<void> {
		this.unlisten?.()
		this.unlisten = undefined
		this.onclose?.()
	}
}
