#!/usr/bin/env python3
"""Reject inconsistent recovery boundaries before any application is admitted."""
import copy
import recover

customer = {'id': '2d762e16-0818-465a-afd2-b5115238513b', 'database_name': 'cust_2d762e160818465aafd2b5115238513b',
            'runtime_id': 'green', 'routing_generation': 4, 'movement_id': None}
identity = {'environment_id': customer['id'], 'routing_generation': 4}
identities = {('green', customer['database_name']): identity}
recover.validate_placement([customer], identities, {'primary', 'green'})
for mutation in ('missing-database', 'wrong-environment', 'older-generation', 'newer-generation', 'held-customer', 'missing-runtime'):
    customers, copies, runtimes = [copy.deepcopy(customer)], copy.deepcopy(identities), {'primary', 'green'}
    if mutation == 'missing-database': copies.clear()
    if mutation == 'wrong-environment': next(iter(copies.values()))['environment_id'] = 'another'
    if mutation == 'older-generation': next(iter(copies.values()))['routing_generation'] = 3
    if mutation == 'newer-generation': next(iter(copies.values()))['routing_generation'] = 5
    if mutation == 'held-customer': customers[0]['movement_id'] = 'unfinished'
    if mutation == 'missing-runtime': runtimes.remove('green')
    try: recover.validate_placement(customers, copies, runtimes)
    except ValueError: pass
    else: raise AssertionError('unsafe recovery admitted: '+mutation)
print('Recovery admission proof passed: missing, mismatched, newer, older and held customer copies remain closed.')

configs={'primary':{'services':{'backup':{'environment':{'RESTIC_REPOSITORY':'s3:https://old/next/platform','RESTIC_PASSWORD':'old','AWS_ACCESS_KEY_ID':'old','AWS_SECRET_ACCESS_KEY':'old','AWS_REGION':'old','AWS_DEFAULT_REGION':'old'}},'api':{'environment':{'LLM_GATEWAY_CREDENTIALS_JSON':'old-provider','DATABASE_URL':'keep-data-key'}}}}}
fresh=copy.deepcopy(configs['primary'])
fresh['services']['backup']['environment'].update(RESTIC_REPOSITORY='s3:https://new/next/platform', RESTIC_PASSWORD='new', AWS_ACCESS_KEY_ID='new', AWS_SECRET_ACCESS_KEY='new', AWS_REGION='new', AWS_DEFAULT_REGION='new')
fresh['services']['api']['environment'].update(LLM_GATEWAY_CREDENTIALS_JSON='new-provider', DATABASE_URL='must-not-replace')
recover.refresh_external_settings(configs,fresh)
assert configs['primary']['services']['backup']['environment']['RESTIC_REPOSITORY']=='s3:https://new/next/platform'
assert configs['primary']['services']['api']['environment']=={'LLM_GATEWAY_CREDENTIALS_JSON':'new-provider','DATABASE_URL':'keep-data-key'}
print('Recovery refreshes external credentials while preserving database material.')
