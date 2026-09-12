#!/usr/bin/env python3
"""Install the independent identity release and retain its recovery material."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import host
import rollout
import start
archive = host.archive


def deploy(source, platform, volume, recover=False):
    if os.geteuid() != 0:
        raise ValueError('Identity installation requires its target administrator')
    config = host.composition(source)
    manifest = json.loads(archive.private_file(source / 'release.json'))
    material = json.loads(archive.private_file(source / 'application-secrets.json'))
    if material['version'] != 1 or material['target'] != 'identity':
        raise ValueError('Application material belongs to another installation')
    for service in config['services'].values():
        if service['image'] not in manifest['images'].values():
            raise ValueError('Identity image differs from its verified release')
    lifecycle = volume / 'lifecycle'
    start.directory(lifecycle)
    with (lifecycle / '.deployment-lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if recover and ((platform / 'release.json').exists() or (volume / 'postgres/PG_VERSION').exists()):
            raise ValueError('Recovery requires a fresh database and installation')
        for image in sorted({service['image'] for service in config['services'].values()}):
            archive.run(['docker', 'pull', image])
        for name, uid in (('postgres', 70), ('backups', 65532), ('release-archive', 65532), ('caddy/data', 0), ('caddy/config', 0)):
            start.directory(volume / name, uid)
        start.directory(volume / 'backups/public-status', 65532)
        os.chmod(volume / 'backups/public-status', 0o755)
        config['services']['backup']['profiles'] = ['backup']
        config['services']['restore']['environment']['RESTORE_RELEASE_ID'] = manifest['sha']
        config = host.configure_backup(config, volume / 'release-archive', manifest['sha'])
        host.write_platform(platform, config, manifest, source)
        compose = ['docker', 'compose', '--project-directory', str(platform)]
        archive.run([*compose, 'up', '--detach', '--pull', 'never', '--wait', 'database-roles'])
        if recover:
            archive.run([*compose, '--profile', 'recovery', 'run', '--rm', 'restore'])
            archive.run([*compose, 'run', '--rm', 'database-roles'])
        archive.run([*compose, 'up', '--detach', '--pull', 'never', '--wait', '--wait-timeout', '240'])
        archive.create(platform, volume / 'release-archive', 'identity')
        host.own_archive(volume / 'release-archive')
        archive.run([*compose, '--profile', 'backup', 'up', '--detach', '--pull', 'never', '--wait', '--wait-timeout', '300', 'backup'])
        print('Identity release and encrypted recovery backup are ready.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--target', choices=['identity'], required=True)
    parser.add_argument('--platform', type=Path, default=Path('/opt/aven/identity'))
    parser.add_argument('--volume', type=Path, default=Path('/var/lib/aven'))
    parser.add_argument('--recover', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    deploy(args.source.absolute(), args.platform.absolute(), args.volume.absolute(), args.recover)
