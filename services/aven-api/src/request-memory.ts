import { BodyLimitError, readBoundedText } from '@avenos/http-boundary'

const MIB = 1024 * 1024

/** Bound compact JSON expansion before JSON.parse allocates arrays and objects. */
function parseBoundedStructure(text: string): unknown {
	let quoted = false,
		escaped = false,
		depth = 0,
		entries = 0
	for (let index = 0; index < text.length; index++) {
		const character = text.charCodeAt(index)
		if (quoted) {
			if (escaped) escaped = false
			else if (character === 92) escaped = true
			else if (character === 34) quoted = false
			continue
		}
		if (character === 34) quoted = true
		else if (character === 91 || character === 123) {
			depth++
			entries++
		} else if (character === 93 || character === 125) depth--
		else if (character === 44 || character === 58) entries++
		if (depth > 64 || entries > 1_000_000)
			throw new BodyLimitError(400, 'REQUEST_JSON_STRUCTURE_TOO_LARGE')
	}
	return JSON.parse(text)
}

/** Shared across model and client-publication requests in one facade process. */
export class RequestMemoryBudget {
	#bytes = 0
	#requests = 0

	constructor(
		private readonly maximumBytes = 128 * MIB,
		private readonly maximumRequests = 8
	) {}

	async json<T>(
		request: Request,
		limit: number,
		consume: (body: unknown) => Promise<T>
	): Promise<T> {
		const declared = request.headers.get('content-length')
		if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
			void request.body?.cancel().catch(() => {})
			throw new BodyLimitError()
		}
		// Unknown/chunked bodies reserve the entire route ceiling before any bytes are read.
		// The reader enforces the declared reservation too, so an understated header cannot bypass it.
		const bodyLimit = declared === null ? limit : Number(declared)
		const reserved = Math.max(MIB, bodyLimit)
		if (this.#bytes + reserved > this.maximumBytes || this.#requests >= this.maximumRequests) {
			void request.body?.cancel().catch(() => {})
			throw new BodyLimitError(503, 'REQUEST_CAPACITY_EXHAUSTED')
		}
		this.#bytes += reserved
		this.#requests += 1
		try {
			// Retain the reservation while parsing, translating and sending the downstream request.
			return await consume(parseBoundedStructure(await readBoundedText(request, bodyLimit)))
		} finally {
			this.#bytes -= reserved
			this.#requests -= 1
		}
	}
}

export function bodyLimitResponse(error: BodyLimitError): Response {
	const busy = error.code === 'REQUEST_CAPACITY_EXHAUSTED'
	return Response.json(
		{ code: error.code, ...(busy && { retryable: true }) },
		{
			status: error.status,
			headers: { 'cache-control': 'no-store', ...(busy && { 'retry-after': '1' }) }
		}
	)
}
