import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { SiteHostConfig } from './config.js'
import { verifyDns } from './dns.js'
import { type DirectoryBinding, materialize, validateBinding } from './repository.js'

type ActiveSite = { binding: DirectoryBinding; root: string }

const contentTypes: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.txt': 'text/plain; charset=utf-8',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2'
}

export class StaticSiteHost {
	private active = new Map<string, ActiveSite>()
	private ready = false
	private reconciling: Promise<void> | null = null

	constructor(private config: SiteHostConfig) {}

	async loadSnapshot(): Promise<void> {
		const snapshot = JSON.parse(
			await readFile(join(this.config.dataRoot, 'active-sites.json'), 'utf8')
		) as { sites: ActiveSite[] }
		for (const site of snapshot.sites ?? []) {
			try {
				validateBinding(site.binding)
				const expectedRoot = resolve(this.config.dataRoot, 'bindings', site.binding.id, 'releases')
				const root = resolve(site.root)
				if (
					root.startsWith(`${expectedRoot}${sep}`) &&
					(await stat(join(root, 'index.html')).catch(() => null))
				)
					this.active.set(site.binding.hostname, site)
			} catch (error) {
				console.warn(
					JSON.stringify({
						message: 'ignored invalid active-site snapshot entry',
						error: String(error)
					})
				)
			}
		}
		this.ready = true
	}

	async reconcile(): Promise<void> {
		if (this.reconciling) return this.reconciling
		this.reconciling = this.doReconcile().finally(() => (this.reconciling = null))
		return this.reconciling
	}

	private async doReconcile() {
		const response = await fetch(this.config.directoryUrl, {
			headers: { authorization: `Bearer ${this.config.bearerToken}` },
			signal: AbortSignal.timeout(10_000)
		})
		if (!response.ok) throw new Error(`site directory returned ${response.status}`)
		const payload = (await response.json()) as { bindings?: DirectoryBinding[] }
		if (!Array.isArray(payload.bindings)) throw new Error('invalid site directory response')
		const configured = new Set(payload.bindings.map((binding) => binding.hostname))
		for (const hostname of this.active.keys())
			if (!configured.has(hostname)) this.active.delete(hostname)
		await Promise.all(payload.bindings.map((binding) => this.reconcileOne(binding)))
		await this.saveSnapshot()
		this.ready = true
	}

	private async saveSnapshot() {
		const target = join(this.config.dataRoot, 'active-sites.json')
		const staging = `${target}.next`
		await writeFile(staging, JSON.stringify({ sites: [...this.active.values()] }), { mode: 0o600 })
		await rename(staging, target)
	}

	private async reconcileOne(binding: DirectoryBinding) {
		let report: Record<string, unknown>
		try {
			validateBinding(binding)
			const dns = await verifyDns(
				binding.hostname,
				binding.verification_token_hash,
				this.config.allowedIpv4,
				this.config.allowedIpv6
			)
			if (!dns.ok) {
				const verifiedAt = binding.verified_at ? Date.parse(binding.verified_at) : 0
				if (Date.now() - verifiedAt > this.config.dnsGraceMilliseconds)
					this.active.delete(binding.hostname)
				report = { id: binding.id, status: 'dns_invalid', error: dns.reason }
			} else {
				binding.verified_at = new Date().toISOString()
				await this.report({ id: binding.id, status: 'syncing', dnsVerified: true })
				const release = await materialize(binding, this.config)
				this.active.set(binding.hostname, { binding, root: release.root })
				report = {
					id: binding.id,
					status: 'active',
					dnsVerified: true,
					artifactRevision: release.artifactRevision,
					sourceRevision: release.sourceRevision
				}
			}
		} catch (error) {
			report = { id: binding.id, status: 'failed', error: (error as Error).message }
		}
		await this.report(report)
	}

	private async report(payload: Record<string, unknown>) {
		await fetch(this.config.statusUrl, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.config.bearerToken}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000)
		}).catch((error) =>
			console.warn(JSON.stringify({ message: 'status report failed', error: String(error) }))
		)
	}

	handle = async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		if (url.pathname === '/health/live') return new Response('ok\n')
		if (url.pathname === '/health/ready')
			return new Response(this.ready ? 'ready\n' : 'not ready\n', {
				status: this.ready ? 200 : 503
			})
		if (url.pathname === '/internal/caddy/ask') {
			const domain = url.searchParams.get('domain')?.toLowerCase().replace(/\.$/, '')
			return new Response(null, { status: domain && this.active.has(domain) ? 200 : 404 })
		}
		if (!['GET', 'HEAD'].includes(request.method))
			return new Response('Method not allowed', { status: 405 })
		const hostname = request.headers.get('host')?.split(':')[0].toLowerCase().replace(/\.$/, '')
		const site = hostname ? this.active.get(hostname) : undefined
		if (!site) return new Response('Not found', { status: 404 })
		let pathname: string
		try {
			pathname = decodeURIComponent(url.pathname)
		} catch {
			return new Response('Bad request', { status: 400 })
		}
		const relative = normalize(pathname).replace(/^[/\\]+/, '')
		if (relative.startsWith('..') || relative.split(/[\\/]/).some((part) => part.startsWith('.')))
			return new Response('Not found', { status: 404 })
		let file = join(site.root, relative || 'index.html')
		const info = await stat(file).catch(() => null)
		if (info?.isDirectory()) file = join(file, 'index.html')
		else if (!info?.isFile()) {
			if (extname(relative)) return new Response('Not found', { status: 404 })
			file = join(site.root, 'index.html')
		}
		const body = Bun.file(file)
		if (!(await body.exists())) return new Response('Not found', { status: 404 })
		const headers = new Headers({
			'content-type': contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'strict-origin-when-cross-origin',
			'x-frame-options': 'DENY',
			'cache-control': relative.startsWith('_app/immutable/')
				? 'public, max-age=31536000, immutable'
				: file.endsWith('.html')
					? 'no-cache'
					: 'public, max-age=3600'
		})
		return new Response(request.method === 'HEAD' ? null : body, { headers })
	}
}
