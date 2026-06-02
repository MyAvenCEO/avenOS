## Clone boundary policy

`typed-actors` keeps defensive copies only at real boundaries:

- **Persistence boundary**: actors, envelopes, and events are copied when written to or read from persistence.
- **Runtime/actor API boundary**: actor state exposed through `ActorContext`, and values captured into queued effects, are copied so actor code cannot mutate committed runtime data after handing it off.
- **External IO/config boundary**: schema files, config documents, and tree summaries returned to callers may be copied before exposure.

Avoid additional subsystem-local cloning once a value is already inside runtime-owned state. In particular, actor implementation files should prefer passing plain values into the runtime and let runtime/persistence own copy isolation.