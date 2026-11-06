"""MCP adapter for SearchPilot's existing local HTTP tool endpoints.

The server exposes only audit, preview, verification, and history. It never
exposes the human approval endpoint.
"""

import os

import httpx
from mcp.server import MCPServer


API_BASE = os.environ.get("SEARCHPILOT_API_URL", "http://127.0.0.1:8000").rstrip("/")
server = MCPServer("SearchPilot")


def _call(method: str, path: str, *, payload: dict | None = None) -> dict:
    try:
        response = httpx.request(
            method,
            f"{API_BASE}{path}",
            json=payload,
            timeout=20,
            trust_env=False,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500]
        raise RuntimeError(f"SearchPilot returned HTTP {exc.response.status_code}: {detail}") from exc
    except httpx.RequestError as exc:
        raise RuntimeError(f"Could not reach SearchPilot at {API_BASE}: {exc}") from exc


@server.tool()
def audit_website(url: str) -> dict:
    """Run a read-only SEO audit of a public HTTP or HTTPS website URL."""
    return _call("POST", "/api/tools/audit_website", payload={"url": url})


@server.tool()
def create_fix_preview(issue_type: str, proposed_value: str) -> dict:
    """Create a non-applying preview for title or meta_description; a human must approve separately."""
    if issue_type not in {"title", "meta_description"}:
        raise ValueError("issue_type must be 'title' or 'meta_description'")
    return _call(
        "POST",
        "/api/tools/create_fix_preview",
        payload={"issue_type": issue_type, "proposed_value": proposed_value},
    )


@server.tool()
def verify_demo_fix() -> dict:
    """Re-audit the controlled local demo site after a human-approved fix."""
    return _call("GET", "/api/tools/verify_demo_fix")


@server.tool()
def get_fix_history() -> dict:
    """Return applied and declined fix decisions for the controlled demo site."""
    return _call("GET", "/api/tools/get_fix_history")


if __name__ == "__main__":
    server.run()
