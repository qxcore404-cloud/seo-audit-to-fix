import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl


app = FastAPI(
    title="SearchPilot SEO API",
    description="SEO auditing and website analysis API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_HTML_SIZE = 1_000_000
TIMEOUT_SECONDS = 12


class AuditRequest(BaseModel):
    url: HttpUrl


def validate_public_host(hostname: str) -> None:
    """Reject local, private and non-public destination addresses."""

    if not hostname:
        raise HTTPException(400, "Invalid website hostname.")

    if hostname.lower() == "localhost" or hostname.lower().endswith(".localhost"):
        raise HTTPException(400, "Local websites cannot be scanned.")

    try:
        addresses = [ipaddress.ip_address(hostname)]
    except ValueError:
        try:
            results = socket.getaddrinfo(
                hostname,
                None,
                type=socket.SOCK_STREAM,
            )
            addresses = list({
                ipaddress.ip_address(result[4][0])
                for result in results
            })
        except socket.gaierror:
            raise HTTPException(400, "Website hostname could not be resolved.")

    if not addresses or any(not address.is_global for address in addresses):
        raise HTTPException(
            400,
            "Private or non-public website addresses are not allowed.",
        )


async def download_html(url: str) -> str:
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Only HTTP and HTTPS websites are supported.")

    if parsed.username or parsed.password:
        raise HTTPException(400, "URLs containing credentials are not allowed.")

    if parsed.port and parsed.port not in (80, 443):
        raise HTTPException(400, "Custom website ports are not allowed.")

    validate_public_host(parsed.hostname or "")

    timeout = httpx.Timeout(TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
            headers={"User-Agent": "SearchPilot-SEO-Audit/1.0"},
        ) as client:
            async with client.stream("GET", url) as response:
                if response.is_redirect:
                    raise HTTPException(
                        400,
                        "Website redirects are not followed. Scan the final URL directly.",
                    )

                response.raise_for_status()

                content_type = response.headers.get("content-type", "").lower()
                if "text/html" not in content_type:
                    raise HTTPException(
                        415,
                        "The requested page did not return HTML content.",
                    )

                content_length = response.headers.get("content-length")
                if content_length and int(content_length) > MAX_HTML_SIZE:
                    raise HTTPException(413, "Website HTML is too large to scan.")

                chunks = []
                total_size = 0

                async for chunk in response.aiter_bytes():
                    total_size += len(chunk)

                    if total_size > MAX_HTML_SIZE:
                        raise HTTPException(
                            413,
                            "Website HTML exceeded the allowed size.",
                        )

                    chunks.append(chunk)

                encoding = response.encoding or "utf-8"
                return b"".join(chunks).decode(encoding, errors="replace")

    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(504, "Website took too long to respond.")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            502,
            f"Website returned HTTP status {exc.response.status_code}.",
        )
    except httpx.RequestError:
        raise HTTPException(502, "Could not connect to the website.")
    except (ValueError, UnicodeError):
        raise HTTPException(502, "Could not read the website response.")


def analyze_html(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    issues = []

    def add_issue(title, description, severity, recommendation):
        issues.append({
            "title": title,
            "description": description,
            "severity": severity,
            "recommendation": recommendation,
        })

    # Page title
    title_tag = soup.find("title")
    page_title = title_tag.get_text(strip=True) if title_tag else ""

    if not page_title:
        add_issue(
            "Missing Page Title",
            "The page does not contain a title tag.",
            "Critical",
            "Add a unique, descriptive title, ideally around 50–60 characters.",
        )
    elif len(page_title) < 30 or len(page_title) > 60:
        add_issue(
            "Page Title Length",
            f"The page title contains {len(page_title)} characters.",
            "Warning",
            "Review the title and aim for approximately 50–60 characters.",
        )
    else:
        add_issue(
            "Page Title",
            f"Page title is present: {page_title}",
            "Passed",
            "No action required.",
        )

    # Meta description
    description_tag = soup.find(
        "meta",
        attrs={"name": lambda value: value and value.lower() == "description"},
    )
    meta_description = (
        description_tag.get("content", "").strip()
        if description_tag else ""
    )

    if not meta_description:
        add_issue(
            "Missing Meta Description",
            "The page does not contain a meta description.",
            "Critical",
            "Add a unique, useful description, ideally around 150–160 characters.",
        )
    elif len(meta_description) < 120 or len(meta_description) > 160:
        add_issue(
            "Meta Description Length",
            f"The meta description contains {len(meta_description)} characters.",
            "Warning",
            "Review the description and aim for approximately 150–160 characters.",
        )
    else:
        add_issue(
            "Meta Description",
            "A meta description is present.",
            "Passed",
            "No action required.",
        )

    # H1 heading
    h1_tags = soup.find_all("h1")

    if not h1_tags:
        add_issue(
            "Missing H1 Heading",
            "No H1 heading was found on this page.",
            "Critical",
            "Add one clear H1 heading that describes the page topic.",
        )
    elif len(h1_tags) > 1:
        add_issue(
            "Multiple H1 Headings",
            f"Found {len(h1_tags)} H1 headings.",
            "Warning",
            "Review the heading structure and use one primary H1 where appropriate.",
        )
    else:
        add_issue(
            "H1 Heading",
            "One H1 heading is present.",
            "Passed",
            "No action required.",
        )

    # Image alt attributes
    images = soup.find_all("img")
    missing_alt = [
        image for image in images
        if not image.has_attr("alt")
    ]

    if missing_alt:
        add_issue(
            "Images Missing Alt Text",
            f"{len(missing_alt)} of {len(images)} images have no alt attribute.",
            "Warning",
            "Add descriptive alt text to informative images. Use empty alt text for decorative images.",
        )
    else:
        add_issue(
            "Image Alt Attributes",
            f"All {len(images)} images have an alt attribute.",
            "Passed",
            "No action required.",
        )

    # Canonical URL
    canonical = soup.find(
        "link",
        rel=lambda value: value and "canonical" in value,
    )

    if not canonical or not canonical.get("href"):
        add_issue(
            "Missing Canonical URL",
            "No canonical link was found.",
            "Warning",
            "Add a canonical link pointing to the preferred page URL.",
        )
    else:
        add_issue(
            "Canonical URL",
            "A canonical link is present.",
            "Passed",
            "Verify that it points to the preferred page URL.",
        )

    # Robots meta
    robots = soup.find(
        "meta",
        attrs={"name": lambda value: value and value.lower() == "robots"},
    )
    robots_content = robots.get("content", "").lower() if robots else ""

    if "noindex" in robots_content:
        add_issue(
            "Page Set to Noindex",
            "The robots meta tag contains noindex.",
            "Critical",
            "Remove noindex only if this page should appear in search results.",
        )
    else:
        add_issue(
            "Robots Meta Tag",
            "No noindex directive was detected in the robots meta tag.",
            "Passed",
            "Confirm that your indexing settings match your intentions.",
        )

    critical_count = sum(
        item["severity"] == "Critical" for item in issues
    )
    warning_count = sum(
        item["severity"] == "Warning" for item in issues
    )
    passed_count = sum(
        item["severity"] == "Passed" for item in issues
    )

    score = max(
        0,
        min(100, 100 - critical_count * 20 - warning_count * 8),
    )

    return {
        "url": url,
        "score": score,
        "summary": {
            "critical": critical_count,
            "warnings": warning_count,
            "passed": passed_count,
            "total": len(issues),
        },
        "issues": issues,
        "message": "SEO audit completed successfully.",
    }


@app.get("/")
async def root():
    return {
        "message": "SearchPilot SEO API",
        "status": "running",
    }


@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "service": "searchpilot-seo-backend",
    }


@app.post("/api/audit")
async def audit_website(request: AuditRequest):
    url = str(request.url)

    html = await download_html(url)

    # HTML parsing is moved off the async event loop.
    result = await asyncio.to_thread(analyze_html, html, url)

    return result


# SEARCHPILOT_APPROVAL_FIX_ENGINE
# Controlled demo website: only this fixed file can be modified.

from pathlib import Path as _FixPath
from hashlib import sha256 as _FixSHA256
from secrets import token_urlsafe as _FixToken
from typing import Literal as _FixLiteral
from pydantic import BaseModel as _FixBaseModel, Field as _FixField
from bs4 import BeautifulSoup as _FixSoup

_DEMO_FILE = (
    _FixPath(__file__).resolve().parents[1]
    / "demo_site"
    / "index.html"
)

_PENDING_FIXES: dict[str, dict] = {}


class FixPreviewRequest(_FixBaseModel):
    issue_type: _FixLiteral["title", "meta_description"]
    proposed_value: str = _FixField(min_length=1, max_length=160)


class FixApproveRequest(_FixBaseModel):
    preview_id: str
    approved: bool


def _read_demo_html():
    if not _DEMO_FILE.is_file():
        raise HTTPException(
            status_code=404,
            detail="Demo website file not found."
        )
    return _DEMO_FILE.read_text(encoding="utf-8")


def _apply_demo_change(soup, issue_type, value):
    if issue_type == "title":
        if soup.title:
            soup.title.string = value
        else:
            if soup.head is None:
                head = soup.new_tag("head")
                if soup.html:
                    soup.html.insert(0, head)
                else:
                    soup.insert(0, head)
            title = soup.new_tag("title")
            title.string = value
            soup.head.append(title)

    elif issue_type == "meta_description":
        tag = soup.find(
            "meta",
            attrs={"name": lambda item: item and item.lower() == "description"}
        )
        if tag is None:
            tag = soup.new_tag("meta")
            tag["name"] = "description"
            soup.head.append(tag)
        tag["content"] = value


@app.post("/api/fix/preview")
def preview_seo_fix(request: FixPreviewRequest):
    value = request.proposed_value.strip()

    if not value or any(ord(char) < 32 for char in value):
        raise HTTPException(status_code=422, detail="Invalid proposed text.")

    if request.issue_type == "title" and len(value) > 60:
        raise HTTPException(
            status_code=422,
            detail="Title must be 60 characters or fewer for this demo."
        )

    if request.issue_type == "meta_description" and len(value) > 160:
        raise HTTPException(
            status_code=422,
            detail="Meta description must be 160 characters or fewer."
        )

    html = _read_demo_html()
    soup = _FixSoup(html, "html.parser")

    if request.issue_type == "title":
        current = soup.title.get_text(strip=True) if soup.title else "(missing)"
    else:
        tag = soup.find(
            "meta",
            attrs={"name": lambda item: item and item.lower() == "description"}
        )
        current = tag.get("content", "") if tag else "(missing)"

    preview_soup = _FixSoup(html, "html.parser")
    _apply_demo_change(preview_soup, request.issue_type, value)

    preview_id = _FixToken(24)
    _PENDING_FIXES[preview_id] = {
        "issue_type": request.issue_type,
        "value": value,
        "original_hash": _FixSHA256(html.encode("utf-8")).hexdigest()
    }

    return {
        "preview_id": preview_id,
        "issue_type": request.issue_type,
        "before": current,
        "proposed": value,
        "preview_html": str(preview_soup),
        "approval_required": True,
        "message": "Review this proposed change. Nothing has been modified yet."
    }


@app.post("/api/fix/approve")
def approve_seo_fix(request: FixApproveRequest):
    pending = _PENDING_FIXES.get(request.preview_id)

    if pending is None:
        raise HTTPException(
            status_code=404,
            detail="Preview not found or expired. Create a new preview."
        )

    if not request.approved:
        _record_fix_history(pending, "Rejected")
        _PENDING_FIXES.pop(request.preview_id, None)
        return {
            "approved": False,
            "applied": False,
            "message": "Fix rejected. Demo website was not changed."
        }

    html = _read_demo_html()
    current_hash = _FixSHA256(html.encode("utf-8")).hexdigest()

    if current_hash != pending["original_hash"]:
        _PENDING_FIXES.pop(request.preview_id, None)
        raise HTTPException(
            status_code=409,
            detail="Demo website changed after preview. Create a new preview."
        )

    soup = _FixSoup(html, "html.parser")
    _apply_demo_change(
        soup,
        pending["issue_type"],
        pending["value"]
    )

    temp_file = _DEMO_FILE.with_suffix(".tmp")
    temp_file.write_text(str(soup), encoding="utf-8")
    temp_file.replace(_DEMO_FILE)

    _PENDING_FIXES.pop(request.preview_id, None)
    _record_fix_history(pending)

    return {
        "approved": True,
        "applied": True,
        "issue_type": pending["issue_type"],
        "new_value": pending["value"],
        "message": "Approved fix applied to the controlled demo website."
    }


@app.get("/api/fix/verify")
def verify_demo_fix():
    html = _read_demo_html()
    result = analyze_html(html, "http://searchpilot-demo.local/")

    return {
        "demo_file": "backend/demo_site/index.html",
        "audit": result,
        "message": "Demo website re-audit completed."
    }


# SearchPilot Fix History
def _record_fix_history(pending, status="Applied"):
    import json
    from datetime import datetime, timezone

    history_file = _DEMO_FILE.with_name("fix_history.json")

    try:
        history = json.loads(history_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        history = []

    history.insert(0, {
        "issue_type": pending["issue_type"],
        "new_value": pending["value"],
        "status": status,
        "target": "Controlled demo website",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })

    temp_file = history_file.with_suffix(".tmp")
    temp_file.write_text(
        json.dumps(history[:100], indent=2),
        encoding="utf-8"
    )
    temp_file.replace(history_file)


@app.get("/api/fix/history")
def get_fix_history():
    import json

    history_file = _DEMO_FILE.with_name("fix_history.json")

    try:
        history = json.loads(history_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        history = []

    return {"history": history}
