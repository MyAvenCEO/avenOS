namespace Aven.Roles.Skills;

public static class SkillCatalog
{
    public const string LlmStructuredGenerate = ResourceOperationTypes.LlmStructuredGenerate;
    public const string MetadataQuery = ResourceOperationTypes.MetadataQuery;
    public const string ShellExecute = ResourceOperationTypes.ShellExecute;
    public const string HumanReview = "human.review";

    public static IReadOnlyList<SkillDefinition> All { get; } =
    [
        new(LlmStructuredGenerate, "Structured LLM generation", "Ask the LLM gateway for schema-validated structured JSON.", RoleHardness.Soft, ResourceKinds.Llm, ResourceOperationTypes.LlmStructuredGenerate),
        new(MetadataQuery, "Metadata query", "Read metadata records through the metadata gateway.", RoleHardness.Hard, ResourceKinds.Metadata, ResourceOperationTypes.MetadataQuery),
        new(ShellExecute, "Host shell", "Execute a bounded host shell command through the shell gateway. Prototype-only and intentionally unsafe.", RoleHardness.Soft, ResourceKinds.Shell, ResourceOperationTypes.ShellExecute),
        new(HumanReview, "Human review", "Ask a human for review or clarification.", RoleHardness.Hybrid, ResourceKinds.Human, ResourceOperationTypes.HumanApprove)
    ];

    public static IReadOnlyDictionary<string, SkillDefinition> ById { get; } =
        All.ToDictionary(static skill => skill.SkillId, StringComparer.OrdinalIgnoreCase);

    public static IReadOnlyList<string> DefaultDynamicSkillIds { get; } =
    [
        MetadataQuery,
        ShellExecute,
        HumanReview
    ];

    public static bool TryGet(string skillId, out SkillDefinition? skill) => ById.TryGetValue(skillId, out skill);
}
