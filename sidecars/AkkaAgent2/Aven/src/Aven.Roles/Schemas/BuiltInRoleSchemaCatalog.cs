namespace Aven.Roles.Schemas;

public static class BuiltInRoleSchemaCatalog
{
    public static IReadOnlyList<KeyValuePair<SchemaRef, string>> All { get; } =
    [
        ..Aven.Roles.Accounting.Schemas.AccountingSchemaCatalog.All,
        ..Aven.Roles.Dynamic.Schemas.DynamicRoleSchemaCatalog.All,
        new(new SchemaRef("schema://contracts/contract-summary@1"), "{\"type\":\"object\",\"required\":[\"contractId\"],\"properties\":{\"contractId\":{\"type\":\"string\"},\"renewalDate\":{\"type\":\"string\"},\"reminderText\":{\"type\":\"string\"},\"renewalTermJson\":{}}}"),
        new(new SchemaRef("schema://contracts/obligation@1"), "{\"type\":\"object\",\"required\":[\"contractId\"],\"properties\":{\"contractId\":{\"type\":\"string\"}}}"),
        new(new SchemaRef("schema://contracts/renewal-term@1"), "{\"type\":\"object\",\"required\":[\"contractId\"],\"properties\":{\"contractId\":{\"type\":\"string\"},\"renewalDate\":{\"type\":\"string\"}}}"),
        new(new SchemaRef("schema://research/document-summary@1"), "{\"type\":\"object\",\"required\":[\"paperId\",\"topic\"],\"properties\":{\"paperId\":{\"type\":\"string\"},\"topic\":{\"type\":\"string\"},\"summary\":{\"type\":\"string\"},\"digestDueAt\":{\"type\":\"string\"}}}"),
        new(new SchemaRef("schema://research/digest@1"), "{\"type\":\"object\",\"required\":[\"paperId\",\"topic\",\"digest\"],\"properties\":{\"paperId\":{\"type\":\"string\"},\"topic\":{\"type\":\"string\"},\"digest\":{\"type\":\"string\"}}}"),
        new(new SchemaRef("schema://contracts/reminder-fired@1"), "{\"type\":\"object\",\"required\":[\"contractId\",\"reminderText\",\"dueAt\",\"summary\"],\"properties\":{\"contractId\":{\"type\":\"string\"},\"reminderText\":{\"type\":\"string\"},\"dueAt\":{\"type\":\"string\"},\"summary\":{\"type\":\"string\"}}}")
    ];
}