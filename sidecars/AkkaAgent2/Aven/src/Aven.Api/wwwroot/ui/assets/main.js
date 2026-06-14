"use strict";
const settings = loadSettings();
const snapshot = {
    health: null,
    roles: [],
    agents: [],
    skills: [],
    artifacts: [],
    prompts: [],
    metadata: [],
    invoices: [],
    statements: [],
    matches: [],
    suppliers: [],
    schemas: []
};
const remembered = loadRemembered();
let rawResult = null;
let inspectorResult = null;
let actorTreeResult = null;
let schemaDetailResult = null;
let schemaValidationResult = null;
let artifactDetailResult = null;
let activeAccountingTab = 'overview';
let activeRuntimeTab = 'inspect';
let activeArtifactPreviewTab = 'meta';
const appElement = document.querySelector('#app');
if (!appElement)
    throw new Error('Missing #app');
const app = appElement;
void init();
async function init() {
    render();
    await refreshSafe();
    render();
}
async function refreshSafe() {
    try {
        await refresh();
    }
    catch (error) {
        toast('Refresh failed', messageOf(error), 'error');
    }
}
async function refresh() {
    const tasks = await Promise.allSettled([
        api('/'),
        api('/api/roles'),
        api('/api/agents'),
        api('/api/skills'),
        api('/api/artifacts?limit=200'),
        api('/api/human/prompts'),
        api('/api/metadata'),
        api('/api/accounting/invoices'),
        api('/api/accounting/account-statements'),
        api('/api/accounting/payment-matches'),
        api('/api/accounting/suppliers'),
        api('/api/schemas')
    ]);
    assign(tasks[0], value => snapshot.health = value);
    assign(tasks[1], value => snapshot.roles = asArray(value));
    assign(tasks[2], value => snapshot.agents = asArray(value));
    assign(tasks[3], value => snapshot.skills = asArray(value));
    assign(tasks[4], value => snapshot.artifacts = asArray(value));
    assign(tasks[5], value => snapshot.prompts = asArray(value));
    assign(tasks[6], value => snapshot.metadata = asArray(value));
    assign(tasks[7], value => snapshot.invoices = asArray(value));
    assign(tasks[8], value => snapshot.statements = asArray(value));
    assign(tasks[9], value => snapshot.matches = asArray(value));
    assign(tasks[10], value => snapshot.suppliers = asArray(value));
    assign(tasks[11], value => snapshot.schemas = asArray(value));
    if (tasks[2]?.status === 'rejected' && snapshot.agents.length === 0) {
        snapshot.agents = remembered.agentIds.map((id) => ({ roleAgentId: { value: id }, roleName: 'remembered', displayName: id, status: 'remembered' }));
    }
}
function assign(result, fn) {
    if (result?.status === 'fulfilled')
        fn(result.value);
}
function render() {
    saveSettings();
    saveRemembered();
    app.replaceChildren(header(), e('main', { class: 'shell' }, viewNode()));
}
function header() {
    return e('header', { class: 'app-header' }, e('div', { class: 'hero' }, e('div', { class: 'hero-mark' }, 'A'), e('div', { class: 'hero-copy' }, e('h1', {}, 'Aven Console'), e('p', {}, 'Artifacts · metadata · runtime'))), e('div', { class: 'header-actions' }, button('Refresh', async () => { await refreshSafe(); render(); }, 'btn small primary')), e('nav', { class: 'primary-nav' }, ...['artifacts', 'agents', 'metadata', 'actor-tree', 'schemas', 'accounting', 'human', 'runtime']
        .map(view => button(tabLabel(view), () => { settings.view = view; render(); }, `nav-pill${settings.view === view ? ' active' : ''}`))));
}
function viewNode() {
    switch (settings.view) {
        case 'artifacts': return artifactsView();
        case 'agents': return agentsView();
        case 'metadata': return metadataView();
        case 'actor-tree': return actorTreeView();
        case 'schemas': return schemaView();
        case 'accounting': return accountingView();
        case 'human': return humanView();
        case 'runtime': return runtimeView();
        default: return artifactsView();
    }
}
function quickIngestCard() {
    let files = [];
    let isDragActive = false;
    const fileName = e('span', { class: 'dropzone-selection' }, 'No files selected');
    const updateDropzoneState = () => {
        dropzone.classList.toggle('drag-active', isDragActive);
    };
    const setFiles = (nextFiles) => {
        files = nextFiles;
        fileName.textContent = files.length
            ? files.length === 1
                ? `${files[0].name} · ${files[0].type || 'unknown'}`
                : `${files.length} files selected`
            : 'No files selected';
    };
    const fileInput = e('input', {
        class: 'dropzone-input',
        type: 'file',
        multiple: true,
        onchange: (ev) => {
            setFiles(Array.from(ev.target.files ?? []));
        }
    });
    const dropzoneIcon = e('div', { class: 'dropzone-icon', 'aria-hidden': 'true' }, '⇪');
    const dropzoneHint = e('div', { class: 'dropzone-hint' }, 'Drop files here or click to browse');
    const dropzone = e('label', {
        class: 'dropzone',
        ondragenter: (ev) => {
            ev.preventDefault();
            isDragActive = true;
            updateDropzoneState();
        },
        ondragover: (ev) => {
            ev.preventDefault();
            isDragActive = true;
            updateDropzoneState();
        },
        ondragleave: (ev) => {
            if (ev.currentTarget !== ev.target)
                return;
            isDragActive = false;
            updateDropzoneState();
        },
        ondrop: (ev) => {
            ev.preventDefault();
            isDragActive = false;
            updateDropzoneState();
            const droppedFiles = Array.from(ev.dataTransfer?.files ?? []);
            setFiles(droppedFiles);
        }
    }, dropzoneIcon, dropzoneHint, fileName, fileInput);
    const form = formNode(async () => {
        if (!files.length) {
            toast('No files selected', 'Choose one or more files first.', 'error');
            return;
        }
        // Upload + submit each file as an independent unit, fanned out with a concurrency cap so that
        // dropping many documents kicks off their extraction pipelines in parallel rather than serially.
        // The backend already runs one extraction worker per document; this stops the UI from feeding
        // them one-at-a-time. The cap protects the browser, the API, and downstream LLM rate limits.
        const total = files.length;
        const MAX_PARALLEL_UPLOADS = 16;
        const outcomes = new Array(total);
        let cursor = 0;
        const runWorker = async () => {
            for (let index = cursor++; index < total; index = cursor++) {
                const file = files[index];
                try {
                    const uploaded = await uploadArtifact(file);
                    const artifactId = String(uploaded.artifactId ?? '');
                    remember('artifactIds', artifactId);
                    const contentSummary = total === 1
                        ? `${inferInputType(file)} accounting document: ${file.name}`
                        : `Accounting document ${index + 1} of ${total}: ${file.name}`;
                    await post('/api/messages', {
                        idempotencyKey: `ui-${Date.now()}-${index}-${artifactId}`,
                        incomingItemRef: artifactId,
                        inputType: inferInputType(file),
                        attachmentRefs: [artifactId],
                        contentSummary,
                        proposedIntent: 'accounting.ingest_document',
                        proposedReason: 'User submitted accounting documents for automatic classification.',
                        requiredSchemas: []
                    });
                    outcomes[index] = { ok: true, artifactId };
                }
                catch {
                    outcomes[index] = { ok: false, name: file.name };
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_UPLOADS, total) }, runWorker));
        const uploadedArtifactIds = outcomes
            .filter((o) => !!o && o.ok)
            .map(o => o.artifactId);
        const failedNames = outcomes
            .filter((o) => !!o && !o.ok)
            .map(o => o.name);
        if (uploadedArtifactIds.length) {
            settings.selectedArtifactId = uploadedArtifactIds[0];
            activeArtifactPreviewTab = 'preview';
        }
        if (failedNames.length) {
            toast('Some documents failed', `${failedNames.length} of ${total} failed: ${failedNames.join(', ')}`, 'error');
        }
        else {
            toast(total === 1 ? 'Document submitted' : 'Documents submitted', uploadedArtifactIds.join(', '), 'success');
        }
        setFiles([]);
        fileInput.value = '';
        await refreshSafe();
        if (settings.selectedArtifactId)
            await inspectArtifact(settings.selectedArtifactId);
        render();
    }, dropzone, submit('Upload and submit'));
    return e('section', { class: 'panel upload-panel' }, e('div', { class: 'panel-body' }, form));
}
function agentsView() {
    return e('div', { class: 'page stack' }, pageIntro('Agents', ''), e('div', { class: 'grid cols-2' }, panel('Agents', null, agentsList()), panel('Create agent', null, createAgentForm())));
}
function agentsList() {
    if (!snapshot.agents.length)
        return empty('No agents.');
    return e('div', { class: 'list' }, ...snapshot.agents.map(agent => {
        const id = idOf(agent.roleAgentId) || String(agent.roleAgentId ?? '');
        return e('button', {
            class: `list-row interactive${settings.selectedAgentId === id ? ' selected' : ''}`,
            type: 'button',
            onclick: async () => {
                settings.selectedAgentId = id;
                remember('agentIds', id);
                await inspectAgent(id);
                settings.view = 'runtime';
                activeRuntimeTab = 'inspect';
                render();
            }
        }, e('div', {}, e('div', { class: 'strong' }, String(agent.displayName ?? id)), e('div', { class: 'muted tiny' }, `${String(agent.roleName ?? 'role')} · ${id}`)), statusBadge(String(agent.status ?? 'registered')));
    }));
}
function createAgentForm() {
    const roles = snapshot.roles.length ? snapshot.roles : [{ roleName: 'accountant', displayName: 'Accountant' }];
    const role = selectNode(roles.map(r => ({ v: String(r.roleName), l: String(r.displayName ?? r.roleName) })));
    const definitionFor = (roleName) => snapshot.roles.find(r => r.roleName === roleName) ?? roles.find(r => String(r.roleName) === roleName) ?? roles[0] ?? {};
    const defaultAgentId = (roleName) => `${String(roleName || 'agent').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agent'}-${Date.now().toString(36)}`;
    const defaultObjective = (roleName) => `Handle ${String(roleName || 'role').replace(/_/g, ' ')} work.`;
    const initialDefinition = definitionFor(role.value || String(roles[0]?.roleName ?? 'accountant'));
    const agentId = inputNode(defaultAgentId(String(initialDefinition.roleName ?? role.value)));
    const display = inputNode(String(initialDefinition.displayName ?? 'Agent'));
    const objective = textareaNode(String(initialDefinition.recentSummary ?? defaultObjective(String(initialDefinition.roleName ?? role.value))));
    const scope = textareaNode(String(initialDefinition.responsibilityScope ?? ''));
    let agentIdTouched = false;
    let displayTouched = false;
    let objectiveTouched = false;
    let scopeTouched = false;
    agentId.addEventListener('input', () => { agentIdTouched = true; });
    display.addEventListener('input', () => { displayTouched = true; });
    objective.addEventListener('input', () => { objectiveTouched = true; });
    scope.addEventListener('input', () => { scopeTouched = true; });
    role.addEventListener('change', () => {
        const definition = definitionFor(role.value);
        if (!agentIdTouched)
            agentId.value = defaultAgentId(String(definition.roleName ?? role.value));
        if (!displayTouched)
            display.value = String(definition.displayName ?? 'Agent');
        if (!objectiveTouched)
            objective.value = String(definition.recentSummary ?? defaultObjective(String(definition.roleName ?? role.value)));
        if (!scopeTouched)
            scope.value = String(definition.responsibilityScope ?? '');
    });
    return formNode(async () => {
        const definition = snapshot.roles.find(r => r.roleName === role.value) ?? {};
        const primarySchemas = asArray(definition.primarySchemas)
            .map(schema => typeof schema === 'string'
            ? schema
            : String(schema?.value ?? ''))
            .filter(Boolean);
        const created = await post('/api/agents', {
            roleAgentId: agentId.value,
            roleName: role.value,
            displayName: display.value,
            objective: objective.value,
            responsibilityScope: scope.value,
            acceptedInputTypes: definition.acceptedInputTypes ?? ['text', 'pdf', 'image'],
            primarySchemas,
            routingDescription: definition.routingDescription ?? null,
            executionMode: definition.executionMode ?? null,
            hardness: definition.hardness ?? null,
            systemPrompt: definition.systemPrompt ?? null,
            allowedSkills: definition.allowedSkills ?? null
        });
        const createdId = String(created.roleAgentId ?? agentId.value);
        settings.selectedAgentId = createdId;
        remember('agentIds', createdId);
        await inspectAgent(createdId);
        await refreshSafe();
        settings.view = 'runtime';
        activeRuntimeTab = 'inspect';
        toast('Agent created', createdId, 'success');
        render();
    }, fields(['Agent id', agentId], ['Role', role], ['Display', display], ['Objective', objective], ['Scope', scope]), submit('Create'));
}
function recentAgentsCard() {
    const cards = snapshot.agents.slice(0, 5).map(agent => {
        const id = idOf(agent.roleAgentId) || String(agent.roleAgentId ?? '');
        return e('button', {
            class: 'list-row interactive',
            type: 'button',
            onclick: async () => {
                settings.selectedAgentId = id;
                remember('agentIds', id);
                activeRuntimeTab = 'inspect';
                settings.view = 'runtime';
                await inspectAgent(id);
                render();
            }
        }, e('div', {}, e('div', { class: 'strong' }, String(agent.displayName ?? id)), e('div', { class: 'muted tiny' }, String(agent.roleName ?? 'role'))), statusBadge(String(agent.status ?? 'registered')));
    });
    return panel('Recent agents', 'Open an agent directly into the runtime inspector.', cards.length ? e('div', { class: 'list' }, ...cards) : empty('No agents yet.'));
}
function workspaceQueueCard() {
    const rows = snapshot.prompts.slice(0, 5).map(p => [
        statusBadge(String(p.status ?? 'unknown')),
        String(p.promptText ?? '—'),
        fmtDate(p.expiresAt)
    ]);
    return panel('Human queue', 'The next prompts that likely need attention.', table(['Status', 'Prompt', 'Expires'], rows));
}
function workspaceArtifactPeek() {
    const rows = snapshot.artifacts.slice(0, 5).map(a => {
        const id = idOf(a.artifactId) || String(a.artifactId ?? '');
        return [mono(id), String(a.filename ?? '—'), button('Open', async () => { settings.view = 'artifacts'; await inspectArtifact(id); render(); }, 'btn small')];
    });
    return panel('Artifact peek', 'A few recent artifacts.', table(['Artifact', 'Filename', ''], rows));
}
function workspaceMetadataPeek() {
    const rows = snapshot.metadata.slice(0, 5).map(m => [
        badge(String(m.subjectKind ?? 'record'), 'blue'),
        String(m.subjectId ?? '—'),
        String(m.schemaRef ?? '—')
    ]);
    return panel('Metadata peek', 'Recent structured facts.', table(['Kind', 'Subject', 'Schema'], rows));
}
function artifactsView() {
    const query = inputNode(settings.artifactQuery ?? '', 'Filter by id, filename, MIME, or source');
    query.oninput = () => {
        settings.artifactQuery = query.value;
        render();
    };
    const items = filterArtifacts(settings.artifactQuery ?? '');
    return e('div', { class: 'page stack-lg' }, pageIntro('Artifacts', ''), quickIngestCard(), sectionHeader('Artifacts', `${items.length}`), actionBar(query, button('Refresh', async () => { await refreshSafe(); render(); }, 'btn small')), e('div', { class: 'grid master-detail' }, panel('Results', null, items.length ? artifactList(items) : empty('No artifacts match.')), artifactPreviewPanel()));
}
function artifactList(items) {
    return e('div', { class: 'list' }, ...items.map(a => {
        const id = idOf(a.artifactId) || String(a.artifactId ?? '');
        return e('button', {
            class: `list-row interactive${settings.selectedArtifactId === id ? ' selected' : ''}`,
            type: 'button',
            onclick: async () => {
                settings.selectedArtifactId = id;
                remember('artifactIds', id);
                await inspectArtifact(id);
                render();
            }
        }, e('div', {}, e('div', { class: 'strong' }, String(a.filename ?? id)), e('div', { class: 'muted tiny' }, `${id} · ${String(a.mimeType ?? '—')}`)), badge(String(a.sourceKind ?? 'artifact')));
    }));
}
function artifactPreviewPanel() {
    const detail = artifactDetailResult && String(artifactDetailResult.artifactId ?? '') === settings.selectedArtifactId ? artifactDetailResult : null;
    const tabs = e('div', { class: 'subnav compact' }, button('Metadata', () => { activeArtifactPreviewTab = 'meta'; render(); }, `subnav-pill${activeArtifactPreviewTab === 'meta' ? ' active' : ''}`), button('Contents', () => { activeArtifactPreviewTab = 'preview'; render(); }, `subnav-pill${activeArtifactPreviewTab === 'preview' ? ' active' : ''}`));
    return panel('Preview', settings.selectedArtifactId, e('div', { class: 'stack' }, tabs, e('div', { class: 'row' }, button('Inspect', async () => { await inspectArtifact(settings.selectedArtifactId); render(); }, 'btn small primary'), button('Open trace tools', () => { settings.view = 'runtime'; activeRuntimeTab = 'raw'; render(); }, 'btn small')), detail
        ? e('div', { class: 'stack' }, activeArtifactPreviewTab === 'preview'
            ? artifactDataPreview(detail)
            : e('div', { class: 'stack' }, detailStatGrid([
                ['Filename', String(detail.filename ?? '—')],
                ['MIME', String(detail.mimeType ?? '—')],
                ['Source', String(detail.sourceKind ?? '—')],
                ['Created', fmtDate(detail.createdAt)]
            ]), Array.isArray(detail.revisions) ? table(['Revision', 'Hash', 'Bytes', 'Created'], detail.revisions.map((r) => [mono(String(r.revisionId ?? '—')), String(r.hash ?? '—'), String(r.sizeBytes ?? '—'), fmtDate(r.createdAt)])) : empty('No revisions returned.'), jsonDetails('Raw artifact detail', detail)))
        : empty('Load artifact inspection to see details.')));
}
function artifactDataPreview(detail) {
    const src = `${settings.baseUrl}/api/artifacts/${encodeURIComponent(String(detail.artifactId))}/content`;
    const mime = String(detail.mimeType ?? '').toLowerCase();
    const filename = String(detail.filename ?? '').toLowerCase();
    if (mime.startsWith('image/'))
        return e('img', { class: 'artifact-media', src, alt: String(detail.filename ?? 'artifact') });
    if (mime === 'application/pdf' || filename.endsWith('.pdf'))
        return e('iframe', { class: 'artifact-frame', src });
    if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('html'))
        return e('iframe', { class: 'artifact-frame', src });
    if (mime.startsWith('application/') || mime.startsWith('audio/') || mime.startsWith('video/') || mime === '' || mime === 'application/octet-stream') {
        return e('div', { class: 'stack' }, e('iframe', { class: 'artifact-frame', src, title: String(detail.filename ?? detail.artifactId ?? 'artifact preview') }), e('div', { class: 'muted tiny' }, 'If your browser cannot preview this file inline, use the direct open link below.'), e('a', { class: 'btn', href: src, rel: 'noreferrer' }, 'Open file'));
    }
    return e('div', { class: 'stack' }, e('iframe', { class: 'artifact-frame', src, title: String(detail.filename ?? detail.artifactId ?? 'artifact preview') }), e('div', { class: 'muted tiny' }, 'If your browser cannot preview this file inline, use the direct open link below.'), e('a', { class: 'btn', href: src, rel: 'noreferrer' }, 'Open file'));
}
function metadataView() {
    const subjectFilter = inputNode(settings.metadataQuery ?? '', 'Filter by subject, kind, schema, or JSON');
    subjectFilter.oninput = () => {
        settings.metadataQuery = subjectFilter.value;
        render();
    };
    const items = filterMetadata(settings.metadataQuery ?? '');
    const selected = selectedMetadata();
    return e('div', { class: 'page stack-lg' }, pageIntro('Metadata', ''), sectionHeader('Metadata', `${items.length}`), actionBar(subjectFilter, button('Refresh', async () => { await refreshSafe(); render(); }, 'btn small')), e('div', { class: 'grid master-detail' }, panel('Results', null, metadataList(items)), panel('Preview', selected ? `${selected.subjectKind ?? 'record'} · ${selected.subjectId ?? '—'}` : null, selected ? metadataPreview(selected) : empty('No metadata selected.'))));
}
function metadataList(items) {
    if (!items.length)
        return empty('No metadata records match this filter.');
    return e('div', { class: 'list' }, ...items.map((record, index) => {
        const key = metadataKey(record, index);
        return e('button', {
            class: `list-row interactive${settings.selectedMetadataKey === key ? ' selected' : ''}`,
            type: 'button',
            onclick: () => {
                settings.selectedMetadataKey = key;
                render();
            }
        }, e('div', {}, e('div', { class: 'strong' }, `${String(record.subjectKind ?? 'record')} · ${String(record.subjectId ?? '—')}`), e('div', { class: 'muted tiny' }, String(record.schemaRef ?? '—'))), badge(String(record.schemaRef ?? 'schema')));
    }));
}
function metadataPreview(record) {
    return e('div', { class: 'stack' }, detailStatGrid([
        ['Subject kind', String(record.subjectKind ?? '—')],
        ['Subject id', String(record.subjectId ?? '—')],
        ['Schema', String(record.schemaRef ?? '—')],
        ['Created', fmtDate(record.createdAt)]
    ]), record.json ? jsonDetails('Structured JSON', parseRaw(record.json)) : empty('No JSON payload found.'));
}
function actorTreeView() {
    return e('div', { class: 'page stack-lg' }, pageIntro('Actor tree', ''), panel('Snapshot', null, e('div', { class: 'row' }, button('Capture snapshot', async () => { await captureActorTree(); render(); }, 'btn primary'), actorTreeResult?.capturedAt ? badge(`Captured ${fmtDate(actorTreeResult.capturedAt)}`, 'blue') : badge('No snapshot yet'))), panel('Tree', null, actorTreeResult?.root ? actorTreeNode(actorTreeResult.root, 0) : empty('Capture a snapshot to inspect the current actor tree.')));
}
function actorTreeNode(node, depth) {
    const target = traceTarget(node);
    return e('div', { class: 'tree-node', style: `--depth:${depth}` }, e('div', { class: 'tree-line' }, e('div', { class: `tree-kind ${String(node.kind ?? 'node')}` }, String((node.kind ?? 'n').slice(0, 1)).toUpperCase()), e('div', { class: 'tree-content' }, e('div', { class: 'tree-title' }, e('span', { class: 'strong' }, String(node.label ?? node.id ?? 'node')), e('div', { class: 'row' }, target ? button('Trace', async () => {
        await loadTrace(target.kind, target.id);
        settings.view = 'runtime';
        activeRuntimeTab = 'trace';
        render();
    }, 'btn small') : null, badge(String(node.status ?? 'unknown'), toneForKind(String(node.kind ?? 'group'))))), e('div', { class: 'muted tiny mono' }, String(node.id ?? '')))), ...(asArray(node.children).map((child) => actorTreeNode(child, depth + 1))));
}
function traceTarget(node) {
    const id = String(node?.id ?? '');
    if (id.startsWith('agent/')) {
        const parts = id.split('/');
        return parts[1] ? { kind: 'agent', id: parts[1] } : null;
    }
    if (id.startsWith('schedule/')) {
        return { kind: 'schedule', id: id.slice('schedule/'.length) };
    }
    return null;
}
function schemaView() {
    const filter = inputNode(settings.schemaQuery ?? '', 'Filter by schema ref or family');
    filter.oninput = () => {
        settings.schemaQuery = filter.value;
        render();
    };
    const schemas = filterSchemas(settings.schemaQuery ?? '');
    const schemaRefInput = inputNode(settings.selectedSchemaRef || '', 'schema://family/name@version');
    const jsonInput = textareaNode(settings.schemaValidationJson || `{
  "example": true
}`, 'JSON to validate');
    return e('div', { class: 'page stack-lg' }, pageIntro('Schemas', ''), e('div', { class: 'grid master-detail' }, panel('Schema explorer', null, e('div', { class: 'stack' }, actionBar(filter, button('Refresh', async () => { await refreshSafe(); render(); }, 'btn small')), schemas.length ? e('div', { class: 'list' }, ...schemas.map(schema => e('button', {
        class: `list-row interactive${settings.selectedSchemaRef === schema.schemaRef ? ' selected' : ''}`,
        type: 'button',
        onclick: async () => {
            settings.selectedSchemaRef = String(schema.schemaRef);
            await loadSchemaDetail(settings.selectedSchemaRef);
            render();
        }
    }, e('div', {}, e('div', { class: 'strong' }, String(schema.label ?? schema.schemaRef)), e('div', { class: 'muted tiny mono' }, String(schema.schemaRef ?? ''))), badge(`v${String(schema.version ?? '—')}`, 'purple')))) : empty('No schemas match this filter.'))), panel('Schema', settings.selectedSchemaRef || 'Select a schema', schemaDetailResult && String(schemaDetailResult.schemaRef ?? '') === settings.selectedSchemaRef
        ? e('div', { class: 'stack' }, detailStatGrid([
            ['Family', String(schemaDetailResult.familyRef ?? '—')],
            ['Version', String(schemaDetailResult.version ?? '—')],
            ['Registered', fmtDate(schemaDetailResult.registeredAt)],
            ['Description', String(schemaDetailResult.description ?? '—')]
        ]), e('pre', { class: 'json schema-viewer' }, JSON.stringify(parseRaw(schemaDetailResult.jsonSchema), null, 2)))
        : empty('Pick a schema to inspect its JSON contract.'))), panel('Validator', null, formNode(async () => {
        settings.selectedSchemaRef = schemaRefInput.value.trim();
        settings.schemaValidationJson = jsonInput.value;
        schemaValidationResult = await post('/api/schemas/validate', { schemaRef: schemaRefInput.value.trim(), json: jsonInput.value });
        render();
    }, fields(['Schema ref', schemaRefInput], ['JSON', jsonInput]), e('div', { class: 'row' }, submit('Validate JSON'), button('Load schema detail', async () => { settings.selectedSchemaRef = schemaRefInput.value.trim(); await loadSchemaDetail(settings.selectedSchemaRef); render(); }, 'btn')), schemaValidationResult
        ? e('div', { class: 'stack' }, e('div', { class: 'row' }, badge(schemaValidationResult.valid ? 'valid' : 'invalid', schemaValidationResult.valid ? 'green' : 'red'), schemaValidationResult.schemaRef ? badge(String(schemaValidationResult.schemaRef), 'blue') : null), !schemaValidationResult.valid && asArray(schemaValidationResult.errors).length
            ? e('ul', { class: 'error-list' }, ...asArray(schemaValidationResult.errors).map((err) => e('li', {}, String(err))))
            : null, jsonDetails('Validation response', schemaValidationResult))
        : empty('No validation run yet.'))));
}
function accountingView() {
    const tabs = e('div', { class: 'subnav' }, ...['overview', 'invoices', 'statements', 'matches', 'suppliers', 'questions']
        .map(tab => button(tabLabel(tab), () => { activeAccountingTab = tab; render(); }, `subnav-pill${activeAccountingTab === tab ? ' active' : ''}`)));
    return e('div', { class: 'page stack-lg' }, pageIntro('Accounting', 'Keep the existing accounting views, but in one calmer page.'), tabs, accountingTab());
}
function accountingTab() {
    if (activeAccountingTab === 'invoices')
        return panel('Invoices', 'Canonical invoice payloads.', table(['Invoice', 'Vendor', 'Issue', 'Due', 'Total', 'Outstanding', 'Raw'], snapshot.invoices.map(i => [String(i.invoiceNumber ?? i.subjectId), String(i.vendorName ?? '—'), String(i.issueDate ?? '—'), String(i.dueDate ?? '—'), money(i.invoiceTotal, i.currency), money(i.totalOutstanding, i.currency), jsonDetails('JSON', parseRaw(i.rawJson))])));
    if (activeAccountingTab === 'statements')
        return panel('Statements', 'Statement metadata and counts.', table(['Statement', 'Period', 'Currency', 'Transactions', 'Raw'], snapshot.statements.map(s => [String(s.statementId ?? s.statementSubjectId), `${s.periodStart ?? '—'} → ${s.periodEnd ?? '—'}`, String(s.currency ?? '—'), String(s.transactionCount ?? 0), jsonDetails('JSON', parseRaw(s.rawJson))])));
    if (activeAccountingTab === 'matches')
        return panel('Payment matches', 'Paid/open/review facts.', matchTable(snapshot.matches));
    if (activeAccountingTab === 'suppliers')
        return panel('Suppliers', 'Supplier spend rollups.', table(['Supplier', 'Paid amount', 'Actions'], snapshot.suppliers.map(s => [String(s.supplierName), money(s.amount, s.currency), e('div', { class: 'row' }, ...['month', 'quarter', 'year'].map(period => button(period, async () => { rawResult = await api(`/api/accounting/suppliers/${encodeURIComponent(String(s.supplierName))}/spend?period=${period}`); settings.view = 'runtime'; activeRuntimeTab = 'raw'; render(); }, 'btn small')))])));
    if (activeAccountingTab === 'questions')
        return accountingQuestions();
    const paid = snapshot.matches.filter(m => String(m.status).toLowerCase() === 'paid').length;
    const review = snapshot.matches.filter(m => String(m.status).toLowerCase().includes('review')).length;
    return e('div', { class: 'grid cols-2' }, panel('Summary', null, e('section', { class: 'stat-grid compact' }, metricCard('Invoices', snapshot.invoices.length, ''), metricCard('Statements', snapshot.statements.length, ''), metricCard('Matches', snapshot.matches.length, ''), metricCard('Paid', paid, ''), metricCard('Needs review', review, ''), metricCard('Suppliers', snapshot.suppliers.length, ''))), panel('Recent matches', null, matchTable(snapshot.matches.slice(0, 8))));
}
function accountingQuestions() {
    const q = inputNode('Who are my suppliers?');
    const output = e('div', { class: 'stack' }, empty('Ask a deterministic accounting question.'));
    const ask = async () => {
        if (!q.value.trim())
            return;
        output.replaceChildren(empty('Asking…'));
        try {
            const result = await api(`/api/accounting/questions?query=${encodeURIComponent(q.value)}`);
            output.replaceChildren(e('div', { class: 'row' }, badge(result.supported ? 'supported' : 'unsupported', result.supported ? 'green' : 'yellow'), badge(String(result.queryKind ?? 'question'))), json(result.result ?? result));
        }
        catch (err) {
            output.replaceChildren(empty(messageOf(err)));
        }
    };
    return panel('Accounting questions', null, formNode(ask, e('div', { class: 'row nowrap' }, q, button('Ask', ask, 'btn primary')), e('div', { class: 'row' }, ...['Who are my suppliers?', 'How much did I pay per supplier per quarter?', 'Which invoices are unpaid?', 'Which invoices need review?'].map(text => button(text, async () => { q.value = text; await ask(); }, 'btn small'))), output));
}
function humanView() {
    return e('div', { class: 'page stack-lg' }, pageIntro('Human prompts', ''), e('section', { class: 'stat-grid compact' }, metricCard('Open', snapshot.prompts.filter(p => !terminal(String(p.status ?? ''))).length, ''), metricCard('Total', snapshot.prompts.length, ''), metricCard('Answered', snapshot.prompts.filter(p => String(p.status).toLowerCase() === 'answered').length, '')), panel('Prompt inbox', null, table(['Status', 'Prompt', 'Operation', 'Correlation', 'Expires', 'Actions', 'Raw'], snapshot.prompts.map(p => [
        statusBadge(String(p.status ?? 'unknown')),
        String(p.promptText ?? ''),
        mono(`${p.operationType ?? ''} · ${p.requestId ?? ''}`),
        p.correlationId ? button(String(p.correlationId), async () => { settings.view = 'runtime'; activeRuntimeTab = 'trace'; await loadTrace('correlation', String(p.correlationId)); render(); }, 'btn small ghost') : '—',
        fmtDate(p.expiresAt),
        promptActions(p),
        jsonDetails('JSON', p)
    ]))));
}
function promptActions(p) {
    if (terminal(String(p.status ?? '')))
        return e('span', { class: 'muted' }, 'terminal');
    const answer = inputNode('approve');
    const reason = inputNode('cancelled from UI');
    return e('div', { class: 'stack tight' }, answer, e('div', { class: 'row' }, button('Answer', async () => { await post(`/api/human/prompts/${encodeURIComponent(String(p.promptId))}/answer`, { answer: answer.value }); toast('Prompt answered', String(p.promptId), 'success'); await refreshSafe(); render(); }, 'btn small primary'), button('Cancel', async () => { await post(`/api/human/prompts/${encodeURIComponent(String(p.promptId))}/cancel`, { reason: reason.value }); toast('Prompt cancelled', String(p.promptId), 'success'); await refreshSafe(); render(); }, 'btn small danger')), reason);
}
function runtimeView() {
    const tabs = e('div', { class: 'subnav' }, ...['inspect', 'trace', 'schedule', 'diagnostics', 'raw']
        .map(tab => button(tabLabel(tab), () => { activeRuntimeTab = tab; render(); }, `subnav-pill${activeRuntimeTab === tab ? ' active' : ''}`)));
    return e('div', { class: 'page stack-lg' }, pageIntro('Runtime', ''), tabs, runtimeTab());
}
function runtimeTab() {
    if (activeRuntimeTab === 'diagnostics')
        return diagnosticsPanel();
    if (activeRuntimeTab === 'trace')
        return traceLookupPanel();
    if (activeRuntimeTab === 'schedule')
        return scheduleLookupPanel();
    if (activeRuntimeTab === 'raw')
        return rawView();
    return inspectPanel();
}
function inspectPanel() {
    const id = inputNode(settings.selectedAgentId);
    return e('div', { class: 'grid cols-2' }, panel('Actor inspector', null, formNode(async () => {
        await inspectAgent(id.value);
        settings.selectedAgentId = id.value;
        remember('agentIds', id.value);
        render();
    }, field('Agent id', id), e('div', { class: 'row' }, submit('Inspect actor'), button('Timeline', async () => { await loadTrace('agent', id.value); activeRuntimeTab = 'trace'; render(); }, 'btn')))), panel('Inspector output', settings.selectedAgentId || 'No agent selected', inspectorResult ? e('div', { class: 'stack' }, traceIfAny(inspectorResult), jsonDetails('Raw structure', inspectorResult)) : empty('Inspect an actor to load state, work items, runs, and operations.')));
}
function traceLookupPanel() {
    const kind = selectNode([{ v: 'correlation', l: 'Correlation timeline' }, { v: 'agent', l: 'Agent timeline' }, { v: 'routing', l: 'Routing attempt' }, { v: 'delivery', l: 'Delivery detail' }, { v: 'llm', l: 'LLM request detail' }, { v: 'schedule', l: 'Schedule timeline' }]);
    const id = inputNode('');
    return e('div', { class: 'grid cols-2' }, panel('Trace lookup', null, formNode(async () => { await loadTrace(kind.value, id.value); render(); }, field('Subject kind', kind), field('Subject id', id), submit('Load trace'))), panel('Recent traces', null, remembered.traces.length ? table(['Kind', 'Id', ''], remembered.traces.map((t) => [badge(t.kind), mono(t.id), button('Open', async () => { await loadTrace(t.kind, t.id); render(); }, 'btn small')])) : empty('No recent trace subjects.')), panel('Trace output', null, inspectorResult ? e('div', { class: 'stack' }, traceIfAny(inspectorResult), jsonDetails('Raw structure', inspectorResult)) : empty('Load a trace to inspect the timeline.')));
}
function scheduleLookupPanel() {
    const id = inputNode('');
    return e('div', { class: 'grid cols-2' }, panel('Schedule inspector', null, formNode(async () => { await loadRaw(`/api/schedules/${encodeURIComponent(id.value)}`); render(); }, field('Schedule id', id), e('div', { class: 'row' }, submit('Inspect schedule'), button('Check due', async () => { await postRaw(`/api/schedules/${encodeURIComponent(id.value)}/check-due`); }, 'btn')))), panel('Schedule output', null, inspectorResult ? jsonDetails('Raw structure', inspectorResult) : empty('Inspect a schedule to see state.')));
}
function diagnosticsPanel() {
    return e('div', { class: 'grid cols-2' }, panel('Runtime diagnostics', null, e('div', { class: 'row wrap' }, button('Trace health', () => loadRaw('/api/debug/health'), 'btn small'), button('Ledger health', () => loadRaw('/api/debug/role-agent-ledger/health'), 'btn small'), button('Invariants', () => loadRaw('/api/debug/invariants'), 'btn small'), button('Stuck', () => loadRaw('/api/debug/stuck'), 'btn small'), button('Flush', () => postRaw('/api/debug/flush'), 'btn small primary'))), panel('Diagnostics output', null, inspectorResult ? jsonDetails('Raw structure', inspectorResult) : empty('Run a diagnostic command to see output.')));
}
function rawView() {
    const method = selectNode([{ v: 'GET', l: 'GET' }, { v: 'POST', l: 'POST' }, { v: 'PUT', l: 'PUT' }, { v: 'DELETE', l: 'DELETE' }]);
    const path = inputNode('/api/debug/health');
    const body = textareaNode('{}');
    return e('div', { class: 'grid cols-2' }, panel('Raw API explorer', null, formNode(async () => {
        const init = { method: method.value };
        if (method.value !== 'GET') {
            init.headers = { 'content-type': 'application/json' };
            init.body = body.value.trim() ? JSON.stringify(JSON.parse(body.value)) : '{}';
        }
        rawResult = await request(path.value, init);
        render();
    }, fields(['Method', method], ['Path', path], ['JSON body', body]), submit('Send request'))), panel('Raw response', null, rawResult ? json(rawResult) : empty('No response yet.')));
}
function panel(title, subtitle, body, actions = []) {
    return e('section', { class: 'panel' }, e('div', { class: 'panel-head' }, e('div', {}, e('h2', { class: 'panel-title' }, title), subtitle ? e('p', { class: 'panel-subtitle' }, subtitle) : null), actions.length ? e('div', { class: 'row' }, ...actions) : null), e('div', { class: 'panel-body' }, body));
}
function pageIntro(title, text) {
    return e('section', { class: 'page-intro' }, e('h2', {}, title), text ? e('p', {}, text) : null);
}
function sectionHeader(title, subtitle) {
    return e('div', { class: 'section-head' }, e('h3', {}, title), e('p', {}, subtitle));
}
function actionBar(...children) {
    return e('div', { class: 'toolbar' }, ...children);
}
function metricCard(labelText, value, caption) {
    return e('article', { class: 'metric' }, e('div', { class: 'metric-value' }, String(value)), e('div', { class: 'metric-label' }, labelText), caption ? e('div', { class: 'metric-caption' }, caption) : null);
}
function detailStatGrid(items) {
    return e('div', { class: 'detail-grid' }, ...items.map(([labelText, value]) => e('div', { class: 'detail-item' }, e('div', { class: 'detail-label' }, labelText), e('div', { class: 'detail-value' }, value))));
}
function matchTable(matches) {
    return table(['Status', 'Invoice', 'Supplier', 'Amount', 'Matched', 'Confidence', 'Reason', 'Review'], matches.map(m => [
        statusBadge(String(m.status ?? 'unknown')),
        String(m.invoiceNumber ?? m.invoiceSubjectId ?? '—'),
        String(m.supplierName ?? '—'),
        money(m.invoiceAmount, m.currency),
        `${money(m.matchedAmount, m.currency)}${m.matchedDate ? ` · ${m.matchedDate}` : ''}`,
        `${Math.round(Number(m.confidence ?? 0) * 100)}%`,
        String(m.reason ?? ''),
        m.reviewPromptId ? badge(String(m.reviewPromptId), 'yellow') : '—'
    ]));
}
async function inspectAgent(id) {
    if (!id)
        return;
    const [state, workItems, runs, operations] = await Promise.all([
        api(`/api/agents/${encodeURIComponent(id)}`),
        api(`/api/role-agents/${encodeURIComponent(id)}/work-items?limit=100`),
        api(`/api/role-agents/${encodeURIComponent(id)}/runs?limit=100`),
        api(`/api/role-agents/${encodeURIComponent(id)}/operations?limit=200`)
    ]);
    inspectorResult = { state, workItems, runs, operations };
}
async function inspectArtifact(id) {
    if (!id)
        return;
    artifactDetailResult = await api(`/api/artifacts/${encodeURIComponent(id)}`);
}
async function captureActorTree() {
    actorTreeResult = await api('/api/debug/actor-tree');
}
async function loadSchemaDetail(schemaRef) {
    if (!schemaRef)
        return;
    schemaDetailResult = await api(`/api/schemas/detail?schemaRef=${encodeURIComponent(schemaRef)}`);
}
async function loadTrace(kind, id) {
    if (!id)
        return;
    let path = `/api/debug/correlations/${encodeURIComponent(id)}?includeDetails=true&limit=200`;
    if (kind === 'agent')
        path = `/api/debug/agents/${encodeURIComponent(id)}/timeline?includeDetails=true&limit=200`;
    if (kind === 'routing')
        path = `/api/debug/routing/${encodeURIComponent(id)}?includeDetails=true&limit=200`;
    if (kind === 'delivery')
        path = `/api/debug/deliveries/${encodeURIComponent(id)}`;
    if (kind === 'llm')
        path = `/api/debug/llm/${encodeURIComponent(id)}`;
    if (kind === 'schedule')
        path = `/api/debug/schedules/${encodeURIComponent(id)}/timeline?includeDetails=true&limit=200`;
    inspectorResult = await api(path);
    rememberTrace(kind, id);
}
function traceIfAny(result) {
    const timeline = result?.items ? result : result?.timeline;
    const items = Array.isArray(timeline?.items) ? timeline.items : [];
    if (!items.length)
        return e('div');
    return e('div', { class: 'timeline' }, ...items.map((item) => e('article', { class: 'timeline-item' }, e('div', { class: 'timeline-head' }, e('div', {}, e('div', { class: 'timeline-event' }, String(item.eventType ?? 'event')), e('div', { class: 'timeline-meta' }, `${fmtDate(item.at)} · ${item.actorKind ?? ''} · ${item.actor ?? ''}`)), e('div', { class: 'row' }, item.correlationId ? button('corr', async () => { await loadTrace('correlation', item.correlationId); render(); }, 'btn small ghost') : null, item.deliveryId ? button('delivery', async () => { await loadTrace('delivery', item.deliveryId); render(); }, 'btn small ghost') : null)), e('div', { class: 'trace-summary' }, String(item.summary ?? '')), item.operationKey ? e('div', { class: 'row' }, badge(String(item.operationKey))) : null)));
}
async function loadRaw(path) { inspectorResult = await api(path); }
async function postRaw(path) { inspectorResult = await post(path, {}); }
async function api(path) { return request(path, { method: 'GET' }); }
async function post(path, body) { return request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
async function request(path, init) {
    const response = await fetch(`${settings.baseUrl}${path}`, init);
    const text = await response.text();
    const body = text ? parseRaw(text) : null;
    if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    return body;
}
async function uploadArtifact(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    return request('/api/artifacts', { method: 'POST', body: form });
}
function table(headers, rows) {
    if (!rows.length)
        return empty('No records yet.');
    return e('div', { class: 'table-wrap' }, e('table', {}, e('thead', {}, e('tr', {}, ...headers.map(h => e('th', {}, h)))), e('tbody', {}, ...rows.map(row => e('tr', {}, ...row.map(cell => e('td', {}, cell)))))));
}
function formNode(onSubmit, ...children) {
    return e('form', { class: 'stack', onsubmit: (ev) => { ev.preventDefault(); void Promise.resolve(onSubmit()).catch(err => toast('Operation failed', messageOf(err), 'error')); } }, ...children);
}
function fields(...items) { return e('div', { class: 'form-grid' }, ...items.map(([labelText, node]) => field(labelText, node))); }
function field(labelText, node) { return e('label', { class: 'field' }, e('span', {}, labelText), node); }
function inputNode(value = '', placeholder = '') { return e('input', { class: 'input', value, placeholder }); }
function textareaNode(value = '', placeholder = '') { return e('textarea', { class: 'textarea', value, placeholder }); }
function selectNode(options) { return e('select', { class: 'select' }, ...options.map(o => e('option', { value: o.v }, o.l))); }
function button(text, onClick, className = 'btn') { return e('button', { class: className, type: 'button', onclick: () => void Promise.resolve(onClick()).catch(err => toast('Operation failed', messageOf(err), 'error')) }, text); }
function submit(text) { return e('button', { class: 'btn primary', type: 'submit' }, text); }
function badge(text, tone = '') { return e('span', { class: `badge${tone ? ` ${tone}` : ''}` }, text || '—'); }
function statusBadge(status) {
    const s = status.toLowerCase();
    const tone = s.includes('fail') || s.includes('block') || s.includes('reject') ? 'red' : s.includes('wait') || s.includes('pending') || s.includes('review') || s.includes('unknown') ? 'yellow' : s.includes('idle') || s.includes('paid') || s.includes('complete') || s.includes('healthy') || s.includes('accepted') || s === 'ok' ? 'green' : 'blue';
    return badge(status || 'unknown', tone);
}
function json(value) { return e('pre', { class: 'json' }, JSON.stringify(value, null, 2)); }
function details(summary, body) { return e('details', {}, e('summary', {}, summary), e('div', { class: 'details-body' }, body)); }
function jsonDetails(summary, value) { return details(summary, json(value)); }
function empty(text) { return e('div', { class: 'empty' }, text); }
function mono(text) { return e('span', { class: 'mono' }, text || '—'); }
function e(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined)
            continue;
        if (key === 'class')
            node.className = String(value);
        else if (key === 'style')
            node.setAttribute('style', String(value));
        else if (key.startsWith('on') && typeof value === 'function')
            node.addEventListener(key.slice(2), value);
        else if (key in node)
            node[key] = value;
        else
            node.setAttribute(key, String(value));
    }
    for (const child of children) {
        if (child === null || child === undefined)
            continue;
        node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}
function filterArtifacts(query) {
    const q = query.trim().toLowerCase();
    if (!q)
        return snapshot.artifacts;
    return snapshot.artifacts.filter(a => [idOf(a.artifactId), a.filename, a.mimeType, a.sourceKind].some(value => String(value ?? '').toLowerCase().includes(q)));
}
function filterMetadata(query) {
    const q = query.trim().toLowerCase();
    if (!q)
        return snapshot.metadata;
    return snapshot.metadata.filter(record => [record.subjectId, record.subjectKind, record.schemaRef, record.json].some(value => String(value ?? '').toLowerCase().includes(q)));
}
function filterSchemas(query) {
    const q = query.trim().toLowerCase();
    if (!q)
        return snapshot.schemas;
    return snapshot.schemas.filter(schema => [schema.schemaRef, schema.familyRef, schema.label].some(value => String(value ?? '').toLowerCase().includes(q)));
}
function selectedMetadata() {
    const index = snapshot.metadata.findIndex((record, idx) => metadataKey(record, idx) === settings.selectedMetadataKey);
    return index >= 0 ? snapshot.metadata[index] : null;
}
function metadataKey(record, index) {
    return [record.subjectKind, record.subjectId, record.schemaRef, record.createdAt, index].map(x => String(x ?? '')).join('::');
}
function tabLabel(tab) { return tab.split('-').map(x => x[0].toUpperCase() + x.slice(1)).join(' '); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function idOf(value) { return typeof value === 'string' ? value : typeof value?.value === 'string' ? value.value : ''; }
function readString(value, key) { return typeof value?.[key] === 'string' ? value[key] : ''; }
function parseRaw(raw) { if (typeof raw !== 'string')
    return raw; try {
    return JSON.parse(raw);
}
catch {
    return raw;
} }
function fmtDate(value) { if (!value)
    return '—'; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(); }
function money(value, currency) { const n = Number(value); if (!Number.isFinite(n))
    return '—'; const c = typeof currency === 'string' && currency !== 'UNKNOWN' ? currency : ''; try {
    return c ? new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n) : n.toFixed(2);
}
catch {
    return `${n.toFixed(2)} ${c}`;
} }
function terminal(status) { return ['answered', 'cancelled', 'expired', 'complete', 'completed'].includes(status.toLowerCase()); }
function inferInputType(file) { if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    return 'pdf'; if (file.type.startsWith('image/'))
    return 'image'; return 'artifact'; }
function messageOf(error) { return error instanceof Error ? error.message : String(error); }
function toneForKind(kind) { return kind === 'agent' ? 'blue' : kind === 'gateway' ? 'purple' : kind === 'schedule' ? 'yellow' : 'green'; }
function toast(title, msg, tone = 'info') {
    const root = document.querySelector('.toast-stack') ?? document.body.appendChild(e('div', { class: 'toast-stack' }));
    const item = e('div', { class: `toast ${tone}` }, e('div', { class: 'toast-title' }, title), e('div', { class: 'toast-message' }, msg));
    root.appendChild(item);
    window.setTimeout(() => item.remove(), tone === 'error' ? 8500 : 4200);
}
function loadSettings() {
    try {
        return {
            baseUrl: '',
            view: 'artifacts',
            selectedAgentId: '',
            selectedArtifactId: '',
            selectedMetadataKey: '',
            selectedSchemaRef: '',
            artifactQuery: '',
            metadataQuery: '',
            schemaQuery: '',
            schemaValidationJson: '',
            ...JSON.parse(localStorage.getItem('aven-ui-settings-v3') ?? '{}')
        };
    }
    catch {
        return { baseUrl: '', view: 'artifacts', selectedAgentId: '', selectedArtifactId: '', selectedMetadataKey: '', selectedSchemaRef: '', artifactQuery: '', metadataQuery: '', schemaQuery: '', schemaValidationJson: '' };
    }
}
function saveSettings() { localStorage.setItem('aven-ui-settings-v3', JSON.stringify(settings)); }
function loadRemembered() {
    try {
        return { agentIds: [], artifactIds: [], traces: [], ...JSON.parse(localStorage.getItem('aven-ui-index-v3') ?? '{}') };
    }
    catch {
        return { agentIds: [], artifactIds: [], traces: [] };
    }
}
function saveRemembered() { localStorage.setItem('aven-ui-index-v3', JSON.stringify(remembered)); }
function remember(key, id) { if (!id)
    return; remembered[key] = [id, ...remembered[key].filter((x) => x !== id)].slice(0, 30); saveRemembered(); }
function rememberTrace(kind, id) { remembered.traces = [{ kind, id }, ...remembered.traces.filter((x) => x.kind !== kind || x.id !== id)].slice(0, 30); saveRemembered(); }
//# sourceMappingURL=main.js.map