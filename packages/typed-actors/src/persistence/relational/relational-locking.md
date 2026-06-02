# Relational Locking Notes

Relational adapters must lock by actor identity rather than only by envelope identity.

Acceptable approaches include:

- locking the target actor row before claiming an envelope;
- using an `actor_locks` table keyed by `actor_id`;
- using database-specific row locks;
- for SQLite, using transaction mode plus conditional updates.