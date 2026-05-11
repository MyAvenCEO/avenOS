import { Buffer } from 'buffer';
import { runWorkerTask } from '../worker.js';
export async function runIngestSkill(input, intent, action, deps) {
    const skillDoc = deps.skillRegistry.ingest?.doc;
    if (!skillDoc)
        return { skill: 'ingest', ok: false, summary: 'Ingest skill is not registered' };
    const worker = await runWorkerTask({ sandboxFactory: deps.sandboxFactory, intent, skill: 'ingest', workerType: action.operation, skillDoc, task: action.input });
    if (action.operation === 'archive-attachment') {
        if (!input.attachment)
            return { skill: 'ingest', ok: false, summary: 'No attachment available' };
        if (input.attachment.archiveKey) {
            return {
                skill: 'ingest',
                ok: worker.exitCode === 0,
                summary: 'Attachment already archived',
                data: { key: input.attachment.archiveKey, worker, name: input.attachment.name }
            };
        }
        if (!input.attachment.base64)
            return { skill: 'ingest', ok: false, summary: 'No attachment content available' };
        const content = Buffer.from(input.attachment.base64, 'base64');
        const result = await deps.storage.archive.put({ content, contentType: input.attachment.contentType, metadata: { name: input.attachment.name } });
        return { skill: 'ingest', ok: worker.exitCode === 0, summary: 'Archived attachment', data: { key: result.key, worker } };
    }
    const url = typeof action.input.url === 'string' ? action.input.url : undefined;
    if (!url)
        return { skill: 'ingest', ok: false, summary: 'No URL provided' };
    const response = await fetch(url);
    if (!response.ok)
        return { skill: 'ingest', ok: false, summary: `Failed to fetch ${url}: ${response.status}`, data: { worker } };
    const content = new Uint8Array(await response.arrayBuffer());
    const result = await deps.storage.archive.put({ content, contentType: response.headers.get('content-type') ?? undefined, metadata: { source: url } });
    return { skill: 'ingest', ok: worker.exitCode === 0, summary: `Archived URL ${url}`, data: { key: result.key, url, worker } };
}
