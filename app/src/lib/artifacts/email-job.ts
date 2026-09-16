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
	phase: 'idle' | 'indexing' | 'importing' | 'finished' | 'stopped'
	indexed: number
	selectedTotal: number
	label: string
	placement: ExecutionEnvironment
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
	phase: 'idle',
	indexed: 0,
	selectedTotal: 0,
	label: '',
	placement: 'local',
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
	private environmentEpoch = 0

	constructor(
		readonly state: EmailJobState,
		private readonly dependencies: Dependencies
	) {}

	async startMailbox(request: EmailRequest, environment: ExecutionEnvironment): Promise<void> {
		if (this.state.running || this.state.paused) return
		this.reset(environment)
		this.request = { ...request, operation: 'start' }
		this.state.phase = 'indexing'
		this.state.label = `${request.mailbox} · ${request.user}`
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
		this.state.phase = 'importing'
		this.state.label = 'Selected PDFs'
		this.state.selectedTotal = this.pending.length
		await this.run()
	}

	clearCompleted() {
		if (!this.state.running && !this.state.paused) this.reset(this.environment)
	}

	resetForEnvironment(): void {
		this.environmentEpoch++
		this.stop = true
		this.request = null
		this.pending = []
		this.scope = ''
		Object.assign(this.state, initialEmailJobState())
	}

	private reset(environment: ExecutionEnvironment) {
		Object.assign(this.state, initialEmailJobState())
		this.environment = environment
		this.state.placement = environment
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
		this.state.phase = 'stopped'
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
		this.state.phase = 'importing'
		this.state.failed = []
		this.done = true
		this.stop = false
		await this.run()
	}

	private async scanWithRetry(request: EmailRequest, epoch: number): Promise<EmailResult | null> {
		for (let attempt = 0; ; attempt++) {
			if (epoch !== this.environmentEpoch) return null
			try {
				return await this.dependencies.scan({ ...request })
			} catch (cause) {
				if (epoch !== this.environmentEpoch) return null
				if (!errorMessage(cause).includes('IMAP_RETRYABLE:') || attempt >= 3) throw cause
				this.state.status = `Mailbox connection interrupted. Retrying automatically (${attempt + 1}/3)…`
				await (this.dependencies.delay?.(1000 * 2 ** attempt) ??
					new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt)))
				if (epoch !== this.environmentEpoch || this.stop || this.state.paused) return null
			}
		}
	}

	private async run(): Promise<void> {
		const epoch = this.environmentEpoch
		this.state.running = true
		try {
			while (epoch === this.environmentEpoch && !this.stop && !this.state.paused) {
				const attachment = this.pending[0]
				if (attachment) {
					this.state.status = `Uploading ${attachment.name}…`
					try {
						const context = await emailImportContext(this.scope, attachment, this.environment)
						if (epoch !== this.environmentEpoch || this.stop || this.state.paused) break
						const receipt = await this.dependencies.ingest(attachment.path, this.environment, {
							...context,
							background: true,
							throwOnError: true
						})
						if (epoch !== this.environmentEpoch) break
						if (!receipt) throw new Error('The file upload did not return a receipt.')
						this.state.imported.push(attachment.id)
					} catch (cause) {
						if (epoch !== this.environmentEpoch) break
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
					if (epoch !== this.environmentEpoch || this.stop) break
					this.request.expectedScope = this.scope
				}
				this.state.status =
					this.request.operation === 'start'
						? 'Finding all messages in the selected folder…'
						: this.state.phase === 'indexing'
							? `Ordering messages by received date: ${this.state.indexed} of ${this.state.total}…`
							: `Reading mailbox: ${this.state.scanned} of ${this.state.total} messages…`
				const response = await this.scanWithRetry({ ...this.request }, epoch)
				if (epoch !== this.environmentEpoch || this.stop || !response) break
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
					this.state.phase = 'indexing'
					this.state.indexed = response.indexed ?? 0
					this.state.status = `Ordering messages by received date: ${response.indexed} of ${response.total}…`
				} else {
					this.state.phase = 'importing'
					this.state.scanned = response.cursor ?? 0
				}
			}
			if (epoch !== this.environmentEpoch) return
			if (this.stop) this.state.status = 'Import stopped. Completed uploads are retained.'
			else if (this.state.paused) this.state.status = 'Import paused. Resume to continue.'
			else {
				this.request = null
				this.state.phase = 'finished'
				this.state.status = `Import finished. ${this.state.imported.length} PDFs uploaded; ${this.state.failed.length} uploads failed. Follow processing in the workspace.`
			}
		} catch (cause) {
			if (epoch !== this.environmentEpoch) return
			this.state.error = errorMessage(cause)
			this.state.paused = true
			this.state.status = 'Import paused. Resume to retry the current mailbox operation.'
		} finally {
			if (epoch === this.environmentEpoch) this.state.running = false
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
