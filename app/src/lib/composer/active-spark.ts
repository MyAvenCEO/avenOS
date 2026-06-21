import { get, writable } from 'svelte/store'
import {
	sparkListFiles,
	sparkReadFile,
	sparksList,
	sparkWriteBytes,
	sparkWriteFile
} from '$lib/composer/spark-ipc'

// Shared state so the website Composer vibe and the chat act on the SAME spark. The Composer
// publishes its selected spark here; the chat reads it to load index.html into the AI context and
// to write AI edits back. board 0055.
export const activeSpark = writable<string>('')

// Bumped to tell any mounted Composer to re-read its files from disk — e.g. after an AI edit wrote
// index.html through the chat. board 0055.
export const composerReload = writable(0)
export function bumpComposerReload(): void {
	composerReload.update((n) => n + 1)
}

/** The active spark, falling back to (and pinning) the first spark when none is selected yet. */
export async function resolveActiveSpark(): Promise<string> {
	const cur = get(activeSpark)
	if (cur) return cur
	const first = (await sparksList())[0] ?? ''
	if (first) activeSpark.set(first)
	return first
}

// Locale-routed static site (Tigris model, like next.aven.ceo): the English home is public/en/
// index.html (served at /en/), styling is a shared public/styles.css, and `private/` holds dropped
// reference images that are never published. board 0055.
export const PUBLIC_INDEX = 'public/en/index.html'
export const PUBLIC_STYLES = 'public/styles.css'

/** Read a spark's current public/index.html (empty string if missing). */
export async function readIndexHtml(sparkId: string): Promise<string> {
	if (!sparkId) return ''
	try {
		return await sparkReadFile(sparkId, PUBLIC_INDEX)
	} catch {
		return ''
	}
}

export type DroppedImage = { name: string; path: string }
// Reference images the user dropped this session — stored in the spark's private/ folder (never
// published). The chat surfaces them as design inspiration for the next edit. board 0055.
export const droppedImages = writable<DroppedImage[]>([])

/** Store dropped files into the spark's private/ folder + record them for the edit prompt. */
export async function storeDroppedFiles(files: File[]): Promise<DroppedImage[]> {
	const spark = await resolveActiveSpark()
	if (!spark) return []
	const added: DroppedImage[] = []
	for (const f of files) {
		const safe = (f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file').toLowerCase()
		const path = `private/${safe}`
		try {
			await sparkWriteBytes(spark, path, new Uint8Array(await f.arrayBuffer()))
			added.push({ name: f.name, path })
		} catch (e) {
			console.error('[composer] store dropped file failed:', e)
		}
	}
	if (added.length) droppedImages.update((cur) => [...cur, ...added])
	return added
}

const TEXT_FILE_RE = /\.(html|css|js|mjs|json|svg|xml|txt|md)$/i

/** Read all text files under public/ as a path→content map (the AI multi-file edit context). */
export async function readPublicFiles(sparkId: string): Promise<Record<string, string>> {
	if (!sparkId) return {}
	const out: Record<string, string> = {}
	try {
		for (const f of await sparkListFiles(sparkId)) {
			if (!f.path.startsWith('public/') || !TEXT_FILE_RE.test(f.path)) continue
			try {
				out[f.path] = await sparkReadFile(sparkId, f.path)
			} catch {
				/* skip unreadable */
			}
		}
	} catch {
		/* none yet */
	}
	if (!out[PUBLIC_INDEX]) out[PUBLIC_INDEX] = await readIndexHtml(sparkId)
	return out
}

/** Write changed public/ files back to disk (AI multi-file edit result). */
export async function writePublicFiles(
	sparkId: string,
	files: Record<string, string>
): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		if (!path.startsWith('public/')) continue // safety: never write outside the public bucket
		await sparkWriteFile(sparkId, path, content)
	}
}

/** Overwrite a spark's public/index.html. */
export async function writeIndexHtml(sparkId: string, html: string): Promise<void> {
	await sparkWriteFile(sparkId, PUBLIC_INDEX, html)
}
