using System.Text.Json.Nodes;
using Aven.Api.Runtime;
using Aven.Sidecar;
using Aven.Sidecar.Protocol;
using Microsoft.Extensions.Configuration;

namespace Aven.Tests.Sidecar;

/// <summary>
/// In-process integration test: a real <see cref="RuntimeCompositionRoot"/> (temp SQLite,
/// no LLM provider) driven through <see cref="MethodDispatcher"/>. Proves the M2 method
/// surface returns structured envelopes and that messages.submit goes through the actor
/// submission path (it returns a structured submit outcome, not a bypassed shortcut).
/// </summary>
public sealed class DispatcherIntegrationTests : IAsyncLifetime
{
    private string _tempDir = string.Empty;
    private RuntimeCompositionRoot _runtime = null!;
    private MethodDispatcher _dispatcher = null!;

    public Task InitializeAsync()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "aven-sidecar-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Aven:Persistence:SqlitePath"] = Path.Combine(_tempDir, "runtime.sqlite"),
                ["Aven:Trace:SqlitePath"] = Path.Combine(_tempDir, "trace.sqlite"),
                ["Aven:Artifacts:BlobRoot"] = Path.Combine(_tempDir, "blobs"),
            })
            .Build();

        _runtime = new RuntimeCompositionRoot(config);
        _dispatcher = new MethodDispatcher(_runtime, startupError: null, new SidecarLogger(TextWriter.Null));
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await _runtime.DisposeAsync();
        try
        {
            Directory.Delete(_tempDir, recursive: true);
        }
        catch
        {
            // best effort temp cleanup
        }
    }

    private async Task<ProtocolEnvelope> Call(string method, JsonObject? @params = null)
    {
        var request = ProtocolEnvelope.Request($"t_{method}", method, @params);
        return await _dispatcher.DispatchAsync(request);
    }

    [Fact]
    public async Task Hello_ping_report_capabilities()
    {
        var hello = await Call(ProtocolMethods.SessionHello);
        Assert.NotNull(hello.Result);
        Assert.Equal(1, hello.Result!["protocolVersion"]!.GetValue<int>());
        Assert.Equal("akkaagent2-sidecar", hello.Result["server"]!["name"]!.GetValue<string>());

        var ping = await Call(ProtocolMethods.SessionPing);
        Assert.True(ping.Result!["ok"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Skills_roles_agents_lists_return_arrays()
    {
        var skills = await Call(ProtocolMethods.SkillsList);
        Assert.IsType<JsonArray>(skills.Result!["skills"]);

        var roles = await Call(ProtocolMethods.RolesList);
        Assert.IsType<JsonArray>(roles.Result!["roles"]);

        var agents = await Call(ProtocolMethods.AgentsList);
        Assert.IsType<JsonArray>(agents.Result!["agents"]);

        var prompts = await Call(ProtocolMethods.HumanPromptsList);
        Assert.IsType<JsonArray>(prompts.Result!["prompts"]);
    }

    [Fact]
    public async Task Agents_create_then_get_round_trips()
    {
        var create = await Call(ProtocolMethods.AgentsCreate, new JsonObject
        {
            ["roleAgentId"] = "agent-sidecar-test-1",
            ["roleName"] = "accountant",
            ["displayName"] = "Sidecar Test Agent",
            ["objective"] = "Exercise the sidecar dispatch path",
            ["responsibilityScope"] = "tests",
        });
        Assert.NotNull(create.Result);
        Assert.Equal("agent-sidecar-test-1", create.Result!["roleAgentId"]!.GetValue<string>());

        var get = await Call(ProtocolMethods.AgentsGet, new JsonObject { ["agentId"] = "agent-sidecar-test-1" });
        Assert.NotNull(get.Result);
        Assert.Equal("agent-sidecar-test-1", get.Result!["roleAgentId"]!.GetValue<string>());
    }

    [Fact]
    public async Task Agents_get_unknown_returns_structured_error()
    {
        var response = await Call(ProtocolMethods.AgentsGet, new JsonObject { ["agentId"] = "nope-does-not-exist" });
        Assert.Null(response.Result);
        Assert.NotNull(response.Error);
        Assert.Equal(ProtocolErrorCodes.AgentNotFound, response.Error!.Code);
    }

    [Fact]
    public async Task Unknown_method_returns_unknown_method_error()
    {
        var response = await Call("does.not.exist");
        Assert.NotNull(response.Error);
        Assert.Equal(ProtocolErrorCodes.UnknownMethod, response.Error!.Code);
    }

    [Fact]
    public async Task Missing_required_param_returns_invalid_params()
    {
        var response = await Call(ProtocolMethods.AgentsGet, new JsonObject());
        Assert.NotNull(response.Error);
        Assert.Equal(ProtocolErrorCodes.InvalidParams, response.Error!.Code);
    }

    [Fact]
    public async Task Messages_submit_returns_structured_status()
    {
        // Frontend AgentSubmitInput shape — must map to ApiMessageRequest and go through the
        // actor submission path, returning a structured outcome (not a protocol error).
        var response = await Call(ProtocolMethods.MessagesSubmit, new JsonObject
        {
            ["identityId"] = "spark-test",
            ["messageId"] = "ui-msg-1",
            ["replyId"] = "ui-reply-1",
            ["text"] = "Summarize my open tasks",
            ["sourceView"] = "talk",
            ["attachments"] = new JsonArray(),
        });

        Assert.Null(response.Error);
        Assert.NotNull(response.Result);
        var status = response.Result!["status"]!.GetValue<string>();
        Assert.Contains(status, new[] { "accepted", "clarification", "rejected", "conflict", "unknown" });
    }

    [Fact]
    public async Task Messages_result_returns_settlement_view_for_agent()
    {
        await Call(ProtocolMethods.AgentsCreate, new JsonObject
        {
            ["roleAgentId"] = "agent-result-1",
            ["roleName"] = "accountant",
            ["displayName"] = "Result Agent",
            ["objective"] = "settlement view test",
            ["responsibilityScope"] = "tests",
        });

        var response = await Call(ProtocolMethods.MessagesResult, new JsonObject { ["agentId"] = "agent-result-1" });

        Assert.Null(response.Error);
        Assert.NotNull(response.Result);
        Assert.Equal("agent-result-1", response.Result!["agentId"]!.GetValue<string>());
        // The settlement fields the frontend polls on are all present and well-typed.
        Assert.False(string.IsNullOrEmpty(response.Result["status"]!.GetValue<string>()));
        _ = response.Result["settled"]!.GetValue<bool>();
        Assert.True(response.Result["activeRuns"]!.GetValue<int>() >= 0);
        Assert.True(response.Result["pendingOperations"]!.GetValue<int>() >= 0);
    }

    [Fact]
    public async Task Messages_result_unknown_agent_returns_not_found()
    {
        var response = await Call(ProtocolMethods.MessagesResult, new JsonObject { ["agentId"] = "nope" });
        Assert.NotNull(response.Error);
        Assert.Equal(ProtocolErrorCodes.AgentNotFound, response.Error!.Code);
    }

    [Fact]
    public async Task Human_prompts_answer_unknown_returns_not_found()
    {
        var response = await Call(ProtocolMethods.HumanPromptsAnswer, new JsonObject
        {
            ["promptId"] = "missing-prompt",
            ["answer"] = "yes",
        });
        Assert.NotNull(response.Error);
        Assert.Equal(ProtocolErrorCodes.HumanPromptNotFound, response.Error!.Code);
    }
}
