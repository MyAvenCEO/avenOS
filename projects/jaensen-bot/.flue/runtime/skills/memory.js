import { runWorkerTask } from '../worker.js';
export async function runMemorySkill(intent, action, deps) {
    const input = action.input && typeof action.input === 'object' ? action.input : {};
    const skillDoc = deps.skillRegistry.memory?.doc;
    if (!skillDoc)
        return { skill: 'memory', ok: false, summary: 'Memory skill is not registered' };
    const worker = await runWorkerTask({
        sandboxFactory: deps.sandboxFactory,
        intent,
        skill: 'memory',
        workerType: action.operation,
        skillDoc,
        task: input
    });
    if (action.operation === 'remember') {
        const topic = asString(input.topic) ?? intent.title;
        const note = asString(input.note) ?? asString(input.content) ?? intent.summary;
        await deps.storage.memory.appendTopicNote(topic, note);
        return { skill: 'memory', ok: worker.exitCode === 0, summary: `Stored note in ${topic}`, data: { topic, worker } };
    }
    if (action.operation === 'recall') {
        const topic = asString(input.topic) ?? intent.title;
        const content = await deps.storage.memory.readTopic(topic);
        return { skill: 'memory', ok: worker.exitCode === 0, summary: `Read topic ${topic}`, data: { topic, content, worker } };
    }
    const query = asString(input.query) ?? intent.title;
    return { skill: 'memory', ok: worker.exitCode === 0, summary: `Searched memory for ${query}`, data: { query, matches: await deps.storage.memory.search(query), worker } };
}
function asString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
