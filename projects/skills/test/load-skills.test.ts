import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SkillValidationError, loadSkills } from '../src/index'

const tempDirs: string[] = []

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('loads SKILL.md recursively', async () => {
	const rootDir = await createTempRoot()
	await writeSkill(rootDir, 'memory/SKILL.md', `---\nid: memory\ndescription: Memory skill\n---\n\n# Memory\n`)
	await writeSkill(rootDir, 'extract/nested/SKILL.md', `---\nid: extract\ndescription: Extract skill\n---\n\n# Extract\n`)

	const skills = await loadSkills({ rootDir, now: new Date('2026-05-12T00:00:00.000Z') })

	expect(skills.map((skill) => skill.id)).toEqual(['extract', 'memory'])
	expect(skills.map((skill) => skill.path)).toEqual(['extract/nested/SKILL.md', 'memory/SKILL.md'])
	expect(skills[0]?.loadedAt).toBe('2026-05-12T00:00:00.000Z')
	expect(skills[0]?.bodyHash).toBeString()
	if (typeof skills[0]?.bodyHash === 'string') {
		expect(skills[0].bodyHash.length).toBe(64)
	}
})

test('loadSkills accepts direct_actors', async () => {
	const rootDir = await createTempRoot()
	await writeSkill(rootDir, 'memory/SKILL.md', `---\nid: memory\ndescription: Memory skill\n---\n`)
	await writeSkill(rootDir, 'pdf/SKILL.md', `---\nid: pdf\ndescription: PDF skill\ndirect_actors:\n  - skill/memory\n---\n`)

	const skills = await loadSkills({ rootDir })
	expect(skills.find((skill) => skill.id === 'pdf')?.directActors).toEqual(['skill/memory'])
})

test('loadSkills rejects non-array direct_actors', async () => {
	const rootDir = await createTempRoot()
	await writeSkill(rootDir, 'memory/SKILL.md', `---\nid: memory\ndescription: Memory skill\ndirect_actors: skill/pdf\n---\n`)
	await writeSkill(rootDir, 'pdf/SKILL.md', `---\nid: pdf\ndescription: PDF skill\n---\n`)

	await expect(loadSkills({ rootDir })).rejects.toThrow(/direct_actors must be an array of strings/)
})

test('loadSkills rejects human intent and worker targets', async () => {
	for (const target of ['human', 'intent/abc', 'skill-worker/memory/foo', 'memory']) {
		const rootDir = await createTempRoot()
		await writeSkill(rootDir, 'memory/SKILL.md', `---\nid: memory\ndescription: Memory skill\ndirect_actors:\n  - ${target}\n---\n`)
		await writeSkill(rootDir, 'pdf/SKILL.md', `---\nid: pdf\ndescription: PDF skill\n---\n`)

		await expect(loadSkills({ rootDir })).rejects.toThrow(/direct_actors entries must match/)
	}
})

test('loadSkills rejects unknown skill target', async () => {
	const rootDir = await createTempRoot()
	await writeSkill(rootDir, 'memory/SKILL.md', `---\nid: memory\ndescription: Memory skill\ndirect_actors:\n  - skill/missing\n---\n`)

	await expect(loadSkills({ rootDir })).rejects.toThrow(/references unknown skill "missing"/)
})

test('loadSkills rejects self target', async () => {
	const rootDir = await createTempRoot()
	await writeSkill(rootDir, 'memory/SKILL.md', `---\nid: memory\ndescription: Memory skill\ndirect_actors:\n  - skill/memory\n---\n`)

	await expect(loadSkills({ rootDir })).rejects.toThrow(/must not reference the skill itself/)
})

test('rejects duplicate skill ids', async () => {
	const rootDir = await createTempRoot()
	await writeSkill(rootDir, 'memory/SKILL.md', `---\nid: memory\ndescription: Memory skill\n---\n`)
	await writeSkill(rootDir, 'other/SKILL.md', `---\nid: memory\ndescription: Duplicate memory skill\n---\n`)

	await expect(loadSkills({ rootDir })).rejects.toThrow(
		new SkillValidationError('Duplicate skill id "memory" in other/SKILL.md')
	)
})

test('rejects missing id', async () => {
	const rootDir = await createTempRoot()
	await writeSkill(rootDir, 'memory/SKILL.md', `---\ndescription: Memory skill\n---\n`)

	await expect(loadSkills({ rootDir })).rejects.toThrow(SkillValidationError)
	await expect(loadSkills({ rootDir })).rejects.toThrow(/Invalid skill frontmatter/)
})

test('rejects invalid id', async () => {
	const rootDir = await createTempRoot()
	await writeSkill(rootDir, 'memory/SKILL.md', `---\nid: Memory\ndescription: Memory skill\n---\n`)

	await expect(loadSkills({ rootDir })).rejects.toThrow(
		/Invalid skill id "Memory" in memory\/SKILL.md/
	)
})

async function createTempRoot(): Promise<string> {
	const rootDir = await mkdtemp(path.join(tmpdir(), 'skills-test-'))
	tempDirs.push(rootDir)
	return rootDir
}

async function writeSkill(rootDir: string, relativePath: string, content: string): Promise<void> {
	const filePath = path.join(rootDir, relativePath)
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, content, 'utf8')
}