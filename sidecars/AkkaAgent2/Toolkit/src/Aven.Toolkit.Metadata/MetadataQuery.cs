namespace Aven.Toolkit.Metadata;

public record MetadataQuery(
    string? SubjectKind = null,
    string? SubjectId = null,
    SchemaRef? SchemaRef = null,
    int Limit = 50,
    TimeSpan? Timeout = null,
    IReadOnlyList<string>? SubjectKinds = null,
    IReadOnlyList<string>? SubjectIds = null,
    IReadOnlyList<SchemaRef>? SchemaRefs = null);
