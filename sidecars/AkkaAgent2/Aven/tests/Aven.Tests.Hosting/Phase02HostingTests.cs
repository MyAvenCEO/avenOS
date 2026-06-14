using Akka.Actor;
using Akka.Hosting;
using Aven.Akka.Hosting;
using Aven.Toolkit.Core.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Aven.Tests.Hosting;

public class Phase02HostingTests
{
    [Fact]
    public async Task HostStartsAndStopsCleanly()
    {
        using var host = await CreateHostAsync();
        var actorSystem = host.Services.GetRequiredService<ActorSystem>();

        Assert.False(actorSystem.WhenTerminated.IsCompleted);

        await host.StopAsync();

        Assert.True(actorSystem.WhenTerminated.IsCompleted);
    }

    [Fact]
    public async Task ActorRegistrationAndLookupWorks()
    {
        var pingAddress = new ActorAddress("actors/ping", "local");

        using var host = await CreateHostAsync((system, registry, addresses) =>
        {
            var actor = system.ActorOf(Props.Create(() => new PingActor()), "ping");
            addresses.Register(pingAddress, actor);
        });

        var resolver = host.Services.GetRequiredService<IActorAddressResolver>();
        var actorRef = resolver.Resolve(pingAddress);
        var response = await actorRef.Ask<string>("ping", TimeSpan.FromSeconds(3));

        Assert.Equal("pong", response);
    }

    [Fact]
    public async Task UnknownActorResolutionFailsInspectably()
    {
        using var host = await CreateHostAsync();
        var resolver = host.Services.GetRequiredService<IActorAddressResolver>();
        var address = new ActorAddress("actors/missing", "local");

        var exception = Assert.Throws<UnknownActorAddressException>(() => resolver.Resolve(address));

        Assert.Equal(address, exception.Address);
        Assert.Contains("actors/missing", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void NoPersistedModelContainsIActorRef()
    {
        var cleanPaths = PersistenceModelInspector.FindForbiddenTypePaths<PersistableEnvelope>(IsActorRefType);
        var forbiddenPaths = PersistenceModelInspector.FindForbiddenTypePaths<InvalidPersistedModel>(IsActorRefType);

        Assert.Empty(cleanPaths);
        Assert.Contains("InvalidPersistedModel.ActorRef", forbiddenPaths);
    }

    [Fact]
    public void CanonicalJsonHashingIsDeterministic()
    {
        var serializer = new CanonicalJsonSerializer();
        var left = new { B = 2, A = 1, Nested = new { Y = true, X = 4 } };
        var right = new { Nested = new { X = 4, Y = true }, A = 1, B = 2 };

        Assert.Equal(serializer.Hash(left), serializer.Hash(right));
    }

    private static async Task<IHost> CreateHostAsync(Action<ActorSystem, IActorRegistry, LocalActorAddressRegistry>? configure = null)
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddAvenAkkaHosting("AvenPhase02System", configure);

        var host = builder.Build();
        await host.StartAsync();
        return host;
    }

    private sealed class PingActor : ReceiveActor
    {
        public PingActor()
        {
            Receive<string>(message => Sender.Tell(message == "ping" ? "pong" : "unknown"));
        }
    }

    private sealed record PersistableEnvelope(AvenEnvelope<string> Envelope);

    private sealed class InvalidPersistedModel
    {
        // Intentionally unused directly; reflection test verifies persisted models reject IActorRef.
        public IActorRef ActorRef { get; init; } = ActorRefs.Nobody;
    }

    private static bool IsActorRefType(Type type)
    {
        if (type.FullName is "Akka.Actor.IActorRef")
        {
            return true;
        }

        return type.GetInterfaces().Any(i => i.FullName is "Akka.Actor.IActorRef");
    }
}