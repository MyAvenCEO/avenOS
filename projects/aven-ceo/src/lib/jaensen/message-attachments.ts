export function normalizeMessageAttachments(input: {
	attachments?: unknown
	attachment?: unknown
}): unknown[] {
	return [
		...(Array.isArray(input.attachments) ? input.attachments : []),
		...(input.attachment === undefined ? [] : [input.attachment])
	]
}