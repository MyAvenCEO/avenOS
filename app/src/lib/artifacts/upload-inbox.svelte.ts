import { invoke, isTauri } from '@tauri-apps/api/core'
import { shell } from '../intents/talk.svelte'
import { customerWork } from './customer-work.svelte'

export interface InboxItem {
	artifactId: string
	payload: { originalName: string; declaredMediaType: string; observedAt: string }
	blob: { length: number }
}
export const uploadInbox = $state({
	items: [] as InboxItem[],
	nextAfter: null as string | null,
	loading: false,
	busy: false,
	progress: '',
	error: ''
})
let generation = 0
let loadRequest = 0
export function inboxEpoch() {
	return generation
}
export function resetUploadInbox() {
	generation++
	uploadInbox.items = []
	uploadInbox.nextAfter = null
	uploadInbox.loading = false
	uploadInbox.busy = false
	uploadInbox.progress = ''
	uploadInbox.error = ''
	shell.inboxOpen = false
}
export async function loadUploadInbox(more = false) {
	if (!isTauri()) return
	const revision = generation
	const request = ++loadRequest
	uploadInbox.loading = true
	uploadInbox.error = ''
	try {
		const result = await invoke<{ items: InboxItem[]; nextAfter: string | null }>(
			'artifact_inbox',
			{ after: more ? uploadInbox.nextAfter : null }
		)
		if (revision !== generation || request !== loadRequest) return
		uploadInbox.items = more
			? [
					...uploadInbox.items,
					...result.items.filter(
						(i) => !uploadInbox.items.some((old) => old.artifactId === i.artifactId)
					)
				]
			: result.items
		uploadInbox.nextAfter = result.nextAfter
	} catch (error) {
		if (revision === generation && request === loadRequest) uploadInbox.error = String(error)
	} finally {
		if (revision === generation && request === loadRequest) uploadInbox.loading = false
	}
}
export async function quarantineUploads(paths: string[]) {
	if (!paths.length) return
	shell.tab = 'intents'
	shell.detail = true
	shell.inboxOpen = true
	if (customerWork.uploads || uploadInbox.busy) {
		uploadInbox.error = 'Ein Upload läuft noch. Bitte kurz warten.'
		return
	}
	if (paths.length > 50) {
		uploadInbox.error = 'Bitte höchstens 50 Dateien auf einmal ablegen.'
		return
	}
	customerWork.uploads = true
	uploadInbox.busy = true
	uploadInbox.error = ''
	const revision = generation
	const errors: string[] = []
	try {
		const scope = await invoke<string>('imap_account_scope')
		for (const [index, path] of paths.entries()) {
			if (revision !== generation) break
			uploadInbox.progress = `${index + 1} / ${paths.length}`
			try {
				await invoke('artifact_upload', {
					uploadId: crypto.randomUUID(),
					publicationId: crypto.randomUUID(),
					intentId: null,
					observedAt: new Date().toISOString(),
					executionEnvironment: 'local',
					path,
					expectedImapScope: scope
				})
			} catch (error) {
				errors.push(`${path.split(/[\\/]/).at(-1)}: ${String(error)}`)
			}
		}
	} catch (error) {
		errors.push(String(error))
	} finally {
		if (revision === generation) {
			customerWork.uploads = false
			uploadInbox.busy = false
			uploadInbox.progress = ''
			await loadUploadInbox()
			if (revision === generation) uploadInbox.error = errors.join('\n')
		}
	}
}
