-- Parameters: scope, snapshot, collection, category, search, source, sort, direction,
-- cursor sort value, cursor key, page size. All joins remain in the authorized scope.
WITH files AS MATERIALIZED (
 SELECT r.id, p.scope_sequence, p.committed_at, c.payload, c.blob_length,
        jsonb_build_object('artifactId',r.id,'typeKey',c.type_key,'typeVersion',c.type_version,
         'publicationId',r.publication_id,'publicationOrdinal',r.publication_ordinal,
         'scopeSequence',p.scope_sequence,'committedAt',p.committed_at,'localKey',r.local_key,
         'artifactSha256',c.artifact_sha256,'producerRunId',r.producer_run_id,
         'inputs',COALESCE((SELECT jsonb_agg(jsonb_build_object('artifactId',i.input_artifact_id,'role',i.role,'ordinal',i.ordinal)) FROM artifact_store.artifact_run_inputs i WHERE i.scope_id=$1 AND i.run_id=r.producer_run_id),'[]'::jsonb),
         'output',jsonb_build_object('role',r.output_role,'ordinal',r.output_ordinal),'runId',r.producer_run_id,'publicationKind',p.kind) AS artifact
 FROM artifact_store.artifact_contents c
 JOIN artifact_store.artifact_records r ON r.scope_id=c.scope_id AND r.id=c.artifact_id
 JOIN artifact_store.publications p ON p.scope_id=r.scope_id AND p.publication_id=r.publication_id
 WHERE c.scope_id=$1 AND c.type_key='core.file' AND p.scope_sequence<=$2
   AND ($6::uuid IS NULL OR r.id=$6)
   AND (NOT ($3='documents' AND $4='all' AND $5='' AND $7='date') OR $10::text IS NULL OR
    CASE WHEN $8='asc' THEN (to_jsonb(p.committed_at),r.id::text||'/document')>($9::jsonb,$10)
     ELSE (to_jsonb(p.committed_at),r.id::text||'/document')<($9::jsonb,$10) END)
 ORDER BY CASE WHEN $8='asc' THEN p.committed_at END ASC,
  CASE WHEN $8='desc' THEN p.committed_at END DESC,
  CASE WHEN $8='asc' THEN r.id END ASC, CASE WHEN $8='desc' THEN r.id END DESC
 LIMIT CASE WHEN $3='documents' AND $4='all' AND $5='' AND $7='date' THEN $11 ELSE NULL END
), unit_heads AS MATERIALIZED (
 SELECT DISTINCT ON (i.input_artifact_id) i.input_artifact_id AS source_id, COALESCE(c.payload->>'resolutionKey',r.publication_id::text) AS resolution_key
 FROM artifact_store.artifact_contents c
 JOIN artifact_store.artifact_records r ON r.scope_id=c.scope_id AND r.id=c.artifact_id
 JOIN artifact_store.artifact_run_inputs i ON i.scope_id=r.scope_id AND i.run_id=r.producer_run_id AND i.role='source'
 JOIN artifact_store.publications p ON p.scope_id=r.scope_id AND p.publication_id=r.publication_id
 WHERE c.scope_id=$1 AND c.type_key='core.document-unit' AND p.scope_sequence<=$2
  AND i.input_artifact_id IN (SELECT id FROM files)
 ORDER BY i.input_artifact_id,p.scope_sequence DESC
), units AS MATERIALIZED (
 SELECT h.source_id,r.id AS unit_id,c.payload AS unit
 FROM unit_heads h
 JOIN artifact_store.artifact_run_inputs i ON i.scope_id=$1 AND i.role='source' AND i.input_artifact_id=h.source_id
 JOIN artifact_store.artifact_records r ON r.scope_id=i.scope_id AND r.producer_run_id=i.run_id
 JOIN artifact_store.publications p ON p.scope_id=r.scope_id AND p.publication_id=r.publication_id AND p.scope_sequence<=$2
 JOIN artifact_store.artifact_contents c ON c.scope_id=r.scope_id AND c.artifact_id=r.id AND c.type_key='core.document-unit'
  AND COALESCE(c.payload->>'resolutionKey',r.publication_id::text)=h.resolution_key
), sources AS MATERIALIZED (
 SELECT f.*,u.unit_id,u.unit,COALESCE(u.unit_id,f.id) AS document_id,
  (SELECT count(*) FROM units n WHERE n.source_id=f.id) AS document_count
 FROM files f LEFT JOIN units u ON u.source_id=f.id AND $3<>'documents'
), validation_heads AS MATERIALIZED (
 SELECT DISTINCT ON (i.input_artifact_id,c.type_key) i.input_artifact_id AS source_id,c.type_key,
   r.producer_run_id,r.publication_id
 FROM artifact_store.artifact_contents c
 JOIN artifact_store.artifact_records r ON r.scope_id=c.scope_id AND r.id=c.artifact_id
 JOIN artifact_store.artifact_run_inputs i ON i.scope_id=r.scope_id AND i.run_id=r.producer_run_id AND i.role IN ('source','document')
 JOIN artifact_store.publications p ON p.scope_id=r.scope_id AND p.publication_id=r.publication_id
 WHERE c.scope_id=$1 AND c.type_key IN ('bookkeeping.invoice-validation','banking.statement-validation')
   AND p.scope_sequence<=$2 AND i.input_artifact_id IN (SELECT document_id FROM sources)
 ORDER BY i.input_artifact_id,c.type_key,p.scope_sequence DESC,r.publication_ordinal DESC,r.id
), documents AS (
 SELECT s.*, COALESCE(f.facts,'{}'::jsonb) || CASE WHEN s.unit IS NOT NULL THEN jsonb_build_object('core.document-classification',s.unit->'classification') ELSE '{}'::jsonb END AS facts, COALESCE(f.views,'[]'::jsonb) || COALESCE(mail.views,'[]'::jsonb) AS views
 FROM sources s LEFT JOIN LATERAL (
  SELECT jsonb_object_agg(type_key,payload) AS facts, jsonb_agg(metadata) AS views
  FROM (
   SELECT DISTINCT ON (c.type_key) c.type_key,
    CASE WHEN c.type_key IN ('docs.extracted-text','core.content-description') THEN '{}'::jsonb ELSE c.payload END AS payload,
    jsonb_build_object('artifactId',r.id,'typeKey',c.type_key,'typeVersion',c.type_version,
     'scopeSequence',p.scope_sequence,'publicationOrdinal',r.publication_ordinal,
     'publicationId',r.publication_id,'committedAt',p.committed_at,'localKey',r.local_key,
     'artifactSha256',c.artifact_sha256,'producerRunId',r.producer_run_id,
     'inputs','[]'::jsonb,'output',null,'runId',r.producer_run_id,'publicationKind','run') AS metadata
   FROM artifact_store.artifact_run_inputs i
   JOIN artifact_store.artifact_records r ON r.scope_id=i.scope_id AND r.producer_run_id=i.run_id
   JOIN artifact_store.artifact_contents c ON c.scope_id=r.scope_id AND c.artifact_id=r.id
   JOIN artifact_store.publications p ON p.scope_id=r.scope_id AND p.publication_id=r.publication_id
   WHERE i.scope_id=$1 AND i.input_artifact_id=s.id AND i.role='source' AND p.scope_sequence<=$2
    AND (NOT (s.unit_id IS NULL AND s.document_count>1 AND (c.type_key LIKE 'bookkeeping.%' OR c.type_key LIKE 'banking.%')))
    AND (s.unit_id IS NULL OR EXISTS (SELECT 1 FROM artifact_store.artifact_run_inputs ui
     WHERE ui.scope_id=$1 AND ui.run_id=r.producer_run_id AND ui.role='document' AND ui.input_artifact_id=s.unit_id))
    AND (c.type_key NOT IN ('bookkeeping.invoice-candidate','bookkeeping.invoice-details','banking.account-statement-candidate') OR EXISTS (
     SELECT 1 FROM validation_heads v WHERE v.source_id=s.document_id
      AND v.type_key=CASE WHEN c.type_key LIKE 'banking.%' THEN 'banking.statement-validation' ELSE 'bookkeeping.invoice-validation' END
      AND (v.publication_id=r.publication_id OR EXISTS (SELECT 1 FROM artifact_store.artifact_run_inputs vi
       WHERE vi.scope_id=$1 AND vi.run_id=v.producer_run_id AND vi.input_artifact_id=r.id))))
    AND c.type_key IN ('bookkeeping.invoice-candidate','bookkeeping.invoice-details',
     'bookkeeping.invoice-validation','banking.account-statement-candidate','banking.statement-validation',
     'core.document-classification','core.content-classification','core.content-description','docs.extracted-text','core.thumbnail','core.email')
   ORDER BY c.type_key,p.scope_sequence DESC,r.publication_ordinal DESC,r.id
  ) latest
 ) f ON true
 LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object('artifactId',r.id,'typeKey',c.type_key,'typeVersion',c.type_version,
   'publicationId',r.publication_id,'publicationOrdinal',r.publication_ordinal,'scopeSequence',p.scope_sequence,
   'committedAt',p.committed_at,'localKey',r.local_key,'producerRunId',r.producer_run_id,
   'inputs','[]'::jsonb,'output',null,'runId',r.producer_run_id,'publicationKind',p.kind)) AS views
  FROM artifact_store.artifact_run_inputs i
  JOIN artifact_store.artifact_records r ON r.scope_id=i.scope_id AND r.id=i.input_artifact_id
  JOIN artifact_store.artifact_contents c ON c.scope_id=r.scope_id AND c.artifact_id=r.id AND c.type_key='core.email'
  JOIN artifact_store.publications p ON p.scope_id=r.scope_id AND p.publication_id=r.publication_id AND p.scope_sequence<=$2
  WHERE i.scope_id=$1 AND i.run_id=(s.artifact->>'producerRunId')::uuid AND i.role='email'
 ) mail ON true
), facts AS (
 SELECT d.*, d.facts->'bookkeeping.invoice-candidate' AS invoice,
  d.facts->'bookkeeping.invoice-details' AS details,
  d.facts->'banking.account-statement-candidate' AS statement,
  CASE WHEN d.facts ? 'core.email' THEN 'email'
       WHEN d.facts ? 'banking.statement-validation' THEN 'statement'
       WHEN d.facts ? 'bookkeeping.invoice-validation' THEN COALESCE(d.facts#>>'{bookkeeping.invoice-details,documentKind}','invoice')
       WHEN d.unit IS NOT NULL THEN CASE WHEN d.unit#>>'{classification,resolvedKind}'='bank-statement' THEN 'statement' ELSE d.unit#>>'{classification,resolvedKind}' END
       ELSE COALESCE(d.facts#>>'{core.document-classification,resolvedKind}',
         d.facts#>>'{core.content-classification,primaryKind}','unknown') END AS category,
  CASE WHEN d.facts ? 'bookkeeping.invoice-validation' THEN
    CASE d.facts#>>'{bookkeeping.invoice-validation,status}' WHEN 'consistent' THEN 'checked' WHEN 'not-applicable' THEN 'unverified' ELSE 'review' END
   WHEN d.facts ? 'banking.statement-validation' THEN
    CASE d.facts#>>'{banking.statement-validation,status}' WHEN 'consistent' THEN 'checked' WHEN 'not-applicable' THEN 'unverified' ELSE 'review' END
   ELSE 'unverified' END AS status
 FROM documents d
), projected AS (
 SELECT f.*, v.row_key, v.artifact_type, v.data
 FROM facts f CROSS JOIN LATERAL (
  SELECT 'document'::text AS row_key, 'core.file'::text AS artifact_type,
   jsonb_build_object('name',f.payload->'originalName','mediaType',f.payload->'declaredMediaType',
    'size',f.blob_length,'date',f.committed_at,'category',f.category,'status',f.status,'documentCount',f.document_count) AS data WHERE $3='documents'
  UNION ALL
  SELECT 'unit','core.document-unit',jsonb_build_object('kind',f.category,'sector',f.unit#>'{classification,sector}',
   'reason',f.unit#>'{classification,reason}','pages',f.unit->'selectors','reference',f.unit->'reference','date',f.committed_at)
   WHERE $3='document-units' AND f.unit_id IS NOT NULL
  UNION ALL
  SELECT 'invoice','bookkeeping.invoice-details',
   (COALESCE(f.invoice,'{}'::jsonb) - 'chunkCoverage') || jsonb_build_object(
    'supplier',COALESCE(NULLIF(f.details#>'{supplier,name}','null'::jsonb),f.invoice->'supplier'),
    'issueDate',f.details->'issueDate','documentKind',f.category,'customerNumber',f.details->'customerNumber',
    'orderNumber',f.details->'orderNumber','category',f.details->'category',
    'amountPaidMinor',f.details#>'{payment,amountPaidMinor}',
    'totalOutstandingMinor',f.details#>'{payment,totalOutstandingMinor}')
   WHERE $3='invoices' AND f.facts ? 'bookkeeping.invoice-validation' AND f.facts#>>'{bookkeeping.invoice-validation,status}'<>'not-applicable'
  UNION ALL
  SELECT 'statement','banking.account-statement-candidate',f.statement - 'transactions' - 'chunkCoverage'
   WHERE $3='statements' AND f.facts ? 'banking.statement-validation'
  UNION ALL
  SELECT 'line-'||l.ordinality,'bookkeeping.invoice-details',l.value || jsonb_build_object(
   'invoiceNumber',f.invoice->'invoiceNumber','supplier',COALESCE(NULLIF(f.details#>'{supplier,name}','null'::jsonb),f.invoice->'supplier'),
   'currency',f.invoice->'currency','row',l.ordinality)
   FROM jsonb_array_elements(COALESCE(NULLIF(f.details->'lineItems','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY l
   WHERE $3='line-items' AND f.facts ? 'bookkeeping.invoice-validation'
  UNION ALL
  SELECT 'transaction-'||t.ordinality,'banking.account-statement-candidate',t.value || jsonb_build_object(
   'currency',f.statement->'currency','accountIban',f.statement->'accountIban','row',t.ordinality)
   FROM jsonb_array_elements(COALESCE(NULLIF(f.statement->'transactions','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY t
   WHERE $3='transactions' AND f.facts ? 'banking.statement-validation'

 ) v
 WHERE ($4='all' OR f.category=$4 OR ($3='documents' AND EXISTS (SELECT 1 FROM units u WHERE u.source_id=f.id AND u.unit#>>'{classification,resolvedKind}'=CASE WHEN $4='statement' THEN 'bank-statement' ELSE $4 END)) OR ($4='other' AND f.category NOT IN ('email','invoice','credit-note','receipt','statement','voucher','contract','contract-summary','transport-ticket','booking-confirmation','delivery-notification','unknown')))
), observation_rows AS (
 SELECT document_id::text||'/'||row_key AS key,
  COALESCE(CASE WHEN $7='date' THEN to_jsonb(committed_at)
   WHEN $7 IN ('unitPriceMinor','quantity','exchangeRate') AND (data->>$7) ~ '^-?[0-9]+([.][0-9]+)?$'
    THEN to_jsonb((data->>$7)::numeric)
   WHEN jsonb_typeof(data->$7)='string' THEN to_jsonb(left(data->>$7,512))
   ELSE data->$7 END,'null'::jsonb) AS sort_value,
  jsonb_build_object('key',document_id::text||'/'||row_key,'source',artifact,
   'name',payload->'originalName','mediaType',payload->'declaredMediaType','sizeBytes',blob_length,
   'category',category,'status',status,'artifactType',artifact_type,'data',data,
   'representations',views,'documentId',unit_id,'document',unit,'documentCount',document_count) AS item
 FROM projected

) , matching_rows AS (
 SELECT item,sort_value,key FROM observation_rows
 WHERE $5='' OR strpos(lower(COALESCE(item->>'name','')||' '||(item->'data')::text),lower($5))>0
)
SELECT item,sort_value,key FROM matching_rows
WHERE $10::text IS NULL OR
 CASE WHEN $8='asc' THEN (sort_value,key)>($9::jsonb,$10) ELSE (sort_value,key)<($9::jsonb,$10) END
ORDER BY CASE WHEN $8='asc' THEN sort_value END ASC, CASE WHEN $8='desc' THEN sort_value END DESC,
 CASE WHEN $8='asc' THEN key END ASC, CASE WHEN $8='desc' THEN key END DESC
LIMIT $11
