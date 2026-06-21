import { SEED_SRC } from '@avenos/skills/composer/seed'
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

// The composer site is a `src/` tree (components/layouts + i18n JSON + markdown pages/blog) that the
// deterministic generator (@avenos/skills/composer) assembles into the deployable site. GLM + the
// editor maintain `src/`; `public/` is generated, `private/` holds dropped images. board 0057.

/** Seed a fresh spark's src/ from the starter bilingual example if it has none yet. board 0057. */
export async function ensureSeeded(sparkId: string): Promise<void> {
	if (!sparkId) return
	try {
		const files = await sparkListFiles(sparkId)
		if (files.some((f) => f.path.startsWith('src/'))) return // already has a source tree
	} catch {
		/* list failed — fall through and seed */
	}
	for (const [path, content] of Object.entries(SEED_SRC)) {
		try {
			await sparkWriteFile(sparkId, path, content)
		} catch (e) {
			console.error('[composer] seed write failed:', path, e)
		}
	}
}

/** Read all text files under src/ as a path→content map (the SSG input + AI edit context). */
export async function readSrcFiles(sparkId: string): Promise<Record<string, string>> {
	if (!sparkId) return {}
	await ensureSeeded(sparkId)
	const out: Record<string, string> = {}
	try {
		for (const f of await sparkListFiles(sparkId)) {
			if (!f.path.startsWith('src/') || !TEXT_FILE_RE.test(f.path)) continue
			try {
				out[f.path] = await sparkReadFile(sparkId, f.path)
			} catch {
				/* skip unreadable */
			}
		}
	} catch {
		/* none yet */
	}
	return out
}

/** Write changed src/ files back to disk (AI edit result / editor save). */
export async function writeSrcFiles(sparkId: string, files: Record<string, string>): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		if (!path.startsWith('src/')) continue // safety: only the source tree
		await sparkWriteFile(sparkId, path, content)
	}
}
