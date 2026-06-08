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
 * Prerequisite: the aven-node binary must already be built on the Sprite at
 * AVEN_SERVER_BIN (see docs/deploy/aven-node-sprite runbook). This script only
 * (re)wires the Service from .env — it does not build.
 */
import { spawnSync } from 'node:child_process'

const SPRITE = process.env.AVEN_CEO_SPRITE?.trim() || 'aven-ceo'
const SEED = process.env.AVEN_SERVER_SEED?.trim() || ''
const BIN =
	process.env.AVEN_SERVER_BIN?.trim() || '/home/sprite/aven-build/target/rust/release/aven-node'
const DATA_DIR = process.env.AVEN_SERVER_DATA_DIR?.trim() || '/home/sprite/aven-data'
const PIN_FILE = process.env.AVEN_SERVER_PIN_FILE?.trim() || '/home/sprite/server.pin'
const BIND = process.env.AVEN_SERVER_BIND?.trim() || '0.0.0.0:4290'
const HEALTH = process.env.AVEN_SERVER_HEALTH_BIND?.trim() || '0.0.0.0:8080'
const RUST_LOG = process.env.RUST_LOG?.trim() || 'info'

// Optional remote rebuild before deploy. The Sprite holds its own git checkout of
// this repo at AVEN_SERVER_SRC_DIR; release:app:all sets AVEN_SERVER_BUILD_REF to the
// exact commit it built the apps from, so the relay's aven-node — and therefore its
// SchemaHash — is byte-for-byte the same source as the devices. Without this, a wiped
// store just comes back up on the relay's *stale* schema and the skew returns.
// Left unset by the plain `deploy:server:sprite` path → behaviour unchanged (no build).
const SRC_DIR = process.env.AVEN_SERVER_SRC_DIR?.trim() || '/home/sprite/aven-build'
const BUILD_REF = process.env.AVEN_SERVER_BUILD_REF?.trim() || ''
const WANT_BUILD = !!(BUILD_REF || process.env.AVEN_SERVER_BUILD?.trim())
const BUILD_TARGET = BUILD_REF || 'origin/main'
// Override the whole recipe with AVEN_SERVER_BUILD_CMD if your Sprite differs.
// Default: refresh the git checkout to the pinned commit and build the relay. There is
// no root Cargo workspace, so aven-node builds via --manifest-path (same as the dev
// relay in scripts/aven-server.ts). CWD stays at SRC_DIR so the committed
// .cargo/config.toml (target-dir = target/rust) is discovered → binary lands at BIN.
// `target/` is gitignored, so the checkout keeps the warm RocksDB build cache.
const BUILD_CMD =
	process.env.AVEN_SERVER_BUILD_CMD?.trim() ||
	`. "$HOME/.cargo/env" 2>/dev/null; set -e; cd ${SRC_DIR} && git fetch --all --tags --prune && git checkout --detach ${BUILD_TARGET} && cargo build --release --manifest-path libs/aven-node/Cargo.toml`

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

/** Stream a long-running command inside the Sprite (inherits stdio so cargo progress shows). */
function onSpriteStream(shellCmd: string) {
	return spawnSync('sprite', ['exec', '-s', SPRITE, '--', 'sh', '-lc', shellCmd], {
		stdio: 'inherit'
	})
}

if (WANT_BUILD) {
	console.log(
		`Rebuilding aven-node on Sprite "${SPRITE}" @ ${BUILD_TARGET} in ${SRC_DIR}\n` +
			'  (first build compiles RocksDB — can take several minutes; a dropped exec here means\n' +
			'   the binary may be stale — re-run, or set AVEN_SERVER_BUILD_CMD to a Sprite job).'
	)
	const built = onSpriteStream(BUILD_CMD)
	if (built.status !== 0) {
		console.error(`❌ remote aven-node build failed (exit ${built.status ?? 'signal'}).`)
		console.error(
			`   Inspect: sprite exec -s ${SPRITE} -- sh -lc 'cd ${SRC_DIR} && git log -1 --oneline'`
		)
		process.exit(1)
	}
	const chk = onSprite(['test', '-x', BIN])
	if (chk.status !== 0) {
		console.error(`❌ build reported success but ${BIN} is missing/not executable.`)
		process.exit(1)
	}
	console.log(`✅ aven-node rebuilt on the Sprite @ ${BUILD_TARGET}.`)
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
