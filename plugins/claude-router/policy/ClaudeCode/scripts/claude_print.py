#!/usr/bin/env python3
"""
Run Anthropic `claude -p` with machine-readable defaults.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Wrapper for `claude -p` with JSON-first defaults."
    )
    parser.add_argument("prompt", help="Instruction prompt passed to `claude -p`.")
    parser.add_argument(
        "--output-format",
        choices=("text", "json", "stream-json"),
        default="json",
        help="Claude print-mode output format.",
    )
    parser.add_argument(
        "--schema-file",
        type=Path,
        help="Path to a JSON Schema file passed to `--json-schema`.",
    )
    parser.add_argument(
        "--schema-json",
        help="Inline JSON Schema string passed to `--json-schema`.",
    )
    parser.add_argument(
        "--permission-mode",
        default="default",
        help="Claude permission mode. Default: default.",
    )
    parser.add_argument(
        "--settings",
        help="Path to a settings JSON file or inline JSON string.",
    )
    parser.add_argument(
        "--setting-sources",
        help="Comma-separated settings sources (user, project, local).",
    )
    parser.add_argument(
        "--mcp-config",
        action="append",
        default=[],
        help="Additional MCP config file or inline JSON. Repeatable.",
    )
    parser.add_argument(
        "--plugin-dir",
        action="append",
        default=[],
        help="Plugin directory to load for this session. Repeatable.",
    )
    parser.add_argument("--agent", help="Claude agent name.")
    parser.add_argument("--agents-json", help="Inline JSON object for `--agents`.")
    parser.add_argument("--model", help="Claude model override.")
    parser.add_argument("--effort", help="Claude effort override.")
    parser.add_argument(
        "--input-format",
        choices=("text", "stream-json"),
        help="Print-mode input format.",
    )
    parser.add_argument(
        "--max-budget-usd",
        type=float,
        help="Budget cap for print mode.",
    )
    parser.add_argument(
        "--include-hook-events",
        action="store_true",
        help="Include hook events in stream-json output.",
    )
    parser.add_argument(
        "--include-partial-messages",
        action="store_true",
        help="Include partial chunks in stream-json output.",
    )
    parser.add_argument(
        "--no-session-persistence",
        action="store_true",
        help="Disable saved sessions for this run.",
    )
    parser.add_argument(
        "--bare",
        action="store_true",
        help="Add `--bare` for isolated print-mode runs.",
    )
    return parser.parse_args()


def normalized_schema(args: argparse.Namespace) -> str | None:
    if args.schema_file and args.schema_json:
        raise SystemExit("Use only one of --schema-file or --schema-json.")

    if args.schema_file:
        data = json.loads(args.schema_file.read_text())
        return json.dumps(data, separators=(",", ":"))

    if args.schema_json:
        data = json.loads(args.schema_json)
        return json.dumps(data, separators=(",", ":"))

    return None


def build_command(args: argparse.Namespace) -> list[str]:
    command = [
        "claude",
        "-p",
        "--output-format",
        args.output_format,
        "--permission-mode",
        args.permission_mode,
    ]

    if args.bare:
        command.append("--bare")

    schema = normalized_schema(args)
    if schema:
        command.extend(["--json-schema", schema])

    if args.settings:
        command.extend(["--settings", args.settings])
    if args.setting_sources:
        command.extend(["--setting-sources", args.setting_sources])
    if args.agent:
        command.extend(["--agent", args.agent])
    if args.agents_json:
        command.extend(["--agents", args.agents_json])
    if args.model:
        command.extend(["--model", args.model])
    if args.effort:
        command.extend(["--effort", args.effort])
    if args.input_format:
        command.extend(["--input-format", args.input_format])
    if args.max_budget_usd is not None:
        command.extend(["--max-budget-usd", str(args.max_budget_usd)])
    if args.include_hook_events:
        command.append("--include-hook-events")
    if args.include_partial_messages:
        command.append("--include-partial-messages")
    if args.no_session_persistence:
        command.append("--no-session-persistence")

    for value in args.mcp_config:
        command.extend(["--mcp-config", value])
    for value in args.plugin_dir:
        command.extend(["--plugin-dir", value])

    command.append(args.prompt)
    return command


def main() -> int:
    args = parse_args()
    command = build_command(args)

    stdin_data = None
    if not sys.stdin.isatty():
        stdin_data = sys.stdin.buffer.read()

    result = subprocess.run(command, input=stdin_data)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
