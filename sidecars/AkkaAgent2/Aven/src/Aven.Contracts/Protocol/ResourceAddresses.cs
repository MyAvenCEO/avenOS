namespace Aven.Contracts.Protocol;

public static class ResourceAddresses
{
    public static ActorAddress Gateway(string resourceKind) => new($"resource/{resourceKind}", "local");

    public static ActorAddress Worker(string resourceKind) => new($"resource/{resourceKind}/worker", "local");

    public static ActorAddress Store(string resourceKind) => new($"resource/{resourceKind}/store", "local");
}