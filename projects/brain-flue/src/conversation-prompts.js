export function buildDispatcherPrompt(input) {
    return [
        'Role: dispatcher',
        'Return only a structured decision matching the provided schema.',
        'Do not invent extra keys.',
        '',
        'Current DispatcherState:',
        jsonBlock(input.state),
        '',
        'Active intents list:',
        jsonBlock(Object.values(input.state.activeIntents)),
        '',
        'Incoming user text:',
        input.userInput.text,
        '',
        'Attachments metadata:',
        jsonBlock(input.userInput.attachments.map(toAttachmentMetadata)),
        '',
        'Incoming envelope:',
        jsonBlock(input.envelope),
        '',
        'Hard rules:',
        '- decide route_existing_intent or create_intent',
        '- create intent only for a distinct user goal',
        '- do not solve the task',
        '- do not call skills',
        '- do not ask user questions'
    ].join('\n');
}
export function buildIntentPrompt(input) {
    return [
        'Role: intent controller',
        'Return only a structured decision matching the provided schema.',
        'Do not invent extra keys.',
        '',
        'Current IntentState:',
        jsonBlock(input.state),
        '',
        'Incoming envelope:',
        jsonBlock(input.envelope),
        '',
        'Available skills (id + description only):',
        jsonBlock(input.availableSkills),
        '',
        'Pending skill calls:',
        jsonBlock(Object.values(input.state.pendingSkillCalls)),
        '',
        'Hard rules:',
        '- you own the user intent',
        '- you may call skills only',
        '- you may not call workers/tools/shell/filesystem',
        '- only ask user when blocked',
        '- continue work after skill results',
        '- always return full updated state'
    ].join('\n');
}
function toAttachmentMetadata(attachment) {
    return {
        id: attachment.id,
        path: attachment.path,
        mimeType: attachment.mimeType,
        name: attachment.name
    };
}
function jsonBlock(value) {
    return JSON.stringify(value, null, 2);
}
