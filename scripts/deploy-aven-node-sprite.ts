#!/usr/bin/env bun
/**
 * Deploy / (re)configure the aven-node relay as a Sprites Service — driven
 * entirely from the repo-root `.env` (the single source of truth).
 *
 *   bun run deploy:server:sprite          # uses .env
 *
 * Rotate the relay identity: change AVEN_SERVER_SEED in .env (e.g.
 * `openssl rand -hex 32`) and re-run. The seed IS the server's ed25519 private
 * key, so its DID changes with it — after a rotation, re-share each spark to the
 * new relay DID ("Replicate this spark here"). The seed is gitignored (lives only
 * in .env locally and in the Sprite service env remotely); it is never committed.
 *
 * Build: plain `deploy:server:sprite` only (re)wires the Service from .env — it does
 * not build (the binary at AVEN_SERVER_BIN must already exist). When AVEN_SERVER_BUILD_REF
 * is set (release:app:all does this), it FIRST ships a source tarball of that commit to the
 * Sprite, extracts it, and `cargo build`s aven-node — see the build block below.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SPRITE = process.env.AVEN_CEO_SPRITE?.trim() || 'aven-ceo'
const SEED = process.env.AVEN_SERVER_SEED?.trim() || ''
const BIN =
	process.env.AVEN_SERVER_BIN?.trim() || '/home/sprite/aven-build/target/rust/release/aven-node'
const DATA_DIR = process.env.AVEN_SERVER_DATA_DIR?.trim() || '/home/sprite/aven-data'
const PIN_FILE = process.env.AVEN_SERVER_PIN_FILE?.trim() || '/home/sprite/server.pin'
const BIND = process.env.AVEN_SERVER_BIND?.trim() || '0.0.0.0:4290'
const HEALTH = process.env.AVEN_SERVER_HEALTH_BIND?.trim() || '0.0.0.0:8080'
const RUST_LOG = process.env.RUST_LOG?.trim() || 'info'

// Optional source rebuild before deploy. The Sprite has NO git checkout — its locked-down
// home (/home/sprite is ubuntu:ubuntu 0750) blocks git's real-uid work-tree access() check —
// so instead of pulling, we SHIP source: release:app:all sets AVEN_SERVER_BUILD_REF to the
// exact commit it built the apps from; we `git archive` that commit, stream it to the Sprite,
// extract it over SRC_DIR (keeping the gitignored target/ build cache), and cargo build. That
// keeps the relay's aven-node — and its SchemaHash — byte-for-byte the same source as the
// devices; without it a wiped store just comes back on the relay's *stale* schema.
// Plain `deploy:server:sprite` leaves AVEN_SERVER_BUILD_REF unset → no build (unchanged).
const SRC_DIR = process.env.AVEN_SERVER_SRC_DIR?.trim() || '/home/sprite/aven-build'
const BUILD_REF = process.env.AVEN_SERVER_BUILD_REF?.trim() || ''
const WANT_BUILD = !!(BUILD_REF || process.env.AVEN_SERVER_BUILD?.trim())
const ARCHIVE_REF = BUILD_REF || 'HEAD'
// Where the shipped tarball lands on the Sprite (sprite-owned, durable, sibling of SRC_DIR).
const REMOTE_TARBALL = process.env.AVEN_SERVER_SRC_TARBALL?.trim() || '/home/sprite/aven-src.tar.gz'
// The on-Sprite build invocation (cargo only — override via AVEN_SERVER_BUILD_CMD). There is
// no root Cargo workspace, so aven-node builds via --manifest-path (same as the dev relay in
// scripts/aven-server.ts). CWD stays at SRC_DIR so the committed .cargo/config.toml
// (target-dir = target/rust) is discovered → binary lands at BIN.
const BUILD_INVOCATION =
	process.env.AVEN_SERVER_BUILD_CMD?.trim() ||
	'cargo build --release --manifest-path libs/aven-node/Cargo.toml'

if (!/^[0-9a-fA-F]{64}$/.test(SEED)) {
	console.error(
		'AVEN_SERVER_SEED must be set in .env to a 64-char hex string (run: openssl rand -hex 32).'
	)
	process.exit(1)
}

/** Run a command inside the Sprite over the websocket exec (reliable for short cmds). */
function onSprite(args: string[]) {
	return spawnSync('sprite', ['exec', '-s', SPRITE, '--', ...args], { encoding: 'utf8' })
}

if (WANT_BUILD) {
	// 1. Archive the exact commit locally. git archive reads the committed tree (not the
	//    working dir) — release:app:all's clean-tree preflight guarantees HEAD == what the
	//    apps build, so this tarball is the same source the devices ship.
	const archive = spawnSync('git', ['archive', '--format=tar.gz', ARCHIVE_REF], {
		cwd: repoRoot,
		maxBuffer: 512 * 1024 * 1024
	})
	if (archive.status !== 0 || !archive.stdout?.length) {
		console.error(
			`❌ git archive ${ARCHIVE_REF} failed: ${archive.stderr?.toString().trim() || 'empty output'}`
		)
		process.exit(1)
	}
	const tar = archive.stdout
	const sha = createHash('sha256').update(tar).digest('hex')
	console.log(
		`Shipping source → Sprite "${SPRITE}": ${ARCHIVE_REF} (${(tar.length / 1_000_000).toFixed(1)} MB, sha256 ${sha.slice(0, 12)}…)`
	)

	// 2. Stream to the Sprite as base64 (binary-safe over the exec channel), decode there.
	const ship = spawnSync(
		'sprite',
		['exec', '-s', SPRITE, '--', 'sh', '-lc', `base64 -d > ${REMOTE_TARBALL}`],
		{ input: tar.toString('base64'), encoding: 'utf8' }
	)
	if (ship.status !== 0) {
		console.error(
			`❌ shipping tarball failed (exit ${ship.status ?? 'signal'}). ${ship.stderr ?? ''}`
		)
		process.exit(1)
	}

	// 3. Integrity gate: bytes on the Sprite must match what we sent.
	const remoteSha = (
		onSprite(['sh', '-lc', `sha256sum ${REMOTE_TARBALL} | cut -d' ' -f1`]).stdout ?? ''
	).trim()
	if (remoteSha !== sha) {
		console.error(
			`❌ tarball integrity mismatch (local ${sha.slice(0, 12)}… vs remote ${remoteSha.slice(0, 12)}…).`
		)
		process.exit(1)
	}
	console.log('  ✓ tarball verified on Sprite.')

	// 4. Extract the pinned source over the warm target/ cache, then build DETACHED. The extract
	//    resets source mtimes, so cargo recompiles a lot (RocksDB included) → a full relay build
	//    is ~10–15 min; a synchronous `sprite exec` that long risks the channel dropping and
	//    killing the build. So launch under setsid (survives disconnect) and poll a sentinel file.
	const DONE = `${SRC_DIR}/.build.done`
	const LOG = `${SRC_DIR}/.build.log`
	const launch = onSprite([
		'sh',
		'-lc',
		[
			`cd ${SRC_DIR} || exit 9`,
			`rm -f ${DONE} ${LOG}`,
			// wipe everything except the build cache, then extract the pinned source fresh
			'find . -maxdepth 1 -mindepth 1 ! -name target -exec rm -rf {} +',
			`tar -xzf ${REMOTE_TARBALL}`,
			// detached: setsid + a LOGIN shell (sh -lc) so the exec disconnecting can't SIGHUP it
			// AND cargo is on PATH (the Sprite's cargo is /.sprite/bin/cargo, only on the login
			// PATH — a non-login `sh -c` can't find it). cargo's exit code → DONE sentinel.
			`setsid sh -lc 'cd ${SRC_DIR} && ${BUILD_INVOCATION} > ${LOG} 2>&1; echo $? > ${DONE}' </dev/null >/dev/null 2>&1 &`,
			'echo launched'
		].join('; ')
	])
	if (launch.status !== 0 || !(launch.stdout ?? '').includes('launched')) {
		console.error(`❌ failed to launch relay build (exit ${launch.status}). ${launch.stderr ?? ''}`)
		process.exit(1)
	}
	console.log(`Building aven-node on Sprite "${SPRITE}" (detached, ~10–15 min). Polling…`)

	const POLL_MS = 15_000
	const MAX_MS = 30 * 60_000
	let code: string | null = null
	for (let waited = 0; waited < MAX_MS; waited += POLL_MS) {
		spawnSync('sleep', [String(POLL_MS / 1000)])
		const p = onSprite([
			'sh',
			'-lc',
			`cat ${DONE} 2>/dev/null; printf '@@'; tail -n1 ${LOG} 2>/dev/null`
		])
		const [donePart, tailPart] = (p.stdout ?? '').split('@@')
		if (donePart.trim() !== '') {
			code = donePart.trim()
			break
		}
		const line = (tailPart ?? '').trim()
		console.log(`  … ${(waited / 60_000).toFixed(1)}m${line ? `  ${line.slice(0, 80)}` : ''}`)
	}
	if (code === null) {
		console.error(
			`❌ relay build unfinished after ${MAX_MS / 60_000} min. Inspect: sprite exec -s ${SPRITE} -- tail -40 ${LOG}`
		)
		process.exit(1)
	}
	if (code !== '0') {
		const tailLog = onSprite(['sh', '-lc', `tail -25 ${LOG}`])
		console.error(`❌ relay build failed (cargo exit ${code}):\n${tailLog.stdout ?? ''}`)
		process.exit(1)
	}
	const chk = onSprite(['test', '-x', BIN])
	if (chk.status !== 0) {
		console.error(`❌ build reported success but ${BIN} is missing/not executable.`)
		process.exit(1)
	}
	console.log(`✅ aven-node rebuilt on the Sprite from ${ARCHIVE_REF} (${sha.slice(0, 12)}…).`)
}

console.log(`Deploying aven-node → Sprite "${SPRITE}" (binary: ${BIN})`)

const envPairs = [
	`AVEN_SERVER_SEED=${SEED}`,
	`AVEN_SERVER_BIND=${BIND}`,
	`AVEN_SERVER_HEALTH_BIND=${HEALTH}`,
	`AVEN_SERVER_PIN_FILE=${PIN_FILE}`,
	`AVEN_SERVER_DATA_DIR=${DATA_DIR}`,
	`RUST_LOG=${RUST_LOG}`
].join(',')

const probe = onSprite(['/.sprite/bin/sprite-env', 'services', 'get', 'aven-node'])
const exists = (probe.stdout ?? '').includes('"name"')

let boot = ''
if (exists && !process.env.WIPE) {
	// Binary-only redeploy: `restart` re-execs the (rebuilt) binary at the same path
	// and reopens the durable store cleanly. We deliberately avoid delete+create —
	// recreating the service makes the fresh process treat the freshly-finalized
	// store as unfinalized and triggers a needless self-heal/re-pull. NOTE: restart
	// keeps the EXISTING service env; to change the seed/config, deploy with WIPE=1.
	console.log('Restarting existing service (preserves the durable store)…')
	onSprite(['/.sprite/bin/sprite-env', 'services', 'restart', 'aven-node'])
	onSprite(['sh', '-c', 'sleep 3'])
} else {
	// Fresh deploy or rotation (WIPE=1): stop + wait for the process to exit (so
	// RocksDB finalizes) + delete + optional wipe + create from the .env config.
	console.log(process.env.WIPE ? 'WIPE=1 — fresh deploy (new store)…' : 'Creating service…')
	onSprite(['/.sprite/bin/sprite-env', 'services', 'stop', 'aven-node'])
	onSprite([
		'sh',
		'-c',
		'for i in $(seq 1 30); do pgrep -f release/aven-node >/dev/null || break; sleep 0.3; done'
	])
	onSprite(['/.sprite/bin/sprite-env', 'services', 'delete', 'aven-node'])
	if (process.env.WIPE) onSprite(['rm', '-rf', DATA_DIR])
	const r = onSprite([
		'/.sprite/bin/sprite-env',
		'services',
		'create',
		'aven-node',
		'--cmd',
		BIN,
		'--dir',
		'/home/sprite',
		'--duration',
		'6s',
		'--env',
		envPairs
	])
	boot = `${r.stdout ?? ''}${r.stderr ?? ''}`
}

// Verify via the authoritative service state.
const get = onSprite(['/.sprite/bin/sprite-env', 'services', 'get', 'aven-node'])
let status = 'unknown'
try {
	status =
		(JSON.parse(get.stdout || '{}') as { state?: { status?: string } })?.state?.status ?? 'unknown'
} catch {
	/* leave as unknown */
}
if (status !== 'running') {
	console.error(`❌ aven-node is not running (status: ${status}).`)
	console.error(
		`   Logs: sprite exec -s ${SPRITE} -- tail -40 /.sprite/logs/services/aven-node.log`
	)
	process.exit(1)
}

// Relay DID: from the create boot stream, else from the service log.
let did = boot.match(/did:key:[A-Za-z0-9]+/)?.[0]
if (!did) {
	const log = onSprite([
		'sh',
		'-c',
		"sed -E 's/\\x1b\\[[0-9;]*m//g' /.sprite/logs/services/aven-node.log | grep -oE 'did:key:[A-Za-z0-9]+' | tail -1"
	])
	did = (log.stdout ?? '').trim() || undefined
}
const healed = /store unreadable . resetting/.test(boot)
console.log(
	`✅ aven-node Service running${healed ? ' (self-healed a corrupt cache; re-pulling from peers)' : ''}. Relay DID: ${did ?? '(see logs)'}`
)
console.log(
	`   Logs:   sprite exec -s ${SPRITE} -- tail -f /.sprite/logs/services/aven-node.log\n` +
		`   Health: sprite proxy -s ${SPRITE} 8080  then  curl localhost:8080/`
)
