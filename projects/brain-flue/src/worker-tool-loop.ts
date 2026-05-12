import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import type { SkillDefinition } from '@jaensen/skills'

import { FlueBrainValidationError } from './errors'

type ShellResult = {
	stdout: string
	stderr: string
	exitCode: number
	timedOut?: boolean
}

type ToolCall =
	| { tool: 'shell'; args: { command: string; cwd?: string } }
	| { tool: 'read_file'; args: { path: string } }
	| { tool: 'write_file'; args: { path: string; content: string } }

type ToolResult =
	| ({ ok: true; tool: 'shell' } & ShellResult & { cwd: string })
	| { ok: true; tool: 'read_file'; path: string; content: string }
	| { ok: true; tool: 'write_file'; path: string; bytesWritten: number }

export interface WorkerToolLoopInput {
	skill: SkillDefinition
	workspaceRoot: string
	skillsRoot?: string
	runShell(command: string, options?: { cwd?: string }): Promise<ShellResult>
	invokeModel(prompt: string): Promise<unknown>
	basePrompt: string
	validateFinalResult(value: unknown): unknown
	unwrapModelData(value: unknown): unknown
}

export async function runWorkerToolLoop(input: WorkerToolLoopInput): Promise<unknown> {
	const resources = readWorkerResources(input.skill, input.workspaceRoot, input.skillsRoot)
	let prompt = buildToolLoopPrompt(input.basePrompt, resources)

	for (let step = 0; step < 24; step += 1) {
		const response = input.unwrapModelData(await input.invokeModel(prompt))
		if (looksLikeToolCall(response)) {
			const toolCall = parseToolCall(response)
			const toolResult = await executeToolCall(resources, toolCall, input.runShell)
			prompt = appendToolResult(prompt, toolCall, toolResult)
			continue
		}

		const finalResult = tryValidateFinalResult(input.validateFinalResult, response)
		if (finalResult.ok) {
			return finalResult.value
		}

		throw new FlueBrainValidationError(
			'Worker response must be either a valid worker result or a supported tool call object'
		)
	}

	throw new FlueBrainValidationError('Worker tool loop exceeded the maximum number of tool steps (24)')
}

function looksLikeToolCall(value: unknown): boolean {
	return Boolean(
		value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		typeof (value as Record<string, unknown>).tool === 'string'
	)
}

function readWorkerResources(skill: SkillDefinition, workspaceRoot: string, skillsRoot?: string) {
	const resources =
		skill.frontmatter.resources &&
		typeof skill.frontmatter.resources === 'object' &&
		!Array.isArray(skill.frontmatter.resources)
			? (skill.frontmatter.resources as Record<string, unknown>)
			: {}

	const skillDirBase = skillsRoot ?? workspaceRoot
	const skillDir = path.resolve(skillDirBase, path.dirname(skill.path))
	const fsRoots = Array.isArray(resources.fs)
		? resources.fs
				.filter((value): value is string => typeof value === 'string' && value.length > 0)
				.map((value) => path.resolve(workspaceRoot, value))
		: []

	return {
		skillDir,
		workspaceRoot,
		shellEnabled: resources.shell === true,
		fsRoots
	}
}

function buildToolLoopPrompt(
	basePrompt: string,
	resources: { shellEnabled: boolean; fsRoots: string[]; skillDir: string }
): string {
	const toolHints: string[] = []
	if (resources.shellEnabled) {
		toolHints.push(`- shell(command, cwd?) is available. Default cwd is ${resources.skillDir}.`)
	}
	if (resources.fsRoots.length > 0) {
		toolHints.push(`- read_file(path) and write_file(path, content) are available inside: ${JSON.stringify(resources.fsRoots)}.`)
	}

	if (toolHints.length === 0) {
		return basePrompt
	}

	return [
		basePrompt,
		'',
		'Tool execution contract:',
		...toolHints,
		'- If you want to use a tool, return exactly one JSON object with this shape:',
		JSON.stringify({ tool: 'shell', args: { command: 'echo ok' } }, null, 2),
		'- For read_file use: {"tool":"read_file","args":{"path":"relative/or/absolute-path"}}',
		'- For write_file use: {"tool":"write_file","args":{"path":"relative/or/absolute-path","content":"..."}}',
		'- After a tool result is provided, continue and either call another tool or return the final worker result schema.',
		'- Do not return a final worker result in the same response as a tool request.'
	].join('\n')
}

function tryValidateFinalResult(validate: (value: unknown) => unknown, value: unknown):
	| { ok: true; value: unknown }
	| { ok: false } {
	try {
		return { ok: true, value: validate(value) }
	} catch {
		return { ok: false }
	}
}

function parseToolCall(value: unknown): ToolCall {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new FlueBrainValidationError('Worker response must be either a valid worker result or a tool call object')
	}

	const record = value as Record<string, unknown>
	const tool = record.tool
	const args =
		record.args && typeof record.args === 'object' && !Array.isArray(record.args)
			? (record.args as Record<string, unknown>)
			: null

	if (!args || typeof tool !== 'string') {
		throw new FlueBrainValidationError('Worker tool call must include string tool and object args')
	}

	switch (tool) {
		case 'shell': {
			if (typeof args.command !== 'string' || args.command.trim().length === 0) {
				throw new FlueBrainValidationError('Worker shell tool requires a non-empty args.command')
			}
			if (args.cwd !== undefined && typeof args.cwd !== 'string') {
				throw new FlueBrainValidationError('Worker shell tool args.cwd must be a string when provided')
			}
			return { tool, args: { command: args.command, cwd: args.cwd as string | undefined } }
		}
		case 'read_file': {
			if (typeof args.path !== 'string' || args.path.trim().length === 0) {
				throw new FlueBrainValidationError('Worker read_file tool requires a non-empty args.path')
			}
			return { tool, args: { path: args.path } }
		}
		case 'write_file': {
			if (typeof args.path !== 'string' || args.path.trim().length === 0) {
				throw new FlueBrainValidationError('Worker write_file tool requires a non-empty args.path')
			}
			if (typeof args.content !== 'string') {
				throw new FlueBrainValidationError('Worker write_file tool requires string args.content')
			}
			return { tool, args: { path: args.path, content: args.content } }
		}
		default:
			throw new FlueBrainValidationError(`Worker requested unsupported tool: ${tool}`)
	}
}

async function executeToolCall(
	resources: { skillDir: string; workspaceRoot: string; shellEnabled: boolean; fsRoots: string[] },
	toolCall: ToolCall,
	runShell: WorkerToolLoopInput['runShell']
): Promise<ToolResult> {
	switch (toolCall.tool) {
		case 'shell': {
			if (!resources.shellEnabled) {
				throw new FlueBrainValidationError('Shell tool is not available for this skill')
			}

			const cwd = resolveCwd(resources, toolCall.args.cwd)
			const result = await runShell(toolCall.args.command, { cwd })
			return {
				ok: true,
				tool: 'shell',
				cwd,
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.exitCode,
				timedOut: result.timedOut ?? false
			}
		}
		case 'read_file': {
			const resolvedPath = resolveFsPath(resources, toolCall.args.path)
			return {
				ok: true,
				tool: 'read_file',
				path: resolvedPath,
				content: await readFile(resolvedPath, 'utf8')
			}
		}
		case 'write_file': {
			const resolvedPath = resolveFsPath(resources, toolCall.args.path)
			await mkdir(path.dirname(resolvedPath), { recursive: true })
			await writeFile(resolvedPath, toolCall.args.content, 'utf8')
			return {
				ok: true,
				tool: 'write_file',
				path: resolvedPath,
				bytesWritten: Buffer.byteLength(toolCall.args.content, 'utf8')
			}
		}
	}
}

function resolveCwd(
	resources: { skillDir: string; fsRoots: string[] },
	cwd: string | undefined
): string {
	const candidate = path.resolve(resources.skillDir, cwd ?? '.')
	const roots = [resources.skillDir, ...resources.fsRoots]
	if (!isWithinAnyRoot(candidate, roots)) {
		throw new FlueBrainValidationError(`Shell cwd is outside the allowed roots: ${cwd ?? '.'}`)
	}
	return candidate
}

function resolveFsPath(
	resources: { skillDir: string; workspaceRoot: string; fsRoots: string[] },
	requestedPath: string
): string {
	if (resources.fsRoots.length === 0) {
		throw new FlueBrainValidationError('Filesystem tools are not available for this skill')
	}

	const resolvedPath = path.isAbsolute(requestedPath)
		? path.resolve(requestedPath)
		: path.resolve(resources.workspaceRoot, requestedPath)
	if (!isWithinAnyRoot(resolvedPath, resources.fsRoots)) {
		throw new FlueBrainValidationError(`Path is outside allowed fs roots: ${requestedPath}`)
	}
	return resolvedPath
}

function isWithinAnyRoot(candidate: string, roots: string[]): boolean {
	return roots.some((root) => {
		const relative = path.relative(root, candidate)
		return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
	})
}

function appendToolResult(prompt: string, toolCall: ToolCall, toolResult: ToolResult): string {
	return [
		prompt,
		'',
		'Tool call executed:',
		JSON.stringify(toolCall, null, 2),
		'Tool result:',
		JSON.stringify(toolResult, null, 2),
		'Continue. Return either another tool call object or the final worker result JSON object.'
	].join('\n')
}