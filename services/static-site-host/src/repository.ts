import { lstat, mkdir, readdir, readFile, rename, rm, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { SiteHostConfig } from './config.js'

export interface DirectoryBinding {
	id: string
	hostname: string
	repository_full_name: string
	clone_url: string
	source_ref: string
	artifact_ref: string
	artifact_path: string
	verification_token_hash: string
	verified_at: string | null
}

const githubRepository = /^[a-z0-9_.-]{1,100}\/[-a-z0-9_.]{1,100}$/
const gitRef = /^refs\/heads\/(?![./])(?!.*(?:\.\.|\/\/|@\{|\\))[A-Za-z0-9._/-]{1,200}(?<![./])$/

export function validateBinding(binding: DirectoryBinding): void {
	if (!/^[0-9a-f-]{36}$/.test(binding.id)) throw new Error('invalid binding id')
	if (
		!/^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(binding.hostname) ||
		binding.hostname.length > 253 ||
		binding.hostname === 'aven.ceo' ||
		binding.hostname.endsWith('.aven.ceo')
	)
		throw new Error('invalid or reserved hostname')
	if (!githubRepository.test(binding.repository_full_name))
		throw new Error('invalid GitHub repository')
	if (binding.clone_url !== `https://github.com/${binding.repository_full_name}.git`)
		throw new Error('clone URL does not match the GitHub repository')
	if (!gitRef.test(binding.source_ref)) throw new Error('invalid source ref')
	if (!gitRef.test(binding.artifact_ref) || !binding.artifact_ref.startsWith('refs/heads/deploy/'))
		throw new Error('invalid deployment ref')
	if (binding.artifact_path !== 'dist') throw new Error('only the dist artifact path is supported')
	if (!/^[0-9a-f]{64}$/.test(binding.verification_token_hash))
		throw new Error('invalid verification token hash')
}

async function command(args: string[]): Promise<string> {
	const process = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
	const [code, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text()
	])
	if (code !== 0) throw new Error(`${args[0]} failed: ${stderr.trim().slice(0, 500)}`)
	return stdout.trim()
}

async function inspectTree(root: string, maxFiles: number, maxBytes: number) {
	let files = 0
	let bytes = 0
	const pending = [root]
	while (pending.length) {
		const directory = pending.pop() as string
		for await (const entry of new Bun.Glob('*').scan({
			cwd: directory,
			dot: true,
			onlyFiles: false
		})) {
			const path = join(directory, entry)
			const info = await lstat(path)
			if (info.isSymbolicLink()) throw new Error('site artifacts must not contain symbolic links')
			if (info.isDirectory()) pending.push(path)
			else if (info.isFile()) {
				files += 1
				bytes += info.size
				if (files > maxFiles || bytes > maxBytes) throw new Error('site artifact exceeds its limit')
			}
		}
	}
}

export async function materialize(
	binding: DirectoryBinding,
	config: SiteHostConfig
): Promise<{ root: string; artifactRevision: string; sourceRevision: string }> {
	validateBinding(binding)
	const repositoryKey = new Bun.CryptoHasher('sha256')
		.update(`${binding.id}:${binding.repository_full_name}`)
		.digest('hex')
	const repository = join(config.dataRoot, 'repositories', `${repositoryKey}.git`)
	await mkdir(join(config.dataRoot, 'repositories'), { recursive: true })
	if (!(await stat(repository).catch(() => null)))
		await command(['git', 'init', '--bare', repository])
	await command(['git', '--git-dir', repository, 'remote', 'remove', 'origin']).catch(() => '')
	await command(['git', '--git-dir', repository, 'remote', 'add', 'origin', binding.clone_url])
	await command([
		'git',
		'--git-dir',
		repository,
		'fetch',
		'--force',
		'--depth=1',
		'origin',
		`+${binding.source_ref}:refs/aven/source`,
		`+${binding.artifact_ref}:refs/aven/artifact`
	])
	const sourceRevision = await command([
		'git',
		'--git-dir',
		repository,
		'rev-parse',
		'refs/aven/source'
	])
	const artifactRevision = await command([
		'git',
		'--git-dir',
		repository,
		'rev-parse',
		'refs/aven/artifact'
	])
	const bindingRoot = join(config.dataRoot, 'bindings', binding.id)
	const release = join(bindingRoot, 'releases', artifactRevision)
	if (!(await stat(release).catch(() => null))) {
		const staging = join(bindingRoot, `.staging-${crypto.randomUUID()}`)
		await mkdir(staging, { recursive: true })
		try {
			await command([
				'git',
				'--git-dir',
				repository,
				`--work-tree=${staging}`,
				'checkout',
				'-f',
				'refs/aven/artifact',
				'--',
				binding.artifact_path
			])
			const root = join(staging, binding.artifact_path)
			if (!(await stat(join(root, 'index.html')).catch(() => null)))
				throw new Error('deployment artifact has no dist/index.html')
			const marker = (await readFile(join(root, '.source-revision'), 'utf8')).trim()
			if (marker !== sourceRevision)
				throw new Error('deployment artifact was not built from the configured source branch head')
			await inspectTree(root, config.maxFiles, config.maxBytes)
			await mkdir(join(bindingRoot, 'releases'), { recursive: true })
			await rename(root, release)
		} finally {
			await rm(staging, { recursive: true, force: true })
		}
	}
	const next = join(bindingRoot, `.current-${crypto.randomUUID()}`)
	await symlink(join('releases', artifactRevision), next)
	await rename(next, join(bindingRoot, 'current'))
	const releasesRoot = join(bindingRoot, 'releases')
	const oldReleases = await Promise.all(
		(await readdir(releasesRoot))
			.filter((entry) => entry !== artifactRevision)
			.map(async (entry) => ({ entry, mtime: (await stat(join(releasesRoot, entry))).mtimeMs }))
	)
	oldReleases.sort((left, right) => right.mtime - left.mtime)
	for (const obsolete of oldReleases.slice(1))
		await rm(join(releasesRoot, obsolete.entry), { recursive: true, force: true })
	return { root: release, artifactRevision, sourceRevision }
}
