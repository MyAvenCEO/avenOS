import { Buffer } from 'node:buffer'
import path from 'node:path'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'

import type { SkillDefinition } from '@jaensen/skills'

import { FlueBrainValidationError } from './errors'

type ShellResult = {
	stdout: string
	stderr: string
	exitCode: number
	timedOut?: boolean
	aborted?: boolean
}

type ToolCall =
	| { tool: 'shell'; args: { command: string; cwd?: string } }
	| { tool: 'read_file'; args: { path: string; encoding?: 'utf8' | 'base64' } }
	| { tool: 'inspect_attachment'; args: { id: string } }
	| { tool: 'write_file'; args: { path: string; content: string } }
	| {
			tool: 'call_skill'
			args: {
				to: string
				callId: string
				request: string
				payload: unknown
				state?: unknown
			}
		}
	| { tool: 'finish'; args: { result: unknown; state?: unknown } }

type ToolResult =
	| ({ ok: true; tool: 'shell' } & ShellResult & { cwd: string })
	| { ok: true; tool: 'read_file'; path: string; encoding: 'utf8' | 'base64'; content: string }
	| {
			ok: true
			tool: 'inspect_attachment'
			attachment: {
				id: string
				name: string
				mimeType: string
				sizeBytes: number
				sha256: string
				path?: string
				firstBytesHex: string
			}
		}
	| { ok: true; tool: 'write_file'; path: string; bytesWritten: number }

type DeferredToolResult = {
	state: unknown
	result?: unknown
	completed: boolean
	actions?: Array<{
		type: 'call_skill'
		to: string
		callId: string
		request: string
		payload: unknown
	}>
}

export interface WorkerToolLoopInput {
	skill: SkillDefinition
	workspaceRoot: string
	skillsRoot?: string
	uploadRoot?: string
	attachmentScopeId?: string
	runShell(command: string, options?: {
		cwd?: string
		signal?: AbortSignal
		timeoutMs?: number
		maxOutputBytes?: number
	}): Promise<ShellResult>
	invokeModel(prompt: string): Promise<unknown>
	basePrompt: string
	currentState: unknown
	validateFinalResult(value: unknown): unknown
	unwrapModelData(value: unknown): unknown
	signal?: AbortSignal
	shellTimeoutMs?: number
	shellMaxOutputBytes?: number
}

export async function runWorkerToolLoop(input: WorkerToolLoopInput): Promise<unknown> {
	const resources = readWorkerResources(input)
	let prompt = buildToolLoopPrompt(input.basePrompt, resources)

	for (let step = 0; step < 24; step += 1) {
		const response = await invokeModelWithRepair(input, prompt)
		if (looksLikeToolCall(response)) {
			try {
				const toolCall = parseToolCall(response)
				const deferredResult = mapDeferredToolCall(toolCall, input.currentState)
				if (deferredResult) {
					return input.validateFinalResult(deferredResult)
				}
				const toolResult = await executeToolCall(resources, toolCall, input.runShell)
				prompt = appendToolResult(prompt, toolCall, toolResult)
			} catch (error) {
				prompt = appendToolError(prompt, response, error)
			}
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

async function invokeModelWithRepair(input: WorkerToolLoopInput, prompt: string): Promise<unknown> {
	let lastError = 'Unknown model error'

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			return input.unwrapModelData(
				await input.invokeModel(
					attempt === 0
						? prompt
						: [
							prompt,
							'',
							'Your previous response could not be parsed or validated.',
							`Error: ${lastError}`,
							'Return exactly one JSON object.',
							'Use tools for all external actions.',
							'If using a tool, return exactly one tool-call object with only tool and args.',
							'Use call_skill to delegate to another skill.',
							'Use finish when the requested work is complete.',
							'Do not manually emit worker result JSON unless explicitly asked by the runtime.'
						].join('\n')
				)
			)
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error)
		}
	}

	throw new FlueBrainValidationError(`Worker model output could not be repaired: ${lastError}`)
}

function looksLikeToolCall(value: unknown): boolean {
	return Boolean(
		value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		typeof (value as Record<string, unknown>).tool === 'string'
	)
}

function readWorkerResources(input: WorkerToolLoopInput) {
	const resources =
		input.skill.frontmatter.resources &&
		typeof input.skill.frontmatter.resources === 'object' &&
		!Array.isArray(input.skill.frontmatter.resources)
			? (input.skill.frontmatter.resources as Record<string, unknown>)
			: {}

	const skillDirBase = input.skillsRoot ?? input.workspaceRoot
	const skillDir = path.resolve(skillDirBase, path.dirname(input.skill.path))
	const fsRoots = Array.isArray(resources.fs)
		? resources.fs
				.filter((value): value is string => typeof value === 'string' && value.length > 0)
				.map((value) => path.resolve(input.workspaceRoot, value))
		: []
	const uploadFsRoot = input.uploadRoot ? path.resolve(input.uploadRoot) : null

	return {
		skillDir,
		workspaceRoot: input.workspaceRoot,
		shellEnabled: resources.shell === true,
		fsRoots,
		uploadFsRoot,
		attachmentScopeId: input.attachmentScopeId,
		signal: input.signal,
		shellTimeoutMs: input.shellTimeoutMs,
		shellMaxOutputBytes: input.shellMaxOutputBytes
	}
}

function buildToolLoopPrompt(
	basePrompt: string,
	resources: {
		shellEnabled: boolean
		fsRoots: string[]
		skillDir: string
		uploadFsRoot: string | null
		attachmentScopeId?: string
	}
): string {
	const toolHints: string[] = []
	if (resources.shellEnabled) {
		toolHints.push(`- shell(command, cwd?) is available. Default cwd is ${resources.skillDir}.`)
	}
	if (resources.fsRoots.length > 0) {
		toolHints.push(`- read_file(path) and write_file(path, content) are available inside: ${JSON.stringify(resources.fsRoots)}.`)
	}
	if (resources.uploadFsRoot) {
		toolHints.push('- read_file(path, encoding?) also supports current-request attachments via attachment://<attachment-id>.')
		toolHints.push('- inspect_attachment(id) returns attachment metadata and binary preview bytes for current-request attachments.')
	}

	return [
		basePrompt,
		'',
		'Tool execution contract:',
		...toolHints,
		'- Use tools for all external actions.',
		'- Available tools: shell, read_file, write_file, inspect_attachment, call_skill, finish.',
		'- Use call_skill to delegate to another skill.',
		'- Use finish when the requested work is complete.',
		'- Do not manually emit worker result JSON unless explicitly asked by the runtime.',
		'- If you want to use a tool, return exactly one JSON object with this shape:',
		JSON.stringify({ tool: 'shell', args: { command: 'echo ok' } }, null, 2),
		'- For read_file use: {"tool":"read_file","args":{"path":"relative/or/absolute-path-or-attachment://id","encoding":"utf8|base64"}}',
		'- For inspect_attachment use: {"tool":"inspect_attachment","args":{"id":"attachment-id"}}',
		'- For write_file use: {"tool":"write_file","args":{"path":"relative/or/absolute-path","content":"..."}}',
		'- For call_skill use: {"tool":"call_skill","args":{"to":"skills/memory","callId":"remember-1","request":"store","payload":{},"state":{}}}',
		'- For finish use: {"tool":"finish","args":{"result":{"ok":true},"state":{}}}',
		'- After a tool result is provided, continue and either call another tool, call_skill, or finish.',
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
			if (args.encoding !== undefined && args.encoding !== 'utf8' && args.encoding !== 'base64') {
				throw new FlueBrainValidationError('Worker read_file tool args.encoding must be utf8 or base64 when provided')
			}
			return { tool, args: { path: args.path, encoding: (args.encoding as 'utf8' | 'base64' | undefined) ?? 'utf8' } }
		}
		case 'inspect_attachment': {
			if (typeof args.id !== 'string' || args.id.trim().length === 0) {
				throw new FlueBrainValidationError('Worker inspect_attachment tool requires a non-empty args.id')
			}
			return { tool, args: { id: args.id } }
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
		case 'call_skill': {
			if (typeof args.to !== 'string' || args.to.trim().length === 0) {
				throw new FlueBrainValidationError('Worker call_skill tool requires a non-empty args.to')
			}
			if (typeof args.callId !== 'string' || args.callId.trim().length === 0) {
				throw new FlueBrainValidationError('Worker call_skill tool requires a non-empty args.callId')
			}
			if (typeof args.request !== 'string' || args.request.trim().length === 0) {
				throw new FlueBrainValidationError('Worker call_skill tool requires a non-empty args.request')
			}
			if (!('payload' in args)) {
				throw new FlueBrainValidationError('Worker call_skill tool requires args.payload')
			}
			return {
				tool,
				args: {
					to: args.to,
					callId: args.callId,
					request: args.request,
					payload: args.payload,
					state: args.state
				}
			}
		}
		case 'finish': {
			if (!('result' in args)) {
				throw new FlueBrainValidationError('Worker finish tool requires args.result')
			}
			return { tool, args: { result: args.result, state: args.state } }
		}
		default:
			throw new FlueBrainValidationError(`Worker requested unsupported tool: ${tool}`)
	}
}

function mapDeferredToolCall(toolCall: ToolCall, currentState: unknown): DeferredToolResult | null {
	if (toolCall.tool === 'call_skill') {
		return {
			state: toolCall.args.state ?? currentState,
			actions: [
				{
					type: 'call_skill',
					to: toolCall.args.to,
					callId: toolCall.args.callId,
					request: toolCall.args.request,
					payload: toolCall.args.payload
				}
			],
			completed: false
		}
	}

	if (toolCall.tool === 'finish') {
		return {
			state: toolCall.args.state ?? currentState,
			result: toolCall.args.result,
			completed: true
		}
	}

	return null
}

async function executeToolCall(
	resources: {
		skillDir: string
		workspaceRoot: string
		shellEnabled: boolean
		fsRoots: string[]
		uploadFsRoot: string | null
		attachmentScopeId?: string
		signal?: AbortSignal
		shellTimeoutMs?: number
		shellMaxOutputBytes?: number
	},
	toolCall: ToolCall,
	runShell: WorkerToolLoopInput['runShell']
): Promise<ToolResult> {
	switch (toolCall.tool) {
		case 'shell': {
			if (!resources.shellEnabled) {
				throw new FlueBrainValidationError('Shell tool is not available for this skill')
			}

			const cwd = resolveCwd(resources, toolCall.args.cwd)
			const result = await runShell(toolCall.args.command, {
				cwd,
				signal: resources.signal,
				timeoutMs: resources.shellTimeoutMs,
				maxOutputBytes: resources.shellMaxOutputBytes
			})
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
			const resolvedPath = await resolveFsPath(resources, toolCall.args.path)
			const bytes = await readFile(resolvedPath)
			const encoding = toolCall.args.encoding ?? 'utf8'
			return {
				ok: true,
				tool: 'read_file',
				path: toolCall.args.path,
				encoding,
				content: encoding === 'base64' ? bytes.toString('base64') : bytes.toString('utf8')
			}
		}
		case 'inspect_attachment': {
			return {
				ok: true,
				tool: 'inspect_attachment',
				attachment: await inspectAttachment(resources, toolCall.args.id)
			}
		}
		case 'write_file': {
			const resolvedPath = resolveWritableFsPath(resources, toolCall.args.path)
			await mkdir(path.dirname(resolvedPath), { recursive: true })
			await writeFile(resolvedPath, toolCall.args.content, 'utf8')
			return {
				ok: true,
				tool: 'write_file',
				path: toolCall.args.path,
				bytesWritten: Buffer.byteLength(toolCall.args.content, 'utf8')
			}
		}
		case 'call_skill':
		case 'finish':
			throw new FlueBrainValidationError(`Deferred tool should not execute synchronously: ${toolCall.tool}`)
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

async function resolveFsPath(
	resources: {
		skillDir: string
		workspaceRoot: string
		fsRoots: string[]
		uploadFsRoot: string | null
		attachmentScopeId?: string
	},
	requestedPath: string
): Promise<string> {
	if (requestedPath.startsWith('attachment://')) {
		return resolveAttachmentPath(resources, requestedPath)
	}

	const readRoots = resources.uploadFsRoot ? [...resources.fsRoots, resources.uploadFsRoot] : resources.fsRoots
	if (readRoots.length === 0) {
		throw new FlueBrainValidationError('Filesystem tools are not available for this skill')
	}

	const resolvedPath = path.isAbsolute(requestedPath)
		? path.resolve(requestedPath)
		: path.resolve(resources.workspaceRoot, requestedPath)
	if (!isWithinAnyRoot(resolvedPath, readRoots)) {
		throw new FlueBrainValidationError(`Path is outside allowed fs roots: ${requestedPath}`)
	}
	return resolvedPath
}

async function resolveAttachmentPath(
	resources: { uploadFsRoot: string | null; attachmentScopeId?: string },
	requestedPath: string
): Promise<string> {
	if (!resources.uploadFsRoot || !resources.attachmentScopeId) {
		throw new FlueBrainValidationError('Attachment reads are not available for this skill')
	}

	const attachmentId = requestedPath.slice('attachment://'.length)
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(attachmentId)) {
		throw new FlueBrainValidationError(`Invalid attachment reference: ${requestedPath}`)
	}

	const requestsRoot = path.join(resources.uploadFsRoot, 'requests')
	const scopeRoot = path.join(requestsRoot, resources.attachmentScopeId)
	const candidatePath = path.join(scopeRoot, attachmentId, 'blob')

	let realRequestsRoot: string
	let realCandidatePath: string
	try {
		realRequestsRoot = await realpath(requestsRoot)
		realCandidatePath = await realpath(candidatePath)
	} catch {
		throw new FlueBrainValidationError(`Attachment is unavailable: ${attachmentId}`)
	}

	if (!isWithinAnyRoot(realCandidatePath, [realRequestsRoot])) {
		throw new FlueBrainValidationError(`Attachment escapes the allowed root: ${attachmentId}`)
	}

	return realCandidatePath
}

async function inspectAttachment(
	resources: {
		uploadFsRoot: string | null
		attachmentScopeId?: string
		shellEnabled: boolean
	},
	attachmentId: string
): Promise<{
	id: string
	name: string
	mimeType: string
	sizeBytes: number
	sha256: string
	path?: string
	firstBytesHex: string
}> {
	const blobPath = await resolveAttachmentPath(resources, `attachment://${attachmentId}`)
	const metaPath = path.join(path.dirname(blobPath), 'meta.json')
	const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
	const bytes = await readFile(blobPath)
	return {
		id: typeof meta.id === 'string' ? meta.id : attachmentId,
		name: typeof meta.name === 'string' ? meta.name : 'attachment',
		mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : 'application/octet-stream',
		sizeBytes: typeof meta.sizeBytes === 'number' ? meta.sizeBytes : bytes.byteLength,
		sha256: typeof meta.sha256 === 'string' ? meta.sha256 : '',
		path: resources.shellEnabled ? blobPath : undefined,
		firstBytesHex: Buffer.from(bytes.subarray(0, 32)).toString('hex')
	}
}

function resolveWritableFsPath(
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
		'Continue. Return either another tool call object, call_skill, or finish.'
	].join('\n')
}

function appendToolError(prompt: string, response: unknown, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)
	const correction = [
		'Fix the request and continue.',
		'Allowed tools are: shell, read_file, write_file, inspect_attachment, call_skill, finish.',
		'Use call_skill to delegate to another skill.',
		'Use finish when the requested work is complete.',
		'Do not manually emit worker result JSON unless explicitly asked by the runtime.'
	].join('\n')

	return [
		prompt,
		'',
		'Malformed or unsupported tool call:',
		JSON.stringify(response, null, 2),
		'Tool error:',
		message,
		correction
	].join('\n')
}