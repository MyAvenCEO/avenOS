using Aven.Toolkit.Artifacts;
using Aven.Toolkit.Core.Identifiers;

namespace Aven.Toolkit.Llm.Tests;

public sealed class ProviderCapabilityTests
{
    [Fact]
    public void ArtifactSourceDescriptor_Uses_Toolkit_Artifact_Primitives_And_Optional_Inline_Content()
    {
        var descriptor = new ArtifactSourceDescriptor(
            new ArtifactRef(new ArtifactId("artifact-1"), new ArtifactRevisionId("revision-1")),
            "invoice.pdf",
            "application/pdf",
            new BlobRef("sha256", new string('a', 64), 42),
            InlineText: "invoice text",
            InlineDataUrl: "data:application/pdf;base64,AAAA");

        Assert.Equal("artifact-1", descriptor.Artifact.ArtifactId.Value);
        Assert.Equal("invoice.pdf", descriptor.Filename);
        Assert.Equal("application/pdf", descriptor.MimeType);
        Assert.Equal(42, descriptor.Blob.SizeBytes);
        Assert.Equal("invoice text", descriptor.InlineText);
        Assert.Equal("data:application/pdf;base64,AAAA", descriptor.InlineDataUrl);
    }

    [Fact]
    public void Portable_Llm_Value_Objects_Preserve_Declared_Fields()
    {
        var toolCall = new LlmToolCall("search", "{\"query\":\"invoice\"}");
        var degradation = new LlmProviderDegradation("prompt_only_structured_output", "provider required prompt fallback");
        var usage = new LlmUsage(120, 80, 200, 0.42m);
        var model = new LlmModelCapabilities("toolkit-model", true, true, true, true, true, false);

        Assert.Equal("search", toolCall.Name);
        Assert.Equal("{\"query\":\"invoice\"}", toolCall.ArgumentsJson);
        Assert.Equal("prompt_only_structured_output", degradation.Code);
        Assert.Equal("provider required prompt fallback", degradation.Message);
        Assert.Equal(120, usage.PromptTokens);
        Assert.Equal(80, usage.CompletionTokens);
        Assert.Equal(200, usage.TotalTokens);
        Assert.Equal(0.42m, usage.Cost);

        Assert.Equal("toolkit-model", model.ModelName);
        Assert.True(model.SupportsImages);
        Assert.True(model.SupportsPdfArtifacts);
        Assert.True(model.SupportsProviderFiles);
        Assert.True(model.SupportsStrictStructuredOutput);
        Assert.True(model.SupportsToolCalls);
        Assert.False(model.SupportsRecoveryPolling);
    }

    [Fact]
    public void LlmInputBlockSummary_Preserves_All_Public_Summary_Fields()
    {
        var summary = new LlmInputBlockSummary(
            Kind: LlmBlockKind.ProviderFile,
            Text: "summarize this",
            Role: "user",
            ProviderFileKey: new ProviderFileKey("provider-file-7"),
            ArtifactId: new ArtifactId("artifact-9"),
            MimeType: "application/pdf",
            Purpose: "analysis",
            TransportMode: "provider-file",
            PayloadHash: "sha256:abc",
            TextLength: 14,
            Name: "search");

        Assert.Equal(LlmBlockKind.ProviderFile, summary.Kind);
        Assert.Equal("summarize this", summary.Text);
        Assert.Equal("user", summary.Role);
        Assert.Equal("provider-file-7", summary.ProviderFileKey!.Value.Value);
        Assert.Equal("artifact-9", summary.ArtifactId!.Value.Value);
        Assert.Equal("application/pdf", summary.MimeType);
        Assert.Equal("analysis", summary.Purpose);
        Assert.Equal("provider-file", summary.TransportMode);
        Assert.Equal("sha256:abc", summary.PayloadHash);
        Assert.Equal(14, summary.TextLength);
        Assert.Equal("search", summary.Name);
    }
}