import { transportError } from '@avenos/chat-engine/transport-error'

/** Interactive-only settings state. Never persists plaintext or returns it in receipts. */
export interface ConnectionContext {
	environmentId: string
	subjectId: string
}
export interface CredentialMetadata {
	credentialRef: string
	label: string
	kind: 'token' | 'password'
	secretVersion: number
	enabled: boolean
}
export interface BindingMetadata {
	bindingRef: string
	credentialRef: string
	revision: number
	enabled: boolean
	protocol: 'imap' | 'http'
	profile: {
		label: string
		host: string | { kind: string; value: string }
		port?: number
		pathPrefix?: string
		mailboxes?: string[]
		purpose: string
	}
}
export interface ConnectionMetadata {
	credentials: CredentialMetadata[]
	bindings: BindingMetadata[]
}
export type ConnectionTransport = <T>(
	args: ConnectionContext & {
		action: 'metadata' | 'command' | 'receipt'
		commandId?: string
		command?: Record<string, unknown>
	}
) => Promise<T>

export class ConnectionManagement {
	private disposed = false
	private busy = false
	private pending: string | null = null
	private readonly context: ConnectionContext
	constructor(
		context: ConnectionContext,
		private readonly transport: ConnectionTransport
	) {
		this.context = Object.freeze({ ...context })
	}
	close() {
		this.disposed = true
	}
	private active() {
		if (this.disposed) throw Error('CONNECTION_CONTEXT_CLOSED')
	}
	get pendingCommand() {
		return this.pending
	}
	async metadata() {
		this.active()
		const value = await this.transport<ConnectionMetadata>({ ...this.context, action: 'metadata' })
		this.active()
		return value
	}
	async command(command: Record<string, unknown>) {
		this.active()
		if (this.busy || this.pending) throw Error('CONNECTION_COMMAND_PENDING')
		this.busy = true
		const commandId = crypto.randomUUID()
		this.pending = commandId
		try {
			const result = await this.transport<{ receipt: unknown }>({
				...this.context,
				action: 'command',
				commandId,
				command
			})
			this.active()
			this.pending = null
			return result
		} catch (error) {
			// Explicit rejection did not apply the command. A timeout, lost connection
			// or late workspace switch says nothing about whether it committed.
			const { status } = transportError(error)
			if (status && [400, 401, 403, 404, 409, 413, 415, 422].includes(status)) this.pending = null
			throw error
		} finally {
			this.busy = false
		}
	}
	/** No secret or command body retained for automatic retry after uncertainty. */
	async checkReceipt() {
		this.active()
		if (this.busy || !this.pending) throw Error('CONNECTION_COMMAND_NOT_PENDING')
		this.busy = true
		try {
			const result = await this.transport<{ receipt: unknown }>({
				...this.context,
				action: 'receipt',
				commandId: this.pending
			})
			this.active()
			this.pending = null
			return result
		} finally {
			this.busy = false
		}
	}
}
