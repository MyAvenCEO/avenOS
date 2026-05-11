import { Buffer } from 'buffer';
import { extname, basename } from 'path';
import { runWorkerTask } from '../worker.js';
const MAX_EXTRACTED_TEXT_CHARS = 12000;
export async function runExtractSkill(intent, action, deps) {
    const skillDoc = deps.skillRegistry.extract?.doc;
    if (!skillDoc)
        return { skill: 'extract', ok: false, summary: 'Extract skill is not registered' };
    const key = typeof action.input.key === 'string'
        ? action.input.key
        : typeof action.input.archiveKey === 'string'
            ? action.input.archiveKey
            : typeof action.input.source === 'string'
                ? action.input.source
            : undefined;
    if (!key)
        return { skill: 'extract', ok: false, summary: 'No archive key provided' };
    const archived = await deps.storage.archive.get(key);
    if (!archived)
        return { skill: 'extract', ok: false, summary: `Archive ${key} not found` };
    const contentType = typeof action.input.contentType === 'string' ? action.input.contentType : undefined;
    const sandboxFilePath = buildSandboxInputPath(key, archived.contentType ?? contentType);
    const worker = await runWorkerTask({
        sandboxFactory: deps.sandboxFactory,
        intent,
        skill: 'extract',
        workerType: action.operation,
        skillDoc,
        task: action.input,
        files: [{ path: sandboxFilePath, content: archived.content }],
        command: buildExtractCommand(sandboxFilePath, contentType ?? archived.contentType)
    });
    const text = truncateExtractedText(selectExtractedText(worker.stdout, extractTextFromBytes(archived.content, key, archived.contentType)));
    if (action.operation === 'extract-entities') {
        return { skill: 'extract', ok: worker.exitCode === 0, summary: `Extracted entities from ${key}`, data: { key, entities: extractEntities(text), text, worker: truncateWorkerOutput(worker) } };
    }
    return { skill: 'extract', ok: worker.exitCode === 0, summary: `Extracted text from ${key}`, data: { key, text, worker: truncateWorkerOutput(worker) } };
}
function buildExtractCommand(sandboxPath, contentType) {
    const source = `/workspace/${shellEscape(sandboxPath)}`;
    const hintedType = contentType ? shellEscape(contentType) : "''";
    return `test -f ${source} && SOURCE=${source} CONTENT_TYPE_HINT=${hintedType} /bin/bash <<'EOF'
set -euo pipefail

source_path="$SOURCE"
mime=$(file -b --mime-type "$source_path" 2>/dev/null || true)
desc=$(file -b "$source_path" 2>/dev/null || true)
content_type_hint="$CONTENT_TYPE_HINT"
[ -n "$mime" ] || mime="$content_type_hint"
printf 'ANALYSIS mime=%s desc=%s\n' "$mime" "$desc" >&2

limit_output() {
	head -c 12000
}

print_if_meaningful() {
	local output
	output=$(cat)
	if [ -n "$(printf '%s' "$output" | tr -d '[:space:]')" ]; then
		printf '%s' "$output" | limit_output
		return 0
	fi
	return 1
}

run_attempt() {
	local cmd="$1"
	sh -lc "$cmd" 2>/dev/null | print_if_meaningful
}

case "$mime" in
	application/pdf)
		found=""
		for attempt in \
			"pdftotext -layout \"$source_path\" -" \
			"pdftotext \"$source_path\" -" \
			"pdfinfo \"$source_path\"" \
			"strings \"$source_path\""
		do
			output=$(sh -lc "$attempt" 2>/dev/null | limit_output || true)
			if [ -n "$(printf '%s' "$output" | tr -d '[:space:]')" ]; then
				printf '%s\n' "$output"
				if printf '%s' "$output" | grep -Eiq 'invoice|reference number|subtotal|total|vat|amount'; then
					found=1
					break
				fi
			fi
		done
		[ -n "$found" ]
		;;
	image/png|image/jpeg|image/jpg|image/webp|image/tiff|image/bmp)
		if command -v tesseract >/dev/null 2>&1; then
			tesseract "$source_path" stdout 2>/dev/null | limit_output | print_if_meaningful
		else
			printf 'OCR is not available in the sandbox for %s.\n' "$desc" | limit_output
		fi
		;;
	text/html|application/xhtml+xml)
		sed 's/<[^>]*>/ /g' "$source_path" | tr -s '[:space:]' ' ' | limit_output
		;;
	text/*|application/json|application/xml|text/csv)
		cat "$source_path" | limit_output
		;;
	*)
		if grep -Iq . "$source_path" 2>/dev/null; then
			cat "$source_path" | limit_output
		else
			printf 'Binary file detected (%s). No safe extractor matched.\n' "$desc" | limit_output
		fi
		;;
esac
EOF`;
}

function buildSandboxInputPath(key, contentType) {
    const extension = extname(key).toLowerCase() || extensionFromType(contentType);
    return `input/source${extension === '.bin' ? '' : extension}`;
}
function selectExtractedText(workerStdout, fallback) {
    const trimmed = workerStdout.trim();
    if (!trimmed)
        return fallback;
    if (trimmed === 'ok' || trimmed.startsWith('worker:'))
        return fallback;
    return trimmed;
}
function shellEscape(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function extractTextFromBytes(content, key, contentType) {
    const extension = extname(key).toLowerCase() || extensionFromType(contentType);
    if (['.txt', '.md', '.json', '.html', '.htm', '.csv'].includes(extension)) {
        const text = Buffer.from(content).toString('utf-8');
        return truncateExtractedText(extension === '.html' || extension === '.htm' ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : text);
    }
    return `Text extraction is not implemented for ${basename(key)}.`;
}
function truncateExtractedText(text) {
    if (text.length <= MAX_EXTRACTED_TEXT_CHARS)
        return text;
    return `${text.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n…[truncated]`;
}
function truncateWorkerOutput(worker) {
    return {
        ...worker,
        stdout: truncateExtractedText(worker.stdout),
        stderr: truncateExtractedText(worker.stderr)
    };
}
function extractEntities(text) {
    return [...new Set((text.match(/\b[A-Z][a-zA-Z0-9#-]{2,}\b/g) ?? []).slice(0, 20))];
}
function extensionFromType(contentType) {
    if (!contentType)
        return '.bin';
    if (contentType.includes('json'))
        return '.json';
    if (contentType.includes('html'))
        return '.html';
    if (contentType.includes('text/plain'))
        return '.txt';
    if (contentType.includes('markdown'))
        return '.md';
    return '.bin';
}
