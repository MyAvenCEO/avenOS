namespace Aven.Resources.Runtime.Inbox;

public enum ResourceOperationInboxStatus
{
    Recorded,
    Processing,
    Completed,
    Failed
}

public enum ResourceOperationTerminalReplyDeliveryStatus
{
    Pending,
    Delivered
}