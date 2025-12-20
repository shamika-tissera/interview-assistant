"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../flow.module.css";
import { Avatar } from "../components/Avatar";
import { STYLE_HELP, STYLE_LABELS, type Style, useInterview, useMediaSensors } from "../lib/interviewClient";
import { consumeAutostart, loadSetup, saveReviewSnapshot } from "../lib/flowStorage";
import { useVoiceInterview } from "../lib/useVoiceInterview";

type Tab = "answer" | "coach" | "transcript";

export default function InterviewPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("answer");
  const setup = useMemo(() => loadSetup(), []);

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
    sessionId,
    mediaStream,
    sensorMetrics,
    analytics,
    setAnalytics,
    sendAnswer,
    initialAutoListen: setup?.autoListen,
    initialAutoSendVoice: setup?.autoSendVoice,
  });

  const {
    draft,
    setDraft,
    autoListen,
    setAutoListen,
    autoSendVoice,
    setAutoSendVoice,
    recording,
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
  } = voice;

  useEffect(() => {
    if (!setup) return;
    if (status !== "idle" && status !== "closed") return;
    if (!consumeAutostart()) return;
    start(setup.style, setup.group, setup.consent, setup.accent, setup.notes);
  }, [setup, start, status]);

  const handleStart = useCallback(() => {
    if (!setup) return;
    start(setup.style, setup.group, setup.consent, setup.accent, setup.notes);
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
    const el = videoRef.current;
    if (!el || !mediaStream) return;
    if (el.srcObject !== mediaStream) {
      el.srcObject = mediaStream;
    }
    el.play().catch(() => undefined);
  }, [mediaStream, tab, videoRef]);

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
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={status !== "active" || sttPending}
                      onClick={() => (recording ? stopRecording() : startRecording())}
                    >
                      {recording ? "Stop & transcribe" : "Tap to answer"}
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={!question || sttPending || status !== "active"}
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

              <div className={styles.panel}>
                <h2 className={styles.cardTitle}>Text (optional)</h2>
                <textarea
                  className={styles.textarea}
                  placeholder="Speak to fill this automatically. Type only if you prefer."
                  value={draft}
                  disabled={status !== "active"}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.secondary} onClick={sendDraft} disabled={!draft.trim() || status !== "active"}>
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "coach" && (
          <div className={styles.card}>
            <p className={styles.kicker}>Coach</p>
            <h1 className={styles.title}>Glanceable feedback.</h1>
            <p className={styles.subtitle}>Small adjustments, big clarity. Keep this open between questions.</p>

            <div className={styles.section}>
              <div className={styles.panel}>
                <h2 className={styles.cardTitle}>Persona</h2>
                {styleControls}
                <p className={styles.helper} style={{ marginTop: 8 }}>
                  {group === "control" ? "Control group keeps the interviewer neutral." : "Treatment group supports style switching."}
                </p>
              </div>

              <div className={styles.twoCol}>
                <div className={styles.panel}>
                  <h2 className={styles.cardTitle}>Signals</h2>
                  <div className={styles.section}>
                    <div className={styles.pillRow} aria-label="Live metrics">
                      <span className={styles.pill}>Rate: {status === "active" ? `${sensorMetrics.speakingRate || "—"} wpm` : "—"}</span>
                      <span className={styles.pill}>Pause: {status === "active" ? sensorMetrics.pauseRatio : "—"}</span>
                      <span className={styles.pill}>Gaze: {status === "active" ? `${sensorMetrics.gaze}%` : "—"}</span>
                      <span className={styles.pill}>Fillers: {analytics.fillers}</span>
                    </div>
                    <p className={styles.helper}>{streamError || "Grant mic/cam permissions to unlock live telemetry."}</p>
                  </div>
                </div>

                <div className={styles.panel}>
                  <h2 className={styles.cardTitle}>Preview</h2>
                  <video ref={videoRef} muted playsInline style={{ width: "100%", borderRadius: 16, background: "#0f172a" }} />
                </div>
              </div>

              <div className={styles.panel}>
                <h2 className={styles.cardTitle}>Automation</h2>
                <label className={styles.checkbox}>
                  <input type="checkbox" checked={autoListen} onChange={(e) => setAutoListen(e.target.checked)} />
                  <span>Auto-listen after each question</span>
                </label>
                <label className={styles.checkbox}>
                  <input type="checkbox" checked={autoSendVoice} onChange={(e) => setAutoSendVoice(e.target.checked)} />
                  <span>Auto-send when speech finishes</span>
                </label>
              </div>

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
