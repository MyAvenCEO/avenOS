using Aven.Routing.Contracts.Schemas;

namespace Aven.Routing.Schemas;

public static class RoutingSchemaCatalog
{
    public static IReadOnlyList<KeyValuePair<SchemaRef, string>> All { get; } =
    [
        new(RoutingSchemaRefs.DecisionV1, """
        {
          "type": "object",
          "required": ["decision", "candidateRoleAgentIds", "reason"],
          "properties": {
            "decision": { "type": "string" },
            "candidateRoleAgentIds": { "type": "array" },
            "reason": { "type": "string" },
            "clarificationQuestion": { "type": "string" }
          }
        }
        """)
    ];
}