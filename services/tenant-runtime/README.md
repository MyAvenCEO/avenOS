# Tenant Runtime Rail

`aven-tenant-runtime` contains the service-neutral mechanics shared by Rust tenant
workers. It deliberately does not abstract domain repositories or engines.

The crate provides:

- authenticated tenant-directory refresh and binding validation;
- bounded, lazy per-tenant runtime pools;
- fair round-robin background ticks and fail-closed readiness accounting;
- the standard component provisioner HTTP contract;
- tenant database URL, routing-header, bearer, environment, and listener helpers.

Consumers supply a `TenantRuntimeFactory` for opening their domain runtime, a
`ManagedTenantRuntime` implementation for one background tick, and a
`ProvisionerAdapter` for domain migrations and scope registration.
