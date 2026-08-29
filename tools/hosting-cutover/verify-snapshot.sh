#!/bin/sh
set -eu

data_root=${1:?usage: verify-snapshot.sh AVEN_DATA_ROOT}
snapshot="$data_root/static-sites/active-sites.json"

test -f "$snapshot"
node - "$data_root" "$snapshot" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const dataRoot = path.resolve(process.argv[2], 'static-sites')
const containerRoot = '/var/lib/aven/static-sites'
const snapshot = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
const site = snapshot.sites?.find((candidate) => candidate?.binding?.hostname === 'aven.ceo')
if (!site) throw new Error('snapshot has no aven.ceo binding')
const expected = path.resolve(containerRoot, 'bindings', site.binding.id, 'releases')
const release = path.resolve(site.root)
if (!release.startsWith(`${expected}${path.sep}`)) throw new Error('release escapes its binding root')
const mountedRelease = path.join(dataRoot, path.relative(containerRoot, release))
if (!fs.statSync(path.join(mountedRelease, 'index.html')).isFile())
	throw new Error('release has no index.html')
process.stdout.write(`${site.binding.hostname} -> ${release}\n`)
NODE

test -d "$data_root/caddy/data"
test -d "$data_root/caddy/config"
