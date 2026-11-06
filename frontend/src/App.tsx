import { useEffect, useState } from "react";
import "./App.css";

const API = "http://127.0.0.1:8000";

type Issue = {
  title: string;
  description: string;
  severity: "Critical" | "Warning" | "Passed";
  recommendation: string;
};
type Preview = {
  preview_id: string;
  issue_type: string;
  before: string;
  proposed: string;
};
type HistoryItem = {
  issue_type: string;
  new_value: string;
  status: string;
  target: string;
  timestamp: string;
};
type Verification = { score: number; summary: { critical: number; warnings: number; passed: number }; issues: Issue[] };

async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Request failed. Is the SearchPilot backend running?");
  return data;
}

function App() {
  const [url, setUrl] = useState("https://example.com");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState<Preview | null>(null);
  const [proposed, setProposed] = useState("");
  const [approvalToken, setApprovalToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [verification, setVerification] = useState<Verification | null>(null);

  const refreshHistory = async () => {
    try {
      const data = await readResponse(await fetch(`${API}/api/tools/get_fix_history`));
      setHistory(data.history ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load fix history.");
    }
  };

  useEffect(() => { void refreshHistory(); }, []);

  const scan = async () => {
    setScanning(true); setError(""); setMessage(""); setVerification(null);
    try {
      const data = await readResponse(await fetch(`${API}/api/tools/audit_website`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
      }));
      setIssues(data.issues); setScore(data.score); setMessage(`Audit complete for ${data.url}. This scan is read-only.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Audit failed."); }
    finally { setScanning(false); }
  };

  const createPreview = async (issue: Issue) => {
    const issueType = issue.title.toLowerCase().includes("title") ? "title" : issue.title.toLowerCase().includes("meta") ? "meta_description" : "";
    if (!issueType) { setError("Preview fixes currently support page titles and meta descriptions."); return; }
    const defaultValue = issueType === "title"
      ? "SearchPilot | Professional SEO Audit and Optimization"
      : "Discover practical SEO insights with SearchPilot. Audit your website, identify issues, and improve your search visibility with actionable recommendations.";
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await readResponse(await fetch(`${API}/api/tools/create_fix_preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_type: issueType, proposed_value: defaultValue }),
      }));
      setPending(data); setProposed(data.proposed);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create preview."); }
    finally { setBusy(false); }
  };

  const decide = async (approved: boolean, previewId?: string) => {
    if (!pending) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await readResponse(await fetch(`${API}/api/fix/approve`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-SearchPilot-Human-Approval": approvalToken },
        body: JSON.stringify({ preview_id: previewId ?? pending.preview_id, approved }),
      }));
      setPending(null); setMessage(data.message);
      if (approved && data.applied) {
        const verified = await readResponse(await fetch(`${API}/api/tools/verify_demo_fix`));
        setVerification(verified.audit); setIssues(verified.audit.issues); setScore(verified.audit.score);
        setMessage(`Human-approved fix applied to the controlled demo site. Verification score: ${verified.audit.score}/100.`);
      }
      await refreshHistory();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record the human decision."); }
    finally { setBusy(false); }
  };

  const refreshAndDecide = async (approved: boolean) => {
    if (!pending) return;
    setBusy(true); setError("");
    try {
      const refreshed = await readResponse(await fetch(`${API}/api/tools/create_fix_preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_type: pending.issue_type, proposed_value: proposed }),
      }));
      setPending(refreshed);
      await decide(approved, refreshed.preview_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh the preview.");
      setBusy(false);
    }
  };

  const auditCounts = {
    critical: issues.filter((x) => x.severity === "Critical").length,
    warnings: issues.filter((x) => x.severity === "Warning").length,
    passed: issues.filter((x) => x.severity === "Passed").length,
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon">S</div><div><h2>SearchPilot</h2><span>SEO audit workspace</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="navigation">
        <a className="nav-item active" href="#workflow"><span className="nav-icon">▦</span>Workflow</a>
        <a className="nav-item" href="#findings"><span className="nav-icon">⌕</span>Audit findings</a>
        <a className="nav-item" href="#approval"><span className="nav-icon">✓</span>Approval</a>
        <a className="nav-item" href="#history"><span className="nav-icon">◷</span>Fix history</a>
      </nav>
      <div className="sidebar-note"><strong>Demo safety boundary</strong><p>Website scans are read-only. Approved fixes can change only the local demo HTML file.</p></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div><div className="breadcrumb">SearchPilot / Local demo</div><h1>SEO improvement workflow</h1></div><span className="system-status"><span className="status-dot"/>Local backend</span></header>
      <section id="workflow" className="welcome-section"><div><p className="eyebrow">SEARCHPILOT · SWITCH HACKATHON MVP</p><h2>Audit, review, verify.</h2><p className="muted">An agent can inspect and prepare a change. A human decides whether the demo site is updated.</p></div><span className="date-label">Human approval required</span></section>

      <section className="website-panel">
        <div className="website-panel-heading"><div><h3>Read-only website audit</h3><p>Scan a public page for SEO signals. This never writes to the scanned site.</p></div><span className="secure-label">READ ONLY</span></div>
        <form className="scan-form" onSubmit={(event) => { event.preventDefault(); void scan(); }}>
          <div className="url-input-wrapper"><span>↗</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://yourwebsite.com" aria-label="Website URL"/></div>
          <button className="scan-button" disabled={scanning}>{scanning ? "Scanning…" : "Run SEO audit"}</button>
        </form>
        {scanning && <div className="scan-progress"><div className="progress-track"><div className="progress-fill"/></div><span>Fetching and analyzing HTML…</span></div>}
        {message && <p className="inline-message" role="status">{message}</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </section>

      <section className="section-heading"><div><h3>Audit overview</h3><p>{score === null ? "Run an audit to see current findings." : "Current read-only audit results."}</p></div><span className="updated-label">{score === null ? "Awaiting scan" : "Audit complete"}</span></section>
      <section className="stats-grid">
        <Stat title="SEO score" value={score === null ? "—" : `${score}/100`} icon="◉"/>
        <Stat title="Critical issues" value={auditCounts.critical} icon="!" tone="red"/>
        <Stat title="Warnings" value={auditCounts.warnings} icon="△" tone="orange"/>
        <Stat title="Passed checks" value={auditCounts.passed} icon="✓" tone="green"/>
      </section>

      <section id="findings" className="results-section">
        <div className="section-heading results-heading"><div><h3>Audit findings</h3><p>Preview supported metadata fixes before a human approves them.</p></div><span className="result-count">{issues.length} checks</span></div>
        {issues.length === 0 ? <div className="empty-panel">Your audit findings will appear here.</div> : <div className="issues-list">{issues.map((issue) => <article className="issue-row" key={issue.title}>
          <div className={`issue-icon ${issue.severity.toLowerCase()}`}>{issue.severity === "Critical" ? "!" : issue.severity === "Warning" ? "△" : "✓"}</div>
          <div className="issue-details"><div className="issue-title-line"><strong>{issue.title}</strong><span className={`severity ${issue.severity.toLowerCase()}`}>{issue.severity}</span></div><p>{issue.description}</p><div className="recommendation"><span>Recommendation:</span> {issue.recommendation}</div></div>
          <div className="issue-action">{issue.severity === "Passed" ? <span className="passed-label">No action needed</span> : <button className="review-button" disabled={busy} onClick={() => void createPreview(issue)}>Create fix preview</button>}</div>
        </article>)}</div>}
      </section>

      <section id="approval" className="approval-panel">
        <div className="fix-history-heading"><div><p className="eyebrow">CONTROLLED DEMO SITE</p><h2>Human review and approval</h2><p>SearchPilot never edits the public URL you scanned. Approval applies only to <code>backend/demo_site/index.html</code>.</p></div><span className="approval-state">{pending ? "Review pending" : "No pending change"}</span></div>
        {pending ? <div className="preview-card">
          <div className="preview-meta"><span>Change type</span><strong>{pending.issue_type.replace("_", " ")}</strong></div>
          <label className="preview-field">Current value<input value={pending.before} readOnly/></label>
          <label className="preview-field">Proposed value<textarea value={proposed} onChange={(event) => setProposed(event.target.value)} maxLength={pending.issue_type === "title" ? 60 : 160}/></label>
          <small>{proposed.length} characters · Preview will be refreshed before approval.</small>
          <label className="preview-field">Human approval token<input type="password" autoComplete="off" value={approvalToken} onChange={(event) => setApprovalToken(event.target.value)} placeholder="Set SEARCHPILOT_HUMAN_APPROVAL_TOKEN in backend environment"/></label>
          <div className="approval-actions"><button disabled={busy || !approvalToken} className="review-button" onClick={() => void refreshAndDecide(false)}>Decline</button><button disabled={busy || !approvalToken || !proposed.trim()} className="scan-button" onClick={() => void refreshAndDecide(true)}>Approve and apply to demo</button></div>
        </div> : <p className="empty-panel">Create a preview from an audit finding. No file changes until you explicitly approve.</p>}
        {verification && <div className="verification-card"><strong>Verification after approval</strong><p>Demo audit score: <b>{verification.score}/100</b> · {verification.summary.critical} critical · {verification.summary.warnings} warnings · {verification.summary.passed} passed</p></div>}
      </section>

      <section id="history" className="fix-history-section"><div className="fix-history-heading"><div><h2>Fix history</h2><p>Applied and declined changes for the controlled demo site.</p></div><span className="history-count">{history.length} records</span></div>
        {history.length === 0 ? <p className="history-empty">No fix decisions recorded yet.</p> : <div className="history-list">{history.map((item, index) => <article className="history-item" key={`${item.timestamp}-${index}`}><div className="history-item-main"><strong>{item.issue_type.replace("_", " ")}</strong><span>{item.new_value}</span><small>{item.target} · {new Date(item.timestamp).toLocaleString()}</small></div><span className={`history-status ${item.status.toLowerCase()}`}>{item.status}</span></article>)}</div>}
      </section>
      <footer className="footer"><span>SearchPilot · Local demo only</span><span>Agent tools cannot approve fixes.</span></footer>
    </main>
  </div>;
}

function Stat({ title, value, icon, tone = "" }: { title: string; value: string | number; icon: string; tone?: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{title}</span><span className={`stat-symbol ${tone}`}>{icon}</span></div><div className="stat-number">{value}</div><p className="stat-footnote">{title === "SEO score" ? "Based on latest audit" : "Latest audit"}</p></div>;
}

export default App;
