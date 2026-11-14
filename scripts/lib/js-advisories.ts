// The JavaScript dependency audit: `bun audit`, less the advisories that have no fixed
// release in the major versions this repository uses. Every exception names its package
// and why it stays. An exception that no longer matches a finding fails the check too, so
// the list cannot outlive its advisories.

export type Advisory = { url: string; title: string; severity: string }
export type AuditReport = Record<string, Advisory[]>
export type AdvisoryException = { id: string; package: string; reason: string }

export const exceptions: readonly AdvisoryException[] = [
	{
		id: 'GHSA-gcqx-w48m-w2h4',
		package: 'deepmerge',
		reason:
			'Low. No fixed release exists. Only build tooling (@rollup/plugin-node-resolve, @sveltejs/vite-plugin-svelte) merges its own configuration with it.'
	},
	{
		id: 'GHSA-pfhg-q3qv-9q6r',
		package: '@sveltejs/kit',
		reason: 'Low. Fixed only in SvelteKit 3; remove with the SvelteKit 3 migration.'
	},
	{
		id: 'GHSA-27mw-82g8-phjj',
		package: '@sveltejs/kit',
		reason: 'Low. Fixed only in SvelteKit 3; remove with the SvelteKit 3 migration.'
	}
]

export const advisoryId = (advisory: Advisory) => advisory.url.split('/').pop() ?? advisory.url

export function evaluate(report: AuditReport, allowed: readonly AdvisoryException[] = exceptions) {
	const used = new Set<AdvisoryException>()
	const findings: { package: string; advisory: Advisory }[] = []
	for (const [name, advisories] of Object.entries(report))
		for (const advisory of advisories) {
			const exception = allowed.find(
				(entry) => entry.package === name && entry.id === advisoryId(advisory)
			)
			if (exception) used.add(exception)
			else findings.push({ package: name, advisory })
		}
	return { findings, stale: allowed.filter((entry) => !used.has(entry)) }
}
