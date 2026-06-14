namespace Aven.Roles.Dynamic.Schemas;

public static class DynamicRoleSchemaCatalog
{
    public static string StepDecisionV1Json { get; } =
        """
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["status"],
          "properties": {
            "status": {
              "type": "string",
              "enum": ["continue", "complete", "ask_human", "await_input", "fail"]
            },
            "rationaleSummary": {
              "type": ["string", "null"],
              "description": "Short user-safe summary of why this next action is useful. Do not include hidden chain-of-thought."
            },
            "finalAnswer": {
              "type": ["string", "null"]
            },
            "failureReason": {
              "type": ["string", "null"]
            },
            "humanPrompt": {
              "type": ["string", "null"]
            },
            "action": {
              "type": ["object", "null"],
              "additionalProperties": false,
              "required": ["kind", "skillId"],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": ["callSkill"]
                },
                "skillId": {
                  "type": "string"
                },
                "input": {
                  "type": ["object", "null"],
                  "additionalProperties": true
                }
              }
            }
          }
        }
        """;

    public static IReadOnlyList<KeyValuePair<SchemaRef, string>> All { get; } =
    [
        new(DynamicRoleSchemaRefs.StepDecisionV1, StepDecisionV1Json)
    ];
}
