# Aven API facade (`api.aven.ceo`)

The facade connects the authenticated client to its current customer environment.
It owns bounded entitlement and placement records, not customer conversations,
documents, credentials or business data. `aven.id` remains the identity authority.

For interactive work it verifies the short-lived identity token, checks current
entitlement, membership, component readiness and placement, and signs a narrower
tenant grant. Destinations come from the operator-owned runtime directory; callers
cannot choose a database or forwarding URL. Downstream services independently
verify the original identity and component grant. Forwarded identity headers alone
never authorize work.

Input admission also creates a signed certificate for that exact requested turn.
The opt-in internal work control checks current policy, the accepted Intent turn
and its runner lease before exchanging that certificate for short-lived component
grants. It neither retains a login token nor fabricates a user identity.
Both paths use the same imported signing key. Work verification derives its public
key from that already-imported key, including when environment configuration encodes
PEM newlines as `\n`; it does not parse the raw configuration a second time.

Background discovery uses a different signed placement, with no user or session.
Only the configured service credential for the requested runtime/component can
obtain its bounded placement pages. A placement locates a component queue; it
cannot authorize a tool or serve as a tenant or work grant. Customer-local physical
generation and execution checks still apply. The unattended dispatcher, full server
tool host and native handoff are not enabled yet.

[Build and test](../../docs/operations/build-and-test.md#live-studio-workday) owns
internal work configuration and the isolated real-model proofs. The
[customer-data system map](../../docs/customer-database-system-map.md) distinguishes
these service boundaries from the remaining background-execution integration.
