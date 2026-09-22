SELECT item,sort_value,key FROM matching_rows
WHERE ($13::text IS NULL) AND ($10::text IS NULL OR
 CASE WHEN $8='asc' THEN (sort_value,key)>($9::jsonb,$10) ELSE (sort_value,key)<($9::jsonb,$10) END)
ORDER BY CASE WHEN $8='asc' THEN sort_value END ASC, CASE WHEN $8='desc' THEN sort_value END DESC,
 CASE WHEN $8='asc' THEN key END ASC, CASE WHEN $8='desc' THEN key END DESC
LIMIT $11
