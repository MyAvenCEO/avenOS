#!/usr/bin/env python3
"""Manual stdio smoke test for Aven.Sidecar (milestone plan M2 verification).

Spawns the sidecar, sends framed Content-Length requests on stdin, reads framed
responses on stdout, and confirms stdout is protocol-only (logs go to stderr).

Usage: python3 smoke.py /path/to/Aven.Sidecar.dll
"""
import json
import subprocess
import sys
import threading


def frame(obj: dict) -> bytes:
    body = json.dumps(obj).encode("utf-8")
    return f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body


def read_message(stream) -> dict | None:
    # Read header lines until blank line.
    headers = {}
    line = b""
    while True:
        ch = stream.read(1)
        if not ch:
            return None
        line += ch
        if line.endswith(b"\r\n"):
            text = line[:-2].decode("ascii")
            line = b""
            if text == "":
                break
            k, _, v = text.partition(":")
            headers[k.strip().lower()] = v.strip()
    n = int(headers["content-length"])
    body = b""
    while len(body) < n:
        chunk = stream.read(n - len(body))
        if not chunk:
            return None
        body += chunk
    return json.loads(body.decode("utf-8"))


def main() -> int:
    dll = sys.argv[1]
    proc = subprocess.Popen(
        ["dotnet", dll],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    stderr_lines: list[str] = []

    def drain_stderr():
        for raw in proc.stderr:
            stderr_lines.append(raw.decode("utf-8", "replace").rstrip())

    t = threading.Thread(target=drain_stderr, daemon=True)
    t.start()

    requests = [
        {"v": 1, "kind": "request", "id": "hello_1", "method": "session.hello",
         "params": {"client": {"name": "smoke", "version": "0.0.1"}}},
        {"v": 1, "kind": "request", "id": "ping_1", "method": "session.ping"},
        {"v": 1, "kind": "request", "id": "skills_1", "method": "skills.list"},
        {"v": 1, "kind": "request", "id": "roles_1", "method": "roles.list"},
        {"v": 1, "kind": "request", "id": "agents_1", "method": "agents.list"},
        {"v": 1, "kind": "request", "id": "prompts_1", "method": "humanPrompts.list"},
        {"v": 1, "kind": "request", "id": "bad_1", "method": "does.not.exist"},
        {"v": 1, "kind": "request", "id": "shutdown_1", "method": "session.shutdown"},
    ]
    for r in requests:
        proc.stdin.write(frame(r))
    proc.stdin.flush()

    results: dict[str, dict] = {}
    saw_health = False
    # Expect: 1 runtime.health event + one response per request (8).
    expected = len(requests)
    got_responses = 0
    while got_responses < expected:
        msg = read_message(proc.stdout)
        if msg is None:
            break
        if msg.get("kind") == "event":
            if msg.get("method") == "runtime.health":
                saw_health = True
            continue
        if msg.get("kind") == "response":
            results[msg.get("id")] = msg
            got_responses += 1

    proc.wait(timeout=15)
    t.join(timeout=2)

    ok = True

    def check(name, cond):
        nonlocal ok
        status = "PASS" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}")

    print("=== protocol responses ===")
    check("runtime.health event emitted on startup", saw_health)
    check("session.hello returned result", "result" in results.get("hello_1", {}))
    hello = results.get("hello_1", {}).get("result", {})
    check("hello protocolVersion == 1", hello.get("protocolVersion") == 1)
    check("hello server name present", bool(hello.get("server", {}).get("name")))
    check("session.ping ok == true", results.get("ping_1", {}).get("result", {}).get("ok") is True)
    check("skills.list returned a skills array",
          isinstance(results.get("skills_1", {}).get("result", {}).get("skills"), list))
    check("roles.list returned a roles array",
          isinstance(results.get("roles_1", {}).get("result", {}).get("roles"), list))
    check("agents.list returned an agents array",
          isinstance(results.get("agents_1", {}).get("result", {}).get("agents"), list))
    check("humanPrompts.list returned a prompts array",
          isinstance(results.get("prompts_1", {}).get("result", {}).get("prompts"), list))
    bad = results.get("bad_1", {})
    check("unknown method -> error envelope", "error" in bad)
    check("unknown method error code == unknown_method",
          bad.get("error", {}).get("code") == "unknown_method")
    check("session.shutdown returned ok",
          results.get("shutdown_1", {}).get("result", {}).get("ok") is True)
    check("process exited cleanly (rc==0)", proc.returncode == 0)

    print("=== stderr (logs only) ===")
    for ln in stderr_lines[:40]:
        print("  " + ln)

    print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
