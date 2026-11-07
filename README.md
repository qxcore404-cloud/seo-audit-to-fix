# SearchPilot

SearchPilot is a local SEO audit and controlled-fix demo built for the Switch hackathon. It can audit a public page without changing it, prepare a metadata fix for review, require a separate human approval token to apply it, and audit the local demo page afterward.

## The problem

Website audit tools list what is wrong, but a person still has to understand each finding, decide what to change, edit the page, and check that the change worked. SearchPilot connects those steps and keeps a person in control: nothing is changed until a human approves a specific preview.

## How it works

1. A team member asks SearchPilot, in Switch or in the dashboard, to audit a public page.
2. The audit returns evidence and a SearchPilot score. The score is SearchPilot's own measure. It is not a Google score and does not predict rankings or traffic.
3. A fix preview shows the current value and the proposed value for a page title or meta description.
4. A human approves or declines with the approval token. Agent tools cannot approve.
5. An approved change is applied only to the controlled demo page, `backend/demo_site/index.html`.
6. SearchPilot re-audits the demo page and records the result in the fix history.

How Switch is used: a Codex agent in Switch Console calls four SearchPilot tools over MCP (`audit_website`, `create_fix_preview`, `verify_demo_fix`, `get_fix_history`). Approval is deliberately not one of them. See "Switch integration status" below.

## Features

- Read-only website audit for page title, meta description, H1, image alt text, canonical URL, and robots directives.
- Four local agent-callable HTTP tools: `audit_website`, `create_fix_preview`, `verify_demo_fix`, and `get_fix_history`.
- Preview and approval workflow limited to `backend/demo_site/index.html`.
- Explicit before/proposed values, human decision, verification summary, and local fix history in the dashboard.
- Six checks, with fixes available for page titles and meta descriptions only. The other four checks are report-only.
- Proposed fix text is supplied by the reviewer or the agent and can be edited before approval.
- Public website fetch protections: HTTP(S) only, public DNS/IP addresses only, no redirects, credentials, or custom ports.

## Setup

Requirements: Python 3.11 or newer (the MCP adapter uses the official Python SDK), and Node.js 20.19+ or 22.12+ for the frontend toolchain.

1. Create a local approval token and keep it out of source control:

   ```sh
   export SEARCHPILOT_HUMAN_APPROVAL_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
   ```

   The backend fails closed for approval if this variable is missing. Enter the same value in the dashboard when reviewing a preview. The token is not stored by the frontend.

2. Start the backend in one terminal:

   ```sh
   cd backend
   python -m venv .venv
   . .venv/bin/activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```

3. Start the dashboard in another terminal:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

   Open the local URL Vite prints (normally `http://localhost:5173`). The backend allows the local Vite origin.

## Architecture

- **Frontend:** React + TypeScript dashboard. It calls the local FastAPI backend and renders the audit, preview, approval, verification, and history states.
- **Backend:** FastAPI performs bounded public-page HTML fetches and SEO checks. The tool routes live under `/api/tools/`.
- **Controlled target:** fix preview/apply/verification use only `backend/demo_site/index.html`; they do not use the scanned URL as a write destination. The audit uses the public URL as a read-only input.
- **Approval boundary:** agent-callable routes do not include approval. The separate `/api/fix/approve` endpoint requires `X-SearchPilot-Human-Approval` to match `SEARCHPILOT_HUMAN_APPROVAL_TOKEN`, and changes are applied only after an explicit dashboard action. A changed demo file invalidates an old preview.

## Local agent tools

The backend exposes these local operations:

| Tool | Method and path | Input |
| --- | --- | --- |
| `audit_website(url)` | `POST /api/tools/audit_website` | `{"url":"https://example.com"}` |
| `create_fix_preview(issue_type, proposed_value)` | `POST /api/tools/create_fix_preview` | `{"issue_type":"title","proposed_value":"…"}`; issue type is `title` or `meta_description` |
| `verify_demo_fix()` | `GET /api/tools/verify_demo_fix` | None |
| `get_fix_history()` | `GET /api/tools/get_fix_history` | None |

Interactive API docs are available at `http://127.0.0.1:8000/docs` while the backend is running.

## Switch integration status

The official Switch agent protocol documents custom-agent registration with `POST /agents`, a WebSocket at `/agents/{agent_id}/connection/ws`, and calls to Switch's published operations. See [The agent protocol](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol) and [Agent connection](https://docs.switchagents.ai/switch-rooms/internals/agent-connection).

The supported workaround is a Switch-managed agent provider: Switch documents that an agent uses tools and MCP servers configured on its provider. `backend/searchpilot_mcp.py` exposes the four existing local HTTP tools over MCP stdio for Codex; it deliberately omits human approval. Configure that MCP server in Codex, then create a regular Codex agent in Switch Console. See [Onboard an agent](https://docs.switchagents.ai/switch-rooms/getting-started/onboard-your-agents) and [provider setup](https://docs.switchagents.ai/switch-rooms/getting-started/set-up-agent-providers). Codex's MCP configuration is user-level, so the MCP server must run on the same machine as the agent and SearchPilot backend.

From the repository root, install the MCP SDK into the backend environment and register the stdio server with Codex:

```sh
cd backend
.venv/bin/python -m pip install "mcp>=2,<3"
cd ..
codex mcp add searchpilot --env SEARCHPILOT_API_URL=http://127.0.0.1:8000 -- "${PWD}/backend/.venv/bin/python" "${PWD}/backend/searchpilot_mcp.py"
codex mcp list
```

Team-reported status: the Codex agent was created in Switch Console and completed a live website audit. This flow is not covered by the repository's automated tests.

Start the SearchPilot backend, then in Switch Console add a **Codex** agent on **This computer** after the MCP server is configured, and invite it to a room. The server must be running before the agent calls its tools.

For a fully custom Switch protocol client, the docs do **not** document how arbitrary third-party functions are published via the registration `tools` field; its schema and execution behavior are unspecified. SearchPilot does not invent that API. The Switch protocol also requires a continuously running client to register a matching `connection_model`, but the registration docs only say `message_exchange` is a boolean and do not define what its values mean. Do not submit a hand-built `POST /agents` body until that required field is clarified. The provider/MCP route avoids those undocumented custom-registration details.

## Security limitations

- This is a local hackathon demo, not a production multi-user service. The approval token is a local shared secret, not user identity or an audit-grade authorization system.
- Keep the backend bound to localhost. Do not expose it publicly; there is no user login, rate limiting, persistent database, or production secret manager.
- Public page audit is read-only and rejects private/local destinations. Findings and suggested text are untrusted input.
- Fixes only target the checked-in demo HTML file. No CMS, repository, or public-site write integration exists.
- Fix history is local JSON beside the demo HTML and may be reset when that demo data is removed.
- SEO checks are basic HTML heuristics, not a search-ranking guarantee.

## Demo walkthrough

1. Start the backend and frontend as above; check that the dashboard reports the local backend is running by submitting a URL.
2. Run a read-only audit against a public page, or use `https://example.com` for a quick scan.
3. Choose a title or meta description finding and create a fix preview. The dashboard shows the current value and proposed value.
4. Enter the approval token configured for the backend. Select **Approve and apply to demo** or **Decline**. No approval is implicit.
5. For an approved fix, review the post-change demo audit score and the history entry. The scanned public website remains unchanged.

## Testing results (reported by the team)

These results were reported by the team after manual and API testing on Kali Linux. They are team-reported; raw logs and screenshots are not included in this repository.

| Area | Reported result |
| --- | --- |
| Backend health | PASS |
| Website audit and issue detection | PASS |
| Fix preview | PASS |
| Human rejection and approval | PASS |
| Approved fix application | PASS |
| Post-fix verification and fix history | PASS |
| Four MCP tools and AI agent workflow | PASS |
| Security and negative-case checks | PASS |
| Backend restart and repeat testing | PASS |

One website, `bytewrites.org`, returned HTTP 504 (response timeout). It is recorded as a target-site timeout, not a successful audit.

Not confirmed: Windows, mobile browsers. The repository also includes five unit tests in `backend/tests`; see "Tests and production build" to run them.

## Known limitations

- Fixes are applied to a controlled demo page only, not to the scanned website.
- Fix previews support page titles and meta descriptions only.
- Pending previews are held in memory. After a backend restart, create a new preview.
- Some websites may time out during an audit.
- The audit reads raw HTML only. Page scripts are not run, and `noindex` is detected from the robots meta tag only.
- There is no native Android or iOS application.

## Platform compatibility

Tested by the team on Kali Linux. Windows and mobile browsers are not confirmed.

## Team

- **Ali Shan:** project lead, core development, technical QA, submission coordinator.
- **Aisha P:** research, README, documentation, presentation, demo video.
- **Tumusiime Stephen:** AI agent testing, security validation, QA findings support.

## License

No license file is included yet.

## Tests and production build

From the repository root:

```sh
cd backend
.venv/bin/python -m unittest discover -s tests
cd ../frontend
npm run build
```
