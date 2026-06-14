namespace Aven.Submission.Contracts.Responses;

public sealed record SubmissionInspection(IReadOnlyDictionary<string, SubmittedMessageRecord> Commands);
