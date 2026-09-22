import { expect, test } from 'vitest'
import { z } from 'zod'
import { commandValidationFailure } from '../src/command-errors'

test('invalid commands identify their field without echoing rejected values', () => {
	const result = z
		.object({ sourceArtifactId: z.uuid().nullable() })
		.safeParse({ sourceArtifactId: 'private-rejected-value' })
	if (result.success) throw Error('The malformed reference must be rejected')
	const failure = commandValidationFailure(result.error)
	expect(failure.code).toBe('COMMAND_INVALID')
	expect(failure.message).toContain('sourceArtifactId')
	expect(failure.message).toContain('UUID')
	expect(JSON.stringify(failure)).not.toContain('private-rejected-value')
	expect(failure.issues).toHaveLength(1)
})

test('validation diagnostics have a bounded issue count', () => {
	const result = z.array(z.uuid()).safeParse(Array(20).fill('None'))
	if (result.success) throw Error('The malformed references must be rejected')
	expect(commandValidationFailure(result.error).issues).toHaveLength(4)
})
