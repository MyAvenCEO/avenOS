// A custom storagesdk.dev adapter backed by our scoped Tauri fs IPC bridge.
//
// This is the whole point: the composer reads/writes local spark files through
// the SAME universal `Storage` API (`upload`/`download`/`list`/`delete`) that
// `skills/composer/deploy.ts` uses to push to Tigris. Swap `tauriFs(...)` for the
// `tigris(...)` adapter and the exact same call sites publish to the cloud.
//
// First slice = text files (HTML/CSS/JS/JSON) — content round-trips as UTF-8 via
// the String IPC. Binary assets + presigned URLs + snapshots/forks are not yet
// implemented locally (they throw); use the Tigris adapter for those.
import { defineAdapter, bodyToBytes, type Adapter } from '@storagesdk/core/adapter'
import type {
	BodyInput,
	ListOptions,
	ListResult,
	StorageItem,
	StorageItemMeta,
	UploadOptions,
} from '@storagesdk/core'
import * as ipc from './spark-ipc'

const CT: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	css: 'text/css; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	json: 'application/json',
	svg: 'image/svg+xml',
	xml: 'application/xml; charset=utf-8',
	txt: 'text/plain; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
}
const ctFor = (p: string) => CT[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
const etagOf = (s: string) => {
	let h = 5381
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
	return `"${h.toString(16)}"`
}
const enc = new TextEncoder()
const dec = new TextDecoder()

export type TauriFsConfig = { sparkId: string }

export function tauriFs(config: TauriFsConfig): Adapter<TauriFsConfig> {
	const { sparkId } = config
	const meta = (path: string, content: string): StorageItemMeta => ({
		path,
		size: enc.encode(content).length,
		contentType: ctFor(path),
		etag: etagOf(content),
		lastModified: new Date(),
	})
	const nope = (op: string): never => {
		throw new Error(`tauri-fs adapter: ${op} not supported locally — use the tigris adapter`)
	}

	return defineAdapter<TauriFsConfig>({
		name: `tauri-fs:${sparkId}`,
		raw: config,

		async download(path): Promise<StorageItem> {
			const content = await ipc.sparkReadFile(sparkId, path)
			return { ...meta(path, content), body: enc.encode(content) as Uint8Array<ArrayBuffer> }
		},
		async head(path): Promise<StorageItemMeta> {
			return meta(path, await ipc.sparkReadFile(sparkId, path))
		},
		async list(opts?: ListOptions): Promise<ListResult> {
			const prefix = (opts as { prefix?: string } | undefined)?.prefix ?? ''
			const files = await ipc.sparkListFiles(sparkId)
			const items: StorageItemMeta[] = files
				.filter((f) => f.path.startsWith(prefix))
				.map((f) => ({
					path: f.path,
					size: f.size,
					contentType: ctFor(f.path),
					etag: `"${f.size}"`,
					lastModified: new Date(),
				}))
			return { items }
		},
		async url(path): Promise<string> {
			return `tauri-fs://${sparkId}/${path}`
		},
		async upload(path, body: BodyInput, _opts?: UploadOptions): Promise<StorageItemMeta> {
			const content = dec.decode(await bodyToBytes(body))
			await ipc.sparkWriteFile(sparkId, path, content)
			return meta(path, content)
		},
		async delete(path): Promise<void> {
			await ipc.sparkDeleteFile(sparkId, path)
		},
		async copy(from, to): Promise<void> {
			await ipc.sparkWriteFile(sparkId, to, await ipc.sparkReadFile(sparkId, from))
		},
		async move(from, to): Promise<void> {
			await ipc.sparkWriteFile(sparkId, to, await ipc.sparkReadFile(sparkId, from))
			await ipc.sparkDeleteFile(sparkId, from)
		},
		async uploadUrl() {
			return nope('uploadUrl')
		},

		// local backend: no native snapshots/forks (use the tigris adapter for those)
		snapshots: {
			async create() {
				return nope('snapshots')
			},
			async list() {
				return []
			},
			async head() {
				return nope('snapshots')
			},
			async delete() {
				nope('snapshots')
			},
			get() {
				return nope('snapshots')
			},
		},
		forks: {
			async create() {
				return nope('forks')
			},
			async list() {
				return []
			},
			async head() {
				return nope('forks')
			},
			async delete() {
				nope('forks')
			},
			get() {
				return nope('forks')
			},
		},
	})
}
