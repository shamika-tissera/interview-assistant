"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../flow.module.css";
import { Avatar } from "../components/Avatar";
import { HeyGenAvatar } from "../components/HeyGenAvatar";
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
  
  // 准备状态和 Avatar 选择
  const [isPreparing, setIsPreparing] = useState(true);
  const [useHeyGenAvatar, setUseHeyGenAvatar] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const {
    status,
    start,
    stop,
    style,
    group,
    switchStyle,
    question,
    questionPreface,
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
    sessionEnded,
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
    questionPreface,
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

  const autoEndedRef = useRef<boolean>(false);

  useEffect(() => {
    consumeAutostart();
  }, []);

  const startInterview = useCallback(() => {
    if (!setup) return;
    
    const maxQuestions = setup.limitMode === "questions" ? setup.maxQuestions : undefined;
    const durationSeconds = setup.limitMode === "time" ? setup.durationMinutes * 60 : undefined;
    
    start(
      setup.style,
      setup.group,
      setup.consent,
      setup.accent,
      setup.notes,
      setup.pack,
      setup.difficulty,
      maxQuestions,
      durationSeconds,
      setup.customQuestions,
    );
    
    setIsPreparing(false);
    setIsStarting(false);
  }, [setup, start]);

  const handleStart = useCallback(() => {
    if (!setup) return;
    setIsStarting(true);
    if (useHeyGenAvatar && !avatarReady) {
      console.log("[Interview] Waiting for HeyGen Avatar to be ready...");
      return;
    }
    startInterview();
  }, [setup, useHeyGenAvatar, avatarReady, startInterview]);

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
    if (isStarting && useHeyGenAvatar && avatarReady && status === "idle" && setup) {
      console.log("[Interview] Avatar ready, starting interview...");
      setTimeout(() => {
        startInterview();
      }, 500);
    }
  }, [isStarting, useHeyGenAvatar, avatarReady, status, setup, startInterview]);

  useEffect(() => {
    if (!setup) return;
    if (!sessionEnded || autoEndedRef.current) return;
    autoEndedRef.current = true;
    stopRecording();
    setAutoListen(false);
    const message = sessionEnded.message?.trim();
    if (message) {
      speakQuestion(message, handleEnd);
    } else {
      handleEnd();
    }
  }, [handleEnd, sessionEnded, setAutoListen, setup, speakQuestion, stopRecording]);

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
          <Link className={styles.navLink} href="/setup">Setup</Link>
          <div className={styles.tabs} aria-label="Interview tabs">
            <button type="button" className={`${styles.tab} ${tab === "answer" ? styles.tabActive : ""}`} onClick={() => setTab("answer")}>Answer</button>
            <button type="button" className={`${styles.tab} ${tab === "coach" ? styles.tabActive : ""}`} onClick={() => setTab("coach")}>Coach</button>
            <button type="button" className={`${styles.tab} ${tab === "transcript" ? styles.tabActive : ""}`} onClick={() => setTab("transcript")}>Transcript</button>
          </div>
          <div className={styles.badge}>{status.toUpperCase()}</div>
        </div>

        <div className={styles.card}>
          <div className={styles.statusRow}>
            <div>
              <p className={styles.kicker}>Current prompt</p>
              <div className={styles.bigPrompt}>{question || "Start when you’re ready."}</div>
              <p className={styles.helper}>{ttsError ? ttsError : STYLE_HELP[style]}</p>
            </div>
            <div className={styles.buttonRow}>
              {status === "active" && (
                <button type="button" className={styles.secondary} onClick={handleEnd}>End session</button>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.twoCol}>
              {/* Left Column: Controls or Prep */}
              <div className={styles.panel} style={{ position: "relative" }}>
                {isPreparing ? (
                  <div className={styles.section}>
                    <h2 className={styles.cardTitle}>Preparation</h2>
                    <p className={styles.cardText}>Choose your interviewer appearance and wait for initialization.</p>
                    
                    <div className={styles.buttonRow}>
                      <button
                        type="button"
                        className={`${styles.pill} ${!useHeyGenAvatar ? styles.pillActive : ""}`}
                        onClick={() => setUseHeyGenAvatar(false)}
                      >
                        CSS Avatar
                      </button>
                      <button
                        type="button"
                        className={`${styles.pill} ${useHeyGenAvatar ? styles.pillActive : ""}`}
                        onClick={() => setUseHeyGenAvatar(true)}
                      >
                        HeyGen Avatar
                      </button>
                    </div>

                    <div className={styles.buttonRow} style={{ marginTop: "24px" }}>
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={isStarting || (useHeyGenAvatar && !avatarReady)}
                        onClick={handleStart}
                        style={{ width: "100%", padding: "16px" }}
                      >
                        {isStarting ? "Starting..." : "Start Interview"}
                      </button>
                    </div>
                    {isStarting && useHeyGenAvatar && !avatarReady && (
                      <p className={styles.helper} style={{ textAlign: "center", marginTop: "8px", color: "#3b82f6" }}>
                        Waiting for avatar...
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {tab === "answer" && (
                      <div className={styles.section}>
                        <h2 className={styles.cardTitle}>Voice</h2>
                        <div className={styles.buttonRow}>
                          {recording ? (
                            <button type="button" className={styles.primary} disabled={status !== "active" || sttPending} onClick={stopRecording}>
                              Stop & transcribe{recordingMode === "clarification" ? " (clarify)" : ""}
                            </button>
                          ) : (
                            <>
                              <button type="button" className={styles.primary} disabled={status !== "active" || sttPending || !question} onClick={() => startRecording("answer")}>Tap to answer</button>
                              <button type="button" className={styles.secondary} disabled={status !== "active" || sttPending || !question} onClick={() => startRecording("clarification")}>Tap to clarify</button>
                            </>
                          )}
                          <button type="button" className={styles.secondary} disabled={!question || sttPending || status !== "active" || recording} onClick={() => { stopRecording(); speakQuestion(question); }}>Replay</button>
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
                        <details style={{ marginTop: 16 }}>
                          <summary className={styles.detailsSummary}>Type instead</summary>
                          <textarea className={styles.textarea} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type your answer..." />
                          <div className={styles.buttonRow}>
                            <button type="button" className={styles.secondary} onClick={sendDraft} disabled={!draft.trim() || status !== "active"}>Send answer</button>
                          </div>
                        </details>
                      </div>
                    )}

                    {tab === "coach" && (
                      <div className={styles.section}>
                        <h2 className={styles.cardTitle}>Signals</h2>
                        <div className={styles.pillRow}>
                          <span className={styles.pill}>Rate: {sensorMetrics.speakingRate || "—"} wpm</span>
                          <span className={styles.pill}>Pause: {sensorMetrics.pauseRatio}</span>
                          <span className={styles.pill}>Fillers: {analytics.fillers}</span>
                        </div>
                        <video ref={previewRef} muted playsInline style={{ width: "100%", borderRadius: 12, marginTop: 12, background: "#000" }} />
                      </div>
                    )}

                    {tab === "transcript" && (
                      <div className={styles.section} style={{ maxHeight: "400px", overflowY: "auto" }}>
                        <h2 className={styles.cardTitle}>Conversation</h2>
                        {messages.map((m, idx) => (
                          <div key={idx} style={{ marginBottom: 12, padding: 8, borderBottom: "1px solid #eee" }}>
                            <div style={{ fontWeight: "bold", fontSize: "12px" }}>{m.role === "user" ? "You" : "Interviewer"}</div>
                            <div style={{ fontSize: "14px" }}>{m.content}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Right Column: Presence (Always Persistent) */}
              <div className={styles.panel} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <h2 className={styles.cardTitle}>Presence</h2>
                <div style={{ width: "300px", height: "300px", position: "relative", borderRadius: "16px", overflow: "hidden", background: "#f1f5f9" }}>
                  {useHeyGenAvatar ? (
                    <HeyGenAvatar
                      questionText={status === "active" ? question : ""}
                      questionId={turn}
                      debug={true}
                      onReady={() => {
                        console.log("[Interview] HeyGen Avatar ready");
                        setAvatarReady(true);
                      }}
                      onError={(error) => {
                        console.error("[Interview] HeyGen Avatar error:", error);
                        setAvatarReady(false);
                      }}
                    />
                  ) : (
                    <Avatar
                      style={style}
                      talking={interviewerTalking}
                      userTalking={userTalking}
                      listening={listening}
                      fill
                      showStatus={false}
                    />
                  )}
                </div>
                <div style={{ marginTop: 12, textAlign: "center" }}>
                  <div className={styles.badge}>{STYLE_LABELS[style]}</div>
                  {useHeyGenAvatar && isPreparing && (
                    <p className={styles.helper} style={{ marginTop: 8 }}>
                      {avatarReady ? "✅ Avatar Ready" : "⏳ Initializing..."}
                    </p>
                  )}
                  {!isPreparing && lastTip && (
                    <p className={styles.helper} style={{ marginTop: 8 }}>{lastTip.summary}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

