namespace Aven.Submission;

public interface IMessageSubmissionClient
{
    SubmissionInspection Inspect();
    object Submit(SubmitMessageRequest command);
}