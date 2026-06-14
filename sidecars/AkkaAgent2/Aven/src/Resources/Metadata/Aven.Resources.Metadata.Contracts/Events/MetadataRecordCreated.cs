namespace Aven.Resources.Metadata.Contracts.Events;

public sealed record MetadataRecordCreated(
    string RecordId,
    OperationKey Key,
    CorrelationId CorrelationId,
    string SubjectKind,
    string SubjectId,
    ArtifactId? ArtifactId,
    ArtifactRevisionId? ArtifactRevisionId,
    RoleAgentId? RoleAgentId,
    PromptId? PromptId,
    string? ExternalSourceId,
    SchemaRef SchemaRef,
    string Json,
    string PayloadHash,
    string? SourceSummary,
    DateTimeOffset CreatedAt) : IAvenEvent;
