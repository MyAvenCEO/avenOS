// The GLM website editor — the specialist-model edit path for the composer skill. Given the spark's
// current source files + a plain-language instruction, the website model (glm-5-2) streams
// file-scoped SEARCH/REPLACE blocks (and can CREATE new files — one per route), applied
// deterministically. Returns only the CHANGED files + applied/failed counts + usage. Streaming =
// fast + keeps the chat stream alive. Moved out of betterauth/ai.ts so the composer skill owns the
// logic and ai.ts is a thin adapter. board 0055/0056.
import { COMPOSER_AUTHORING_GUIDE } from './authoring'

/** OpenAI-style token usage (kept local to avoid a betterauth import / circular dep). */
export type TokenUsage = {
	prompt_tokens?: number
	completion_tokens?: number
	total_tokens?: number
}

export type EditResult = {
	files: Record<string, string>
	applied: number
	failed: number
	usage?: TokenUsage
}

const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'
// Specialist web model for website edits. Override with TINFOIL_WEBSITE_MODEL. Exported so the
// betterauth adapter can bill the GLM edit at this model's price. board 0055.
export const WEBSITE_MODEL = process.env.TINFOIL_WEBSITE_MODEL ?? 'glm-5-2'

// The home source file (served at /en/) — the default/fallback target when a block names no file.
const HOME = 'src/pages/en/home.md'

// Parse the model's file-scoped SEARCH/REPLACE blocks:
//   FILE: src/<path>\n<<<<<<< SEARCH\n<verbatim>\n=======\n<replacement>\n>>>>>>> REPLACE
export function parseEditBlocks(raw: string): { file: string; search: string; replace: string }[] {
	const blocks: { file: string; search: string; replace: string }[] = []
	const re =
		/(?:FILE:[ \t]*([^\n]+)\n)?<<<<<<<[^\n]*\n([\s\S]*?)\n?=======[^\n]*\n([\s\S]*?)\n?>>>>>>>[^\n]*/g
	let m: RegExpExecArray | null
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
	while ((m = re.exec(raw)) !== null) {
		blocks.push({ file: (m[1] ?? HOME).trim(), search: m[2], replace: m[3] })
	}
	return blocks
}

export async function editWebsiteDiff(
	key: string,
	files: Record<string, string>,
	instruction: string,
	onProgress?: (detail: string) => void,
	/** Live feed of GLM's reasoning + diff text (batched), for a streaming activity panel in the UI. */
	onStream?: (text: string) => void
): Promise<EditResult> {
	// GLM authors source files only; the generator wires routing (see COMPOSER_AUTHORING_GUIDE).
	// edit.ts appends the SEARCH/REPLACE edit mechanism on top of that authoring contract.
	const system =
		`${COMPOSER_AUTHORING_GUIDE}\n\n` +
		'Make the SMALLEST change that satisfies the instruction. Output ONLY edit blocks; precede ' +
		'EACH with its target file, EXACTLY:\n' +
		'FILE: src/<path>\n<<<<<<< SEARCH\n<verbatim text from that file>\n=======\n<replacement>\n' +
		'>>>>>>> REPLACE\n' +
		'SEARCH must be an exact, unique substring of THAT file (copy whitespace verbatim). To CREATE ' +
		'a new file or fully rewrite one, use an EMPTY SEARCH and the entire document as REPLACE. Use ' +
		'several blocks for several files/changes. No commentary, no code fences.'
	const listing =
		Object.entries(files)
			.map(([p, c]) => `===== ${p} =====\n${c}`)
			.join('\n\n') || `(no files yet — create ${HOME})`
	const user = `Current website files:\n\n${listing}\n\nInstruction: ${instruction}`
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: WEBSITE_MODEL,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user }
			],
			stream: true
		})
	})
	if (!res.ok || !res.body) {
		throw new Error(
			`website model ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`
		)
	}
	const reader = res.body.getReader()
	const decoder = new TextDecoder()
	let buf = ''
	let raw = ''
	let streamBuf = '' // batched reasoning+content not yet pushed to onStream
	let usage: TokenUsage | undefined
	let lastReported = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		buf += decoder.decode(value, { stream: true })
		const frames = buf.split('\n\n')
		buf = frames.pop() ?? ''
		for (const frame of frames) {
			const line = frame.split('\n').find((l) => l.startsWith('data:'))
			if (!line) continue
			const payload = line.slice(5).trim()
			if (payload === '[DONE]') continue
			try {
				const j = JSON.parse(payload) as {
					choices?: {
						delta?: { content?: string; reasoning_content?: string; reasoning?: string }
					}[]
					usage?: TokenUsage
				}
				if (j.usage) usage = j.usage
				const d = j.choices?.[0]?.delta
				// some models stream reasoning separately — show it in the live panel too
				if (d?.reasoning_content) streamBuf += d.reasoning_content
				else if (d?.reasoning) streamBuf += d.reasoning
				const chunk = d?.content
				if (chunk) {
					raw += chunk
					streamBuf += chunk
					if (onProgress && raw.length - lastReported >= 180) {
						lastReported = raw.length
						const lines = `${raw.split('\n').length} lines`
						// Surface which file is being worked on from the latest FILE: marker in the stream.
						const marks = raw.match(/FILE:[ \t]*([^\n]+)/g)
						const last = marks?.[marks.length - 1]?.replace(/FILE:[ \t]*/, '').trim()
						if (last) {
							const file = last.startsWith('src/') ? last : `src/${last.replace(/^\/+/, '')}`
							onProgress(
								`${file in files ? 'editing' : 'creating'} ${file.replace(/^src\//, '')} · ${lines}`
							)
						} else {
							onProgress(`glm-5-2 generating… · ${lines}`)
						}
					}
				}
				if (onStream && streamBuf.length >= 100) {
					onStream(streamBuf)
					streamBuf = ''
				}
			} catch {
				/* skip keep-alives / partial frames */
			}
		}
	}
	if (onStream && streamBuf) onStream(streamBuf)
	const blocks = parseEditBlocks(raw)
	const changed: Record<string, string> = {}
	let applied = 0
	let failed = 0
	if (blocks.length === 0) {
		// No blocks — accept a bare document as a full home rewrite (e.g. first creation).
		const fallback = raw
			.replace(/^\s*```(?:html)?\s*/i, '')
			.replace(/\s*```\s*$/, '')
			.trim()
		if (/<html|<!doctype/i.test(fallback)) {
			changed[HOME] = fallback
			return { files: changed, applied: 1, failed: 0, usage }
		}
		return { files: changed, applied: 0, failed: 0, usage }
	}
	// Work on a copy so multiple blocks targeting the same file compound.
	const working: Record<string, string> = { ...files }
	for (const b of blocks) {
		const path = b.file.startsWith('src/') ? b.file : `src/${b.file.replace(/^\/+/, '')}`
		const cur = working[path] ?? ''
		if (b.search.trim() === '') {
			working[path] = b.replace // empty SEARCH = create / full replace
			changed[path] = b.replace
			applied++
		} else if (cur.includes(b.search)) {
			const next = cur.replace(b.search, b.replace)
			working[path] = next
			changed[path] = next
			applied++
		} else {
			failed++
		}
	}
	return { files: changed, applied, failed, usage }
}
