namespace Aven.Roles.Dynamic.Models;

public sealed record DynamicRoleInputCommand(
    string RoleName,
    string CommandType,
    string Goal,
    string? ContentSummary,
    string? ProposedIntent,
    string? SourceItemRef,
    IReadOnlyList<string> AttachmentRefs,
    IReadOnlyList<SchemaRef> RequiredSchemas,
    string CorrelationId);
