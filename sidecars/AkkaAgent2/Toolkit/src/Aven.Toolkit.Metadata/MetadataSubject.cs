namespace Aven.Toolkit.Metadata;

public record MetadataSubject(
    string Kind,
    string Id,
    ArtifactId? ArtifactId = null,
    ArtifactRevisionId? ArtifactRevisionId = null,
    RoleAgentId? RoleAgentId = null,
    PromptId? PromptId = null,
    string? ExternalSourceId = null);
