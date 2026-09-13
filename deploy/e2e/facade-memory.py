#!/usr/bin/env python3
import argparse, concurrent.futures, http.client, json, pathlib, select, subprocess, time, urllib.request, urllib.error, uuid
parser = argparse.ArgumentParser(description='Prove facade admission in a disposable 768 MiB container; uses synthetic bodies and a stalled model transport.')
parser.add_argument('--image', default='aven-e2e-api:local', help='An existing image containing Bun 1.3.13; no image is pulled.')
parser.add_argument('--source', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[2])
parser.add_argument('--expect-oom', action='store_true', help='Baseline reproduction only: expect this disposable container to run out of memory.')
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('/tmp/facade-memory.json'))
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[2]
source = args.source.resolve()
mode = 'baseline' if args.expect_oom else 'fixed'

def run(*args):
    return subprocess.check_output(args, text=True).strip()
name = 'aven-ingest-memory-' + uuid.uuid4().hex[:12]
entry = '/proof/services/aven-api/tests/support/memory-facade.ts'
container = run('docker', 'run', '--detach', '--pull', 'never', '--name', name, '--memory', '768m', '--memory-swap', '768m', '--cpus', '2', '--read-only', '--tmpfs', '/tmp:size=64m', '-p', '127.0.0.1::9093', '-v', str(root) + ':/proof:ro', '-v', str(source) + ':/target:ro', '-e', 'FACADE_SOURCE_ROOT=/target', '--entrypoint', 'bun', args.image, entry)
try:
    port = run('docker', 'port', container, '9093/tcp').split(':')[-1]
    base = 'http://127.0.0.1:' + port

    def get(path):
        with urllib.request.urlopen(base + path, timeout=2) as response:
            return json.load(response)
    for _ in range(60):
        try:
            initial = get('/stats')
            break
        except Exception:
            time.sleep(0.25)
    else:
        raise RuntimeError(run('docker', 'logs', container))
    image = {'type': 'image', 'mediaType': 'image/png', 'base64': 'A' * (13 * 1024 * 1024)}
    body = json.dumps({'modelId': 'memory-proof', 'messages': [{'role': 'user', 'content': [image] * 4}]}).encode()

    def post():
        connection = http.client.HTTPConnection('127.0.0.1', int(port), timeout=30)
        try:
            connection.putrequest('POST', '/internal/v1/llm/completions')
            connection.putheader('authorization', 'Bearer ' + 'disposable-memory-proof'.ljust(32, '-'))
            connection.putheader('content-type', 'application/json')
            connection.putheader('content-length', str(len(body)))
            connection.endheaders()
            view = memoryview(body)
            for offset in range(0, len(body), 65536):
                if select.select([connection.sock], [], [], 0)[0]:
                    break
                try:
                    connection.send(view[offset:offset + 65536])
                except BrokenPipeError:
                    break
            response = connection.getresponse()
            response.read()
            return response.status
        except Exception as error:
            return type(error).__name__
        finally:
            connection.close()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        pending = [pool.submit(post) for _ in range(8)]
        samples = []
        for _ in range(60):
            try:
                sample = get('/stats')
                samples.append(sample)
                if mode == 'fixed' and sample['active'] == 2 and (sum((f.done() for f in pending)) >= 6) or sample['active'] == 8:
                    break
            except Exception:
                break
            time.sleep(0.25)
        try:
            get('/release')
        except Exception:
            pass
        statuses = [f.result() for f in pending]
    state = json.loads(run('docker', 'inspect', '--format', '{{json .State}}', container))
    evidence = {'mode': mode, 'requestBytes': len(body), 'concurrency': 8, 'initial': initial, 'samples': samples, 'statuses': statuses, 'oomKilled': state['OOMKilled']}
    if mode == 'fixed':
        evidence['after'] = get('/stats')
        evidence['retryStatuses'] = [post() for _ in range(6)]
        evidence['final'] = get('/stats')
        assert statuses.count(200) == 2 and statuses.count(503) == 6, evidence
        assert not state['OOMKilled'] and evidence['retryStatuses'] == [200] * 6, evidence
        assert evidence['final']['peak'] < 768 * 1024 * 1024, evidence
    else:
        assert state['OOMKilled'], evidence
    args.output.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({key: value for (key, value) in evidence.items() if key != 'samples'}))
finally:
    subprocess.run(['docker', 'rm', '--force', container], check=True, stdout=subprocess.DEVNULL)
