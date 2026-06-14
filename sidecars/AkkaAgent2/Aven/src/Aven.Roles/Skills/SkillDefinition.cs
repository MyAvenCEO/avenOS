namespace Aven.Roles.Skills;

public sealed record SkillDefinition(
    string SkillId,
    string DisplayName,
    string Description,
    RoleHardness Hardness,
    string ResourceKind,
    string OperationType,
    SchemaRef? InputSchema = null,
    SchemaRef? OutputSchema = null,
    bool MutatesState = false);
