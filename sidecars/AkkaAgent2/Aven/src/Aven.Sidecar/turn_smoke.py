#!/usr/bin/env python3
"""M8 turn smoke: register an agent, submit a text turn with a replyId, and observe any
correlated agent.* / run lifecycle events arriving on stdout. Proves the live-event path
through the real sidecar process (events may be absent if routing rejects the message in a
bare dev env with no LLM — that is reported honestly)."""
import json
import subprocess
import sys
import threading
import time


def frame(obj):
    body = json.dumps(obj).encode()
    return f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body


def reader_thread(stream, events, responses):
    buf = b""

    def read_msg():
        headers = {}
        line = b""
        while True:
            ch = stream.read(1)
            if not ch:
                return None
            line += ch
            if line.endswith(b"\r\n"):
                t = line[:-2].decode()
                line = b""
                if t == "":
                    break
                k, _, v = t.partition(":")
                headers[k.strip().lower()] = v.strip()
        n = int(headers["content-length"])
        body = b""
        while len(body) < n:
            body += stream.read(n - len(body))
        return json.loads(body)

    while True:
        m = read_msg()
        if m is None:
            return
        if m.get("kind") == "event":
            events.append(m)
        elif m.get("kind") == "response":
            responses[m.get("id")] = m


def main():
    dll = sys.argv[1]
    proc = subprocess.Popen(["dotnet", dll], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    events, responses = [], {}
    threading.Thread(target=reader_thread, args=(proc.stdout, events, responses), daemon=True).start()

    def send(obj):
        proc.stdin.write(frame(obj))
        proc.stdin.flush()

    # Unique ids per run: the sidecar persists state at the default data root, so a fixed
    # messageId would be deduplicated (idempotent) on a second run and produce no new run.
    uniq = str(int(time.time() * 1000))
    msg_id, reply_id = f"msg-{uniq}", f"reply-{uniq}"

    send({"v": 1, "kind": "request", "id": "hello", "method": "session.hello"})
    send({"v": 1, "kind": "request", "id": "create", "method": "agents.create", "params": {
        "roleAgentId": f"agent-turn-{uniq}", "roleName": "assistant", "displayName": "Turn Smoke",
        "objective": "answer chat", "responsibilityScope": "chat", "acceptedInputTypes": ["text"]}})
    time.sleep(1.0)
    send({"v": 1, "kind": "request", "id": "submit", "method": "messages.submit", "params": {
        "identityId": "ident-1", "messageId": msg_id, "replyId": reply_id,
        "text": "hello there", "sourceView": "talk", "attachments": []}})

    time.sleep(8.0)
    submit = responses.get("submit", {})
    status = (submit.get("result") or {}).get("status")
    agent_events = [e for e in events if (e.get("event") or {}).get("replyId") == reply_id]
    print("submit status:", status)
    print("submit agentId:", (submit.get("result") or {}).get("agentId"))
    print("event methods seen:", [e.get("method") for e in events])
    print("events correlated to reply-1:", [e.get("method") for e in agent_events])

    send({"v": 1, "kind": "request", "id": "shutdown", "method": "session.shutdown"})
    proc.wait(timeout=15)


if __name__ == "__main__":
    main()
