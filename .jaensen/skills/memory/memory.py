#!/usr/bin/env python3
import argparse
import fcntl
import json
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(ROOT, "store.json")
LOCK = os.path.join(ROOT, "store.lock")


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def normalize(value):
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "-", normalize(value)).strip("-")
    return slug or "general"


def empty_store():
    return {
        "version": 1,
        "topics": {},
    }


def load_store():
    if not os.path.exists(STORE):
        return empty_store()

    with open(STORE, "r", encoding="utf-8") as handle:
        return json.load(handle)


def save_store(data):
    if os.path.exists(STORE):
        shutil.copy2(STORE, STORE + ".bak")

    fd, path = tempfile.mkstemp(
        prefix="store.",
        suffix=".json",
        dir=ROOT,
        text=True,
    )

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())

        os.replace(path, STORE)
    finally:
        if os.path.exists(path):
            os.unlink(path)


def with_locked_store(callback):
    os.makedirs(ROOT, exist_ok=True)

    with open(LOCK, "w", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)

        data = load_store()
        result = callback(data)
        save_store(data)

        return result


def topic_score(query, candidate):
    query_norm = normalize(query)
    candidate_norm = normalize(candidate)

    if not query_norm or not candidate_norm:
        return 0.0

    score = SequenceMatcher(None, query_norm, candidate_norm).ratio()

    is_safe_substring_match = (
        len(query_norm) >= 4
        and len(candidate_norm) >= 4
        and (query_norm in candidate_norm or candidate_norm in query_norm)
    )

    if is_safe_substring_match:
        score = max(score, 0.86)

    return score


def find_topic(data, topic):
    best_key = None
    best_score = 0.0

    for key, value in data["topics"].items():
        names = [key, value.get("label", key), *value.get("aliases", [])]

        for name in names:
            score = topic_score(topic, name)

            if score > best_score:
                best_key = key
                best_score = score

    return best_key, best_score


def list_topics(data):
    return [
        {
            "topic_key": key,
            "topic": value["label"],
            "count": len(value.get("items", [])),
            "updated_at": value.get("updated_at"),
        }
        for key, value in sorted(data["topics"].items())
    ]


def ensure_topic(data, label):
    existing_key, score = find_topic(data, label)

    if existing_key is not None and score >= 0.82:
        return existing_key, score, False

    base_key = slugify(label)
    key = base_key
    index = 2

    while key in data["topics"]:
        key = f"{base_key}-{index}"
        index += 1

    now = utc_now()

    data["topics"][key] = {
        "label": label.strip() or "General",
        "aliases": [],
        "items": [],
        "created_at": now,
        "updated_at": now,
    }

    return key, 1.0, True


def cmd_topics(_args):
    return {"topics": list_topics(load_store())}


def cmd_add(args):
    text = args.text.strip()

    if not text:
        raise SystemExit("--text must not be empty")

    def operation(data):
        key, score, created = ensure_topic(data, args.topic)
        topic = data["topics"][key]
        now = utc_now()

        item = {
            "id": uuid.uuid4().hex[:12],
            "text": text,
            "tags": args.tag or [],
            "created_at": now,
            "updated_at": now,
        }

        topic["items"].append(item)
        topic["updated_at"] = now

        return {
            "saved": True,
            "created_topic": created,
            "matched_score": round(score, 3),
            "topic_key": key,
            "topic": topic["label"],
            "item": item,
        }

    return with_locked_store(operation)


def cmd_get(args):
    data = load_store()
    key, score = find_topic(data, args.topic)

    if key is None or score < 0.65:
        return {
            "found": False,
            "message": "No matching topic found.",
            "known_topics": list_topics(data),
        }

    topic = data["topics"][key]

    return {
        "found": True,
        "matched_score": round(score, 3),
        "topic_key": key,
        "topic": topic["label"],
        "items": topic.get("items", []),
    }


def cmd_search(args):
    query = normalize(args.query)
    data = load_store()
    results = []

    for key, topic in data["topics"].items():
        topic_text = " ".join(
            [
                topic.get("label", ""),
                " ".join(topic.get("aliases", [])),
                " ".join(item.get("text", "") for item in topic.get("items", [])),
                " ".join(
                    tag
                    for item in topic.get("items", [])
                    for tag in item.get("tags", [])
                ),
            ]
        )

        haystack = normalize(topic_text)
        label_score = topic_score(args.query, topic.get("label", key))
        text_matches = query and query in haystack

        if text_matches or label_score >= 0.65:
            results.append(
                {
                    "topic_key": key,
                    "topic": topic["label"],
                    "matched_score": round(label_score, 3),
                    "items": topic.get("items", []),
                }
            )

    return {
        "found": len(results) > 0,
        "results": results,
    }


def cmd_delete(args):
    def operation(data):
        for key, topic in data["topics"].items():
            original_items = topic.get("items", [])
            remaining_items = [
                item for item in original_items if item.get("id") != args.id
            ]

            if len(remaining_items) != len(original_items):
                topic["items"] = remaining_items
                topic["updated_at"] = utc_now()

                return {
                    "deleted": True,
                    "topic_key": key,
                    "topic": topic["label"],
                    "id": args.id,
                }

        return {
            "deleted": False,
            "id": args.id,
        }

    return with_locked_store(operation)


def cmd_rename_topic(args):
    def operation(data):
        key, score = find_topic(data, args.old)

        if key is None or score < 0.65:
            return {
                "renamed": False,
                "message": "No matching topic found.",
                "known_topics": list_topics(data),
            }

        topic = data["topics"][key]
        old_label = topic["label"]

        if old_label not in topic["aliases"]:
            topic["aliases"].append(old_label)

        topic["label"] = args.new.strip()
        topic["updated_at"] = utc_now()

        return {
            "renamed": True,
            "topic_key": key,
            "old_topic": old_label,
            "new_topic": topic["label"],
        }

    return with_locked_store(operation)


def main():
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)

    topics = subcommands.add_parser("topics")
    topics.set_defaults(handler=cmd_topics)

    add = subcommands.add_parser("add")
    add.add_argument("--topic", required=True)
    add.add_argument("--text", required=True)
    add.add_argument("--tag", action="append")
    add.set_defaults(handler=cmd_add)

    get = subcommands.add_parser("get")
    get.add_argument("--topic", required=True)
    get.set_defaults(handler=cmd_get)

    search = subcommands.add_parser("search")
    search.add_argument("--query", required=True)
    search.set_defaults(handler=cmd_search)

    delete = subcommands.add_parser("delete")
    delete.add_argument("--id", required=True)
    delete.set_defaults(handler=cmd_delete)

    rename = subcommands.add_parser("rename-topic")
    rename.add_argument("--old", required=True)
    rename.add_argument("--new", required=True)
    rename.set_defaults(handler=cmd_rename_topic)

    args = parser.parse_args()
    result = args.handler(args)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
