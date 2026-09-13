#!/usr/bin/env python3
"""Exercise identity startup with the production dependency graph and real Compose."""
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from unittest.mock import patch
import uuid
import identity

repository = Path(__file__).resolve().parents[2]
template = repository / 'deploy/identity/docker-compose.yml'
environment = dict(os.environ)
for name in re.findall(r'\$\{([A-Z][A-Z0-9_]*):?\?', template.read_text()):
    environment[name] = 'fixture'
graph = json.loads(subprocess.check_output(
    ['docker', 'compose', '--file', str(template), '--profile', 'recovery', 'config', '--format', 'json'], env=environment))
image = 'alpine:3.22.3'
run = identity.archive.run
try:
    run(['docker', 'image', 'inspect', image])
except subprocess.CalledProcessError:
    run(['docker', 'pull', image])

for failed_service in (None, 'database-roles', 'migrate'):
    with tempfile.TemporaryDirectory(prefix='identity-compose-') as directory:
        root = Path(directory)
        source = root / 'input'; source.mkdir()
        platform = root / 'identity'; volume = root / 'volume'
        manifest = {'version': 1, 'sha': 'a' * 40, 'images': {'IDENTITY_IMAGE': image}}
        (source / 'release.json').write_text(json.dumps(manifest))
        (source / 'application-secrets.json').write_text(json.dumps({'version': 1, 'target': 'identity'}))
        config = {'name': 'aven-identity-proof-' + uuid.uuid4().hex[:12], 'services': {}}
        for name, service in graph['services'].items():
            one_shot = name in ('database-roles', 'migrate', 'restore')
            config['services'][name] = {
                'image': image, 'entrypoint': ['sh', '-c'],
                'command': ['exit 23' if name == failed_service else 'exit 0' if one_shot else 'sleep 600'],
                'depends_on': copy.deepcopy(service.get('depends_on', {})),
                'environment': {}, 'volumes': [], 'network_mode': 'none',
                'read_only': True, 'cap_drop': ['ALL'], 'pids_limit': 16,
                'mem_limit': '32m', 'stop_grace_period': '1s',
                **({'profiles': service['profiles']} if 'profiles' in service else {}),
                **({} if one_shot else {'healthcheck': {
                    'test': ['CMD', 'true'], 'interval': '100ms', 'timeout': '1s', 'retries': 10}}),
            }
        retained = []

        def write_platform(path, composition, *_):
            path.mkdir(exist_ok=True)
            (path / 'docker-compose.yml').write_text(json.dumps(composition))
            (path / 'release.json').write_text(json.dumps(manifest))

        def command(args):
            if args[:2] == ['docker', 'pull']:
                assert args[2:] == [image]
                return b''  # The fixture image was resolved before entering the test.
            return run(args)

        compose = ['docker', 'compose', '--project-directory', str(platform)]
        try:
            with patch.object(identity.os, 'geteuid', return_value=0), \
                 patch.object(identity.start.os, 'chown'), \
                 patch.object(identity.host, 'composition', return_value=config), \
                 patch.object(identity.host, 'configure_backup', side_effect=lambda value, *_: value), \
                 patch.object(identity.host, 'write_platform', side_effect=write_platform), \
                 patch.object(identity.archive, 'run', side_effect=command), \
                 patch.object(identity.archive, 'create', side_effect=lambda *_: retained.append(True)), \
                 patch.object(identity.host, 'own_archive'):
                try:
                    identity.deploy(source, platform, volume)
                except subprocess.CalledProcessError:
                    if failed_service is None:
                        raise
                else:
                    assert failed_service is None, 'failed initialization was accepted'
                    marker = volume / 'postgres/PG_VERSION'; marker.write_text('fixture-data')
                    health = volume / 'backups/public-status/health.json'; health.write_text('fixture-health')
                    identity.deploy(source, platform, volume)
                    assert marker.read_text() == 'fixture-data'
                    assert health.read_text() == 'fixture-health'
            ids = run([*compose, '--profile', 'backup', 'ps', '--all', '--quiet']).decode().split()
            states = {item['Config']['Labels']['com.docker.compose.service']: item['State']
                      for item in json.loads(run(['docker', 'inspect', *ids]))}
            assert states['database']['Health']['Status'] == 'healthy'
            if failed_service:
                assert not retained, 'failed initialization retained a successful release'
                assert states[failed_service]['ExitCode'] == 23
                assert states.get('identity', {}).get('StartedAt', '0001').startswith('0001')
                assert states.get('backup', {}).get('StartedAt', '0001').startswith('0001')
            else:
                assert len(retained) == 2
                assert states['database-roles']['ExitCode'] == states['migrate']['ExitCode'] == 0
                assert states['identity']['Health']['Status'] == states['backup']['Health']['Status'] == 'healthy'
        finally:
            if (platform / 'docker-compose.yml').exists():
                run([*compose, '--profile', 'backup', '--profile', 'recovery', 'down', '--volumes', '--remove-orphans'])

print('Real Compose identity startup passed: successful jobs, safe retries, role and migration failure gates.')
