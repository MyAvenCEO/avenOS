, measured AS (
 SELECT item, CASE WHEN $13::text IS NOT NULL THEN NULLIF(item#>>'{data,currency}','') ELSE NULL END AS currency,
  CASE WHEN $13::text IS NOT NULL AND (item->'data'->>$13) ~ '^-?[0-9]{1,128}$' THEN (item->'data'->>$13)::numeric ELSE NULL END AS amount
 FROM matching_rows
)
SELECT jsonb_build_object(
 'currency',currency,
 'count',count(*)::text,
 'checkedCount',count(*) FILTER (WHERE item->>'status'='checked')::text,
 'reviewCount',count(*) FILTER (WHERE item->>'status'='review')::text,
 'knownAmountCount',count(amount)::text,
 'unknownAmountCount',count(*) FILTER (WHERE $13::text IS NOT NULL AND amount IS NULL)::text,
 'sumMinor',CASE WHEN currency ~ '^[A-Z]{3}$' THEN sum(amount)::text ELSE NULL END
) AS item
FROM measured
GROUP BY currency
ORDER BY 1
