namespace Aven.Roles.Models;

public sealed record RoleOutputContract(
    string ResultType,
    IReadOnlyList<SchemaRef> ProducedSchemas,
    bool MayScheduleWork,
    bool MayPromptHuman);
