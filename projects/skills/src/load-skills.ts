import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { createSkillActorId, parseSkillActorId } from '@jaensen/persistence-sqlite'

import { SkillValidationError } from './errors'
import { isValidSkillId } from './skill-id'
import type { LoadSkillsInput, SkillDefinition } from './types'

export async function loadSkills(input: LoadSkillsInput): Promise<SkillDefinition[]> {
	const now = (input.now ?? new Date()).toISOString()
	const files = await findSkillFiles(input.rootDir)
	const definitions: SkillDefinition[] = []
	const seenIds = new Set<string>()

	for (const filePath of files) {
		const relativePath = toPosix(path.relative(input.rootDir, filePath))
		const raw = await readFile(filePath, 'utf8')
		const parsed = parseSkillMarkdown(raw, relativePath)
		const frontmatter = parsed.frontmatter

		if (!isValidSkillId(frontmatter.id)) {
			throw new SkillValidationError(
				`Invalid skill id \"${frontmatter.id}\" in ${relativePath}; expected lowercase slug`
			)
		}

		if (seenIds.has(frontmatter.id)) {
			throw new SkillValidationError(`Duplicate skill id \"${frontmatter.id}\" in ${relativePath}`)
		}

		seenIds.add(frontmatter.id)
		definitions.push({
			id: frontmatter.id,
			path: relativePath,
			description: frontmatter.description,
			directActors: frontmatter.direct_actors ?? [],
			frontmatter: frontmatter as unknown as Record<string, unknown>,
			body: parsed.body,
			bodyHash: createHash('sha256').update(parsed.body).digest('hex'),
			loadedAt: now
		})
	}

	validateDirectActors(definitions)

	return definitions.sort((left, right) => left.id.localeCompare(right.id))
}

async function findSkillFiles(rootDir: string): Promise<string[]> {
	const entries = await readdir(rootDir, { withFileTypes: true })
	const files: string[] = []

	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name)
		if (entry.isDirectory()) {
			files.push(...(await findSkillFiles(entryPath)))
			continue
		}

		if (entry.isFile() && entry.name === 'SKILL.md') {
			files.push(entryPath)
		}
	}

	return files.sort((left, right) => left.localeCompare(right))
}

function toPosix(value: string): string {
	return value.split(path.sep).join('/')
}

interface ParsedSkillFrontmatter {
	id: string
	description: string
	worker_policy?: 'ephemeral' | 'pooled' | 'durable'
	direct_actors?: string[]
	message_types?: string[]
	resources?: {
		fs?: string[]
		shell?: boolean
	}
}

function parseSkillMarkdown(
	raw: string,
	relativePath: string
): { frontmatter: ParsedSkillFrontmatter; body: string } {
	const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
	if (!match) {
		throw new SkillValidationError(`Invalid skill frontmatter in ${relativePath}: missing frontmatter block`)
	}

	const [, frontmatterRaw, body] = match
	const frontmatter = parseSimpleYaml(frontmatterRaw)
	validateFrontmatter(frontmatter, relativePath)

	return {
		frontmatter,
		body
	}
}

function validateFrontmatter(
	frontmatter: Record<string, unknown>,
	relativePath: string
): asserts frontmatter is Record<string, unknown> & ParsedSkillFrontmatter {
	if (frontmatter.direct_actors === '') {
		delete frontmatter.direct_actors
	}

	if (frontmatter.message_types === '') {
		delete frontmatter.message_types
	}

	if (frontmatter.resources === '') {
		delete frontmatter.resources
	}

	if (typeof frontmatter.id !== 'string' || frontmatter.id.length === 0) {
		throw new SkillValidationError(`Invalid skill frontmatter in ${relativePath}: id is required`)
	}

	if (typeof frontmatter.description !== 'string' || frontmatter.description.length === 0) {
		throw new SkillValidationError(`Invalid skill frontmatter in ${relativePath}: description is required`)
	}

	if (
		frontmatter.worker_policy !== undefined &&
		frontmatter.worker_policy !== 'ephemeral' &&
		frontmatter.worker_policy !== 'pooled' &&
		frontmatter.worker_policy !== 'durable'
	) {
		throw new SkillValidationError(`Invalid skill frontmatter in ${relativePath}: worker_policy is invalid`)
	}

	if (
		frontmatter.direct_actors !== undefined &&
		(!Array.isArray(frontmatter.direct_actors) ||
			!frontmatter.direct_actors.every((value) => typeof value === 'string'))
	) {
		throw new SkillValidationError(`Invalid skill frontmatter in ${relativePath}: direct_actors must be an array of strings`)
	}

	if (
		frontmatter.message_types !== undefined &&
		(!Array.isArray(frontmatter.message_types) ||
			!frontmatter.message_types.every((value) => typeof value === 'string'))
	) {
		throw new SkillValidationError(`Invalid skill frontmatter in ${relativePath}: message_types must be an array of strings`)
	}

	if (frontmatter.resources !== undefined) {
		if (
			typeof frontmatter.resources !== 'object' ||
			frontmatter.resources === null ||
			Array.isArray(frontmatter.resources)
		) {
			throw new SkillValidationError(`Invalid skill frontmatter in ${relativePath}: resources must be an object`)
		}

		const resources = frontmatter.resources as Record<string, unknown>
		if (resources.fs !== undefined && (!Array.isArray(resources.fs) || !resources.fs.every((value) => typeof value === 'string'))) {
			throw new SkillValidationError(`Invalid skill frontmatter in ${relativePath}: resources.fs must be an array of strings`)
		}

		if (resources.shell !== undefined && typeof resources.shell !== 'boolean') {
			throw new SkillValidationError(`Invalid skill frontmatter in ${relativePath}: resources.shell must be a boolean`)
		}
	}
}

function validateDirectActors(definitions: SkillDefinition[]): void {
	const knownSkills = new Set(definitions.map((definition) => definition.id))

	for (const definition of definitions) {
		for (const actor of definition.directActors) {
			const target = parseSkillActorId(actor)
			if (!target) {
				throw new SkillValidationError(
					`Invalid skill frontmatter in ${definition.path}: direct_actors entries must be canonical skill actor ids`
				)
			}

			const targetSkillId = target.skillId
			if (targetSkillId === definition.id) {
				throw new SkillValidationError(
					`Invalid skill frontmatter in ${definition.path}: direct_actors must not reference the skill itself`
				)
			}

			if (!knownSkills.has(targetSkillId)) {
				throw new SkillValidationError(
					`Invalid skill frontmatter in ${definition.path}: direct_actors references unknown skill \"${targetSkillId}\"`
				)
			}
		}
	}
}

function parseSimpleYaml(input: string): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	const lines = input.split(/\r?\n/)

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]
		if (!line || !line.trim()) {
			continue
		}

		const trimmed = line.trim()
		if (trimmed.startsWith('- ')) {
			throw new SkillValidationError('Invalid skill frontmatter: unexpected list item')
		}

		const separatorIndex = line.indexOf(':')
		if (separatorIndex === -1) {
			throw new SkillValidationError(`Invalid skill frontmatter line: ${trimmed}`)
		}

		const key = line.slice(0, separatorIndex).trim()
		const value = line.slice(separatorIndex + 1).trim()

		if (value.length > 0) {
			result[key] = parseScalar(value)
			continue
		}

		const nextLine = lines[index + 1]
		if (nextLine?.startsWith('  - ')) {
			const items: string[] = []
			while (lines[index + 1]?.startsWith('  - ')) {
				items.push(lines[index + 1].slice(4).trim())
				index += 1
			}
			result[key] = items
			continue
		}

		if (nextLine?.startsWith('  ')) {
			const nested: Record<string, unknown> = {}
			while (lines[index + 1]?.startsWith('  ')) {
				const nestedLine = lines[index + 1].slice(2)
				const nestedSeparatorIndex = nestedLine.indexOf(':')
				if (nestedSeparatorIndex === -1) {
					throw new SkillValidationError(`Invalid skill frontmatter line: ${nestedLine.trim()}`)
				}

				const nestedKey = nestedLine.slice(0, nestedSeparatorIndex).trim()
				const nestedValue = nestedLine.slice(nestedSeparatorIndex + 1).trim()

				if (nestedValue.length > 0) {
					nested[nestedKey] = parseScalar(nestedValue)
					index += 1
					continue
				}

				const listItems: string[] = []
				while (lines[index + 2]?.startsWith('    - ')) {
					listItems.push(lines[index + 2].slice(6).trim())
					index += 1
				}

				nested[nestedKey] = listItems
				index += 1
			}
			result[key] = nested
			continue
		}

		result[key] = ''
	}

	return result
}

function parseScalar(value: string): unknown {
	if (value === 'true') {
		return true
	}

	if (value === 'false') {
		return false
	}

	return value
}