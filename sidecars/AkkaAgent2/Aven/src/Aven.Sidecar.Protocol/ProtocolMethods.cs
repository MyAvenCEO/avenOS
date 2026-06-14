namespace Aven.Sidecar.Protocol;

/// <summary>
/// Methods frozen for the first integration slice (milestone plan M1, "Methods
/// frozen for first slice"; STDIO_RPC_SPEC.md §6-8). Dotted, domain-grouped names.
/// Do not rename these without a protocol version bump.
/// </summary>
public static class ProtocolMethods
{
    public const string SessionHello = "session.hello";
    public const string SessionPing = "session.ping";
    public const string SessionShutdown = "session.shutdown";

    public const string SkillsList = "skills.list";
    public const string RolesList = "roles.list";

    public const string AgentsCreate = "agents.create";
    public const string AgentsList = "agents.list";
    public const string AgentsGet = "agents.get";

    public const string MessagesSubmit = "messages.submit";

    /// <summary>
    /// Read the settled outcome of a turn for a routed agent (milestone plan M6 step 4 —
    /// bounded polling for the final reply until live events land in M8). Added after the
    /// M1 freeze, as M6 explicitly permits a dedicated run-result method.
    /// </summary>
    public const string MessagesResult = "messages.result";

    public const string HumanPromptsList = "humanPrompts.list";
    public const string HumanPromptsGet = "humanPrompts.get";
    public const string HumanPromptsAnswer = "humanPrompts.answer";
    public const string HumanPromptsCancel = "humanPrompts.cancel";
}

/// <summary>
/// Events frozen for the first integration slice (milestone plan M1, "Events frozen
/// for first slice"). Server-originated; best-effort live delivery (spec §9.2).
/// </summary>
public static class ProtocolEvents
{
    public const string RuntimeHealth = "runtime.health";

    public const string AgentRunStarted = "agent.run.started";
    public const string AgentMessageDelta = "agent.message.delta";
    public const string AgentMessageCompleted = "agent.message.completed";
    public const string AgentToolStarted = "agent.tool.started";
    public const string AgentToolCompleted = "agent.tool.completed";
    public const string AgentRunFailed = "agent.run.failed";

    public const string HumanPromptCreated = "humanPrompt.created";
    public const string HumanPromptResolved = "humanPrompt.resolved";
}
