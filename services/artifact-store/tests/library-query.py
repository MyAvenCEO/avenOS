"""Synthetic SQL projection regression. Disposable PostgreSQL only; no customer files.
Run: python3 services/artifact-store/tests/library-query.py
"""
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
STORE = ROOT / 'services/artifact-store'
NAME = f'aven-library-test-{os.getpid()}'
SCOPE = str(uuid.UUID(int=10000000))
OTHER = str(uuid.UUID(int=20000000))

def docker(*args, input=None):
    result = subprocess.run(['docker', *args], input=input, text=True, capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()

def sql(text):
    return docker('exec', '-i', '-e', 'PGPASSWORD=synthetic-only', NAME, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t', input=text)

def literal(value):
    if value is None: return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"

def uid(value): return str(uuid.UUID(int=value))

sequence = 0
statements = []
def artifact(kind, payload, source=None, inputs=None, scope=SCOPE, publication=None, document=None, source_role="source"):
    global sequence
    sequence += 1
    ident = uid(sequence)
    pub = publication or ident
    run = (publication or ident) if source else None
    if not publication:
        publication_kind = literal('run' if source else 'roots')
        source_parameters = 'NULL' if source else literal('{}')
        statements.append(f"INSERT INTO artifact_store.publications VALUES ({literal(scope)},{literal(pub)},{sequence},{literal(uid(999999))},1,{publication_kind},'fixture','fixture',{source_parameters},'{('a'*64)}','{{}}',{literal(run)},'2026-01-01T00:00:00Z');")
        if source:
            statements.append(f"INSERT INTO artifact_store.production_runs VALUES ({literal(run)},{literal(scope)},{literal(pub)},'synthetic','1','{{}}','{{}}','{{}}','{{}}','{{}}',now());")
            for n, item in enumerate([source, *(inputs or [])]):
                statements.append(f"INSERT INTO artifact_store.artifact_run_inputs VALUES ({literal(scope)},{literal(run)},{literal(source_role if n==0 else 'input')},{n},{literal(item)});")
    if document and not publication:
        statements.append(f"INSERT INTO artifact_store.artifact_run_inputs VALUES ({literal(scope)},{literal(run)},'document',0,{literal(document)});")
    statements.append(f"INSERT INTO artifact_store.artifact_records VALUES ({literal(ident)},{literal(scope)},{literal(pub)},{sequence if publication else 0},{literal(kind+'-'+str(sequence))},{literal(run)},{literal('output' if source else None)},{str(sequence) if source else 'NULL'},now());")
    statements.append(f"INSERT INTO artifact_store.artifact_contents VALUES ({literal(ident)},{literal(scope)},{literal(kind)},1,'{('b'*64)}',{literal(json.dumps(payload))},NULL,NULL,'{('c'*64)}');")
    return ident

def query(collection='documents', category='all', search='', after=None, sort='date', direction='desc', scope=SCOPE, snapshot=None, source=None, limit=50):
    source_sql = STORE/'crates/postgres/src'/'library.sql'
    params=[scope,snapshot if snapshot is not None else sequence,collection,category,search,source,sort,direction,json.dumps(after[0]) if after else None,after[1] if after else None,limit]
    result=sql('PREPARE library(uuid,bigint,text,text,text,uuid,text,text,jsonb,text,bigint) AS '+source_sql.read_text()+';\nEXECUTE library('+','.join(literal(p) for p in params)+');')
    return [(json.loads(parts[0]),json.loads(parts[1]),parts[2]) for line in result.splitlines() if len(parts:=line.split('\t'))==3]

try:
    docker('run','--rm','-d','--name',NAME,'-e','POSTGRES_PASSWORD=synthetic-only','postgres:17-alpine')
    for _ in range(150):
        try: sql('SELECT 1'); break
        except RuntimeError: time.sleep(.2)
    sql('CREATE SCHEMA artifact_store;'+(STORE/'crates/postgres/migrations/0001_core.sql').read_text()+(STORE/'crates/postgres/migrations/0004_library_indexes.sql').read_text())
    sql(f"INSERT INTO artifact_store.artifact_scopes VALUES ('{SCOPE}',0),('{OTHER}',0);")
    types=['core.file','bookkeeping.invoice-candidate','bookkeeping.invoice-details','bookkeeping.invoice-validation','banking.account-statement-candidate','banking.statement-validation','core.document-classification','core.document-unit','core.thumbnail','core.email']
    sql(''.join(f"INSERT INTO artifact_store.artifact_type_versions VALUES ('{kind}',1,'synthetic','{{}}','forbidden','[]','{'b'*64}',now());" for kind in types))
    source=artifact('core.file',{'originalName':'Synthetic hosting invoice.pdf','declaredMediaType':'application/pdf'})
    old=artifact('bookkeeping.invoice-candidate',{'supplier':'Old extraction','invoiceNumber':'OLD','currency':'EUR','grossMinor':99999},source)
    candidate=artifact('bookkeeping.invoice-candidate',{'supplier':'Example Hosting','invoiceNumber':'INV-001','currency':'EUR','netMinor':1000,'taxMinor':190,'grossMinor':1190},source)
    details=artifact('bookkeeping.invoice-details',{'documentKind':'invoice','supplier':{'name':'Example Hosting','street':'Example Street 1','city':'Test City','contactName':'Alex Example','bankingAccounts':[{'iban':'DE00000000000000000000','bic':'EXAMPLE','bankName':'Test Bank'}]},'buyer':{'name':'Sample Buyer'},'lineItems':[{'description':'Hosting','netMinor':1000,'grossMinor':1190,'quantity':'1','unitPriceMinor':'1000'}],'payment':{}},source)
    artifact('bookkeeping.invoice-validation',{'status':'consistent'},source,[candidate,details])
    # A newer page observation is not a new validated invoice.
    artifact('bookkeeping.invoice-candidate',{'supplier':'Wrong page fragment','grossMinor':999999},source)
    artifact('bookkeeping.invoice-details',{'supplier':{'name':'Wrong page fragment'},'lineItems':[]},source)
    statement_source=artifact('core.file',{'originalName':'Synthetic statement.pdf','declaredMediaType':'application/pdf'})
    statement=artifact('banking.account-statement-candidate',{'accountHolder':'Example Holder','accountIban':'DE11111111111111111111','institution':{'name':'Synthetic Bank'},'currency':'EUR','transactions':[{'counterpartyName':'Example Hosting','amountMinor':-1190,'bookingDate':'2026-01-01','description':'INV-001'}]},statement_source)
    artifact('banking.statement-validation',{'status':'inconsistent'},statement_source,[statement])
    mail_source=artifact('core.file',{'originalName':'Synthetic mail attachment.txt','declaredMediaType':'text/plain'})
    artifact('core.email',{'subject':'Synthetic message'},mail_source)
    artifact('core.file',{'originalName':'Other tenant secret.pdf'},scope=OTHER)
    sql('BEGIN;'+''.join(statements)+'COMMIT;');statements=[]
    invoice=query('invoices')
    assert len(invoice)==1 and invoice[0][0]['data']['grossMinor']==1190
    assert invoice[0][0]['data']['supplier']=='Example Hosting'
    assert invoice[0][0]['status']=='checked'
    assert len(query(category='invoice'))==1 and len(query(category='statement'))==1
    assert len(query(category='email'))==1 and not query(category='other')
    assert len(query('statements'))==1 and query('statements')[0][0]['status']=='review'
    assert query('transactions')[0][0]['data']['amountMinor']==-1190
    assert query('line-items')[0][0]['data']['netMinor']==1000
    assert not query(search='Other tenant secret')
    assert len(query(scope=OTHER))==1
    frozen=sequence
    first=query(limit=1)
    second=query(limit=1,after=(first[-1][1],first[-1][2]))
    assert first[0][0]['key']!=second[0][0]['key']
    artifact('core.file',{'originalName':'After snapshot.pdf'})
    sql('BEGIN;'+''.join(statements)+'COMMIT;');statements=[]
    assert not query(search='After snapshot',snapshot=frozen)
    assert len(query(search='After snapshot'))==1
    assert query('invoices',sort='grossMinor',direction='asc')[0][0]['data']['grossMinor']==1190
    # Atomic human corrections can produce candidate, details and validation together.
    corrected=artifact('bookkeeping.invoice-candidate',{'supplier':'Corrected supplier','invoiceNumber':'INV-001','currency':'EUR','grossMinor':1250},source,[candidate,details])
    artifact('bookkeeping.invoice-details',{'supplier':{'name':None,'bankingAccounts':None},'lineItems':[]},source,publication=corrected)
    artifact('bookkeeping.invoice-validation',{'status':'consistent'},source,publication=corrected)
    sql('BEGIN;'+''.join(statements)+'COMMIT;');statements=[]
    assert query('invoices')[0][0]['data']['grossMinor']==1250
    assert query('invoices')[0][0]['data']['supplier']=='Corrected supplier'
    assert query('invoices',snapshot=frozen)[0][0]['data']['grossMinor']==1190
    # Separate validated documents stay separate even when extracted names match.
    second_source=artifact('core.file',{'originalName':'Second hosting invoice.pdf','declaredMediaType':'application/pdf'})
    second_candidate=artifact('bookkeeping.invoice-candidate',{'supplier':'Corrected supplier','invoiceNumber':'INV-002','grossMinor':500,'currency':'EUR'},second_source)
    second_details=artifact('bookkeeping.invoice-details',{'supplier':{'name':'Corrected supplier'},'lineItems':[]},second_source)
    artifact('bookkeeping.invoice-validation',{'status':'consistent'},second_source,[second_candidate,second_details])
    sql('BEGIN;'+''.join(statements)+'COMMIT;');statements=[]
    invoice_rows=query('invoices')
    assert len(invoice_rows)==2 and {item[0]['source']['artifactId'] for item in invoice_rows}=={source,second_source}
    # Sources beyond the old 2,000-artifact tail remain searchable. No blob reads.
    for n in range(5000): artifact('core.file',{'originalName':f'Synthetic scale {n:05}.txt','declaredMediaType':'text/plain'})
    sql('BEGIN;'+''.join(statements)+'COMMIT;');statements=[]
    sql('ANALYZE;')
    start=time.monotonic(); batch=query(); elapsed=time.monotonic()-start
    assert len(batch)==50
    assert len(query(search='Synthetic scale 00001'))==1
    assert len(query(search='Synthetic hosting'))==1
    print(json.dumps({'passed':True,'syntheticDocuments':5000+9,'pageSize':len(batch),'firstPageSeconds':round(elapsed,3),'tenantIsolation':True,'validatedRevisionSelection':True}))
finally:
    subprocess.run(['docker','rm','-f',NAME],capture_output=True)
