using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Aven.Tests.E2E;

public sealed partial class Phase27ApiProductPathTests
{
    [Fact]
    public async Task Api_RoleAgentLedgerEndpoints_ListWorkItemsRunsAndOperations()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_phase28_ledger_1",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new
                {
                    content = new object[]
                    {
                        new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-TRACE-1", 125.50m) }
                    }
                }
            },
            usage = new { input_tokens = 12, output_tokens = 8, total_tokens = 20 }
        });

        var client = CreateClient(providerResponses, out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-ledger-api",
            roleName = "accountant",
            displayName = "Accountant",
            objective = "Handle invoices and statements",
            responsibilityScope = "Accounting documents",
            acceptedInputTypes = new[] { "pdf", "image" },
            primarySchemas = new[] { "schema://accounting/invoice@3" },
            routingDescription = "Routes invoices and statements"
        });
        Assert.Equal(HttpStatusCode.Created, createAgentResponse.StatusCode);

        var artifactId = await UploadFixtureAsync(client, "invoice-en.pdf", "application/pdf");
        var messageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase28-ledger-endpoints",
            incomingItemRef = artifactId,
            inputType = "pdf",
            attachmentRefs = new[] { artifactId },
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });
        Assert.Equal(HttpStatusCode.OK, messageResponse.StatusCode);

        _ = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-TRACE-1");

        JsonElement workItems = default;
        JsonElement runs = default;
        JsonElement operations = default;
        var observed = false;
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var workItemsResponse = await client.GetAsync("/api/role-agents/agent-accountant-ledger-api/work-items");
            var runsResponse = await client.GetAsync("/api/role-agents/agent-accountant-ledger-api/runs");
            var operationsResponse = await client.GetAsync("/api/role-agents/agent-accountant-ledger-api/operations");

            Assert.Equal(HttpStatusCode.OK, workItemsResponse.StatusCode);
            Assert.Equal(HttpStatusCode.OK, runsResponse.StatusCode);
            Assert.Equal(HttpStatusCode.OK, operationsResponse.StatusCode);

            workItems = await workItemsResponse.Content.ReadFromJsonAsync<JsonElement>();
            runs = await runsResponse.Content.ReadFromJsonAsync<JsonElement>();
            operations = await operationsResponse.Content.ReadFromJsonAsync<JsonElement>();

            if (workItems.EnumerateArray().Any() && runs.EnumerateArray().Any() && operations.EnumerateArray().Any())
            {
                observed = true;
                break;
            }

            await Task.Delay(100);
        }

        Assert.True(observed, "Expected role-agent ledger endpoints to expose at least one work item, run, and operation.");
    }

    [Fact]
    public async Task Api_ArtifactQuery_FiltersUploadedArtifacts()
    {
        var client = CreateClient(new Queue<object>(), out _);

        var invoiceArtifactId = await UploadFixtureAsAsync(client, fixtureName: "invoice-en.pdf", uploadedFilename: "invoice-phase28.pdf", mimeType: "application/pdf");
        var textArtifactId = await UploadFixtureAsAsync(client, fixtureName: "contract-de.pdf", uploadedFilename: "notes-phase28.txt", mimeType: "text/plain");

        var filenameResponse = await client.GetAsync("/api/artifacts?filenameContains=invoice-phase28");
        var mimeResponse = await client.GetAsync("/api/artifacts?mimeType=text/plain");
        var sourceKindResponse = await client.GetAsync("/api/artifacts?sourceKind=upload");

        Assert.Equal(HttpStatusCode.OK, filenameResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, mimeResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, sourceKindResponse.StatusCode);

        var filenameJson = await filenameResponse.Content.ReadFromJsonAsync<JsonElement>();
        var mimeJson = await mimeResponse.Content.ReadFromJsonAsync<JsonElement>();
        var sourceKindJson = await sourceKindResponse.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Contains(filenameJson.EnumerateArray(), x => x.GetProperty("artifactId").GetProperty("value").GetString() == invoiceArtifactId);
        Assert.Contains(mimeJson.EnumerateArray(), x => x.GetProperty("artifactId").GetProperty("value").GetString() == textArtifactId);
        Assert.True(sourceKindJson.EnumerateArray().Count() >= 2);
        Assert.All(sourceKindJson.EnumerateArray(), x => Assert.Equal("upload", x.GetProperty("sourceKind").GetString()));
    }

    [Fact]
    public async Task Api_ArtifactIntegrityEndpoint_ReportsHealthyUploadedArtifacts()
    {
        var dataRoot = Path.Combine(Path.GetTempPath(), $"aven-phase28-integrity-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dataRoot);

        try
        {
            var client = CreateClient(
                new Queue<object>(),
                out _,
                new Dictionary<string, string?>
                {
                    ["Aven:Persistence:SqlitePath"] = Path.Combine(dataRoot, "aven.sqlite"),
                    ["Aven:Trace:SqlitePath"] = Path.Combine(dataRoot, "aven.trace.sqlite"),
                    ["Aven:Artifacts:BlobRoot"] = Path.Combine(dataRoot, "artifact-blobs")
                });

            _ = await UploadFixtureAsync(client, "invoice-en.pdf", "application/pdf");

            var cheapResponse = await client.GetAsync("/api/debug/artifacts/integrity");
            var verifyResponse = await client.GetAsync("/api/debug/artifacts/integrity?verifyBytes=true");

            Assert.Equal(HttpStatusCode.OK, cheapResponse.StatusCode);
            Assert.Equal(HttpStatusCode.OK, verifyResponse.StatusCode);

            var cheapJson = await cheapResponse.Content.ReadFromJsonAsync<JsonElement>();
            var verifyJson = await verifyResponse.Content.ReadFromJsonAsync<JsonElement>();

            Assert.True(cheapJson.GetProperty("healthy").GetBoolean());
            Assert.False(cheapJson.GetProperty("verifyBytes").GetBoolean());
            Assert.True(cheapJson.GetProperty("artifactCount").GetInt32() >= 1);
            Assert.True(cheapJson.GetProperty("revisionCount").GetInt32() >= 1);
            Assert.Empty(cheapJson.GetProperty("issues").EnumerateArray());

            Assert.True(verifyJson.GetProperty("healthy").GetBoolean());
            Assert.True(verifyJson.GetProperty("verifyBytes").GetBoolean());
            Assert.True(verifyJson.GetProperty("artifactCount").GetInt32() >= 1);
            Assert.True(verifyJson.GetProperty("revisionCount").GetInt32() >= 1);
            Assert.Empty(verifyJson.GetProperty("issues").EnumerateArray());

            Assert.Equal(cheapJson.GetProperty("issues").GetArrayLength() == 0, cheapJson.GetProperty("healthy").GetBoolean());
            Assert.Equal(verifyJson.GetProperty("issues").GetArrayLength() == 0, verifyJson.GetProperty("healthy").GetBoolean());
        }
        finally
        {
            if (Directory.Exists(dataRoot))
            {
                Directory.Delete(dataRoot, recursive: true);
            }
        }
    }

    [Fact]
    public async Task Api_ArtifactIntegrityEndpoint_SerializesNullableIdsAsNull_WhenUnhealthy()
    {
        var dataRoot = Path.Combine(Path.GetTempPath(), $"aven-phase28-integrity-unhealthy-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dataRoot);

        try
        {
            var client = CreateClient(
                new Queue<object>(),
                out _,
                new Dictionary<string, string?>
                {
                    ["Aven:Persistence:SqlitePath"] = Path.Combine(dataRoot, "aven.sqlite"),
                    ["Aven:Trace:SqlitePath"] = Path.Combine(dataRoot, "aven.trace.sqlite"),
                    ["Aven:Artifacts:BlobRoot"] = Path.Combine(dataRoot, "artifact-blobs")
                });

            var hash = new string('a', 64);
            var orphanPath = Path.Combine(dataRoot, "artifact-blobs", "sha256", "aa", "aa", hash);
            Directory.CreateDirectory(Path.GetDirectoryName(orphanPath)!);
            await File.WriteAllBytesAsync(orphanPath, new byte[] { 1, 2, 3, 4 });

            var response = await client.GetAsync("/api/debug/artifacts/integrity");

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            var issue = json.GetProperty("issues").EnumerateArray().Single(x => x.GetProperty("code").GetString() == "blob_file_orphaned");

            Assert.False(json.GetProperty("healthy").GetBoolean());
            Assert.Equal(json.GetProperty("issues").GetArrayLength() == 0, json.GetProperty("healthy").GetBoolean());
            Assert.Equal(JsonValueKind.String, issue.GetProperty("code").ValueKind);
            Assert.Equal(JsonValueKind.Null, issue.GetProperty("artifactId").ValueKind);
            Assert.Equal(JsonValueKind.Null, issue.GetProperty("revisionId").ValueKind);
        }
        finally
        {
            if (Directory.Exists(dataRoot))
            {
                Directory.Delete(dataRoot, recursive: true);
            }
        }
    }

    private static async Task<string> UploadFixtureAsAsync(HttpClient client, string fixtureName, string uploadedFilename, string mimeType)
    {
        using var multipart = new MultipartFormDataContent();
        var content = new ByteArrayContent(await LoadFixtureBytesAsync(fixtureName));
        content.Headers.ContentType = MediaTypeHeaderValue.Parse(mimeType);
        multipart.Add(content, "file", uploadedFilename);

        var uploadResponse = await client.PostAsync("/api/artifacts", multipart);
        Assert.Equal(HttpStatusCode.Created, uploadResponse.StatusCode);
        var uploadJson = await uploadResponse.Content.ReadFromJsonAsync<JsonElement>();
        return uploadJson.GetProperty("artifactId").GetString()!;
    }
}