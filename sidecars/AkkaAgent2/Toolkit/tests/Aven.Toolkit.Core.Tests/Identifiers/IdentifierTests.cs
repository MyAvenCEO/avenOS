using Aven.Toolkit.Core.Identifiers;

namespace Aven.Toolkit.Core.Tests.Identifiers;

public sealed class IdentifierTests
{
    [Fact]
    public void SchemaRef_preserves_value_and_value_equality()
    {
        var left = new SchemaRef("schema://accounting/invoice@2");
        var right = new SchemaRef("schema://accounting/invoice@2");
        var different = new SchemaRef("schema://accounting/invoice@3");

        Assert.Equal("schema://accounting/invoice@2", left.Value);
        Assert.Equal(left, right);
        Assert.NotEqual(left, different);
    }

    [Fact]
    public void Additional_identifier_value_objects_preserve_value_equality()
    {
        Assert.Equal(new ArtifactId("artifact-1"), new ArtifactId("artifact-1"));
        Assert.Equal(new ArtifactRevisionId("revision-1"), new ArtifactRevisionId("revision-1"));
        Assert.Equal(new PromptId("prompt-1"), new PromptId("prompt-1"));
        Assert.Equal(new ProviderFileKey("provider-file-1"), new ProviderFileKey("provider-file-1"));
        Assert.Equal(new RoleAgentId("agent-1"), new RoleAgentId("agent-1"));

        Assert.Equal("artifact-1", new ArtifactId("artifact-1").Value);
        Assert.Equal("revision-1", new ArtifactRevisionId("revision-1").Value);
        Assert.Equal("prompt-1", new PromptId("prompt-1").Value);
        Assert.Equal("provider-file-1", new ProviderFileKey("provider-file-1").Value);
        Assert.Equal("agent-1", new RoleAgentId("agent-1").Value);
    }
}