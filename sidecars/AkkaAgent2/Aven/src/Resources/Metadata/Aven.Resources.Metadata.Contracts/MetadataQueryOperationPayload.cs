namespace Aven.Resources.Metadata.Contracts;

public sealed record MetadataQueryOperationPayload(
    string RequestId,
    IReadOnlyList<string>? SubjectKinds = null,
    IReadOnlyList<string>? SubjectIds = null,
    IReadOnlyList<SchemaRef>? SchemaRefs = null,
    int Limit = 200,
    int TimeoutMilliseconds = 1000,
    string? CapabilityId = null);
