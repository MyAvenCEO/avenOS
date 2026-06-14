# Aven.Toolkit.Metadata

Portable metadata contracts and validation/query primitives extracted from Aven runtime.

- Runtime-independent metadata DTOs and query/validation primitives remain toolkit-owned.
- The old `InMemoryMetadataStore` helper was moved into `tests/Aven.Toolkit.Metadata.Tests` because it is test support, not production toolkit functionality.