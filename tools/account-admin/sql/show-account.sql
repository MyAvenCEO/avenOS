SELECT id, email, name, role, email_verified, created_at
FROM "user"
WHERE id = :'selector' OR lower(email) = lower(:'selector')
ORDER BY id;
