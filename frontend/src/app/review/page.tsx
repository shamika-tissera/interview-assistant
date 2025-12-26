"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../flow.module.css";
import { HTTP_BASE } from "../lib/interviewClient";
import { clearReviewSnapshot, loadReviewSnapshot } from "../lib/flowStorage";

type SessionReport = {
  turns: number;
  avgSpeakingRate?: number | null;
  avgPauseRatio?: number | null;
  avgCenter?: number | null;
  avgFillers?: number | null;
  avgLatencyMs?: number | null;
};

type ExportSessionRow = {
  id?: string;
  created_at?: string;
};

type ExportAnswerRow = {
  turn: number;
  answer: string;
  created_at?: string;
  speaking_rate?: number | null;
  pause_ratio?: number | null;
  gaze?: number | null;
  fillers?: number | null;
};

type ExportTelemetryRow = {
  event_type?: string;
  latency_ms?: number | null;
  payload?: string | null;
  created_at?: string;
};

type ExportData = {
  error?: string;
  session?: ExportSessionRow;
  answers?: ExportAnswerRow[];
  telemetry?: ExportTelemetryRow[];
};

function mean(values: Array<number | null | undefined>) {
  const filtered = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

function formatMaybeNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

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

function trimExcerpt(text: string, max = 170) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\u00C0-\u017F]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "so",
  "that",
  "the",
  "their",
  "then",
  "there",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your",
]);

const FILLER_WORDS = ["um", "uh", "like", "actually", "basically", "literally"];
const WEAK_PHRASES = ["just", "maybe", "kind of", "sort of", "probably", "i think", "i guess", "somewhat", "pretty"];

function formatPack(value: string | null | undefined) {
  switch (value) {
    case "swe_behavioral":
      return "SWE behavioral";
    case "swe_system_design":
      return "SWE system design";
    case "data_science_ml":
      return "Data science / ML";
    case "leadership":
      return "Leadership";
    default:
      return value || "—";
  }
}

function formatDifficulty(value: string | null | undefined) {
  switch (value) {
    case "standard":
      return "Standard";
    case "hard":
      return "Hard";
    default:
      return value || "—";
  }
}

function countOccurrences(text: string, needle: string) {
  const pattern = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "gi");
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function countPhraseOccurrences(text: string, phrase: string) {
  const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "gi");
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

type TurnNote = {
  turn: number;
  time: string;
  title: string;
  metric: string;
  excerpt: string;
  fix: string;
};

function buildTurnNotes(data: ExportData | null) {
  if (!data?.session || !data.answers) return [];
  const sessionStart = toMs(data.session.created_at);
  const answers = [...data.answers].sort((a, b) => a.turn - b.turn);

  const questionsByAnswerTurn: Record<number, string> = {};
  for (const t of data.telemetry ?? []) {
    if (t.event_type !== "question") continue;
    const payload = safeJsonParse<{ answer_turn?: number; question?: string }>(t.payload);
    if (!payload?.answer_turn || !payload.question) continue;
    questionsByAnswerTurn[payload.answer_turn] = payload.question;
  }

  const candidates: Array<{ score: number; turn: number; kind: string; metric: string; fix: string }> = [];
  for (const a of answers) {
    const rate = typeof a.speaking_rate === "number" ? a.speaking_rate : null;
    const pause = typeof a.pause_ratio === "number" ? a.pause_ratio : null;
    const center = typeof a.gaze === "number" ? a.gaze : null;
    const fillers = typeof a.fillers === "number" ? a.fillers : null;

    if (fillers !== null && fillers >= 3) {
      candidates.push({
        score: fillers * 10,
        turn: a.turn,
        kind: "fillers",
        metric: `Fillers: ${fillers}`,
        fix: "Swap fillers for silence: pause, then restart the sentence cleanly.",
      });
    }
    if (rate !== null && rate >= 180) {
      candidates.push({
        score: (rate - 170) * 2,
        turn: a.turn,
        kind: "pace",
        metric: `Pace: ${Math.round(rate)} wpm`,
        fix: "Slow down: add micro-pauses on key nouns and numbers.",
      });
    }
    if (center !== null && center > 0 && center <= 55) {
      candidates.push({
        score: (60 - center) * 2,
        turn: a.turn,
        kind: "center",
        metric: `Centering: ${Math.round(center)}%`,
        fix: "Re-center: keep your face in-frame for your first and last sentence.",
      });
    }
    if (pause !== null && pause >= 0.22) {
      candidates.push({
        score: (pause - 0.18) * 200,
        turn: a.turn,
        kind: "pauses",
        metric: `Pause ratio: ${pause.toFixed(2)}`,
        fix: "Reduce long pauses: take one planning pause up front, then keep sentences flowing.",
      });
    }
  }

  // If no strong signal spikes, use longest answer as the third highlight.
  const wordCounts = answers.map((a) => ({ turn: a.turn, words: tokenize(a.answer).length }));
  const longest = wordCounts.sort((a, b) => b.words - a.words)[0];
  if (longest && longest.words >= 110) {
    candidates.push({
      score: longest.words,
      turn: longest.turn,
      kind: "length",
      metric: `Length: ${longest.words} words`,
      fix: "Tighten: lead with a 1-sentence headline, then 2 bullets (action + impact).",
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const chosenTurns = new Set<number>();
  const notes: TurnNote[] = [];

  for (const c of candidates) {
    if (chosenTurns.has(c.turn)) continue;
    const answer = answers.find((a) => a.turn === c.turn);
    if (!answer) continue;
    const answerMs = toMs(answer.created_at);
    const time = formatOffsetMs(sessionStart !== null && answerMs !== null ? answerMs - sessionStart : null);
    const question = questionsByAnswerTurn[answer.turn];
    notes.push({
      turn: answer.turn,
      time,
      title: question ? `Turn ${answer.turn}: ${trimExcerpt(question, 84)}` : `Turn ${answer.turn}`,
      metric: c.metric,
      excerpt: trimExcerpt(answer.answer),
      fix: c.fix,
    });
    chosenTurns.add(c.turn);
    if (notes.length >= 3) break;
  }

  return notes;
}

type SignalRow = {
  title: string;
  value: string;
  example: string;
  fix: string;
};

function buildSignalRows(data: ExportData | null): SignalRow[] {
  const answers = data?.answers ?? [];
  if (answers.length === 0) return [];

  const byFastest = [...answers]
    .filter((a) => typeof a.speaking_rate === "number")
    .sort((a, b) => (b.speaking_rate ?? 0) - (a.speaking_rate ?? 0))[0];
  const byMostFillers = [...answers]
    .filter((a) => typeof a.fillers === "number")
    .sort((a, b) => (b.fillers ?? 0) - (a.fillers ?? 0))[0];
  const byLowestCenter = [...answers]
    .filter((a) => typeof a.gaze === "number" && (a.gaze ?? 0) > 0)
    .sort((a, b) => (a.gaze ?? 0) - (b.gaze ?? 0))[0];
  const byLongest = [...answers].sort((a, b) => tokenize(b.answer).length - tokenize(a.answer).length)[0];

  const allText = answers.map((a) => a.answer).join(" ");
  const fillerCount = FILLER_WORDS.reduce((sum, w) => sum + countOccurrences(allText, w), 0);
  const weakCount = WEAK_PHRASES.reduce((sum, p) => sum + countPhraseOccurrences(allText, p), 0);

  const freq: Record<string, number> = {};
  for (const token of tokenize(allText)) {
    if (token.length <= 2) continue;
    if (STOPWORDS.has(token)) continue;
    freq[token] = (freq[token] ?? 0) + 1;
  }
  const topRepeated = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([, count]) => count >= 3)
    .map(([word, count]) => `${word} (${count})`);

  const rows: SignalRow[] = [];

  const avgRate = mean(answers.map((a) => a.speaking_rate));
  rows.push({
    title: "Pace",
    value: avgRate === null ? "—" : `${Math.round(avgRate)} wpm`,
    example: byFastest ? `Turn ${byFastest.turn}: ${trimExcerpt(byFastest.answer, 120)}` : "No pace data captured.",
    fix: "Aim for ~120–160 wpm. Add micro-pauses after key nouns and metrics.",
  });

  const avgPause = mean(answers.map((a) => a.pause_ratio));
  rows.push({
    title: "Pauses",
    value: avgPause === null ? "—" : avgPause.toFixed(2),
    example: byLongest ? `Turn ${byLongest.turn}: ${trimExcerpt(byLongest.answer, 120)}` : "No pause data captured.",
    fix: "Take one planning pause up front, then keep sentences flowing (shorter clauses).",
  });

  const avgCenter = mean(answers.map((a) => a.gaze));
  rows.push({
    title: "Centering",
    value: avgCenter === null ? "—" : `${Math.round(avgCenter)}%`,
    example: byLowestCenter ? `Turn ${byLowestCenter.turn}: ${trimExcerpt(byLowestCenter.answer, 120)}` : "No camera centering captured.",
    fix: "Keep your face centered for the first + last sentence of each answer.",
  });

  rows.push({
    title: "Fillers",
    value: `${fillerCount}`,
    example: byMostFillers ? `Turn ${byMostFillers.turn}: ${trimExcerpt(byMostFillers.answer, 120)}` : "No transcript captured.",
    fix: "Replace “um/like” with a silent pause. Restart the sentence cleanly.",
  });

  rows.push({
    title: "Weak words",
    value: `${weakCount}`,
    example: byLongest ? `Turn ${byLongest.turn}: ${trimExcerpt(byLongest.answer, 120)}` : "No transcript captured.",
    fix: "Remove hedges (maybe/just/kind of). Swap in a concrete metric or decision.",
  });

  rows.push({
    title: "Repetition",
    value: topRepeated.length ? topRepeated.slice(0, 3).join(", ") : "—",
    example: byLongest ? `Turn ${byLongest.turn}: ${trimExcerpt(byLongest.answer, 120)}` : "No transcript captured.",
    fix: "Vary phrasing and replace repeated adjectives with proof points (numbers, constraints, tradeoffs).",
  });

  return rows;
}

function buildNextSteps(report: SessionReport | null) {
  if (!report) return [];
  const steps: Array<{ priority: number; text: string }> = [];

  if (typeof report.avgSpeakingRate === "number") {
    if (report.avgSpeakingRate > 175) steps.push({ priority: 80, text: "Slow down: aim for ~120–160 wpm with micro-pauses on key nouns." });
    if (report.avgSpeakingRate < 105) steps.push({ priority: 55, text: "Speed up slightly by shortening sentences and leading with your headline." });
  }
  if (typeof report.avgPauseRatio === "number" && report.avgPauseRatio > 0.18) {
    steps.push({ priority: 70, text: "Reduce long pauses: take one planning pause up front, then keep sentences flowing." });
  }
  if (typeof report.avgCenter === "number" && report.avgCenter < 60) {
    steps.push({ priority: 60, text: "Re-center on camera: keep your face centered for your first and last sentence each turn." });
  }
  if (typeof report.avgFillers === "number" && report.avgFillers > 1) {
    steps.push({ priority: 60, text: "Replace fillers with silence: pause silently and restart the sentence cleanly." });
  }

  steps.sort((a, b) => b.priority - a.priority);
  const unique = Array.from(new Set(steps.map((s) => s.text)));
  if (unique.length === 0) {
    unique.push("Keep the structure: add one crisp metric next answer to make your impact unmistakable.");
  }
  return unique.slice(0, 3);
}

export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.shell}>
          <div className={styles.container}>
            <div className={styles.card}>
              <p className={styles.kicker}>Review</p>
              <h1 className={styles.title}>Loading…</h1>
              <p className={styles.subtitle}>Preparing your session summary.</p>
              <div className={styles.buttonRow}>
                <Link className={styles.secondary} href="/setup">
                  New session
                </Link>
              </div>
            </div>
          </div>
        </main>
      }
    >
      <ReviewPageInner />
    </Suspense>
  );
}

function ReviewPageInner() {
  const params = useSearchParams();
  const querySessionId = params.get("sessionId");
  const snapshot = useMemo(() => loadReviewSnapshot(), []);
  const sessionId = querySessionId || snapshot?.sessionId || null;
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string>("");
  const [reportError, setReportError] = useState<string>("");
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!sessionId) {
        setData(null);
        setReportError("");
        return;
      }
      setLoading(true);
      setReportError("");
      try {
        const res = await fetch(`${HTTP_BASE}/export/session/${sessionId}`);
        const json = (await res.json()) as ExportData;
        if (!res.ok || json.error) throw new Error(json.error || "fetch_failed");
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setReportError("Couldn’t load session summary (backend not running?).");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const report = useMemo<SessionReport | null>(() => {
    const answers = data?.answers ?? [];
    if (!answers.length) return sessionId ? { turns: 0 } : null;
    const latency = (data?.telemetry ?? []).filter((t) => t.event_type === "latency").map((t) => t.latency_ms);
    return {
      turns: answers.length,
      avgSpeakingRate: mean(answers.map((a) => a.speaking_rate)),
      avgPauseRatio: mean(answers.map((a) => a.pause_ratio)),
      avgCenter: mean(answers.map((a) => a.gaze)),
      avgFillers: mean(answers.map((a) => a.fillers)),
      avgLatencyMs: mean(latency),
    };
  }, [data, sessionId]);

  const nextSteps = useMemo(() => buildNextSteps(report), [report]);
  const highlights = useMemo(() => buildTurnNotes(data), [data]);
  const signalRows = useMemo(() => buildSignalRows(data), [data]);
  const answersSorted = useMemo(() => [...(data?.answers ?? [])].sort((a, b) => a.turn - b.turn), [data]);
  const sessionStartMs = useMemo(() => toMs(data?.session?.created_at), [data]);
  const sessionMeta = useMemo(() => {
    for (const t of data?.telemetry ?? []) {
      if (t.event_type !== "session_meta") continue;
      const payload = safeJsonParse<{ pack?: string; difficulty?: string }>(t.payload);
      if (!payload) continue;
      return payload;
    }
    return null;
  }, [data]);

  const questionsByAnswerTurn = useMemo(() => {
    const lookup: Record<number, string> = {};
    for (const t of data?.telemetry ?? []) {
      if (t.event_type !== "question") continue;
      const payload = safeJsonParse<{ answer_turn?: number; question?: string }>(t.payload);
      if (!payload?.answer_turn || !payload.question) continue;
      lookup[payload.answer_turn] = payload.question;
    }
    return lookup;
  }, [data]);

  const tipsByTurn = useMemo(() => {
    const lookup: Record<number, Array<{ summary: string; detail: string }>> = {};
    for (const t of data?.telemetry ?? []) {
      if (t.event_type !== "tips") continue;
      const payload = safeJsonParse<{ turn?: number; items?: Array<{ summary: string; detail: string }> }>(t.payload);
      if (!payload?.turn || !payload.items?.length) continue;
      lookup[payload.turn] = payload.items;
    }
    return lookup;
  }, [data]);

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <Link className={styles.navLink} href="/setup">
            New session
          </Link>
          <div className={styles.step}>{sessionId ? `Session ${sessionId.slice(0, 8)}` : "No session loaded"}</div>
        </div>

        <div className={styles.card}>
          <p className={styles.kicker}>Review</p>
          <h1 className={styles.title}>A quick look back.</h1>
          <p className={styles.subtitle}>A one-page after-action report: highlights, signals, transcript.</p>

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
            {sessionId && (
              <Link className={styles.secondary} href={`/mentor/review?sessionId=${encodeURIComponent(sessionId)}`}>
                Mentor view
              </Link>
            )}
            <Link className={styles.secondary} href="/setup">
              Start another
            </Link>
          </div>
          {exportStatus && (
            <p className={styles.helper} style={{ marginTop: 10 }}>
              {exportStatus}
            </p>
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Summary</h2>
            {!sessionId ? (
              <p className={styles.cardText}>No session selected yet.</p>
            ) : report && !reportError ? (
              <>
                <div className={styles.pillRow} style={{ marginTop: 10 }}>
                  <span className={styles.pill}>Turns: {report.turns}</span>
                  <span className={styles.pill}>Pack: {formatPack(sessionMeta?.pack)}</span>
                  <span className={styles.pill}>Difficulty: {formatDifficulty(sessionMeta?.difficulty)}</span>
                  <span className={styles.pill}>Rate: {formatMaybeNumber(report.avgSpeakingRate)} wpm</span>
                  <span className={styles.pill}>Pause: {formatMaybeNumber(report.avgPauseRatio, 2)}</span>
                  <span className={styles.pill}>Center: {formatMaybeNumber(report.avgCenter)}%</span>
                  <span className={styles.pill}>Fillers: {formatMaybeNumber(report.avgFillers)}</span>
                  <span className={styles.pill}>Latency: {formatMaybeNumber(report.avgLatencyMs)} ms</span>
                </div>
                <div className={styles.section}>
                  <div className={styles.panel}>
                    <div className={styles.optionTitle}>Next practice</div>
                    <div className={styles.cardText} style={{ marginTop: 8 }}>
                      {nextSteps.map((s) => (
                        <div key={s}>• {s}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className={styles.cardText} style={{ color: reportError ? "var(--danger)" : undefined }}>
                {reportError || (loading ? "Loading…" : "No session data yet.")}
              </p>
            )}
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Highlights</h2>
            {!highlights.length ? (
              <p className={styles.cardText}>No highlight moments yet. Complete a few turns to unlock clips.</p>
            ) : (
              <div className={styles.section}>
                {highlights.map((h) => (
                  <div key={`${h.turn}-${h.metric}`} className={styles.panel}>
                    <div className={styles.statusRow}>
                      <div className={styles.optionTitle}>{h.title}</div>
                      <a className={styles.link} href={`#turn-${h.turn}`}>
                        {h.time}
                      </a>
                    </div>
                    <div className={styles.cardText} style={{ marginTop: 8 }}>
                      <div>• {h.metric}</div>
                      <div>• “{h.excerpt}”</div>
                      <div>• Fix: {h.fix}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Signals (not noise)</h2>
            {!signalRows.length ? (
              <p className={styles.cardText}>No analytics yet. Finish a turn to generate delivery signals.</p>
            ) : (
              <div className={styles.section}>
                {signalRows.map((row) => (
                  <div key={row.title} className={styles.panel}>
                    <div className={styles.statusRow}>
                      <div className={styles.optionTitle}>{row.title}</div>
                      <div className={styles.step}>{row.value}</div>
                    </div>
                    <div className={styles.cardText} style={{ marginTop: 8 }}>
                      <div>Example: {row.example}</div>
                      <div style={{ marginTop: 6 }}>Fix: {row.fix}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Transcript</h2>
            {answersSorted.length ? (
              <div className={styles.section}>
                {answersSorted.map((a) => {
                  const answerMs = toMs(a.created_at);
                  const offsetMs = sessionStartMs !== null && answerMs !== null ? answerMs - sessionStartMs : null;
                  return (
                  <div key={a.turn} className={styles.panel} id={`turn-${a.turn}`}>
                    <div className={styles.statusRow}>
                      <div className={styles.optionTitle}>Turn {a.turn}</div>
                      <div className={styles.step}>
                        {formatOffsetMs(offsetMs)}
                      </div>
                    </div>
                    {questionsByAnswerTurn[a.turn] && (
                      <div className={styles.cardText} style={{ marginTop: 8 }}>
                        <strong>Prompt:</strong> {questionsByAnswerTurn[a.turn]}
                      </div>
                    )}
                    <div className={styles.cardText} style={{ marginTop: 8 }}>
                      <strong>Answer:</strong> {a.answer}
                    </div>
                    {tipsByTurn[a.turn]?.length ? (
                      <div className={styles.cardText} style={{ marginTop: 10 }}>
                        <strong>Tips:</strong>
                        {tipsByTurn[a.turn].map((t) => (
                          <div key={t.summary}>• {t.summary}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
                })}
              </div>
            ) : snapshot?.messages?.length ? (
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
              <p className={styles.cardText}>No transcript found yet.</p>
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
              <p className={styles.cardText}>Tips show here after each turn.</p>
            )}
          </div>
        </div>

        <div className={styles.center} style={{ marginTop: 22 }}>
          <Link className={styles.navLink} href="/">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
