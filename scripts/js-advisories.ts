import { resolve } from 'node:path'
import { type AuditReport, advisoryId, evaluate } from './lib/js-advisories.ts'

const root = resolve(import.meta.dir, '..')
const child = Bun.spawn([process.execPath, 'audit', '--json'], {
	cwd: root,
	stdout: 'pipe',
	stderr: 'inherit'
})
const timer = setTimeout(() => child.kill(), 180_000)
const [code, text] = await Promise.all([child.exited, new Response(child.stdout).text()])
clearTimeout(timer)
let report: AuditReport
try {
	report = text.trim() ? JSON.parse(text) : {}
} catch {
	throw new Error(`bun audit did not return a JSON report (exit ${code}).`)
}
if (
	![0, 1].includes(code) ||
	typeof report !== 'object' ||
	report === null ||
	Array.isArray(report)
)
	throw new Error(`bun audit failed (exit ${code}).`)

const { findings, stale } = evaluate(report)
for (const { package: name, advisory } of findings)
	console.error(`${advisory.severity}: ${name}: ${advisory.title} - ${advisory.url}`)
for (const entry of stale)
	console.error(
		`stale exception: ${entry.id} no longer applies to ${entry.package}; remove it from scripts/lib/js-advisories.ts.`
	)
if (findings.length || stale.length) process.exit(1)
const known = Object.values(report).flat().map(advisoryId)
console.log(
	known.length
		? `No JavaScript advisories beyond the ${known.length} documented exceptions.`
		: 'No JavaScript advisories.'
)
