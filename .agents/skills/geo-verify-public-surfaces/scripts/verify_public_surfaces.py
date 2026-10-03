#!/usr/bin/env python3

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile


USER_AGENT = "Mozilla/5.0 (compatible; AndroperatorGeoVerifier/1.0; +https://androperator.com/)"
CONNECT_TIMEOUT_SECONDS = "5"
MAX_TIME_SECONDS = "20"
RETRY_COUNT = "2"
BOT_USER_AGENTS = {
    "GPTBot": "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
    "ChatGPT-User": "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
    "ClaudeBot": "Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://www.anthropic.com/claudebot)",
    "PerplexityBot": "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://www.perplexity.ai/perplexitybot)",
    "Googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
}


def build_checks(landing_base_url, docs_base_url):
    return [
        {
            "kind": "url",
            "url": f"{landing_base_url}/robots.txt",
            "content_type": r"text/plain",
            "body_pattern": r"(?im)^User-agent:\s+\*",
            "probe_bots": True,
        },
        {
            "kind": "url",
            "url": f"{landing_base_url}/llms.txt",
            "content_type": r"text/plain",
            "body_pattern": r"(?m)^#\s+",
            "probe_bots": True,
        },
        {
            "kind": "url",
            "url": f"{landing_base_url}/llms-full.txt",
            "content_type": r"text/plain",
            "body_pattern": r"(?m)^#\s+",
            "probe_bots": True,
        },
        {
            "kind": "url",
            "url": f"{landing_base_url}/index.md",
            "content_type": r"text/markdown|text/plain",
            "body_pattern": r"(?im)^#\s+Androperator",
            "probe_bots": True,
        },
        {"kind": "url", "url": f"{landing_base_url}/agents/", "content_type": r"text/html"},
        {"kind": "url", "url": f"{landing_base_url}/sitemap.xml", "content_type": r"application/xml|text/xml"},
        {"kind": "redirect", "url": f"{landing_base_url}/agent.md", "location": r"/agents.md"},
        {"kind": "url", "url": f"{landing_base_url}/agents.md", "content_type": r"text/markdown|text/plain"},
        {"kind": "redirect", "url": f"{landing_base_url}/for-agents", "location": r"/agents/"},
        {
            "kind": "url",
            "url": f"{docs_base_url}/robots.txt",
            "content_type": r"text/plain",
            "body_pattern": r"(?im)^User-agent:\s+\*",
            "probe_bots": True,
        },
        {
            "kind": "url",
            "url": f"{docs_base_url}/llms.txt",
            "content_type": r"text/plain",
            "body_pattern": r"(?im)^#\s+Androperator Documentation",
            "probe_bots": True,
        },
        {
            "kind": "url",
            "url": f"{docs_base_url}/llms-full.txt",
            "content_type": r"text/plain",
            "body_pattern": r"(?im)^#\s+Androperator Documentation",
            "probe_bots": True,
        },
        {"kind": "url", "url": f"{docs_base_url}/sitemap.xml", "content_type": r"application/xml|text/xml"},
        {"kind": "url", "url": f"{docs_base_url}/", "content_type": r"text/html"},
        {
            "kind": "url",
            "url": f"{docs_base_url}/ai-agents/node-api-for-agents/",
            "content_type": r"text/html",
            "probe_bots": True,
        },
        {"kind": "url", "url": f"{docs_base_url}/reference/cli-reference/", "content_type": r"text/html"},
    ]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--landing-base-url", default="https://androperator.com")
    parser.add_argument("--docs-base-url", default="https://docs.androperator.com")
    parser.add_argument("--allow-noindex", action="store_true")
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--branch-name")
    return parser.parse_args()


def get_git_branch_name():
    try:
        proc = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    branch = proc.stdout.strip()
    return branch or None


def slugify_branch_name(branch_name):
    slug = branch_name.strip().lower()
    slug = re.sub(r"[^a-z0-9-]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug


def resolve_preview_urls(args):
    branch_name = args.branch_name or os.environ.get("CF_PAGES_BRANCH") or get_git_branch_name()
    if not branch_name:
        raise SystemExit("--preview requires a branch name, either via --branch-name or the current git branch")
    branch_slug = slugify_branch_name(branch_name)
    if not branch_slug:
        raise SystemExit(f"--preview branch name {branch_name!r} cannot be converted to a valid hostname")
    landing = f"https://{branch_slug}.androperator.pages.dev"
    docs = f"https://{branch_slug}.androperator-docs.pages.dev"
    return landing, docs


def run_curl(args):
    proc = subprocess.run(
        [
            "curl",
            "-sSI",
            "--connect-timeout",
            CONNECT_TIMEOUT_SECONDS,
            "--max-time",
            MAX_TIME_SECONDS,
            "--retry",
            RETRY_COUNT,
            "-A",
            USER_AGENT,
            *args,
        ],
        capture_output=True,
        text=True,
        timeout=int(MAX_TIME_SECONDS) + 5,
    )
    return proc.returncode, proc.stdout + proc.stderr


def run_curl_get(url, user_agent=USER_AGENT):
    with tempfile.NamedTemporaryFile(delete=False) as header_file:
        header_path = header_file.name
    try:
        proc = subprocess.run(
            [
                "curl",
                "-sSL",
                "--connect-timeout",
                CONNECT_TIMEOUT_SECONDS,
                "--max-time",
                MAX_TIME_SECONDS,
                "--retry",
                RETRY_COUNT,
                "-A",
                user_agent,
                "-D",
                header_path,
                url,
            ],
            capture_output=True,
            text=True,
            timeout=int(MAX_TIME_SECONDS) + 5,
        )
        header_text = ""
        try:
            with open(header_path, "r", encoding="utf-8", errors="replace") as fh:
                header_text = fh.read()
        except OSError:
            header_text = ""
    finally:
        try:
            os.unlink(header_path)
        except OSError:
            pass
    return proc.returncode, header_text, proc.stdout + proc.stderr


def parse_headers(raw):
    raw = raw.replace("\r\n", "\n")
    blocks = [block.strip() for block in raw.split("\n\n") if block.strip()]
    if not blocks:
        return None, {}
    final = blocks[-1].splitlines()
    status = final[0].strip() if final else ""
    headers = {}
    for line in final[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return status, headers


def fail(url, reasons, status="", headers=None, raw=""):
    return {
        "url": url,
        "ok": False,
        "reasons": reasons,
        "status": status,
        "headers": headers or {},
        "raw": raw,
    }


def is_challenge_page(body):
    return bool(re.search(r"(?is)<title[^>]*>\s*(?:attention required|just a moment|access denied)|<[^>]+(?:id|class)=[\"\'][^\"\']*(?:cf-challenge|challenge-platform)|/cdn-cgi/challenge-platform/", body))


def verify_url(check, allow_noindex=False):
    code, raw = run_curl([check["url"]])
    if code != 0:
        return fail(check["url"], [f"curl failed with exit code {code}"], raw=raw)

    status, headers = parse_headers(raw)
    reasons = []

    if not re.search(r"^HTTP/[0-9.]+\s+200\b", status or "", re.IGNORECASE):
        reasons.append(f"expected final 200, got {status or 'no status line'}")

    content_type = headers.get("content-type", "")
    if not re.search(check["content_type"], content_type, re.IGNORECASE):
        reasons.append(f"unexpected content-type: {content_type or 'missing'}")

    x_robots = headers.get("x-robots-tag", "")
    if not allow_noindex and re.search(r"\bnoindex\b", x_robots, re.IGNORECASE):
        reasons.append(f"unexpected noindex header: {x_robots}")
    if re.search(r"\b(noai|noimageai)\b", x_robots, re.IGNORECASE):
        reasons.append(f"unexpected AI-blocking header: {x_robots}")

    if check.get("body_pattern"):
        get_code, get_headers_text, body = run_curl_get(check["url"])
        if get_code != 0:
            reasons.append(f"GET failed with exit code {get_code}")
        else:
            get_status, _ = parse_headers(get_headers_text)
            if not re.search(r"^HTTP/[0-9.]+\s+200\b", get_status or "", re.IGNORECASE):
                reasons.append(f"expected GET 200, got {get_status or 'no status line'}")
            if not re.search(check["body_pattern"], body, re.IGNORECASE):
                reasons.append("unexpected body content")
            if is_challenge_page(body):
                reasons.append("response body looks like an anti-bot, policy, or fallback page")

    if check.get("probe_bots"):
        bot_failures = probe_bot_access(check["url"], allow_noindex=allow_noindex)
        reasons.extend(bot_failures)

    if reasons:
        return fail(check["url"], reasons, status=status, headers=headers, raw=raw)

    return {
        "url": check["url"],
        "ok": True,
        "reasons": [],
        "status": status,
        "headers": headers,
    }


def probe_bot_access(url, allow_noindex=False):
    failures = []
    for bot_name, user_agent in BOT_USER_AGENTS.items():
        code, header_text, body = run_curl_get(url, user_agent=user_agent)
        if code != 0:
            failures.append(f"{bot_name} GET failed with exit code {code}")
            continue

        status, headers = parse_headers(header_text)
        x_robots = headers.get("x-robots-tag", "")
        cf_mitigated = headers.get("cf-mitigated", "")

        if not re.search(r"^HTTP/[0-9.]+\s+200\b", status or "", re.IGNORECASE):
            failures.append(f"{bot_name} got {status or 'no status line'}")
            continue
        if cf_mitigated:
            failures.append(f"{bot_name} was mitigated by Cloudflare: {cf_mitigated}")
        if re.search(r"\b(noai|noimageai)\b", x_robots, re.IGNORECASE):
            failures.append(f"{bot_name} saw AI-blocking header: {x_robots}")
        if not allow_noindex and re.search(r"\bnoindex\b", x_robots, re.IGNORECASE):
            failures.append(f"{bot_name} saw noindex header: {x_robots}")
        if is_challenge_page(body):
            failures.append(f"{bot_name} received challenge-like body content")
    return failures


def verify_redirect(check):
    code, raw = run_curl([check["url"]])
    if code != 0:
        return fail(check["url"], [f"curl failed with exit code {code}"], raw=raw)

    status, headers = parse_headers(raw)
    reasons = []

    if not re.search(r"^HTTP/[0-9.]+\s+30[178]\b", status or "", re.IGNORECASE):
        reasons.append(f"expected redirect, got {status or 'no status line'}")

    location = headers.get("location", "")
    location_pattern = rf"^(?:{re.escape(check['location'])}|https?://[^/]+{re.escape(check['location'])})$"
    if not re.search(location_pattern, location, re.IGNORECASE):
        reasons.append(f"unexpected redirect target: {location or 'missing'}")

    if reasons:
        return fail(check["url"], reasons, status=status, headers=headers, raw=raw)

    return {
        "url": check["url"],
        "ok": True,
        "reasons": [],
        "status": status,
        "headers": headers,
    }


def main():
    args = parse_args()
    if args.preview and (
        args.landing_base_url == "https://androperator.com"
        and args.docs_base_url == "https://docs.androperator.com"
    ):
        landing_base_url, docs_base_url = resolve_preview_urls(args)
        args.allow_noindex = True
    else:
        landing_base_url = args.landing_base_url.rstrip("/")
        docs_base_url = args.docs_base_url.rstrip("/")

    checks = build_checks(
        landing_base_url,
        docs_base_url,
    )

    results = []
    for check in checks:
        if check["kind"] == "url":
            result = verify_url(check, allow_noindex=args.allow_noindex)
        else:
            result = verify_redirect(check)
        results.append(result)

    passed = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]

    for result in results:
        status = "PASS" if result["ok"] else "FAIL"
        line = f"{status} {result['url']}"
        if result["reasons"]:
            line += " - " + "; ".join(result["reasons"])
        print(line)

    print()
    print("Summary")
    print(f"- passed: {len(passed)}")
    print(f"- failed: {len(failed)}")
    print(f"- overall: {'PASS' if not failed else 'FAIL'}")

    if failed:
        print("- failures:")
        for result in failed:
            print(f"  - {result['url']}: {'; '.join(result['reasons'])}")

    print()
    print(
        "RESULT_JSON:"
        + json.dumps(
            {
                "ok": len(failed) == 0,
                "passed": len(passed),
                "failed": len(failed),
                "landingBaseUrl": landing_base_url,
                "docsBaseUrl": docs_base_url,
                "allowNoindex": args.allow_noindex,
                "results": [
                    {
                        "url": result["url"],
                        "ok": result["ok"],
                        "status": result.get("status", ""),
                        "reasons": result["reasons"],
                        "location": result.get("headers", {}).get("location"),
                        "contentType": result.get("headers", {}).get("content-type"),
                        "xRobotsTag": result.get("headers", {}).get("x-robots-tag"),
                    }
                    for result in results
                ],
            }
        )
    )

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
