export interface GetCommunicationMessage {
  readonly type: "getCommunication";
  readonly communicationId: string;
}