// Consumer side of the email-outbox boundary. Runs on its own connection pool
// with the email-worker role; it never touches auth or domain tables.
import { randomUUID } from 'node:crypto'
import nodemailer, { type Transporter } from 'nodemailer'
import type pg from 'pg'
import type pino from 'pino'
import { sanitizeError } from '../../validation.js'
import type { EmailWorkerConfig } from '../config.js'
import { decryptPayload } from '../crypto.js'
import { withTransaction } from '../db.js'
import { renderEmail, type SystemEmailTemplate, type TemplateDataMap } from './templates.js'

export interface ClaimedEmail {
	id: string
	template_key: string
	to_address: string
	payload_encrypted: string
	attempts: number
	max_attempts: number
}

export async function recoverExpiredLeases(pool: pg.Pool): Promise<number> {
	const now = new Date()
	const result = await pool.query(
		"UPDATE email_queue SET status='retry_wait',lease_owner=NULL,lease_expires_at=NULL,available_at=$1,updated_at=$1 WHERE status='sending' AND lease_expires_at < $1",
		[now]
	)
	return result.rowCount ?? 0
}

export async function claimEmails(
	pool: pg.Pool,
	owner: string,
	batchSize: number,
	leaseSeconds: number
): Promise<ClaimedEmail[]> {
	return withTransaction(pool, async (client) => {
		const now = new Date()
		const rows = (
			await client.query<ClaimedEmail>(
				`SELECT id,template_key,to_address,payload_encrypted,attempts,max_attempts FROM email_queue
       WHERE status IN ('queued','retry_wait') AND available_at <= $1 AND (lease_expires_at IS NULL OR lease_expires_at < $1) AND payload_encrypted IS NOT NULL
       ORDER BY priority DESC, created_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED`,
				[now, batchSize]
			)
		).rows
		const lease = new Date(now.getTime() + leaseSeconds * 1000)
		for (const row of rows) {
			await client.query(
				"UPDATE email_queue SET status='sending',lease_owner=$1,lease_expires_at=$2,attempts=attempts+1,updated_at=$3 WHERE id=$4",
				[owner, lease, now, row.id]
			)
			row.attempts += 1
		}
		return rows
	})
}

export type SmtpFailureKind = 'retry' | 'dead'
export function retryDelaySeconds(
	attempt: number,
	base: number,
	maximum: number,
	random = Math.random
): number {
	const delay = Math.min(base * 2 ** Math.max(0, attempt - 1), maximum)
	return delay + Math.floor(random() * Math.min(delay * 0.25, 60))
}
export function classifySmtpFailure(error: unknown): SmtpFailureKind {
	const value = error as { responseCode?: number; code?: string }
	if (value.responseCode && value.responseCode >= 500) return 'dead'
	if (value.responseCode && value.responseCode >= 400) return 'retry'
	return ['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ESOCKET', 'ETLS'].includes(value.code ?? '')
		? 'retry'
		: 'dead'
}

export function createTransport(config: Pick<EmailWorkerConfig, 'SMTP_URL'>): Transporter {
	return nodemailer.createTransport(config.SMTP_URL as never, { pool: true, maxConnections: 2 })
}

export class EmailWorker {
	private owner = randomUUID()
	private timer?: NodeJS.Timeout
	private heartbeatTimer?: NodeJS.Timeout
	private active = false
	private started = new Date()
	constructor(
		private pool: pg.Pool,
		private config: EmailWorkerConfig,
		private key: Buffer,
		private transport: Transporter,
		private logger: pino.Logger
	) {}

	start() {
		void recoverExpiredLeases(this.pool).catch(() => {})
		void this.heartbeat()
		this.timer = setInterval(() => {
			void this.tick()
		}, this.config.EMAIL_WORKER_POLL_INTERVAL_MS)
		this.heartbeatTimer = setInterval(
			() => void this.heartbeat(),
			this.config.EMAIL_WORKER_HEARTBEAT_SECONDS * 1000
		)
		this.timer.unref()
		this.heartbeatTimer.unref()
		void this.tick()
	}

	stop() {
		if (this.timer) clearInterval(this.timer)
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
		this.transport.close()
	}

	async heartbeat() {
		try {
			await this.pool.query(
				`INSERT INTO worker_heartbeats(worker_name,instance_id,version,started_at,last_heartbeat_at,metadata) VALUES('email-worker',$1,$2,$3,$4,$5)
         ON CONFLICT(worker_name) DO UPDATE SET instance_id=EXCLUDED.instance_id,version=EXCLUDED.version,last_heartbeat_at=EXCLUDED.last_heartbeat_at,metadata=EXCLUDED.metadata`,
				[
					this.owner,
					this.config.APPLICATION_VERSION,
					this.started,
					new Date(),
					JSON.stringify({ batchSize: this.config.EMAIL_WORKER_BATCH_SIZE })
				]
			)
		} catch (error) {
			this.logger.warn({ err: sanitizeError(error) }, 'email worker heartbeat failed')
		}
	}

	async tick() {
		if (this.active) return
		this.active = true
		try {
			const messages = await claimEmails(
				this.pool,
				this.owner,
				this.config.EMAIL_WORKER_BATCH_SIZE,
				this.config.EMAIL_WORKER_LEASE_SECONDS
			)
			await Promise.all(messages.map((message) => this.deliver(message)))
		} catch (error) {
			this.logger.error({ err: sanitizeError(error) }, 'email worker tick failed')
		} finally {
			this.active = false
		}
	}

	private async deliver(row: ClaimedEmail) {
		const started = Date.now()
		try {
			const data = decryptPayload<TemplateDataMap[SystemEmailTemplate]>(
				row.payload_encrypted,
				this.key
			)
			const rendered = renderEmail(row.template_key as SystemEmailTemplate, data as never)
			const info = await this.transport.sendMail({
				from: this.config.SMTP_FROM,
				replyTo: this.config.SMTP_REPLY_TO || undefined,
				to: row.to_address,
				subject: rendered.subject,
				text: rendered.text,
				html: rendered.html,
				headers: { 'X-Aven-Queue-ID': row.id }
			})
			const now = new Date()
			await this.pool.query(
				"UPDATE email_queue SET status='sent',payload_encrypted=NULL,smtp_message_id=$1,sent_at=$2,updated_at=$2,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,last_error_message=NULL WHERE id=$3 AND lease_owner=$4",
				[info.messageId ?? null, now, row.id, this.owner]
			)
			this.logger.info({ emailQueueId: row.id, durationMs: Date.now() - started }, 'email sent')
		} catch (error) {
			await this.failure(row, error)
		}
	}

	private async failure(row: ClaimedEmail, error: unknown) {
		const kind = classifySmtpFailure(error)
		const exhausted = row.attempts >= row.max_attempts
		const now = new Date()
		const message = sanitizeError(error)
		if (kind === 'dead' || exhausted) {
			await this.pool.query(
				"UPDATE email_queue SET status='dead',dead_at=$1,updated_at=$1,lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2,last_error_message=$3 WHERE id=$4 AND lease_owner=$5",
				[
					now,
					kind === 'dead' ? 'EMAIL_PERMANENT_FAILURE' : 'EMAIL_ATTEMPTS_EXHAUSTED',
					message,
					row.id,
					this.owner
				]
			)
		} else {
			const seconds = retryDelaySeconds(
				row.attempts,
				this.config.EMAIL_RETRY_BASE_SECONDS,
				this.config.EMAIL_RETRY_MAX_SECONDS
			)
			await this.pool.query(
				"UPDATE email_queue SET status='retry_wait',available_at=$1,updated_at=$2,lease_owner=NULL,lease_expires_at=NULL,last_error_code='EMAIL_TRANSIENT_FAILURE',last_error_message=$3 WHERE id=$4 AND lease_owner=$5",
				[new Date(now.getTime() + seconds * 1000), now, message, row.id, this.owner]
			)
		}
		this.logger.warn({ emailQueueId: row.id, kind, exhausted }, 'email delivery failed')
	}
}
