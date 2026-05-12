import { expect, test } from 'bun:test'

import { normalizeMessageAttachments } from './message-attachments'

test('normalizeMessageAttachments preserves raw client attachments without adding paths', () => {
	const attachments = normalizeMessageAttachments({
		attachments: [{ name: 'brief.txt', base64: 'aGVsbG8=' }],
		attachment: { id: 'staged-1' }
	})

	expect(attachments).toEqual([{ name: 'brief.txt', base64: 'aGVsbG8=' }, { id: 'staged-1' }])
	expect(JSON.stringify(attachments)).not.toContain('path')
})