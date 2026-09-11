#!/usr/bin/env python3
"""Verify identity restore ordering and refusal of partially populated targets."""
import json
from pathlib import Path
import tempfile
from unittest.mock import patch
import identity

for recovery in (False, True):
    with tempfile.TemporaryDirectory(prefix='identity-install-') as directory:
        root=Path(directory);source=root/'input';source.mkdir();platform=root/'identity';volume=root/'volume'
        image='registry.fixture/service@sha256:'+'b'*64
        (source/'release.json').write_text(json.dumps({'version':1,'sha':'a'*40,'images':{'IDENTITY_IMAGE':image}}))
        (source/'application-secrets.json').write_text(json.dumps({'version':1,'target':'identity','values':{}}))
        config={'services':{name:{'image':image,'environment':{},'volumes':[]} for name in ('database','database-roles','identity','backup','restore')}}
        calls=[]
        def mkdir(path, uid=0): path.mkdir(mode=0o700,parents=True,exist_ok=True)
        def write_platform(path, *_): path.mkdir();(path/'release.json').write_text('{}')
        with patch.object(identity.os,'geteuid',return_value=0), patch.object(identity.host,'composition',return_value=config), \
             patch.object(identity.start,'directory',side_effect=mkdir), patch.object(identity.host,'write_platform',side_effect=write_platform), \
             patch.object(identity.archive,'run',side_effect=lambda args:calls.append(args)), \
             patch.object(identity.archive,'create',side_effect=lambda *_:calls.append(['retain'])), patch.object(identity.host,'own_archive'):
            identity.deploy(source,platform,volume,recovery)
        retained=next(i for i,c in enumerate(calls) if c==['retain'])
        backup=next(i for i,c in enumerate(calls) if 'backup' in c and 'up' in c)
        assert retained<backup
        restores=[i for i,c in enumerate(calls) if 'run' in c and c[-1]=='restore']
        assert bool(restores)==recovery
        if recovery:
            assert restores[0]<next(i for i,c in enumerate(calls) if 'run' in c and c[-1]=='database-roles')<retained
        with patch.object(identity.os,'geteuid',return_value=0), patch.object(identity.host,'composition',return_value=config), \
             patch.object(identity.start,'directory',side_effect=mkdir), patch.object(identity.archive,'run') as commands:
            try:identity.deploy(source,platform,volume,True)
            except ValueError:pass
            else:raise AssertionError('recovery reused an existing identity installation')
            commands.assert_not_called()
print('Identity retains recovery material before backup, reconciles restored roles and refuses partial-target reuse.')
