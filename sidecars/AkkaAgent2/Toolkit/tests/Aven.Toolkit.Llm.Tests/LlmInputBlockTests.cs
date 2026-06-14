using Aven.Toolkit.Core.Identifiers;

namespace Aven.Toolkit.Llm.Tests;

public sealed class LlmInputBlockTests
{
    [Fact]
    public void Every_Input_Block_Kind_Preserves_Its_Public_Shape()
    {
        var text = new TextInputBlock("hello", Role: "system");
        var json = new JsonInputBlock("{}", Role: "assistant");
        var imageArtifact = new ArtifactInputBlock(
            LlmBlockKind.ImageArtifact,
            new ArtifactId("artifact-image"),
            "image/png",
            InlineTransportData: "data:image/png;base64,AAAA");
        var documentArtifact = new ArtifactInputBlock(
            LlmBlockKind.DocumentArtifact,
            new ArtifactId("artifact-doc"),
            "application/pdf");
        var providerFile = new ProviderFileInputBlock(new ProviderFileKey("file-1"), "vision-input", "provider-file");
        var toolDefinition = new ToolDefinitionInputBlock("search", "Search docs", "{}");
        var toolResult = new ToolResultInputBlock("search", "{\"hits\":1}");

        Assert.Equal(LlmBlockKind.Text, text.Kind);
        Assert.Equal("hello", text.Text);
        Assert.Equal("system", text.Role);

        Assert.Equal(LlmBlockKind.Json, json.Kind);
        Assert.Equal("{}", json.Json);
        Assert.Equal("assistant", json.Role);

        Assert.Equal(LlmBlockKind.ImageArtifact, imageArtifact.Kind);
        Assert.Equal(LlmBlockKind.ImageArtifact, imageArtifact.ArtifactKind);
        Assert.Equal("artifact-image", imageArtifact.ArtifactId.Value);
        Assert.Equal("image/png", imageArtifact.MimeType);
        Assert.Equal("data:image/png;base64,AAAA", imageArtifact.InlineTransportData);

        Assert.Equal(LlmBlockKind.DocumentArtifact, documentArtifact.Kind);
        Assert.Equal(LlmBlockKind.DocumentArtifact, documentArtifact.ArtifactKind);
        Assert.Equal("artifact-doc", documentArtifact.ArtifactId.Value);
        Assert.Equal("application/pdf", documentArtifact.MimeType);
        Assert.Null(documentArtifact.InlineTransportData);

        Assert.Equal(LlmBlockKind.ProviderFile, providerFile.Kind);
        Assert.Equal("file-1", providerFile.ProviderFileKey.Value);
        Assert.Equal("vision-input", providerFile.Purpose);
        Assert.Equal("provider-file", providerFile.TransportMode);

        Assert.Equal(LlmBlockKind.ToolDefinition, toolDefinition.Kind);
        Assert.Equal("search", toolDefinition.Name);
        Assert.Equal("Search docs", toolDefinition.Description);
        Assert.Equal("{}", toolDefinition.JsonSchema);

        Assert.Equal(LlmBlockKind.ToolResult, toolResult.Kind);
        Assert.Equal("search", toolResult.ToolName);
        Assert.Equal("{\"hits\":1}", toolResult.ResultJson);
    }
}