"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "../flow.module.css";
import { HTTP_BASE, STYLE_LABELS, type Style } from "../lib/interviewClient";

type SessionListItem = {
  id: string;
  style: string;
  group_name?: string | null;
  consented?: boolean;
  created_at?: string;
  n_answers?: number;
  avg_speaking_rate?: number | null;
  avg_pause_ratio?: number | null;
  avg_gaze?: number | null;
  avg_fillers?: number | null;
};

function formatMaybeNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function safeDateString(value?: string) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

export default function HistoryPage() {
  const [items, setItems] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${HTTP_BASE}/sessions?limit=30`);
        const json = (await res.json()) as { items?: SessionListItem[]; error?: string };
        if (!res.ok || json.error) throw new Error(json.error || "fetch_failed");
        if (!cancelled) setItems(json.items ?? []);
      } catch {
        if (!cancelled) setError("Couldn’t load session history. Make sure the backend is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasSessions = useMemo(() => items.length > 0, [items.length]);

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <Link className={styles.navLink} href="/">
            Home
          </Link>
          <div className={styles.step}>History</div>
        </div>

        <div className={styles.card}>
          <p className={styles.kicker}>Sessions</p>
          <h1 className={styles.title}>Your recent practice.</h1>
          <p className={styles.subtitle}>Review past sessions, export data, and watch your delivery improve over time.</p>

          <div className={styles.buttonRow}>
            <Link className={styles.primary} href="/setup">
              New session
            </Link>
            <Link className={styles.secondary} href="/lab">
              Lab mode
            </Link>
          </div>
        </div>

        <div className={styles.section}>
          {loading && (
            <div className={styles.card}>
              <p className={styles.cardText}>Loading…</p>
            </div>
          )}

          {!loading && error && (
            <div className={styles.card}>
              <p className={styles.cardText} style={{ color: "var(--danger)" }}>
                {error}
              </p>
            </div>
          )}

          {!loading && !error && !hasSessions && (
            <div className={styles.card}>
              <p className={styles.cardText}>No sessions yet. Start your first practice session.</p>
              <div className={styles.buttonRow}>
                <Link className={styles.primary} href="/setup">
                  Start
                </Link>
              </div>
            </div>
          )}

          {!loading &&
            !error &&
            items.map((s) => {
              const styleKey = (s.style as Style) in STYLE_LABELS ? (s.style as Style) : null;
              return (
                <div key={s.id} className={styles.card}>
                  <div className={styles.statusRow}>
                    <div>
                      <div className={styles.optionTitle}>
                        {styleKey ? STYLE_LABELS[styleKey] : s.style || "Session"}
                        {typeof s.n_answers === "number" ? ` • ${s.n_answers} turns` : ""}
                      </div>
                      <div className={styles.helper}>{safeDateString(s.created_at)}</div>
                    </div>
                    <Link className={styles.secondary} href={`/review?sessionId=${encodeURIComponent(s.id)}`}>
                      Open
                    </Link>
                  </div>

                  <div className={styles.pillRow} style={{ marginTop: 12 }}>
                    <span className={styles.pill}>Rate: {formatMaybeNumber(s.avg_speaking_rate)} wpm</span>
                    <span className={styles.pill}>Pause: {formatMaybeNumber(s.avg_pause_ratio, 2)}</span>
                    <span className={styles.pill}>Center: {formatMaybeNumber(s.avg_gaze)}%</span>
                    <span className={styles.pill}>Fillers: {formatMaybeNumber(s.avg_fillers)}</span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </main>
  );
}
