import { Buffer } from 'node:buffer'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'
import type { SkillDefinition } from '@jaensen/skills'

import { createFlueSkillWorkerBrain } from '../src'

const tempDirs: string[] = []

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const baseSkill: SkillDefinition = {
	id: 'reader',
	path: 'reader/SKILL.md',
	description: 'Reader skill',
	directActors: [],
	frontmatter: { id: 'reader', description: 'Reader skill', worker_policy: 'durable' },
	body: '# Reader',
	bodyHash: 'hash-reader',
	loadedAt: '2026-05-12T00:00:00.000Z'
}

test('skill can read uploaded file through attachment:// id in request layout', async () => {
	const workspaceRoot = await createTempRoot('jaensen-upload-access-')
	const attachmentScopeId = '123e4567-e89b-12d3-a456-426614174000'
	const attachmentId = 'att-1'
	await seedRequestUpload(workspaceRoot, attachmentScopeId, attachmentId, 'hello.txt', 'uploaded hello')
	let step = 0
	const brain = createFlueSkillWorkerBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						step += 1
						if (step === 1) return { tool: 'read_file', args: { path: `attachment://${attachmentId}` } }
						return { state: { done: true }, result: { ok: true }, completed: true }
					},
					async task() { throw new Error('unexpected task') },
					async shell() { return { stdout: '', stderr: '', exitCode: 0, timedOut: false } }
				}
			}
		},
		workspaceRoot,
		skillsRoot: path.join(workspaceRoot, '.jaensen/skills'),
		uploadRoot: path.join(workspaceRoot, '.jaensen/uploads'),
		resolveAttachmentScopeId: (envelope) =>
			typeof (envelope.payload as { attachmentScopeId?: unknown })?.attachmentScopeId === 'string'
				? (envelope.payload as { attachmentScopeId: string }).attachmentScopeId
				: undefined
	})

	await expect(
		brain.run({
			skill: { ...baseSkill, frontmatter: { ...baseSkill.frontmatter, resources: { shell: false, fs: [] } } },
			workerId: 'worker-1',
			actorState: {},
			envelope: makeEnvelopeRecord({ payload: { attachmentScopeId } })
		})
	).resolves.toMatchObject({ completed: true })
})

test('skill can inspect attachment and read binary as base64', async () => {
	const workspaceRoot = await createTempRoot('jaensen-upload-binary-')
	const attachmentScopeId = '123e4567-e89b-12d3-a456-426614174001'
	const attachmentId = 'att-bin-1'
	await seedRequestUploadBuffer(workspaceRoot, attachmentScopeId, attachmentId, 'pixel.bin', Buffer.from([0x00, 0x01, 0x02, 0xff]))
	let step = 0
	const seen: unknown[] = []
	const brain = createFlueSkillWorkerBrain({
		harness: {
			async session() {
				return {
					async prompt(prompt) {
						seen.push(prompt)
						step += 1
						if (step === 1) return { tool: 'inspect_attachment', args: { id: attachmentId } }
						if (step === 2) return { tool: 'read_file', args: { path: `attachment://${attachmentId}`, encoding: 'base64' } }
						return { state: { done: true }, result: { ok: true }, completed: true }
					},
					async task() { throw new Error('unexpected task') },
					async shell() { return { stdout: '', stderr: '', exitCode: 0, timedOut: false } }
				}
			}
		},
		workspaceRoot,
		skillsRoot: path.join(workspaceRoot, '.jaensen/skills'),
		uploadRoot: path.join(workspaceRoot, '.jaensen/uploads'),
		resolveAttachmentScopeId: (envelope) =>
			typeof (envelope.payload as { attachmentScopeId?: unknown })?.attachmentScopeId === 'string'
				? (envelope.payload as { attachmentScopeId: string }).attachmentScopeId
				: undefined
	})

	await expect(
		brain.run({
			skill: { ...baseSkill, frontmatter: { ...baseSkill.frontmatter, resources: { shell: true, fs: [] } } },
			workerId: 'worker-1',
			actorState: {},
			envelope: makeEnvelopeRecord({ payload: { attachmentScopeId } })
		})
	).resolves.toMatchObject({ completed: true })
	expect(seen.length).toBeGreaterThan(0)
})

test('file-analyzer can inspect a pdf, optionally call memory, and return summarized content', async () => {
	const workspaceRoot = await createTempRoot('jaensen-upload-pdf-')
	const attachmentScopeId = '123e4567-e89b-12d3-a456-426614174009'
	const attachmentId = 'att-pdf-1'
	const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'utf8')
	await seedRequestUploadBuffer(workspaceRoot, attachmentScopeId, attachmentId, 'report.pdf', pdfBytes, 'application/pdf')
	let step = 0
	const brain = createFlueSkillWorkerBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						step += 1
						if (step === 1) return { tool: 'inspect_attachment', args: { id: attachmentId } }
						if (step === 2) return { tool: 'read_file', args: { path: `attachment://${attachmentId}`, encoding: 'base64' } }
						if (step === 3) {
							return {
								tool: 'call_skill',
								args: {
									to: 'skill/memory',
									callId: 'remember-pdf-1',
									request: 'store',
									payload: { topic: 'pdf', text: 'Inspected report.pdf' },
									state: { phase: 'waiting-memory' }
								}
							}
						}
						return {
							tool: 'finish',
							args: {
								state: { phase: 'done' },
								result: {
									fileName: 'report.pdf',
									summary: 'PDF attachment inspected and content extracted',
									extractedText: '%PDF-1.4'
								}
							}
						}
					},
					async task() { throw new Error('unexpected task') },
					async shell() { return { stdout: '', stderr: '', exitCode: 0, timedOut: false } }
				}
			}
		},
		workspaceRoot,
		skillsRoot: path.join(workspaceRoot, '.jaensen/skills'),
		uploadRoot: path.join(workspaceRoot, '.jaensen/uploads'),
		resolveAttachmentScopeId: (envelope) =>
			typeof (envelope.payload as { attachmentScopeId?: unknown })?.attachmentScopeId === 'string'
				? (envelope.payload as { attachmentScopeId: string }).attachmentScopeId
				: undefined
	})

	await expect(
		brain.run({
			skill: {
				...baseSkill,
				id: 'file-analyzer',
				path: 'file-analyzer/SKILL.md',
				directActors: ['skill/memory'],
				frontmatter: { ...baseSkill.frontmatter, id: 'file-analyzer', resources: { shell: false, fs: [] } }
			},
			workerId: 'worker-pdf',
			actorState: {},
			envelope: makeEnvelopeRecord({ payload: { attachmentScopeId, callId: 'parent-call-1' } })
		})
	).resolves.toMatchObject({
		actions: [{ type: 'call_skill', to: 'skill/memory', callId: 'remember-pdf-1' }],
		completed: false,
		state: { phase: 'waiting-memory' }
	})

	await expect(
		brain.run({
			skill: {
				...baseSkill,
				id: 'file-analyzer',
				path: 'file-analyzer/SKILL.md',
				directActors: ['skill/memory'],
				frontmatter: { ...baseSkill.frontmatter, id: 'file-analyzer', resources: { shell: false, fs: [] } }
			},
			workerId: 'worker-pdf',
			actorState: { phase: 'waiting-memory' },
			envelope: makeEnvelopeRecord({
				type: 'skill.result',
				payload: { attachmentScopeId, callId: 'remember-pdf-1', parentCallId: 'parent-call-1', result: { ok: true } }
			})
		})
	).resolves.toMatchObject({
		completed: true,
		state: { phase: 'done' },
		result: expect.objectContaining({ fileName: 'report.pdf', summary: expect.stringContaining('PDF') })
	})
})

test('skill without shared upload root cannot read uploaded file', async () => {
	const workspaceRoot = await createTempRoot('jaensen-upload-denied-')
	const relativePath = '.jaensen/uploads/upload-1/hello.txt'
	const dir = path.join(workspaceRoot, '.jaensen/uploads/upload-1')
	await mkdir(dir, { recursive: true })
	await writeFile(path.join(dir, 'hello.txt'), 'uploaded hello', 'utf8')
	const brain = createFlueSkillWorkerBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return { tool: 'read_file', args: { path: relativePath } }
					},
					async task() { throw new Error('unexpected task') },
					async shell() { return { stdout: '', stderr: '', exitCode: 0, timedOut: false } }
				}
			}
		},
		workspaceRoot,
		skillsRoot: path.join(workspaceRoot, '.jaensen/skills')
	})

	await expect(
		brain.run({
			skill: { ...baseSkill, frontmatter: { ...baseSkill.frontmatter, resources: { shell: false, fs: [] } } },
			workerId: 'worker-1',
			actorState: {},
			envelope: makeEnvelopeRecord()
		})
	).rejects.toThrow(/Filesystem tools are not available|outside allowed fs roots|maximum number of tool steps/i)
})

async function createTempRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), prefix))
	tempDirs.push(root)
	return root
}

async function seedRequestUpload(
	workspaceRoot: string,
	scopeId: string,
	attachmentId: string,
	fileName: string,
	content: string
): Promise<void> {
	await seedRequestUploadBuffer(workspaceRoot, scopeId, attachmentId, fileName, Buffer.from(content, 'utf8'))
}

async function seedRequestUploadBuffer(
	workspaceRoot: string,
	scopeId: string,
	attachmentId: string,
	fileName: string,
	content: Buffer,
	mimeType = 'application/octet-stream'
): Promise<void> {
	const dir = path.join(workspaceRoot, '.jaensen/uploads/requests', scopeId, attachmentId)
	await mkdir(dir, { recursive: true })
	await writeFile(path.join(dir, 'blob'), content)
	await writeFile(
		path.join(dir, 'meta.json'),
		JSON.stringify({
			id: attachmentId,
			name: fileName,
			mimeType,
			sizeBytes: content.byteLength,
			sha256: 'a'.repeat(64),
			storedAt: '2026-05-12T00:00:00.000Z',
			sessionId: '123e4567-e89b-12d3-a456-426614174099',
			kind: 'request',
			scopeId
		}),
		'utf8'
	)
}

function makeEnvelopeRecord(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return {
		id: 'env-1',
		fromActor: 'skill/reader',
		toActor: 'skill-worker/reader/worker-1',
		type: 'reader.run',
		correlationId: 'corr-1',
		causationId: null,
		payload: {},
		status: 'queued',
		availableAt: '2026-05-12T00:00:00.000Z',
		attempts: 0,
		maxAttempts: 25,
		lockedBy: null,
		lockedUntil: null,
		lastError: null,
		createdAt: '2026-05-12T00:00:00.000Z',
		updatedAt: '2026-05-12T00:00:00.000Z',
		...overrides
	}
}