SELECT count(*)
FROM "user"
WHERE id = :'selector' OR lower(email) = lower(:'selector');
