
import { useEffect, useState } from "react";
import "./App.css";

type FixHistoryItem = {
  issue_type: string;
  new_value: string;
  status: string;
  target: string;
  timestamp: string;
};

type Issue = {
  title: string;
  description: string;
  severity: "Critical" | "Warning" | "Passed";
  recommendation: string;
};

function App() {
  const [url, setUrl] = useState("https://example.com");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [activeTab, setActiveTab] = useState("Overview");
  const [scanning, setScanning] = useState(false);
  const [score, setScore] = useState(0);
  const [approved, setApproved] = useState<string[]>([]);
  const [fixing, setFixing] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [fixHistory, setFixHistory] = useState<FixHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/fix/history")
      .then((response) => {
        if (!response.ok) throw new Error("History could not be loaded");
        return response.json();
      })
      .then((data) => setFixHistory(data.history || []))
      .catch((error) => console.error("Fix History:", error))
      .finally(() => setHistoryLoading(false));
  }, []);


  const criticalCount = issues.filter(
    (issue) => issue.severity === "Critical"
  ).length;

  const warningCount = issues.filter(
    (issue) => issue.severity === "Warning"
  ).length;

  const passedCount = issues.filter(
    (issue) => issue.severity === "Passed"
  ).length;



  const handleScan = async () => {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      alert("Please enter a valid website URL.");
      return;
    }

    setScanning(true);
    setShowNotice(false);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/audit",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: parsedUrl.toString() }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "SEO audit failed. Please try again."
        );
      }

      setIssues(data.issues);
      setScore(data.score);
      setApproved([]);
      setShowNotice(true);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Could not connect to the SEO backend."
      );
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (title: string) => {
    const issueType = title.toLowerCase().includes("title")
      ? "title"
      : title.toLowerCase().includes("meta")
        ? "meta_description"
        : null;

    if (!issueType) {
      alert("This SEO fix type is not supported yet. Title and meta description fixes are currently available.");
      return;
    }

    const proposedValue =
      issueType === "title"
        ? "SearchPilot | Professional SEO Audit and Optimization"
        : "Discover practical SEO insights with SearchPilot. Audit your website, identify issues, and improve your search visibility with actionable recommendations.";

    setFixing(true);

    try {
      // Step 1: Generate preview
      const previewResponse = await fetch(
        "http://127.0.0.1:8000/api/fix/preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issue_type: issueType,
            proposed_value: proposedValue,
          }),
        }
      );

      const previewData = await previewResponse.json();

      if (!previewResponse.ok) {
        throw new Error(
          typeof previewData.detail === "string"
            ? previewData.detail
            : "Could not generate fix preview."
        );
      }

      // Step 2: Ask for explicit human approval
      const accepted = window.confirm(
        `SEARCHPILOT FIX PREVIEW

` +
        `Issue: ${title}

` +
        `Current value:
${previewData.before}

` +
        `Proposed value:
${previewData.proposed}

` +
        `IMPORTANT: This will modify only the controlled SearchPilot demo website, not the public website you scanned.

` +
        `Do you approve this change?`
      );

      // Step 3: Send approval or rejection
      const approvalResponse = await fetch(
        "http://127.0.0.1:8000/api/fix/approve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preview_id: previewData.preview_id,
            approved: accepted,
          }),
        }
      );

      const approvalData = await approvalResponse.json();

      if (!approvalResponse.ok) {
        throw new Error(
          typeof approvalData.detail === "string"
            ? approvalData.detail
            : "Could not process approval."
        );
      }

      if (!accepted) {
        alert("Fix rejected. No website changes were made.");
        return;
      }

      // Step 4: Re-audit after applying the approved fix
      const verifyResponse = await fetch(
        "http://127.0.0.1:8000/api/fix/verify"
      );

      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok) {
        throw new Error("Fix was applied, but verification failed.");
      }

      setIssues(verifyData.audit.issues);
      setScore(verifyData.audit.score);
      setApproved((current) =>
        current.includes(title) ? current : [...current, title]
      );
      setShowNotice(true);

      alert(
        `Fix successfully applied!

` +
        `New SEO score: ${verifyData.audit.score}/100
` +
        `Website has been re-audited.`
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Something went wrong while applying the SEO fix."
      );
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">S</div>
          <div>
            <h2>SearchPilot</h2>
            <span>SEO Intelligence</span>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="navigation">
          {[
            ["Overview", "▦"],
            ["SEO Audit", "⌕"],
            ["AI Recommendations", "✧"],
            ["Fix History", "◷"],
          ].map(([name, icon]) => (
            <button
              key={name}
              className={`nav-item ${activeTab === name ? "active" : ""}`}
              onClick={() => setActiveTab(name)}
            >
              <span className="nav-icon">{icon}</span>
              {name}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">?</div>
            <strong>Need assistance?</strong>
            <p>Explore your SEO audit workflow.</p>
            <button onClick={() => alert("Help center coming soon.")}>
              Visit Help Center →
            </button>
          </div>

          <div className="profile">
            <div className="avatar">SA</div>
            <div className="profile-info">
              <strong>SEO Admin</strong>
              <span>Project workspace</span>
            </div>
            <span className="profile-menu">•••</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="breadcrumb">Workspace / {activeTab}</div>
            <h1>{activeTab}</h1>
          </div>

          <div className="topbar-right">
            <span className="system-status">
              <span className="status-dot" />
              System operational
            </span>
            <button className="notification-button" aria-label="Notifications">
              ♧
            </button>
          </div>
        </header>

        <section className="welcome-section">
          <div>
            <p className="eyebrow">SEO PERFORMANCE CENTER</p>
            <h2>Good to see you again.</h2>
            <p className="muted">
              Monitor your website health and discover opportunities to grow.
            </p>
          </div>
          <div className="date-label">● Live workspace</div>
        </section>

        <section className="website-panel">
          <div className="website-panel-heading">
            <div>
              <h3>Website Audit</h3>
              <p>Enter a website URL to start an SEO audit.</p>
            </div>
            <span className="secure-label">⌑ Secure workspace</span>
          </div>

          <div className="scan-form">
            <div className="url-input-wrapper">
              <span>↗</span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://yourwebsite.com"
                aria-label="Website URL"
              />
            </div>
            <button
              className="scan-button"
              onClick={handleScan}
              disabled={scanning}
            >
              {scanning ? "Scanning..." : "✧  Run SEO Audit"}
            </button>
          </div>

          {scanning && (
            <div className="scan-progress">
              <div className="progress-track">
                <div className="progress-fill" />
              </div>
              <span>Connecting to website and scanning SEO...</span>
            </div>
          )}

          {showNotice && (
            <p className="demo-notice">
              Live SEO audit completed successfully using your FastAPI backend.
            </p>
          )}
        </section>

        <section className="section-heading">
          <div>
            <h3>Performance Overview</h3>
            <p>Your website SEO health at a glance.</p>
          </div>
          <span className="updated-label">Live API</span>
        </section>

        <section className="stats-grid">
          <div className="stat-card score-card">
            <div className="stat-top">
              <span>SEO Health Score</span>
              <span className="stat-symbol">◉</span>
            </div>
            <div className="score-content">
              <div className="score-number">{score}<small>/100</small></div>
              <div className="score-ring">
                <span>{score}</span>
              </div>
            </div>
            <p className="stat-footnote">Based on live website audit</p>
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span>Critical Issues</span>
              <span className="stat-symbol red">!</span>
            </div>
            <div className="stat-number">{criticalCount}</div>
            <p className="stat-footnote">Require immediate attention</p>
            <div className="stat-indicator red-bg" />
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span>Warnings</span>
              <span className="stat-symbol orange">△</span>
            </div>
            <div className="stat-number">{warningCount}</div>
            <p className="stat-footnote">Potential improvements</p>
            <div className="stat-indicator orange-bg" />
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span>Passed Checks</span>
              <span className="stat-symbol green">✓</span>
            </div>
            <div className="stat-number">{passedCount}</div>
            <p className="stat-footnote">Checks looking healthy</p>
            <div className="stat-indicator green-bg" />
          </div>
        </section>

        <section className="results-section">
          <div className="section-heading results-heading">
            <div>
              <h3>SEO Audit Findings</h3>
              <p>Review detected issues and proposed improvements.</p>
            </div>
            <span className="result-count">{issues.length} checks</span>
          </div>

          <div className="issues-list">
            {issues.map((issue) => (
              <article className="issue-row" key={issue.title}>
                <div className={`issue-icon ${issue.severity.toLowerCase()}`}>
                  {issue.severity === "Critical"
                    ? "!"
                    : issue.severity === "Warning"
                      ? "△"
                      : "✓"}
                </div>

                <div className="issue-details">
                  <div className="issue-title-line">
                    <strong>{issue.title}</strong>
                    <span className={`severity ${issue.severity.toLowerCase()}`}>
                      {issue.severity}
                    </span>
                  </div>
                  <p>{issue.description}</p>
                  <div className="recommendation">
                    <span>✧ AI suggestion:</span> {issue.recommendation}
                  </div>
                </div>

                <div className="issue-action">
                  {issue.severity === "Critical" ||
                  issue.severity === "Warning" ? (
                    <button
                      className={
                        approved.includes(issue.title)
                          ? "approved-button"
                          : "review-button"
                      }
                      onClick={() => handleApprove(issue.title)}
                      disabled={approved.includes(issue.title) || fixing}
                    >
                      {approved.includes(issue.title)
                        ? "✓ Approved"
                        : fixing ? "Processing..." : "Preview & approve fix"}
                    </button>
                  ) : (
                    <span className="passed-label">No action needed</span>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="approval-notice">
            <span className="approval-icon">♧</span>
            <div>
              <strong>Human approval is always required</strong>
              <p>
                Suggestions are not applied automatically. Approval here is
                a demo interaction; actual website changes will be connected
                later.
              </p>
            </div>
          </div>
        </section>

        <section className="fix-history-section">
          <div className="fix-history-heading">
            <div>
              <h2>Fix History</h2>
              <p>Record of approved SEO changes</p>
            </div>
            <span className="history-count">{fixHistory.length} fixes</span>
          </div>

          {historyLoading ? (
            <p className="history-empty">Loading fix history...</p>
          ) : fixHistory.length === 0 ? (
            <p className="history-empty">No approved fixes yet.</p>
          ) : (
            <div className="history-list">
              {fixHistory.map((item, index) => (
                <article className="history-item" key={`${item.timestamp}-${index}`}>
                  <div className="history-item-main">
                    <strong>{item.issue_type.replace("_", " ")}</strong>
                    <span>{item.new_value}</span>
                    <small>{item.target} · {new Date(item.timestamp).toLocaleString()}</small>
                  </div>
                  <span className="history-status">{item.status}</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="footer">
          <span>SearchPilot SEO Intelligence</span>
          <span>Built for the SEO Audit-to-Fix project</span>
        </footer>
      </main>
    </div>
  );
}

export default App;


