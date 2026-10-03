#!/usr/bin/env python3

import argparse
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urljoin


ACCOUNT_ENV = "ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID"
TOKEN_ENV = "ANDROPERATOR_CLOUDFLARE_DOCS_WRANGLER_API_TOKEN"
DEFAULT_LANDING_BASE_URL = "https://androperator.com"
DEFAULT_DOCS_BASE_URL = "https://docs.androperator.com"
MAX_RETRIES = 1


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--landing-base-url", default=os.environ.get("GEO_LANDING_BASE_URL", DEFAULT_LANDING_BASE_URL))
    parser.add_argument("--docs-base-url", default=os.environ.get("GEO_DOCS_BASE_URL", DEFAULT_DOCS_BASE_URL))
    parser.add_argument("--static-limit", type=int, default=25)
    parser.add_argument("--rendered-limit", type=int, default=5)
    parser.add_argument("--crawl-depth", type=int, default=2)
    parser.add_argument("--poll-attempts", type=int, default=8)
    parser.add_argument("--poll-interval-seconds", type=float, default=3.0)
    parser.add_argument("--request-timeout-seconds", type=float, default=20.0)
    parser.add_argument("--request-spacing-seconds", type=float, default=0.5)
    parser.add_argument("--include-rendered-comparison", action="store_true")
    return parser.parse_args()


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def critical_urls(landing_base_url, docs_base_url):
    return {
        "landing": [
            f"{landing_base_url}/robots.txt",
            f"{landing_base_url}/llms.txt",
            f"{landing_base_url}/llms-full.txt",
            f"{landing_base_url}/index.md",
            f"{landing_base_url}/agents",
            f"{landing_base_url}/sitemap.xml",
        ],
        "docs": [
            f"{docs_base_url}/robots.txt",
            f"{docs_base_url}/llms.txt",
            f"{docs_base_url}/llms-full.txt",
            f"{docs_base_url}/sitemap.xml",
            f"{docs_base_url}/ai-agents/node-api-for-agents/",
            f"{docs_base_url}/reference/cli-reference/",
        ],
    }


def crawl_expected_urls(landing_base_url, docs_base_url):
    return {
        "landing": [
            landing_base_url,
            f"{landing_base_url}/",
            f"{landing_base_url}/agents",
            f"{landing_base_url}/index.md",
        ],
        "docs": [
            docs_base_url,
            f"{docs_base_url}/",
            f"{docs_base_url}/ai-agents/node-api-for-agents/",
            f"{docs_base_url}/reference/cli-reference/",
        ],
    }


def markdown_probe_specs(landing_base_url, docs_base_url):
    return [
        {
            "label": "landing-homepage",
            "url": landing_base_url,
            "min_length": 400,
            "patterns": [
                r"Androperator",
                r"Node API|node api",
            ],
        },
        {
            "label": "landing-index-markdown",
            "url": f"{landing_base_url}/index.md",
            "min_length": 200,
            "patterns": [
                r"Androperator",
                r"docs\.androperator\.com",
            ],
        },
        {
            "label": "docs-node-api",
            "url": f"{docs_base_url}/ai-agents/node-api-for-agents/",
            "min_length": 1000,
            "patterns": [
                r"Node API",
                r"Androperator-Result|commandId|taskId",
            ],
        },
        {
            "label": "docs-cli-reference",
            "url": f"{docs_base_url}/reference/cli-reference/",
            "min_length": 500,
            "patterns": [
                r"CLI|cli",
                r"androperator",
            ],
        },
    ]


def link_probe_specs(landing_base_url, docs_base_url):
    return [
        {
            "label": "landing-homepage-links",
            "url": landing_base_url,
            "expected_links": [
                f"{docs_base_url}/ai-agents/node-api-for-agents/",
                f"{docs_base_url}/reference/cli-reference/",
                f"{docs_base_url}/reference/api-overview/",
                f"{landing_base_url}/index.md",
                f"{landing_base_url}/agents",
            ],
        },
        {
            "label": "docs-homepage-links",
            "url": docs_base_url,
            "expected_links": [
                f"{docs_base_url}/ai-agents/node-api-for-agents/",
                f"{docs_base_url}/reference/cli-reference/",
                f"{docs_base_url}/reference/api-overview/",
            ],
        },
    ]


def crawl_specs(args):
    landing_base_url = args.landing_base_url.rstrip("/")
    docs_base_url = args.docs_base_url.rstrip("/")
    specs = [
        {
            "label": "landing-static-crawl",
            "url": landing_base_url,
            "body": {
                "url": f"{landing_base_url}/landing-sitemap.xml",
                "limit": args.static_limit,
                "depth": args.crawl_depth,
                "formats": ["markdown"],
                "render": False,
                "source": "sitemaps",
                "options": {
                    "includePatterns": [f"{landing_base_url}/**"],
                    "excludePatterns": [],
                },
            },
        },
        {
            "label": "docs-static-crawl",
            "url": docs_base_url,
            "body": {
                "url": docs_base_url,
                "limit": args.static_limit,
                "depth": args.crawl_depth,
                "formats": ["markdown"],
                "render": False,
                "source": "sitemaps",
                "options": {
                    "includePatterns": [f"{docs_base_url}/**"],
                    "excludePatterns": [],
                },
            },
        },
    ]
    if args.include_rendered_comparison:
        specs.extend(
            [
                {
                    "label": "landing-rendered-sample",
                    "url": landing_base_url,
                    "body": {
                        "url": landing_base_url,
                        "limit": args.rendered_limit,
                        "depth": 1,
                        "formats": ["markdown"],
                        "render": True,
                        "source": "links",
                        "options": {
                            "includePatterns": [f"{landing_base_url}/**"],
                            "excludePatterns": [],
                        },
                    },
                },
                {
                    "label": "docs-rendered-sample",
                    "url": docs_base_url,
                    "body": {
                        "url": docs_base_url,
                        "limit": args.rendered_limit,
                        "depth": 1,
                        "formats": ["markdown"],
                        "render": True,
                        "source": "links",
                        "options": {
                            "includePatterns": [f"{docs_base_url}/**"],
                            "excludePatterns": [],
                        },
                    },
                },
            ]
        )
    return specs


class CloudflareClient:
    def __init__(self, account_id, token, timeout_seconds, spacing_seconds):
        self.account_id = account_id
        self.token = token
        self.timeout_seconds = timeout_seconds
        self.spacing_seconds = spacing_seconds
        self.last_request_started_at = None

    def api_request(self, method, path, payload=None, query=None):
        if self.last_request_started_at is not None:
            elapsed = time.time() - self.last_request_started_at
            if elapsed < self.spacing_seconds:
                time.sleep(self.spacing_seconds - elapsed)
        self.last_request_started_at = time.time()
        url = f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/browser-rendering/{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = None
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(url, data=data, method=method, headers=headers)

        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    body = response.read().decode("utf-8", "replace")
                    parsed = json.loads(body) if body else {}
                    return {
                        "ok": True,
                        "status_code": response.status,
                        "headers": dict(response.headers.items()),
                        "data": parsed,
                    }
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", "replace")
                parsed = json.loads(body) if body else {}
                last_error = {
                    "ok": False,
                    "status_code": exc.code,
                    "headers": dict(exc.headers.items()),
                    "data": parsed,
                }
                # Retry only on server error (5xx) or rate limit (429)
                if exc.code is not None and (exc.code >= 500 or exc.code == 429):
                    if attempt < MAX_RETRIES - 1:
                        time.sleep(self.spacing_seconds)
                        continue
                return last_error
            except urllib.error.URLError as exc:
                last_error = {
                    "ok": False,
                    "status_code": None,
                    "headers": {},
                    "data": {
                        "success": False,
                        "errors": [{"message": str(exc.reason)}],
                    },
                }
                if attempt < MAX_RETRIES - 1:
                    time.sleep(self.spacing_seconds)
                    continue
                return last_error
            except (TimeoutError, socket.timeout, OSError) as exc:
                last_error = {
                    "ok": False,
                    "status_code": None,
                    "headers": {},
                    "data": {
                        "success": False,
                        "errors": [{"message": getattr(exc, "strerror", None) or "request timed out"}],
                    },
                }
                if attempt < MAX_RETRIES - 1:
                    time.sleep(self.spacing_seconds)
                    continue
                return last_error
        return last_error or {
            "ok": False,
            "status_code": None,
            "headers": {},
            "data": {
                "success": False,
                "errors": [{"message": "request retries exhausted"}],
            },
        }
def safe_error_messages(response):
    errors = response.get("data", {}).get("errors") or []
    messages = []
    for error in errors:
        code = error.get("code")
        message = error.get("message", "unknown error")
        if code is None:
            messages.append(message)
        else:
            messages.append(f"{code}: {message}")
    return messages


def is_rate_limited(errors):
    for error in errors:
        if "Rate limit exceeded" in error or "429" in error:
            return True
    return False


def create_crawl_job(client, spec):
    response = client.api_request("POST", "crawl", payload=spec["body"])
    result = {
        "label": spec["label"],
        "url": spec["url"],
        "request": spec["body"],
        "created": response["ok"] and bool(response["data"].get("success")),
        "status_code": response["status_code"],
        "job_id": response["data"].get("result") if response["ok"] else None,
        "errors": safe_error_messages(response) if not (response["ok"] and response["data"].get("success")) else [],
        "poll": None,
        "records": [],
        "summary": {},
    }
    return result


def poll_crawl_job(client, crawl_result, poll_attempts, poll_interval_seconds):
    job_id = crawl_result.get("job_id")
    if not job_id:
        crawl_result["poll"] = {
            "ok": False,
            "status": "not_created",
            "message": "crawl job was not created",
            "attempts": 0,
        }
        return crawl_result

    for attempt in range(1, poll_attempts + 1):
        response = client.api_request("GET", f"crawl/{job_id}", query={"limit": 1})
        if response["ok"] and response["data"].get("success"):
            result = response["data"].get("result") or {}
            status = result.get("status")
            crawl_result["poll"] = {
                "ok": True,
                "status": status,
                "message": "",
                "attempts": attempt,
            }
            if status and status != "running":
                records, record_errors = fetch_crawl_records(client, job_id)
                crawl_result["summary"] = {
                    "status": status,
                    "total": result.get("total"),
                    "finished": result.get("finished"),
                    "browserSecondsUsed": result.get("browserSecondsUsed"),
                }
                if record_errors:
                    crawl_result["summary"]["recordFetchErrors"] = record_errors
                crawl_result["records"] = records
                return crawl_result
        else:
            messages = safe_error_messages(response)
            crawl_result["poll"] = {
                "ok": False,
                "status": "error",
                "message": "; ".join(messages) or f"HTTP {response['status_code']}",
                "attempts": attempt,
            }
            if response["status_code"] == 404 and any("Crawl job not found" in message for message in messages):
                crawl_result["poll"] = {
                    "ok": False,
                    "status": "eventual_consistency_wait",
                    "message": "; ".join(messages) or "crawl job not visible yet",
                    "attempts": attempt,
                }
            else:
                crawl_result["poll"] = {
                    "ok": False,
                    "status": "job_lookup_failed",
                    "message": "; ".join(messages) or "crawl job lookup failed",
                    "attempts": attempt,
                }
                return crawl_result
        time.sleep(poll_interval_seconds)

    if crawl_result.get("poll") is None:
        crawl_result["poll"] = {
            "ok": False,
            "status": "timeout",
            "message": "crawl job did not reach a terminal state during polling",
            "attempts": poll_attempts,
        }
    return crawl_result


def fetch_crawl_records(client, job_id):
    records = []
    cursor = None
    errors = []
    while True:
        query = {"limit": 100}
        if cursor is not None:
            query["cursor"] = cursor
        response = client.api_request("GET", f"crawl/{job_id}", query=query)
        if not (response["ok"] and response["data"].get("success")):
            errors.extend(safe_error_messages(response))
            return records, errors
        result = response["data"].get("result") or {}
        records.extend(result.get("records") or [])
        cursor = result.get("cursor")
        if cursor in (None, "", 0):
            return records, errors


def run_markdown_probe(client, spec):
    response = client.api_request("POST", "markdown", payload={"url": spec["url"]})
    markdown = response["data"].get("result") if response["ok"] else None
    patterns = spec["patterns"]
    missing_patterns = []
    if markdown:
        for pattern in patterns:
            if not re.search(pattern, markdown, re.IGNORECASE):
                missing_patterns.append(pattern)
    ok = bool(markdown) and len(markdown) >= spec["min_length"] and not missing_patterns
    return {
        "label": spec["label"],
        "url": spec["url"],
        "ok": ok,
        "status_code": response["status_code"],
        "length": len(markdown or ""),
        "missing_patterns": missing_patterns,
        "errors": safe_error_messages(response) if not response["ok"] else [],
        "sample": (markdown or "")[:240],
    }


def run_links_probe(client, spec):
    response = client.api_request(
        "POST",
        "links",
        payload={
            "url": spec["url"],
            "excludeExternalLinks": False,
            "visibleLinksOnly": True,
        },
    )
    links = response["data"].get("result") if response["ok"] else []
    normalized_links = []
    for link in links or []:
        normalized_links.append(urljoin(spec["url"].rstrip("/") + "/", link))
    found_links = set(normalized_links)
    missing_links = [expected for expected in spec["expected_links"] if expected not in found_links]
    return {
        "label": spec["label"],
        "url": spec["url"],
        "ok": response["ok"] and not missing_links,
        "status_code": response["status_code"],
        "count": len(links or []),
        "missing_links": missing_links,
        "errors": safe_error_messages(response) if not response["ok"] else [],
        "links": links or [],
        "normalizedLinks": normalized_links,
    }


def record_status_map(records):
    mapping = {}
    for record in records:
        url = record.get("url") or record.get("metadata", {}).get("url")
        if url:
            mapping[url] = record.get("status")
            normalized = url.rstrip("/")
            if normalized:
                mapping[normalized] = record.get("status")
                mapping[normalized + "/"] = record.get("status")
    return mapping


def add_finding(findings, severity, category, summary, detail):
    findings.append(
        {
            "severity": severity,
            "category": category,
            "summary": summary,
            "detail": detail,
        }
    )


def evaluate(args, crawls, markdown_probes, links_probes):
    findings = []
    critical = critical_urls(args.landing_base_url.rstrip("/"), args.docs_base_url.rstrip("/"))
    crawl_expected = crawl_expected_urls(args.landing_base_url.rstrip("/"), args.docs_base_url.rstrip("/"))

    for crawl in crawls:
        if not crawl["created"]:
            add_finding(
                findings,
                "blocker",
                "cloudflare-api",
                f"{crawl['label']} could not create a crawl job",
                "; ".join(crawl["errors"]) or "job creation failed",
            )
            continue

        poll = crawl.get("poll") or {}
        if poll.get("status") == "job_lookup_failed":
            add_finding(
                findings,
                "blocker",
                "cloudflare-api",
                f"{crawl['label']} created a crawl job but Cloudflare never returned job results",
                poll.get("message") or "crawl job lookup failed",
            )
            continue

        if poll.get("status") == "timeout":
            add_finding(
                findings,
                "medium",
                "discoverability",
                f"{crawl['label']} did not finish during the polling window",
                poll.get("message") or "crawl timed out during local polling",
            )
            continue

        if crawl["records"]:
            expected_urls = crawl_expected["landing"] if crawl["label"].startswith("landing") else crawl_expected["docs"]
            status_by_url = record_status_map(crawl["records"])
            missing = [url for url in expected_urls if status_by_url.get(url) is None]
            if missing:
                add_finding(
                    findings,
                    "medium",
                    "discoverability",
                    f"{crawl['label']} did not report all expected page URLs",
                    "Missing expected page URLs: " + ", ".join(missing),
                )
            bad_statuses = []
            for url in expected_urls:
                status = status_by_url.get(url)
                if status in {"disallowed", "errored", "cancelled", "skipped"}:
                    bad_statuses.append(f"{url}={status}")
            if bad_statuses:
                add_finding(
                    findings,
                    "medium",
                    "fetchability",
                    f"{crawl['label']} reported blocked or failed expected page URLs",
                    ", ".join(bad_statuses),
                )

    for probe in markdown_probes:
        if probe["errors"]:
            if is_rate_limited(probe["errors"]):
                add_finding(
                    findings,
                    "blocker",
                    "cloudflare-api",
                    f"{probe['label']} markdown extraction hit Cloudflare Browser Rendering rate limits",
                    "; ".join(probe["errors"]),
                )
                continue
            add_finding(
                findings,
                "high",
                "extractability",
                f"{probe['label']} markdown extraction failed",
                "; ".join(probe["errors"]),
            )
            continue
        if probe["length"] < 1:
            add_finding(
                findings,
                "high",
                "extractability",
                f"{probe['label']} returned empty markdown",
                probe["url"],
            )
            continue
        if not probe["ok"]:
            detail = f"length={probe['length']}"
            if probe["missing_patterns"]:
                detail += "; missing patterns: " + ", ".join(probe["missing_patterns"])
            add_finding(
                findings,
                "medium",
                "extractability",
                f"{probe['label']} markdown is weaker than expected",
                detail,
            )

    for probe in links_probes:
        if probe["errors"]:
            if is_rate_limited(probe["errors"]):
                add_finding(
                    findings,
                    "blocker",
                    "cloudflare-api",
                    f"{probe['label']} link extraction hit Cloudflare Browser Rendering rate limits",
                    "; ".join(probe["errors"]),
                )
                continue
            add_finding(
                findings,
                "medium",
                "discoverability",
                f"{probe['label']} link extraction failed",
                "; ".join(probe["errors"]),
            )
            continue
        if probe["missing_links"]:
            add_finding(
                findings,
                "medium",
                "canonical-source-clarity",
                f"{probe['label']} is missing expected high-signal links",
                ", ".join(probe["missing_links"]),
            )

    if not findings:
        add_finding(
            findings,
            "info",
            "summary",
            "No material GEO issues were detected in this Browser Rendering pass",
            "The Cloudflare Browser Rendering checks that ran completed successfully.",
        )

    overall = "PASS"
    severities = [finding["severity"] for finding in findings]
    if any(severity in {"high", "blocker"} for severity in severities):
        overall = "FAIL"
    elif any(severity == "medium" for severity in severities):
        overall = "WARN"
    return overall, findings


def print_summary(overall, crawls, markdown_probes, links_probes, findings):
    for crawl in crawls:
        if not crawl["created"]:
            print(f"FAIL {crawl['label']} create")
            continue
        poll = crawl.get("poll") or {}
        if poll.get("status") == "job_lookup_failed":
            print(f"WARN {crawl['label']} lookup")
        elif poll.get("status") == "timeout":
            print(f"WARN {crawl['label']} polling")
        elif crawl["records"]:
            print(f"PASS {crawl['label']} results")
        else:
            print(f"WARN {crawl['label']} results")

    for probe in markdown_probes:
        label = "PASS" if probe["ok"] else "WARN"
        if probe["errors"] and not any("429" in error for error in probe["errors"]):
            label = "FAIL"
        print(f"{label} {probe['label']}")

    for probe in links_probes:
        label = "PASS" if probe["ok"] else "WARN"
        if probe["errors"]:
            label = "FAIL"
        print(f"{label} {probe['label']}")

    print("")
    print("Summary")
    print(f"- overall: {overall}")
    print(f"- crawl jobs: {len(crawls)}")
    print(f"- markdown probes: {len(markdown_probes)}")
    print(f"- link probes: {len(links_probes)}")
    print(f"- findings: {len(findings)}")
    print("")
    print("Findings")
    for finding in findings:
        print(f"- [{finding['severity']}] {finding['summary']} - {finding['detail']}")


def main():
    args = parse_args()
    account_id = os.environ.get(ACCOUNT_ENV)
    token = os.environ.get(TOKEN_ENV)
    if not account_id:
        raise SystemExit(f"missing required environment variable: {ACCOUNT_ENV}")
    if not token:
        raise SystemExit(f"missing required environment variable: {TOKEN_ENV}")

    client = CloudflareClient(
        account_id=account_id,
        token=token,
        timeout_seconds=args.request_timeout_seconds,
        spacing_seconds=args.request_spacing_seconds,
    )

    crawls = []
    for spec in crawl_specs(args):
        crawl = create_crawl_job(client, spec)
        crawl = poll_crawl_job(client, crawl, args.poll_attempts, args.poll_interval_seconds)
        crawls.append(crawl)

    markdown_probes = [run_markdown_probe(client, spec) for spec in markdown_probe_specs(args.landing_base_url.rstrip("/"), args.docs_base_url.rstrip("/"))]
    links_probes = [run_links_probe(client, spec) for spec in link_probe_specs(args.landing_base_url.rstrip("/"), args.docs_base_url.rstrip("/"))]

    overall, findings = evaluate(args, crawls, markdown_probes, links_probes)
    print_summary(overall, crawls, markdown_probes, links_probes, findings)

    result = {
        "ok": overall == "PASS",
        "overall": overall,
        "generatedAt": now_iso(),
        "config": {
            "landingBaseUrl": args.landing_base_url.rstrip("/"),
            "docsBaseUrl": args.docs_base_url.rstrip("/"),
            "staticLimit": args.static_limit,
            "renderedLimit": args.rendered_limit,
            "crawlDepth": args.crawl_depth,
        },
        "crawls": crawls,
        "markdownProbes": markdown_probes,
        "linksProbes": links_probes,
        "findings": findings,
    }
    print("")
    print("RESULT_JSON:" + json.dumps(result, separators=(",", ":")))

    if overall == "FAIL":
        sys.exit(1)


if __name__ == "__main__":
    main()
