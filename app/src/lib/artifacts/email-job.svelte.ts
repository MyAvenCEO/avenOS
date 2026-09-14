import { invoke } from '@tauri-apps/api/core'
import {
	EmailImportJob,
	type EmailJobState,
	type EmailResult,
	initialEmailJobState
} from './email-job'
import { ingestFile } from './ingest.svelte'

export const emailJobState = $state<EmailJobState>(initialEmailJobState())
export const emailJob = new EmailImportJob(emailJobState, {
	accountScope: () => invoke<string>('imap_account_scope'),
	scan: (request) => invoke<EmailResult>('imap_scan', { request }),
	ingest: ingestFile
})
