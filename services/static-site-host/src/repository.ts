import { lstat, mkdir, readdir, readFile, rename, rm, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { type DirectoryBinding, validateBinding } from './binding.js'
import type { SiteHostConfig } from './config.js'

export { type DirectoryBinding, validateBinding } from './binding.js'

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
