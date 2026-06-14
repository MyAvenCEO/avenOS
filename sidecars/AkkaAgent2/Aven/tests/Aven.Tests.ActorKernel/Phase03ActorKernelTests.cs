using Akka.Actor;
using Akka.Configuration;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Tests.ActorKernel;

public sealed class Phase03ActorKernelTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase03-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public async Task CommandAccepted_Restart_DuplicateSamePayloadReturnsSameAcceptance()
    {
        var command = new AcceptTestCommand(new CommandId("cmd-001"), new SamplePayload("alpha", 1));

        var first = await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new TestInboxActor("phase03-inbox")), "phase03-inbox");
            return await actor.Ask<CommandReply>(command, TimeSpan.FromSeconds(5));
        });

        var second = await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new TestInboxActor("phase03-inbox")), "phase03-inbox");
            return await actor.Ask<CommandReply>(command, TimeSpan.FromSeconds(5));
        });

        Assert.Equal(CommandReplyKind.Accepted, first.Kind);
        Assert.Equal(CommandReplyKind.Duplicate, second.Kind);
        Assert.Equal(first.PayloadHash, second.PayloadHash);
        Assert.Equal(first.AcceptedAt, second.AcceptedAt);
    }

    [Fact]
    public async Task DuplicateDifferentPayloadConflicts()
    {
        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new TestInboxActor("phase03-conflict")), "phase03-conflict");

            var accepted = await actor.Ask<CommandReply>(
                new AcceptTestCommand(new CommandId("cmd-002"), new SamplePayload("alpha", 1)),
                TimeSpan.FromSeconds(5));

            var conflict = await actor.Ask<CommandReply>(
                new AcceptTestCommand(new CommandId("cmd-002"), new SamplePayload("beta", 2)),
                TimeSpan.FromSeconds(5));

            Assert.Equal(CommandReplyKind.Accepted, accepted.Kind);
            Assert.Equal(CommandReplyKind.Conflict, conflict.Kind);
            Assert.Equal(accepted.PayloadHash, conflict.ExistingPayloadHash);

            return true;
        });
    }

    [Fact]
    public void TerminalValueCannotChange()
    {
        var terminal = new TerminalState<string, string>();
        var applied = terminal.TrySet("accepted");
        var updated = terminal.ApplySet("accepted");
        var conflict = updated.TrySet("rejected");

        Assert.Equal(TerminalSetStatus.Applied, applied.Status);
        Assert.True(updated.IsTerminal);
        Assert.Equal("accepted", updated.Value);
        Assert.Equal(TerminalSetStatus.Conflict, conflict.Status);
        Assert.Equal("accepted", conflict.ExistingValue);
        Assert.Equal("rejected", conflict.AttemptedValue);
        Assert.Equal("accepted", updated.ApplySet("rejected").Value);
    }

    [Fact]
    public void AckMetadataMayUpdateTerminalRecord()
    {
        var terminal = new TerminalState<string, AckMetadata>()
            .ApplySet("succeeded")
            .WithAckMetadata(new AckMetadata("gateway/1", DateTimeOffset.Parse("2026-01-02T03:04:05+00:00")));

        Assert.True(terminal.IsTerminal);
        Assert.Equal("succeeded", terminal.Value);
        Assert.NotNull(terminal.AckMetadata);
        Assert.Equal("gateway/1", terminal.AckMetadata!.AckedBy);
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        if (File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }

        return Task.CompletedTask;
    }

    private async Task<T> WithSystem<T>(Func<ActorSystem, Task<T>> action)
    {
        var config = ConfigurationFactory.ParseString($$"""
            akka {
              loglevel = WARNING
              stdout-loglevel = WARNING
              persistence {
                journal.plugin = "akka.persistence.journal.sqlite"
                snapshot-store.plugin = "akka.persistence.snapshot-store.sqlite"
                journal.sqlite {
                  class = "Akka.Persistence.Sqlite.Journal.SqliteJournal, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
              }
            }
            """);

        var system = ActorSystem.Create($"aven-phase03-{Guid.NewGuid():N}", config);
        try
        {
            return await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private sealed record AcceptTestCommand(CommandId CommandId, SamplePayload Payload);

    private sealed record SamplePayload(string Name, int Version);

    private sealed record AckMetadata(string AckedBy, DateTimeOffset AckedAt);

    private enum CommandReplyKind
    {
        Accepted,
        Duplicate,
        Conflict
    }

    private sealed record CommandReply(
        CommandReplyKind Kind,
        string PayloadHash,
        DateTimeOffset AcceptedAt,
        string? ExistingPayloadHash = null);

    private sealed class TestInboxActor : InboxLedgerPersistentActor
    {
        private readonly CanonicalJsonSerializer _serializer = new();

        public TestInboxActor(string persistenceId)
            : base(persistenceId)
        {
            Command<AcceptTestCommand>(Handle);
        }

        private void Handle(AcceptTestCommand command)
        {
            var replyTo = Sender;
            var payloadHash = _serializer.Hash(command.Payload);
            var decision = Decide(command.CommandId, payloadHash);

            switch (decision.Kind)
            {
                case ProcessedCommandDecisionKind.Duplicate:
                    replyTo.Tell(new CommandReply(
                        CommandReplyKind.Duplicate,
                        decision.ExistingEntry!.PayloadHash,
                        decision.ExistingEntry.AcceptedAt));
                    break;

                case ProcessedCommandDecisionKind.Conflict:
                    replyTo.Tell(new CommandReply(
                        CommandReplyKind.Conflict,
                        payloadHash,
                        decision.ExistingEntry!.AcceptedAt,
                        decision.ExistingEntry.PayloadHash));
                    break;

                case ProcessedCommandDecisionKind.Accepted:
                    var acceptedAt = DateTimeOffset.UtcNow;
                    PersistAcceptance(
                        new ProcessedCommandAccepted(command.CommandId, payloadHash, acceptedAt, "accepted"),
                        persisted => replyTo.Tell(new CommandReply(CommandReplyKind.Accepted, persisted.PayloadHash, persisted.AcceptedAt)));
                    break;

                default:
                    throw new ArgumentOutOfRangeException();
            }
        }
    }
}