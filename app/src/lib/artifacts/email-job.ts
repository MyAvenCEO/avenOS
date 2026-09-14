import type { ExecutionEnvironment } from '@avenos/actors'
import { type EmailAttachment, emailImportContext, type FileImportContext } from './email-import'

export interface EmailRequest {
	operation: 'list' | 'scan' | 'demo' | 'start' | 'batch'
	host: string
	port: number
	user: string
	password: string
	mailbox: string
	since: string | null
	before: string | null
	maxMessages: number
	snapshotId?: string
	cursor?: number
	expectedScope?: string
}

export interface EmailResult {
	scope: string
	mailboxes: string[]
	attachments: EmailAttachment[]
	issues: string[]
	snapshotId?: string
	phase?: 'indexing' | 'importing'
	indexed?: number
	total?: number
	cursor?: number
	done?: boolean
}

export interface EmailJobState {
	running: boolean
	paused: boolean
	status: string
	error: string
	total: number
	scanned: number
	imported: string[]
	failed: { attachment: EmailAttachment; error: string }[]
	issues: string[]
}

export const initialEmailJobState = (): EmailJobState => ({
	running: false,
	paused: false,
	status: '',
	error: '',
	total: 0,
	scanned: 0,
	imported: [],
	failed: [],
	issues: []
})

interface Dependencies {
	accountScope(): Promise<string>
	delay?(milliseconds: number): Promise<void>
	scan(request: EmailRequest): Promise<EmailResult>
	ingest(
		path: string,
		environment: ExecutionEnvironment,
		context: FileImportContext
	): Promise<unknown>
}

/** Owned by the application module, independent of the settings component lifecycle. */
export class EmailImportJob {
	private request: EmailRequest | null = null
	private scope = ''
	private environment: ExecutionEnvironment = 'local'
	private pending: EmailAttachment[] = []
	private done = false
	private stop = false

	constructor(
		readonly state: EmailJobState,
		private readonly dependencies: Dependencies
	) {}

	async startMailbox(request: EmailRequest, environment: ExecutionEnvironment): Promise<void> {
		if (this.state.running || this.state.paused) return
		this.reset(environment)
		this.request = { ...request, operation: 'start' }
		await this.run()
	}

	async startSelected(
		result: EmailResult,
		selected: string[],
		environment: ExecutionEnvironment
	): Promise<void> {
		if (this.state.running || this.state.paused) return
		this.reset(environment)
		this.scope = result.scope
		this.pending = result.attachments.filter((attachment) => selected.includes(attachment.id))
		this.done = true
		await this.run()
	}

	clearCompleted() {
		if (!this.state.running && !this.state.paused) this.reset(this.environment)
	}

	private reset(environment: ExecutionEnvironment) {
		Object.assign(this.state, initialEmailJobState())
		this.environment = environment
		this.request = null
		this.scope = ''
		this.pending = []
		this.done = false
		this.stop = false
	}

	pause() {
		this.state.paused = true
		this.state.status = 'Pausing after the current message or PDF finishes…'
	}

	cancel() {
		this.stop = true
		this.state.paused = false
		this.request = null // Drop credentials immediately; an in-flight IPC call may still finish.
		this.pending = []
		this.state.status = this.state.running
			? 'Stopping after the current operation…'
			: 'Import stopped.'
	}

	async resume(): Promise<void> {
		if (this.state.running) return
		this.state.paused = false
		this.state.error = ''
		await this.run()
	}

	async retryFailed(): Promise<void> {
		if (this.state.running || this.state.paused) return
		this.pending = this.state.failed.map((entry) => entry.attachment)
		this.state.failed = []
		this.done = true
		this.stop = false
		await this.run()
	}

	private async scanWithRetry(request: EmailRequest): Promise<EmailResult | null> {
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.dependencies.scan({ ...request })
			} catch (cause) {
				if (!errorMessage(cause).includes('IMAP_RETRYABLE:') || attempt >= 3) throw cause
				this.state.status = `Mailbox connection interrupted. Retrying automatically (${attempt + 1}/3)…`
				await (this.dependencies.delay?.(1000 * 2 ** attempt) ??
					new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt)))
				if (this.stop || this.state.paused) return null
			}
		}
	}

	private async run(): Promise<void> {
		this.state.running = true
		try {
			while (!this.stop && !this.state.paused) {
				const attachment = this.pending[0]
				if (attachment) {
					this.state.status = `Uploading and processing ${attachment.name}…`
					try {
						const context = await emailImportContext(this.scope, attachment, this.environment)
						if (this.stop || this.state.paused) break
						const receipt = await this.dependencies.ingest(attachment.path, this.environment, {
							...context,
							background: true,
							throwOnError: true
						})
						if (!receipt) throw new Error('The file upload did not return a receipt.')
						this.state.imported.push(attachment.id)
					} catch (cause) {
						this.state.failed.push({ attachment, error: errorMessage(cause) })
					}
					this.pending.shift()
					continue
				}
				if (this.done) break
				if (!this.request)
					throw new Error('Enter your mailbox connection settings to start an import.')
				if (!this.scope) {
					this.scope = await this.dependencies.accountScope()
					if (this.stop) break
					this.request.expectedScope = this.scope
				}
				this.state.status =
					this.request.operation === 'start'
						? 'Finding all messages in the selected folder…'
						: `Reading mailbox: ${this.state.scanned} of ${this.state.total} messages…`
				const response = await this.scanWithRetry({ ...this.request })
				if (this.stop || !response) break
				if (this.scope && response.scope !== this.scope)
					throw new Error('Your Aven account changed. Start a new import.')
				this.scope = response.scope
				this.request = {
					...this.request,
					operation: 'batch',
					snapshotId: response.snapshotId,
					cursor: response.cursor ?? 0,
					expectedScope: response.scope
				}
				this.state.total = response.total ?? 0
				this.state.issues.push(...response.issues)
				this.pending = response.attachments
				this.done = response.done ?? false
				if (response.phase === 'indexing') {
					this.state.status = `Ordering messages by received date: ${response.indexed} of ${response.total}…`
				} else {
					this.state.scanned = response.cursor ?? 0
				}
			}
			if (this.stop) this.state.status = 'Import stopped. Completed uploads are retained.'
			else if (this.state.paused) this.state.status = 'Import paused. Resume to continue.'
			else {
				this.request = null
				this.state.status = `Import finished. ${this.state.imported.length} PDFs uploaded; ${this.state.failed.length} uploads failed. Follow processing in the workspace.`
			}
		} catch (cause) {
			this.state.error = errorMessage(cause)
			this.state.paused = true
			this.state.status = 'Import paused. Resume to retry the current mailbox operation.'
		} finally {
			this.state.running = false
		}
	}
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error
		? cause.message
		: typeof cause === 'string'
			? cause
			: JSON.stringify(cause)
}
