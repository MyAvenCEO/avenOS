import { runWorkerTask } from '../worker.js';
export async function runMemorySkill(intent, action, deps) {
    const worker = await runWorkerTask({
        sandboxFactory: deps.sandboxFactory,
        intent,
        skill: 'memory',
        workerType: action.operation,
        skillDoc: deps.skillDocs.memory,
        task: action.input
    });
    if (action.operation === 'remember') {
        const topic = asString(action.input.topic) ?? intent.title;
        const note = asString(action.input.note) ?? asString(action.input.content) ?? intent.summary;
        await deps.storage.memory.appendTopicNote(topic, note);
        return { skill: 'memory', ok: worker.exitCode === 0, summary: `Stored note in ${topic}`, data: { topic, worker } };
    }
    if (action.operation === 'recall') {
        const topic = asString(action.input.topic) ?? intent.title;
        const content = await deps.storage.memory.readTopic(topic);
        return { skill: 'memory', ok: worker.exitCode === 0, summary: `Read topic ${topic}`, data: { topic, content, worker } };
    }
    const query = asString(action.input.query) ?? intent.title;
    return { skill: 'memory', ok: worker.exitCode === 0, summary: `Searched memory for ${query}`, data: { query, matches: await deps.storage.memory.search(query), worker } };
}
function asString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
