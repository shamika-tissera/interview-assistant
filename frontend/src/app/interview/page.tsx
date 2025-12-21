"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../flow.module.css";
import { Avatar } from "../components/Avatar";
import { STYLE_HELP, STYLE_LABELS, type Style, useInterview, useMediaSensors } from "../lib/interviewClient";
import { consumeAutostart, saveReviewSnapshot, useStoredSetup, type InterviewSetup } from "../lib/flowStorage";
import { useVoiceInterview } from "../lib/useVoiceInterview";

type Tab = "answer" | "coach" | "transcript";

export default function InterviewPage() {
  const storedSetup = useStoredSetup();
  if (storedSetup === undefined) {
    return (
      <main className={styles.shell}>
        <div className={styles.container}>
          <div className={styles.card}>
            <p className={styles.kicker}>Interview</p>
            <h1 className={styles.title}>Loading…</h1>
            <p className={styles.subtitle}>Preparing your session.</p>
            <div className={styles.buttonRow}>
              <Link className={styles.secondary} href="/setup">
                Back to setup
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return <InterviewInner setup={storedSetup} />;
}

function InterviewInner({ setup }: { setup: InterviewSetup | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("answer");
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const {
    status,
    start,
    stop,
    style,
    group,
    switchStyle,
    question,
    messages,
    tips,
    sessionId,
    analytics,
    setAnalytics,
    sendAnswer,
    sendClarification,
    sendTelemetry,
    turn,
    interviewerCue,
    lastClarification,
  } = useInterview();

  const { metrics: sensorMetrics, videoRef, streamError, stream: mediaStream } = useMediaSensors(status === "active");

  const disabled = useMemo(() => status === "connecting" || status === "error", [status]);

  useEffect(() => {
    if (!setup || !setup.consent) {
      router.replace("/setup");
    }
  }, [router, setup]);

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
    initialAutoListen: setup?.autoListen,
    initialAutoSendVoice: setup?.autoSendVoice,
    nudgesEnabled: setup?.nudgesEnabled,
    nudgeSound: setup?.nudgeSound,
    nudgeHaptics: setup?.nudgeHaptics,
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
    nudge,
    listening,
    userTalking,
    startRecording,
    stopRecording,
    speakQuestion,
    sendDraft,
    sendClarificationDraft,
  } = voice;

  useEffect(() => {
    if (!setup) return;
    if (status !== "idle" && status !== "closed") return;
    if (!consumeAutostart()) return;
    start(setup.style, setup.group, setup.consent, setup.accent, setup.notes, setup.pack, setup.difficulty);
  }, [setup, start, status]);

  const handleStart = useCallback(() => {
    if (!setup) return;
    start(setup.style, setup.group, setup.consent, setup.accent, setup.notes, setup.pack, setup.difficulty);
  }, [setup, start]);

  const handleEnd = useCallback(() => {
    if (!setup) return;
    stopRecording();
    const sid = sessionId ?? "";
    saveReviewSnapshot({
      sessionId: sid,
      setup,
      messages,
      tips,
      savedAt: Date.now(),
    });
    stop();
    router.push(sid ? `/review?sessionId=${encodeURIComponent(sid)}` : "/review");
  }, [messages, router, sessionId, setup, stop, stopRecording, tips]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el || !mediaStream || tab !== "coach") return;
    if (el.srcObject !== mediaStream) {
      el.srcObject = mediaStream;
    }
    el.play().catch(() => undefined);
  }, [mediaStream, tab]);

  const styleControls = (
    <div className={styles.pillRow} role="radiogroup" aria-label="Interviewer style">
      {(["supportive", "neutral", "cold"] as Style[]).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={style === s}
          className={`${styles.pill} ${style === s ? styles.pillActive : ""}`}
          onClick={() => switchStyle(s)}
          disabled={disabled || status !== "active"}
        >
          {STYLE_LABELS[s]}
        </button>
      ))}
    </div>
  );

  const lastTip = tips.length > 0 ? tips[0] : null;

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <video ref={videoRef} muted playsInline className={styles.sensorVideo} />
        <div className={styles.topBar}>
          <Link className={styles.link} href="/setup">
            Setup
          </Link>
          <div className={styles.tabs} aria-label="Interview tabs">
            <button type="button" className={`${styles.tab} ${tab === "answer" ? styles.tabActive : ""}`} onClick={() => setTab("answer")}>
              Answer
            </button>
            <button type="button" className={`${styles.tab} ${tab === "coach" ? styles.tabActive : ""}`} onClick={() => setTab("coach")}>
              Coach
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === "transcript" ? styles.tabActive : ""}`}
              onClick={() => setTab("transcript")}
            >
              Transcript
            </button>
          </div>
          <div className={styles.badge}>{status.toUpperCase()}</div>
        </div>

        {tab === "answer" && (
          <div className={styles.card}>
            <div className={styles.statusRow}>
              <div>
                <p className={styles.kicker}>Current prompt</p>
                <div className={styles.bigPrompt}>{question || "Start when you’re ready."}</div>
                <p className={styles.helper}>{ttsError ? ttsError : STYLE_HELP[style]}</p>
                {lastClarification && (
                  <p className={styles.helper} style={{ marginTop: 6 }}>
                    Interviewer: {lastClarification}
                  </p>
                )}
              </div>
              <div className={styles.buttonRow}>
                {status !== "active" ? (
                  <button type="button" className={styles.primary} disabled={!setup || disabled} onClick={handleStart}>
                    Start interview
                  </button>
                ) : (
                  <button type="button" className={styles.secondary} onClick={handleEnd}>
                    End session
                  </button>
                )}
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.twoCol}>
                <div className={styles.panel}>
                  <h2 className={styles.cardTitle}>Voice</h2>
                  <div className={styles.buttonRow}>
                    {recording ? (
                      <button type="button" className={styles.primary} disabled={status !== "active" || sttPending} onClick={stopRecording}>
                        Stop & transcribe{recordingMode === "clarification" ? " (clarify)" : ""}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={styles.primary}
                          disabled={status !== "active" || sttPending || !question}
                          onClick={() => startRecording("answer")}
                        >
                          Tap to answer
                        </button>
                        <button
                          type="button"
                          className={styles.secondary}
                          disabled={status !== "active" || sttPending || !question}
                          onClick={() => startRecording("clarification")}
                        >
                          Tap to clarify
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={!question || sttPending || status !== "active" || recording}
                      onClick={() => {
                        stopRecording();
                        speakQuestion(question);
                      }}
                    >
                      Replay
                    </button>
                  </div>
                  <p className={styles.helper} style={{ marginTop: 8 }}>
                    {listening ? (sttPending ? "Transcribing…" : "Recording — speak naturally.") : "Not recording."}
                  </p>
                  {nudge && (
                    <div className={styles.nudge} role="status" aria-live="polite">
                      <span className={styles.nudgeDot} aria-hidden />
                      <span>{nudge.message}</span>
                    </div>
                  )}
                  {sttError && (
                    <p className={styles.helper} style={{ marginTop: 8, color: "#dc2626" }}>
                      {sttError}
                    </p>
                  )}
                </div>

                <div className={styles.panel}>
                  <h2 className={styles.cardTitle}>Presence</h2>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <Avatar style={style} talking={interviewerTalking} userTalking={userTalking} listening={listening} />
                    <div>
                      <div className={styles.badge}>{STYLE_LABELS[style]}</div>
                      <p className={styles.helper} style={{ marginTop: 10 }}>
                        {lastTip ? lastTip.summary : "Coaching appears after your first answer."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <details className={styles.panel}>
                <summary className={styles.detailsSummary}>Type instead (optional)</summary>
                <div className={styles.section}>
                  <textarea
                    className={styles.textarea}
                    placeholder="Speak to fill this automatically. Type only if you prefer."
                    value={draft}
                    disabled={status !== "active"}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className={styles.buttonRow}>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={sendDraft}
                      disabled={!draft.trim() || status !== "active" || sttPending || recording}
                    >
                      Send answer
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={sendClarificationDraft}
                      disabled={!draft.trim() || status !== "active" || sttPending || recording || !question}
                    >
                      Ask clarification
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </div>
        )}

        {tab === "coach" && (
          <div className={styles.card}>
            <p className={styles.kicker}>Coach</p>
            <h1 className={styles.title}>Glanceable feedback.</h1>
            <p className={styles.subtitle}>Small adjustments, big clarity. Keep this open between questions.</p>

            <div className={styles.section}>
              <div className={styles.twoCol}>
                <div className={styles.panel}>
                  <h2 className={styles.cardTitle}>Signals</h2>
                  <div className={styles.section}>
                    <div className={styles.pillRow} aria-label="Live metrics">
                      <span className={styles.pill}>Rate: {status === "active" ? `${sensorMetrics.speakingRate || "—"} wpm` : "—"}</span>
                      <span className={styles.pill}>Pause: {status === "active" ? sensorMetrics.pauseRatio : "—"}</span>
                      <span className={styles.pill}>Center: {status === "active" ? `${sensorMetrics.gaze}%` : "—"}</span>
                      <span className={styles.pill}>Fillers: {analytics.fillers}</span>
                    </div>
                    <p className={styles.helper}>{streamError || "Grant mic/cam permissions to unlock live telemetry."}</p>
                  </div>
                </div>

                <div className={styles.panel}>
                  <h2 className={styles.cardTitle}>Preview</h2>
                  <video ref={previewRef} muted playsInline style={{ width: "100%", borderRadius: 16, background: "#0f172a" }} />
                </div>
              </div>

              <details className={styles.panel}>
                <summary className={styles.detailsSummary}>Session settings</summary>
                <div className={styles.section}>
                  <div className={styles.panel}>
                    <div className={styles.optionTitle}>Interviewer tone</div>
                    <div style={{ marginTop: 10 }}>{styleControls}</div>
                    <p className={styles.helper} style={{ marginTop: 10 }}>
                      {group === "control" ? "Control group keeps the interviewer neutral." : "Treatment group supports style switching."}
                    </p>
                  </div>
                  <div className={styles.panel}>
                    <div className={styles.optionTitle}>Automation</div>
                    <div className={styles.section}>
                      <label className={styles.checkbox}>
                        <input type="checkbox" checked={autoListen} onChange={(e) => setAutoListen(e.target.checked)} />
                        <span>Auto-listen after each question</span>
                      </label>
                      <label className={styles.checkbox}>
                        <input type="checkbox" checked={autoSendVoice} onChange={(e) => setAutoSendVoice(e.target.checked)} />
                        <span>Auto-send when speech finishes</span>
                      </label>
                    </div>
                  </div>
                </div>
              </details>

              <div className={styles.panel}>
                <h2 className={styles.cardTitle}>Tips</h2>
                {tips.length === 0 ? (
                  <p className={styles.cardText}>Answer once to get concise recommendations.</p>
                ) : (
                  <div className={styles.section}>
                    {tips.map((tip) => (
                      <div key={tip.summary} className={styles.panel}>
                        <div className={styles.optionTitle}>{tip.summary}</div>
                        <div className={styles.cardText} style={{ marginTop: 6 }}>
                          {tip.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "transcript" && (
          <div className={styles.card}>
            <p className={styles.kicker}>Transcript</p>
            <h1 className={styles.title}>See your turns.</h1>
            <p className={styles.subtitle}>This is what you actually said — helpful for spotting patterns.</p>

            <div className={styles.section}>
              <div className={styles.panel}>
                <h2 className={styles.cardTitle}>Conversation</h2>
                {messages.length === 0 ? (
                  <p className={styles.cardText}>Start the interview to begin capturing turns.</p>
                ) : (
                  <div className={styles.section}>
                    {messages.map((m, idx) => (
                      <div key={`${m.role}-${idx}`} className={styles.panel}>
                        <div className={styles.statusRow}>
                          <div className={styles.optionTitle}>{m.role === "user" ? "You" : "Interviewer"}</div>
                          <div className={styles.step}>
                            Turn {m.turn + 1}
                            {m.style ? ` • ${STYLE_LABELS[m.style]}` : ""}
                          </div>
                        </div>
                        <div className={styles.cardText} style={{ marginTop: 8 }}>
                          {m.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.buttonRow}>
                <button type="button" className={styles.secondary} disabled={!sessionId} onClick={handleEnd}>
                  End & review
                </button>
                <Link className={styles.secondary} href="/lab">
                  Open lab mode
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
