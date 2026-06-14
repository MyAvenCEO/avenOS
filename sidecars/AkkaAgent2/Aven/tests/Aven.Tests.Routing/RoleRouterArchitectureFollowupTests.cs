using System.Runtime.CompilerServices;

namespace Aven.Tests.Routing;

public sealed class RoleRouterArchitectureFollowupTests
{
    [Fact]
    public void Routing_UsesActorOwnedRouterAndDumbClient()
    {
        var repoRoot = FindRepoRoot();
        var oldRoutingActorFileName = string.Concat("Routing", "JournalActor.cs");
        var oldRoutingActorTypeName = string.Concat("Aven.Routing.Actors.", "Routing", "JournalActor");
        var oldRoutingAdapterName = string.Concat("Routing", "Delivery", "AdapterActor");
        var oldRouterTypeName = string.Concat("Aven.Routing.", "Role", "Router");
        var oldRouterConstructorFragment = string.Concat("Role", "Router", " router");
        var routingAssembly = typeof(RoleRoutingClient).Assembly;
        var routerActorType = routingAssembly.GetType("Aven.Routing.Actors.RoleRouterActor");
        Assert.NotNull(routerActorType);

        var oldRouterType = routingAssembly.GetType(oldRouterTypeName);
        Assert.Null(oldRouterType);
        Assert.Null(routingAssembly.GetType(oldRoutingActorTypeName));

        Assert.True(File.Exists(Path.Combine(repoRoot, "Aven", "src", "Routing", "Aven.Routing", "Actors", "RoleRouterActor.cs")));
        Assert.False(File.Exists(Path.Combine(repoRoot, "Aven", "src", "Routing", "Aven.Routing", "Actors", oldRoutingActorFileName)));
        Assert.False(File.Exists(Path.Combine(repoRoot, "Aven", "src", "Submission", "Aven.Submission", oldRoutingAdapterName + ".cs")));

        var messageSubmissionActorSource = File.ReadAllText(Path.Combine(repoRoot, "Aven", "src", "Submission", "Aven.Submission", "Actors", "MessageSubmissionActor.cs"));
        Assert.Contains("private readonly RoleRoutingClient _router;", messageSubmissionActorSource, StringComparison.Ordinal);
        Assert.Contains("RoleRoutingClient router,", messageSubmissionActorSource, StringComparison.Ordinal);
        Assert.DoesNotContain(oldRouterConstructorFragment, messageSubmissionActorSource, StringComparison.Ordinal);

        var messageSubmissionClientSource = File.ReadAllText(Path.Combine(repoRoot, "Aven", "src", "Submission", "Aven.Submission", "MessageSubmissionClient.cs"));
        Assert.Contains("public MessageSubmissionClient(IActorRef submissionActor)", messageSubmissionClientSource, StringComparison.Ordinal);
        Assert.DoesNotContain("ActorOf(", messageSubmissionClientSource, StringComparison.Ordinal);
        Assert.DoesNotContain("resolver.Register(RoutingGatewayAddress, router.ActorRef);", messageSubmissionClientSource, StringComparison.Ordinal);

        var messageSubmissionHostSource = File.ReadAllText(Path.Combine(repoRoot, "Aven", "src", "Submission", "Aven.Submission", "MessageSubmissionHost.cs"));
        Assert.Contains("resolver.Register(RoutingGatewayAddress, router.ActorRef);", messageSubmissionHostSource, StringComparison.Ordinal);
        Assert.Contains("ActorOf(", messageSubmissionHostSource, StringComparison.Ordinal);
        Assert.DoesNotContain(oldRoutingAdapterName, messageSubmissionClientSource, StringComparison.Ordinal);
    }

    [Fact]
    public void RoleRoutingClient_DoesNotContainRoutingDecisionLogic()
    {
        var source = File.ReadAllText(Path.Combine(FindRepoRoot(), "Aven", "src", "Routing", "Aven.Routing", "Clients", "RoleRoutingClient.cs"));

        Assert.Contains("Ask<RouteResolution>", source, StringComparison.Ordinal);
        Assert.Contains("InspectRouteAttempts", source, StringComparison.Ordinal);
        Assert.Contains("GetRouteAttemptCommand", source, StringComparison.Ordinal);

        Assert.DoesNotContain("RoleAgentRegistryClient", source, StringComparison.Ordinal);
        Assert.DoesNotContain("WorkIntakeClient", source, StringComparison.Ordinal);
        Assert.DoesNotContain("LlmRoleSelector", source, StringComparison.Ordinal);
        Assert.DoesNotContain("RouteAuditEntry", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Evaluate(", source, StringComparison.Ordinal);
        Assert.DoesNotContain("CommitAccepted", source, StringComparison.Ordinal);
    }

    private static string FindRepoRoot([CallerFilePath] string sourceFile = "")
    {
        var current = new DirectoryInfo(Path.GetDirectoryName(sourceFile) ?? Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "Aven.sln")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Could not locate repository root containing Aven.sln.");
    }
}