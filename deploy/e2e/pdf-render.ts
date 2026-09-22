import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise the decoder in the actual runtime image, without host dependencies,
// host fonts or network access. Nonempty extracted text cannot detect blank renders.
const image = process.argv[2]
if (!image) throw new Error('Actor Runner image argument required')
const container = `aven-pdf-render-${crypto.randomUUID()}`
const directory = await mkdtemp(join(tmpdir(), 'aven-pdf-render-'))
try {
	const entry = new URL(
		'../../libs/aven-document-ingest/tests/support/bundled-server-decoder-entry.ts',
		import.meta.url
	).pathname
	await chmod(directory, 0o755)
	const build = Bun.spawn(['bun', 'build', entry, '--target=bun', `--outdir=${directory}`], {
		stdout: 'pipe',
		stderr: 'pipe'
	})
	if ((await build.exited) !== 0) throw new Error(await new Response(build.stderr).text())
	const fixture = new URL('./fixtures/e2e-invoice.pdf', import.meta.url).pathname
	const child = Bun.spawn(
		[
			'docker',
			'run',
			'--rm',
			'--name',
			container,
			'--network=none',
			'--read-only',
			'--cap-drop=ALL',
			'--security-opt=no-new-privileges',
			'--memory=512m',
			'--pids-limit=128',
			'--mount',
			`type=bind,src=${directory},dst=/app/render-proof,readonly`,
			'--mount',
			`type=bind,src=${fixture},dst=/app/invoice.pdf,readonly`,
			image,
			'bun',
			'/app/render-proof/bundled-server-decoder-entry.js',
			'/app/invoice.pdf'
		],
		{ stdout: 'pipe', stderr: 'pipe', timeout: 60_000 }
	)
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	])
	if (code !== 0 || stderr.includes('standardFontDataUrl'))
		throw new Error(`Container render failed (${code}): ${stderr}\n${stdout}`)
	const result = JSON.parse(stdout.trim())
	if (
		result.outcome !== 'ok' ||
		result.pages !== 1 ||
		result.systemFonts !== 0 ||
		!Array.isArray(result.textPixels) ||
		result.textPixels.length !== 1 ||
		!Number.isFinite(result.textPixels[0]) ||
		result.textPixels[0] <= 1_000
	)
		throw new Error(`Container lost printed invoice text: ${stdout}`)
	console.info(
		`Actor Runner image rendered ${result.textPixels[0]} dark text pixels with no system fonts.`
	)
} finally {
	// A timed-out Docker client can leave its container running.
	await Bun.spawn(['docker', 'rm', '--force', container], {
		stdout: 'ignore',
		stderr: 'ignore',
		timeout: 15_000
	}).exited
	await rm(directory, { recursive: true, force: true })
}
