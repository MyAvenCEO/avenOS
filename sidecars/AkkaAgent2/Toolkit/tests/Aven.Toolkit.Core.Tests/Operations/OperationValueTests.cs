using Aven.Toolkit.Core.Operations;

namespace Aven.Toolkit.Core.Tests.Operations;

public sealed class OperationValueTests
{
    [Fact]
    public void OperationError_preserves_code_message_retryable_and_details()
    {
        var error = new OperationError(
            "payload_conflict",
            "Conflicting duplicate payload.",
            false,
            "{\"conflictKind\":\"hash_mismatch\"}");

        Assert.Equal("payload_conflict", error.Code);
        Assert.Equal("Conflicting duplicate payload.", error.Message);
        Assert.False(error.Retryable);
        Assert.Equal("{\"conflictKind\":\"hash_mismatch\"}", error.DetailsJson);
    }

    [Fact]
    public void OperationValue_uses_value_equality()
    {
        var left = new OperationValue("metadata.create", "{\"ok\":true}");
        var right = new OperationValue("metadata.create", "{\"ok\":true}");
        var different = new OperationValue("metadata.create", "{\"ok\":false}");

        Assert.Equal(left, right);
        Assert.NotEqual(left, different);
    }
}