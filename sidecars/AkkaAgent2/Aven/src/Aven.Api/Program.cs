using Aven.Api;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

var repoRoot = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "..", ".."));
builder.Configuration
    .AddJsonFile(Path.Combine(repoRoot, "appsettings.Local.json"), optional: true, reloadOnChange: false)
    .AddJsonFile(Path.Combine(repoRoot, "appsettings.OpenAI.local.json"), optional: true, reloadOnChange: false);

builder.Services.AddSingleton<RuntimeCompositionRoot>();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

var app = builder.Build();

app.UseDefaultFiles(new DefaultFilesOptions
{
    RequestPath = "/ui"
});
app.UseStaticFiles();

app.MapGet("/", () => Results.Ok(new { service = "aven-api", status = "ok" }));

app.MapGet("/api/skills", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.ListSkills()));

app.MapGet("/api/roles", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.ListRoleDefinitions()));

app.MapPost("/api/roles", (RoleDefinitionRequest request, RuntimeCompositionRoot runtime) =>
{
    var role = runtime.UpsertRoleDefinition(request);
    return Results.Created($"/api/roles/{role.RoleName}", role);
});

app.MapPost("/api/agents", (CreateAgentRequest request, RuntimeCompositionRoot runtime) =>
{
    var created = runtime.RegisterAgent(request);
    return Results.Created($"/api/agents/{created.RoleAgentId}", created);
});

app.MapGet("/api/agents", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.ListAgents()));

app.MapPost("/api/artifacts", async (HttpRequest request, RuntimeCompositionRoot runtime, CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
    {
        return Results.BadRequest(new { error = "multipart_form_required" });
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.FirstOrDefault();
    if (file is null)
    {
        return Results.BadRequest(new { error = "file_required" });
    }

    var uploaded = runtime.UploadArtifact(file);
    return Results.Created($"/api/artifacts/{uploaded.ArtifactId}", uploaded);
});

app.MapGet("/api/artifacts", (string? filenameContains, string? mimeType, string? sourceKind, int? limit, RuntimeCompositionRoot runtime) =>
    Results.Ok(runtime.QueryArtifacts(filenameContains, mimeType, sourceKind, limit)));

app.MapGet("/api/agents/{agentId}", (string agentId, RuntimeCompositionRoot runtime) =>
{
    var state = runtime.InspectAgent(agentId);
    return state is null ? Results.NotFound() : Results.Ok(state);
});

app.MapGet("/api/role-agents/{roleAgentId}/work-items", async (string roleAgentId, WorkItemStatus? status, int? limit, RuntimeCompositionRoot runtime, CancellationToken cancellationToken) =>
    Results.Ok(await runtime.ListRoleAgentWorkItemsAsync(roleAgentId, status, limit, cancellationToken)));

app.MapGet("/api/role-agents/{roleAgentId}/runs", async (string roleAgentId, string? workItemId, RunStatus? status, int? limit, RuntimeCompositionRoot runtime, CancellationToken cancellationToken) =>
    Results.Ok(await runtime.ListRoleAgentRunsAsync(roleAgentId, workItemId, status, limit, cancellationToken)));

app.MapGet("/api/role-agents/{roleAgentId}/operations", async (string roleAgentId, string? runId, OperationStatus? status, int? limit, RuntimeCompositionRoot runtime, CancellationToken cancellationToken) =>
    Results.Ok(await runtime.ListRoleAgentOperationsAsync(roleAgentId, runId, status, limit, cancellationToken)));

app.MapGet("/api/artifacts/{artifactId}", (string artifactId, RuntimeCompositionRoot runtime) =>
{
    var artifact = runtime.InspectArtifact(artifactId);
    return artifact is null ? Results.NotFound() : Results.Ok(artifact);
});

app.MapGet("/api/artifacts/{artifactId}/content", async (string artifactId, RuntimeCompositionRoot runtime, CancellationToken cancellationToken) =>
{
    var content = await runtime.GetArtifactContentAsync(artifactId, cancellationToken);
    return content is null
        ? Results.NotFound()
        : Results.File(content.Bytes, content.MimeType, content.Filename);
});

app.MapGet("/api/debug/artifacts/integrity", (bool? verifyBytes, RuntimeCompositionRoot runtime) =>
    Results.Ok(runtime.CheckArtifactIntegrity(verifyBytes ?? false)));

app.MapPost("/api/messages", (ApiMessageRequest request, RuntimeCompositionRoot runtime) =>
{
    var response = runtime.SubmitMessage(request);
    return response switch
    {
        SubmitMessageAccepted accepted => Results.Ok(accepted),
        SubmitMessageNeedsClarification clarification => Results.Ok(clarification),
        SubmitMessageConflict conflict => Results.Conflict(conflict),
        SubmitMessageRejected rejected => Results.BadRequest(rejected),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError)
    };
});

app.MapGet("/api/metadata", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.InspectMetadata()));

app.MapGet("/api/schemas", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.ListSchemas()));

app.MapGet("/api/schemas/detail", (string schemaRef, RuntimeCompositionRoot runtime) =>
{
    var schema = runtime.GetSchema(schemaRef);
    return schema is null ? Results.NotFound() : Results.Ok(schema);
});

app.MapPost("/api/schemas/validate", (SchemaValidateApiRequest request, RuntimeCompositionRoot runtime) =>
    Results.Ok(runtime.ValidateSchema(request.SchemaRef, request.Json)));

app.MapGet("/api/accounting/invoices", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.ListAccountingInvoices()));
app.MapGet("/api/accounting/account-statements", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.ListAccountingStatements()));
app.MapGet("/api/accounting/payment-matches", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.ListAccountingPaymentMatches()));
app.MapGet("/api/accounting/suppliers", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.ListAccountingSuppliers()));
app.MapGet("/api/accounting/suppliers/{supplierIdOrName}/spend", (string supplierIdOrName, string? period, RuntimeCompositionRoot runtime) => Results.Ok(runtime.GetAccountingSupplierSpend(supplierIdOrName, period)));
app.MapGet("/api/accounting/questions", (string query, RuntimeCompositionRoot runtime) => Results.Ok(runtime.AskAccountingQuestion(query)));


app.MapGet("/api/human/prompts", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.ListHumanPrompts()));

app.MapGet("/api/human/prompts/{promptId}", (string promptId, RuntimeCompositionRoot runtime) =>
{
    var prompt = runtime.GetHumanPrompt(promptId);
    return prompt is null ? Results.NotFound() : Results.Ok(prompt);
});

app.MapPost("/api/human/prompts/{promptId}/answer", (string promptId, HumanPromptAnswerRequest request, RuntimeCompositionRoot runtime) =>
{
    var response = runtime.AnswerHumanPrompt(promptId, request.Answer);
    return response switch
    {
        null => Results.NotFound(),
        HumanPromptAnswerAccepted accepted => Results.Ok(accepted),
        HumanPromptAnswerConflict conflict => Results.Conflict(conflict),
        HumanPromptAnswerRejected rejected => Results.BadRequest(rejected),
        HumanPromptOperationReplyUnavailable unavailable => Results.Conflict(unavailable),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError)
    };
});

app.MapPost("/api/human/prompts/{promptId}/cancel", (string promptId, HumanPromptCancelRequest request, RuntimeCompositionRoot runtime) =>
{
    var response = runtime.CancelHumanPrompt(promptId, request.Reason);
    return response switch
    {
        null => Results.NotFound(),
        HumanPromptCancellationAccepted accepted => Results.Ok(accepted),
        HumanPromptCancellationRejected rejected when string.Equals(rejected.Error.Code, "missing_cancel_reason", StringComparison.Ordinal) => Results.BadRequest(rejected),
        HumanPromptCancellationRejected rejected => Results.Conflict(rejected),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError)
    };
});

app.MapAvenDebugEndpoints();

app.MapGet("/api/debug/actor-tree", (RuntimeCompositionRoot runtime) => Results.Ok(runtime.CaptureActorTreeSnapshot()));

app.MapGet("/api/schedules/{scheduleId}", (string scheduleId, RuntimeCompositionRoot runtime) =>
{
    var schedule = runtime.InspectSchedule(scheduleId);
    return schedule is null ? Results.NotFound() : Results.Ok(schedule);
});

app.MapPost("/api/schedules/{scheduleId}/check-due", (string scheduleId, RuntimeCompositionRoot runtime) =>
{
    var reply = runtime.TriggerScheduleDue(scheduleId, DateTimeOffset.UtcNow);
    return Results.Ok(reply);
});

app.Run();

public partial class Program;

public sealed record SchemaValidateApiRequest(string SchemaRef, string Json);