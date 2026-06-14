# Aven.Resources.Runtime

Shared resource-runtime kernel.

## Responsibilities

- Provide `ResourceGatewayRail` for gateway admission/intent/terminal protocol plumbing.
- Provide the resource-operation inbox store and recovery messages.
- Provide the `IAvenResourceModule` composition contract.

## Non-responsibilities

- Concrete resource gateways.
- Concrete resource workers.
- Concrete resource modules.
- Provider/store/shell/schema execution work.

Those belong to the resource-specific assemblies:

```text
Aven.Resources.Artifacts
Aven.Resources.Metadata
Aven.Resources.Llm
Aven.Resources.Human
Aven.Resources.Shell
Aven.Scheduling
```

Gateways authorize, record, and dispatch only. Resource-specific workers execute reads/queries/provider calls/shell commands, and singleton writer actors serialize writes.
