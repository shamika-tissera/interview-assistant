"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Metric } from "../components/Metric";
import { useVoiceInterview } from "../lib/useVoiceInterview";
import { HTTP_BASE, STYLE_HELP, STYLE_LABELS, type Style, useInterview, useMediaSensors } from "../lib/interviewClient";
import styles from "../page.module.css";

export default function LabPage() {
  const {
    status,
    start,
    stop,
    style,
    group,
    setGroup,
    switchStyle,
    question,
    messages,
    tips,
    sessionId,
    analytics,
    setAnalytics,
    sendAnswer,
    sendClarification,
    setMessages,
    sendCheckIn,
    sendTelemetry,
    turn,
    interviewerCue,
  } = useInterview();

  const [confidence, setConfidence] = useState<number>(70);
  const [stress, setStress] = useState<number>(30);
  const { metrics: sensorMetrics, videoRef, streamError, stream: mediaStream } = useMediaSensors(status === "active");
  const [consent, setConsent] = useState<boolean>(false);
  const [accent, setAccent] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string>("");

  const disabled = useMemo(() => status === "connecting" || status === "error", [status]);
  const voice = useVoiceInterview({
    status,
    style,
    question,
    interviewerCue,
    sessionId,
    turn,
    mediaStream,
    sensorMetrics,
    analytics,
    setAnalytics,
    sendAnswer,
    sendClarification,
    sendTelemetry,
    nudgesEnabled: false,
  });
  const {
    draft,
    setDraft,
    autoListen,
    setAutoListen,
    autoSendVoice,
    setAutoSendVoice,
    recording,
    recordingMode,
    sttPending,
    sttError,
    ttsError,
    interviewerTalking,
    listening,
    userTalking,
    startRecording,
    stopRecording,
    speakQuestion,
    sendDraft,
    sendClarificationDraft,
  } = voice;

  useEffect(() => {
    if (status !== "active") return;
    setAnalytics((prev) => ({
      ...prev,
      speakingRate: sensorMetrics.speakingRate || prev.speakingRate,
      pauseRatio: sensorMetrics.pauseRatio,
      gaze: sensorMetrics.gaze || prev.gaze,
      volume: sensorMetrics.volume,
      speechSeconds: sensorMetrics.speechSeconds ?? prev.speechSeconds,
    }));
  }, [sensorMetrics, setAnalytics, status]);

  const logCheckIn = useCallback(() => {
    sendCheckIn(group, confidence, stress);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: `Check-in (${group}): confidence ${confidence}/100, stress ${stress}/100.`,
        turn: prev.length,
      },
    ]);
  }, [confidence, group, sendCheckIn, setMessages, stress]);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>BG Hacker • Cognitive Ergonomics</p>
          <h1 className={styles.title}>Multi-style AI Interview Trainer</h1>
          <p className={styles.subtitle}>
            Practice with supportive, neutral, and cold interviewer personas. Get glanceable feedback on delivery,
            pacing, and adaptability.
          </p>
        </div>
        <div className={styles.sessionMeta}>
          <div className={styles.badge}>{status.toUpperCase()}</div>
          <div className={styles.sessionId}>{sessionId ? `Session: ${sessionId.slice(0, 8)}` : "No session yet"}</div>
          <div className={styles.styleHint}>{STYLE_HELP[style]}</div>
        </div>
      </header>

      <section className={styles.controls}>
        <div className={styles.styleSwitch}>
          {(["supportive", "neutral", "cold"] as Style[]).map((s) => (
            <button
              key={s}
              className={`${styles.styleButton} ${style === s ? styles.styleButtonActive : ""}`}
              onClick={() => switchStyle(s)}
              aria-pressed={style === s}
            >
              <span className={styles.styleLabel}>{STYLE_LABELS[s]}</span>
              <span className={styles.styleSub}>{STYLE_HELP[s]}</span>
            </button>
          ))}
        </div>
        <div className={styles.sessionControls}>
          <button className={styles.primary} disabled={disabled || !consent} onClick={() => start(style, group, consent, accent, notes)}>
            {status === "active" ? "Restart" : "Start Interview"}
          </button>
          <button className={styles.secondary} onClick={stop} disabled={status === "idle"}>
            Stop
          </button>
          <button
            className={styles.secondary}
            disabled={!sessionId || exporting}
            onClick={async () => {
              if (!sessionId) return;
              setExporting(true);
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
            {exporting ? "Exporting..." : "Export session JSON"}
          </button>
        </div>
      </section>

      <section className={styles.consentCard}>
        <div>
          <p className={styles.kicker}>Consent & fairness</p>
          <h3 className={styles.cardTitle}>Data handling agreement</h3>
          <p className={styles.subtitle}>
            We store session metrics (answers, delivery signals, latency) locally for coaching and aggregate analysis.
            No emotion inference; you can export/delete your session data.
          </p>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I consent to capture and local processing of mic/cam signals for this session.</span>
          </label>
          <div className={styles.fairnessRow}>
            <label>
              Accent / dialect (optional)
              <input
                type="text"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                placeholder="e.g., US Southern, Nigerian English"
              />
            </label>
            <label>
              Notes (optional)
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any accessibility or fairness notes"
              />
            </label>
          </div>
          <p className={styles.helperText}>
            Accent metadata helps audit ASR latency/fairness. Export anytime with “Export session JSON.” {exportStatus}
          </p>
        </div>
      </section>

      <section className={styles.columns}>
        <div className={styles.leftColumn}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <p className={styles.kicker}>Voice-led interview</p>
              <h3 className={styles.cardTitle}>Avatar & mic flow</h3>
            </div>
            <div className={styles.avatarRow}>
              <Avatar style={style} talking={interviewerTalking} userTalking={userTalking} listening={listening} />
              <div className={styles.voicePanel}>
                <div className={styles.voiceStatus}>
                  Questions are spoken in her adaptive voice (Coqui TTS). {ttsError && ttsError}
                </div>
                <div className={styles.voiceControls}>
                  {recording ? (
                    <button className={styles.secondary} disabled={status !== "active" || sttPending} onClick={stopRecording}>
                      Stop & transcribe{recordingMode === "clarification" ? " (clarify)" : ""}
                    </button>
                  ) : (
                    <>
                      <button
                        className={styles.secondary}
                        disabled={status !== "active" || sttPending || !question}
                        onClick={() => startRecording("answer")}
                      >
                        Tap to answer
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={status !== "active" || sttPending || !question}
                        onClick={() => startRecording("clarification")}
                      >
                        Tap to clarify
                      </button>
                    </>
                  )}
                  <button
                    className={styles.secondary}
                    disabled={!question || sttPending || recording}
                    onClick={() => {
                      stopRecording();
                      speakQuestion(question);
                    }}
                  >
                    Replay question
                  </button>
                </div>
                <div className={styles.voiceToggles}>
                  <label className={styles.checkboxRow}>
                    <input type="checkbox" checked={autoListen} onChange={(e) => setAutoListen(e.target.checked)} />
                    <span>Auto-listen after each question</span>
                  </label>
                  <label className={styles.checkboxRow}>
                    <input type="checkbox" checked={autoSendVoice} onChange={(e) => setAutoSendVoice(e.target.checked)} />
                    <span>Auto-send when speech finishes</span>
                  </label>
                </div>
                <p className={styles.helperText}>
                  Mic pickup drives analytics and fills the transcript; typing is optional. Audio is sent to the local
                  Whisper model for transcription. Keep the text box as fallback.
                </p>
              </div>
            </div>
          </div>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.kicker}>Current prompt</p>
                <h3 className={styles.cardTitle}>{question || "Click Start to get your first question"}</h3>
              </div>
              <div className={styles.pill}>{STYLE_LABELS[style]}</div>
            </div>
            <textarea
              className={styles.answerBox}
              placeholder="Speak your answer (auto-filled). Type here only if you prefer."
              value={draft}
              disabled={status !== "active"}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
            />
            <div className={styles.listeningStatus}>
              <span className={listening ? styles.dotLive : styles.dotIdle} />
              {listening
                ? sttPending
                  ? "Transcribing…"
                  : "Recording — just speak naturally."
                : "Not recording. Tap to answer or wait for auto-listen."}
            </div>
            {sttError && <div className={styles.errorText}>{sttError}</div>}
            <div className={styles.answerActions}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className={styles.primary} onClick={sendDraft} disabled={!draft.trim() || status !== "active" || recording || sttPending}>
                  Send answer
                </button>
                <button
                  className={styles.secondary}
                  onClick={sendClarificationDraft}
                  disabled={!draft.trim() || status !== "active" || recording || sttPending || !question}
                >
                  Ask clarification
                </button>
              </div>
              <div className={styles.helperText}>
                Live answers auto-send when you stop talking. Voice latency is logged for fairness audits.
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <p className={styles.kicker}>Real-time signals</p>
              <h3 className={styles.cardTitle}>Glanceable HUD</h3>
            </div>
            <div className={styles.metricsGrid}>
              <Metric label="Speaking rate" value={`${analytics.speakingRate || "—"} wpm`} target="120-160" />
              <Metric label="Pause ratio" value={`${analytics.pauseRatio}`} target="<0.12" />
              <Metric label="Gaze on camera" value={`${analytics.gaze}%`} target="70%+" />
              <Metric label="Fillers (last answer)" value={`${analytics.fillers}`} target="keep ≤1" />
            </div>
            <div className={styles.videoRow}>
              <div className={styles.videoContainer}>
                <video ref={videoRef} className={styles.video} muted playsInline />
              </div>
              <div className={styles.metricHint}>
                Live camera/audio power adaptive coaching. Face detection (if supported) approximates on-camera gaze; audio
                RMS drives pause ratio and rate. {streamError || "Grant mic/cam permissions to unlock live telemetry."}
              </div>
            </div>
            <div className={styles.metricHint}>
              Feedback mixes modalities: color band for rate, subtle chime for filler spikes, compact cards after each
              turn.
            </div>
          </div>
        </div>

        <div className={styles.rightColumn}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <p className={styles.kicker}>Conversation</p>
              <h3 className={styles.cardTitle}>Transcript & moves</h3>
            </div>
            <div className={styles.feed}>
              {messages.length === 0 && <p className={styles.placeholder}>Answers and follow-ups will appear here.</p>}
              {messages.map((m, idx) => (
                <div key={`${m.role}-${idx}`} className={styles.message}>
                  <div className={styles.messageMeta}>
                    <span className={styles.messageRole}>{m.role === "user" ? "You" : "Interviewer"}</span>
                    {m.style && <span className={styles.messageStyle}>{STYLE_LABELS[m.style]}</span>}
                    <span className={styles.messageTurn}>Turn {m.turn + 1}</span>
                  </div>
                  <p className={styles.messageText}>{m.content}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <p className={styles.kicker}>Actionable tips</p>
              <h3 className={styles.cardTitle}>Style-aware coaching</h3>
            </div>
            {tips.length === 0 ? (
              <p className={styles.placeholder}>Send an answer to see concise recommendations.</p>
            ) : (
              <ul className={styles.tipList}>
                {tips.map((tip, i) => (
                  <li key={`${tip.summary}-${i}`} className={styles.tipItem}>
                    <div className={styles.tipSummary}>{tip.summary}</div>
                    <div className={styles.tipDetail}>{tip.detail}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <p className={styles.kicker}>Experiment flow</p>
              <h3 className={styles.cardTitle}>Check-ins (pre / post)</h3>
            </div>
            <div className={styles.chipRow}>
              {["control", "treatment"].map((g) => (
                <button
                  key={g}
                  className={`${styles.chip} ${group === g ? styles.chipActive : ""}`}
                  onClick={() => setGroup(g as "control" | "treatment")}
                >
                  {g === "control" ? "Control: neutral only" : "Treatment: multi-style"}
                </button>
              ))}
            </div>
            <div className={styles.sliderRow}>
              <label>
                Confidence {confidence}/100
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={confidence}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                />
              </label>
              <label>
                Stress {stress}/100
                <input type="range" min={0} max={100} value={stress} onChange={(e) => setStress(Number(e.target.value))} />
              </label>
            </div>
            <button className={styles.secondary} onClick={logCheckIn}>
              Log check-in
            </button>
            <p className={styles.helperText}>
              Use this during pre-test, training, and post-tests to track adaptability and perceived readiness.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
