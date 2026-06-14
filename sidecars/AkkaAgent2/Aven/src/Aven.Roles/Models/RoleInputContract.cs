namespace Aven.Roles.Models;

public sealed record RoleInputContract(
    string CommandType,
    string Summary,
    IReadOnlyList<SchemaRef> RequiredSchemas);
