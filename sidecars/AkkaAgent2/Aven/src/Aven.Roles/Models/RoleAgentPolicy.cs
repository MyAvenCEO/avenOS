namespace Aven.Roles.Models;

public sealed record RoleAgentPolicy(
    string RoleName,
    bool RequiresLlmCapability,
    bool AcceptsUntargetedDocuments,
    bool RequiresHumanClarificationWhenAmbiguous);
