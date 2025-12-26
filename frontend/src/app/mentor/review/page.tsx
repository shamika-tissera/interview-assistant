"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../../flow.module.css";
import { HTTP_BASE } from "../../lib/interviewClient";

type ExportSessionRow = {
  id?: string;
  created_at?: string;
};

type ExportAnswerRow = {
  turn: number;
  answer: string;
  created_at?: string;
};

type ExportData = {
  error?: string;
  session?: ExportSessionRow;
  answers?: ExportAnswerRow[];
};

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function formatOffsetMs(ms: number | null) {
  if (ms === null) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type CommentRow = {
  id?: number;
  event_type?: string;
  payload?: string | null;
  created_at?: string;
};

type CommentPayload = {
  turn?: number;
  text?: string;
  author?: string | null;
  kind?: string | null;
};

export default function MentorReviewPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.shell}>
          <div className={styles.container}>
            <div className={styles.card}>
              <p className={styles.kicker}>Mentor</p>
              <h1 className={styles.title}>Loading…</h1>
              <p className={styles.subtitle}>Preparing the session transcript.</p>
            </div>
          </div>
        </main>
      }
    >
      <MentorReviewInner />
    </Suspense>
  );
}

function MentorReviewInner() {
  const params = useSearchParams();
  const sessionId = params.get("sessionId");
  const [data, setData] = useState<ExportData | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [draftTurn, setDraftTurn] = useState<string>("");
  const [draftKind, setDraftKind] = useState<"comment" | "assignment">("comment");
  const [draftAuthor, setDraftAuthor] = useState<string>("");
  const [draftText, setDraftText] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError("");
    try {
      const [exportRes, commentsRes] = await Promise.all([
        fetch(`${HTTP_BASE}/export/session/${sessionId}`),
        fetch(`${HTTP_BASE}/comments/${sessionId}`),
      ]);
      const exportJson = (await exportRes.json()) as ExportData;
      const commentsJson = (await commentsRes.json()) as { items?: CommentRow[]; error?: string };
      if (!exportRes.ok || exportJson.error) throw new Error(exportJson.error || "export_failed");
      if (!commentsRes.ok || commentsJson.error) throw new Error(commentsJson.error || "comments_failed");
      setData(exportJson);
      setComments(commentsJson.items ?? []);
    } catch {
      setError("Couldn’t load mentor review. Make sure the backend is running and the session id is valid.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const answers = useMemo(() => [...(data?.answers ?? [])].sort((a, b) => a.turn - b.turn), [data]);
  const sessionStartMs = useMemo(() => toMs(data?.session?.created_at), [data]);

  const commentsByTurn = useMemo(() => {
    const grouped: Record<number, Array<CommentPayload & { at?: string; event?: string }>> = {};
    for (const row of comments) {
      const payload = safeJsonParse<CommentPayload>(row.payload);
      const turn = payload?.turn;
      if (typeof turn !== "number" || !payload?.text) continue;
      grouped[turn] ??= [];
      grouped[turn].push({ ...payload, at: row.created_at, event: row.event_type });
    }
    return grouped;
  }, [comments]);

  const turnOptions = useMemo(() => answers.map((a) => String(a.turn)), [answers]);

  useEffect(() => {
    if (!draftTurn && turnOptions.length) setDraftTurn(turnOptions[0]);
  }, [draftTurn, turnOptions]);

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <Link className={styles.navLink} href={sessionId ? `/review?sessionId=${encodeURIComponent(sessionId)}` : "/review"}>
            Back to report
          </Link>
          <div className={styles.step}>Mentor review</div>
        </div>

        <div className={styles.card}>
          <p className={styles.kicker}>Mentor</p>
          <h1 className={styles.title}>Timestamped feedback.</h1>
          <p className={styles.subtitle}>Leave notes tied to a turn. Use “assignment” to request a redo.</p>

          {!sessionId && <p className={styles.cardText}>Missing `sessionId`.</p>}
          {error && (
            <p className={styles.cardText} style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          {loading && <p className={styles.cardText}>Loading…</p>}

          <div className={styles.section}>
            <div className={styles.panel}>
              <div className={styles.optionTitle}>Add note</div>
              <div className={styles.fieldRow} style={{ marginTop: 10 }}>
                <label className={styles.field}>
                  Turn
                  <select
                    className={styles.input}
                    value={draftTurn}
                    onChange={(e) => setDraftTurn(e.target.value)}
                    disabled={!turnOptions.length}
                  >
                    {turnOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Author (optional)
                  <input className={styles.input} value={draftAuthor} onChange={(e) => setDraftAuthor(e.target.value)} placeholder="e.g., Alex" />
                </label>
              </div>

              <div className={styles.pillRow} style={{ marginTop: 12 }} role="radiogroup" aria-label="Note kind">
                {(["comment", "assignment"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={draftKind === k}
                    className={`${styles.pill} ${draftKind === k ? styles.pillActive : ""}`}
                    onClick={() => setDraftKind(k)}
                  >
                    {k === "comment" ? "Comment" : "Assignment"}
                  </button>
                ))}
              </div>

              <textarea
                className={styles.textarea}
                style={{ marginTop: 12 }}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={draftKind === "assignment" ? "Redo: Answer turn 3 with STAR, include 1 metric." : "Example: Great opening. Add 1 number in the outcome."}
              />

              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!sessionId || !draftTurn || !draftText.trim() || saving}
                  onClick={async () => {
                    if (!sessionId) return;
                    const turn = Number(draftTurn);
                    if (!turn || !draftText.trim()) return;
                    setSaving(true);
                    setStatus("");
                    try {
                      const res = await fetch(`${HTTP_BASE}/comments`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          sessionId,
                          turn,
                          text: draftText.trim(),
                          author: draftAuthor.trim() || undefined,
                          kind: draftKind,
                        }),
                      });
                      const json = (await res.json()) as { error?: string };
                      if (!res.ok || json.error) throw new Error(json.error || "comment_failed");
                      setDraftText("");
                      setStatus("Saved.");
                      await refresh();
                    } catch {
                      setStatus("Save failed.");
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? "Saving…" : "Save note"}
                </button>
                <button type="button" className={styles.secondary} onClick={() => void refresh()} disabled={!sessionId || saving}>
                  Refresh
                </button>
              </div>
              {status && (
                <p className={styles.helper} style={{ marginTop: 10 }}>
                  {status}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className={styles.section}>
          {answers.map((a) => {
            const answerMs = toMs(a.created_at);
            const offset = sessionStartMs !== null && answerMs !== null ? answerMs - sessionStartMs : null;
            const turnComments = commentsByTurn[a.turn] ?? [];
            return (
              <div key={a.turn} className={styles.card} id={`turn-${a.turn}`}>
                <div className={styles.statusRow}>
                  <div className={styles.optionTitle}>Turn {a.turn}</div>
                  <div className={styles.step}>{formatOffsetMs(offset)}</div>
                </div>
                <div className={styles.cardText} style={{ marginTop: 10 }}>
                  {a.answer}
                </div>
                <div className={styles.section}>
                  <div className={styles.panel}>
                    <div className={styles.optionTitle}>Notes</div>
                    {!turnComments.length ? (
                      <p className={styles.cardText} style={{ marginTop: 8 }}>
                        No notes yet.
                      </p>
                    ) : (
                      <div className={styles.section} style={{ marginTop: 10 }}>
                        {turnComments.map((c, idx) => (
                          <div key={`${a.turn}-${idx}`} className={styles.panel}>
                            <div className={styles.statusRow}>
                              <div className={styles.optionTitle}>{c.kind === "assignment" ? "Assignment" : "Comment"}</div>
                              <div className={styles.step}>{c.author || "Anonymous"}</div>
                            </div>
                            <div className={styles.cardText} style={{ marginTop: 8 }}>
                              {c.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
