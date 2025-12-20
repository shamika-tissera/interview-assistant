"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../flow.module.css";
import { HTTP_BASE } from "../lib/interviewClient";
import { clearReviewSnapshot, loadReviewSnapshot } from "../lib/flowStorage";

export default function ReviewPage() {
  const params = useSearchParams();
  const querySessionId = params.get("sessionId");
  const snapshot = useMemo(() => loadReviewSnapshot(), []);
  const sessionId = querySessionId || snapshot?.sessionId || null;
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string>("");

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <Link className={styles.link} href="/setup">
            New session
          </Link>
          <div className={styles.step}>{sessionId ? `Session ${sessionId.slice(0, 8)}` : "No session loaded"}</div>
        </div>

        <div className={styles.card}>
          <p className={styles.kicker}>Review</p>
          <h1 className={styles.title}>A quick look back.</h1>
          <p className={styles.subtitle}>Export your raw session data, and revisit transcript + tips.</p>

          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primary}
              disabled={!sessionId || exporting}
              onClick={async () => {
                if (!sessionId) return;
                setExporting(true);
                setExportStatus("");
                try {
                  const res = await fetch(`${HTTP_BASE}/export/session/${sessionId}`);
                  const json = await res.json();
                  const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `session-${sessionId}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setExportStatus("Exported session JSON.");
                } catch {
                  setExportStatus("Export failed.");
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? "Exporting…" : "Export session JSON"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                clearReviewSnapshot();
              }}
            >
              Clear local review
            </button>
            <Link className={styles.secondary} href="/setup">
              Start another
            </Link>
          </div>
          {exportStatus && <p className={styles.helper} style={{ marginTop: 10 }}>{exportStatus}</p>}
        </div>

        <div className={styles.section}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Transcript</h2>
            {snapshot?.messages?.length ? (
              <div className={styles.section}>
                {snapshot.messages.map((m, idx) => (
                  <div key={`${m.role}-${idx}`} className={styles.panel}>
                    <div className={styles.statusRow}>
                      <div className={styles.optionTitle}>{m.role === "user" ? "You" : "Interviewer"}</div>
                      <div className={styles.step}>Turn {m.turn + 1}</div>
                    </div>
                    <div className={styles.cardText} style={{ marginTop: 8 }}>
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.cardText}>No local transcript snapshot found. Use lab mode for full logging.</p>
            )}
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Tips</h2>
            {snapshot?.tips?.length ? (
              <div className={styles.section}>
                {snapshot.tips.map((tip) => (
                  <div key={tip.summary} className={styles.panel}>
                    <div className={styles.optionTitle}>{tip.summary}</div>
                    <div className={styles.cardText} style={{ marginTop: 6 }}>
                      {tip.detail}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.cardText}>No tips captured locally.</p>
            )}
          </div>
        </div>

        <div className={styles.center} style={{ marginTop: 22 }}>
          <Link className={styles.link} href="/">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
