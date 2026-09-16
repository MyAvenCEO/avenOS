#!/usr/bin/env python3
"""Prove the pinned database image persists its cluster and rejects an older layout."""
from pathlib import Path
import subprocess
import time
import uuid

image = (Path(__file__).with_name('Dockerfile').read_text().splitlines()[0].split()[1])
name = 'aven-storage-' + uuid.uuid4().hex[:12]
volume = name + '-data'
old_volume = name + '-old'


def docker(*args, check=True):
    return subprocess.run(['docker', *args], check=check, capture_output=True, text=True, timeout=60)


def ready():
    for _ in range(40):
        if docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', check=False).returncode == 0:
            return
        time.sleep(0.5)
    raise AssertionError('Fresh database did not become ready')


try:
    for item in (volume, old_volume):
        docker('volume', 'create', item)
    docker('run', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=synthetic-only',
           '-v', volume + ':/var/lib/postgresql', image)
    ready()
    result = docker('exec', name, 'psql', '-U', 'postgres', '-Atc', 'SHOW data_directory').stdout.strip()
    assert result == '/var/lib/postgresql/18/docker', result
    docker('exec', name, 'psql', '-U', 'postgres', '-c',
           "CREATE TABLE persistence_proof (value text); INSERT INTO persistence_proof VALUES ('retained');")
    docker('restart', name)
    ready()
    assert docker('exec', name, 'psql', '-U', 'postgres', '-Atc',
                  'SELECT value FROM persistence_proof').stdout.strip() == 'retained'
    docker('run', '--rm', '--entrypoint', 'sh', '-v', old_volume + ':/var/lib/postgresql',
           image, '-c', 'echo 17 > /var/lib/postgresql/PG_VERSION')
    refused = docker('run', '--name', name + '-old', '-e', 'POSTGRES_PASSWORD=synthetic-only',
                     '-v', old_volume + ':/var/lib/postgresql', image, check=False)
    assert refused.returncode != 0 and 'pg_upgrade' in refused.stderr, refused.stderr
    original = docker('run', '--rm', '--entrypoint', 'sh', '-v', old_volume + ':/var/lib/postgresql',
                      image, '-c', 'cat /var/lib/postgresql/PG_VERSION; test ! -e /var/lib/postgresql/18/docker/PG_VERSION')
    assert original.stdout.strip() == '17'
    print('Database storage passed: PostgreSQL 18 placement, restart persistence, and older-cluster refusal.')
finally:
    docker('rm', '-f', '-v', name, name + '-old', check=False)
    for item in (volume, old_volume):
        docker('volume', 'rm', item, check=False)
