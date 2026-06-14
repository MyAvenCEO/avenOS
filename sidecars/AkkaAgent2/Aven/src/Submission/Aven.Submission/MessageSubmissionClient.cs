using Akka.Actor;

namespace Aven.Submission;

public sealed class MessageSubmissionClient : IMessageSubmissionClient
{
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);
    private readonly IActorRef _submissionActor;

    public MessageSubmissionClient(IActorRef submissionActor) => _submissionActor = submissionActor;

    public SubmissionInspection Inspect() =>
        _submissionActor.Ask<SubmissionInspection>(new InspectSubmissionsCommand(), DefaultTimeout).GetAwaiter().GetResult();

    public object Submit(SubmitMessageRequest command) =>
        _submissionActor.Ask<object>(new SubmitMessageCommand(command), DefaultTimeout).GetAwaiter().GetResult();
}