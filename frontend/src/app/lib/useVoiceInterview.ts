"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Analytics,
  HTTP_BASE,
  InterviewerCue,
  MIN_RECORDING_MS,
  SILENCE_TIMEOUT_MS,
  SessionStatus,
  Style,
  initialAnalytics,
} from "./interviewClient";

type SpeakDone = (() => void) | undefined;

type VoiceSendMode = "answer" | "clarification";

export type LiveNudge = {
  kind: "pace" | "ramble" | "center";
  message: string;
};

type VoiceInterviewParams = {
  status: SessionStatus;
  style: Style;
  question: string;
  interviewerCue?: InterviewerCue | null;
  sessionId: string | null;
  turn: number;
  mediaStream: MediaStream | null;
  sensorMetrics: Analytics;
  analytics: Analytics;
  setAnalytics: React.Dispatch<React.SetStateAction<Analytics>>;
  sendAnswer: (answer: string, metricsOverride?: Analytics) => void;
  sendClarification?: (question: string) => void;
  sendTelemetry?: (event: string, latencyMs?: number, data?: Record<string, unknown>) => void;
  initialAutoListen?: boolean;
  initialAutoSendVoice?: boolean;
  nudgesEnabled?: boolean;
  nudgeSound?: boolean;
  nudgeHaptics?: boolean;
};

export function useVoiceInterview({
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
  initialAutoListen = true,
  initialAutoSendVoice = true,
  nudgesEnabled = true,
  nudgeSound = false,
  nudgeHaptics = false,
}: VoiceInterviewParams) {
  const [draft, setDraft] = useState<string>("");
  const [interviewerTalking, setInterviewerTalking] = useState<boolean>(false);
  const [autoSendVoice, setAutoSendVoice] = useState<boolean>(initialAutoSendVoice);
  const [autoListen, setAutoListen] = useState<boolean>(initialAutoListen);
  const [recording, setRecording] = useState<boolean>(false);
  const [recordingMode, setRecordingMode] = useState<VoiceSendMode>("answer");
  const [sttPending, setSttPending] = useState<boolean>(false);
  const [sttError, setSttError] = useState<string>("");
  const [ttsError, setTtsError] = useState<string>("");
  const [nudge, setNudge] = useState<LiveNudge | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number | null>(null);
  const lastVoiceRef = useRef<number | null>(null);
  const lastSpokenQuestionRef = useRef<string>("");
  const nudgeTimeoutRef = useRef<number | null>(null);
  const nudgeCooldownRef = useRef<Record<LiveNudge["kind"], number>>({ pace: 0, ramble: 0, center: 0 });
  const fastSinceRef = useRef<number | null>(null);
  const offCenterSinceRef = useRef<number | null>(null);

  const metricsRef = useRef<Analytics>(sensorMetrics);
  const userTalkingRef = useRef<boolean>(false);
  const recordingRef = useRef<boolean>(false);
  const statusRef = useRef<SessionStatus>(status);
  const turnRef = useRef<number>(turn);
  const recordingModeRef = useRef<VoiceSendMode>("answer");
  const lastCueIdRef = useRef<number | null>(null);

  const userTalking = useMemo(() => (sensorMetrics.volume || 0) > 0.045, [sensorMetrics.volume]);
  const listening = recording || sttPending;

  useEffect(() => {
    metricsRef.current = sensorMetrics;
  }, [sensorMetrics]);

  useEffect(() => {
    userTalkingRef.current = userTalking;
  }, [userTalking]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    turnRef.current = turn;
  }, [turn]);

  const playNudgeCue = useCallback(async () => {
    if (!nudgeSound) return;
    try {
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.02;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // ignore audio cue failures
    }
  }, [nudgeSound]);

  const playHapticCue = useCallback(() => {
    if (!nudgeHaptics) return;
    try {
      if ("vibrate" in navigator) navigator.vibrate(25);
    } catch {
      // ignore haptics failures
    }
  }, [nudgeHaptics]);

  const triggerNudge = useCallback(
    (next: LiveNudge) => {
      if (!nudgesEnabled) return;
      const now = performance.now();
      const last = nudgeCooldownRef.current[next.kind] ?? 0;
      const cooldownMs = next.kind === "ramble" ? 22_000 : 12_000;
      if (now - last < cooldownMs) return;
      nudgeCooldownRef.current[next.kind] = now;

      if (nudgeTimeoutRef.current) {
        clearTimeout(nudgeTimeoutRef.current);
        nudgeTimeoutRef.current = null;
      }
      setNudge(next);
      void playNudgeCue();
      playHapticCue();

      const answerTurn = turnRef.current + 1;
      sendTelemetry?.("nudge", undefined, { kind: next.kind, message: next.message, answer_turn: answerTurn });

      nudgeTimeoutRef.current = window.setTimeout(() => {
        setNudge(null);
        nudgeTimeoutRef.current = null;
      }, 4200);
    },
    [nudgesEnabled, playHapticCue, playNudgeCue, sendTelemetry],
  );

  useEffect(() => {
    return () => {
      if (ttsSourceRef.current) {
        try {
          ttsSourceRef.current.stop();
        } catch {
          // ignore
        }
      }
      ttsAbortRef.current?.abort();
      if (nudgeTimeoutRef.current) {
        clearTimeout(nudgeTimeoutRef.current);
        nudgeTimeoutRef.current = null;
      }
    };
  }, []);

  const buildMetrics = useCallback(
    (text: string): Analytics => {
      const words = text.split(/\s+/).filter(Boolean);
      const fillerCount = words.filter((w) => ["um", "uh", "like"].includes(w.toLowerCase())).length;
      const speechSeconds =
        sensorMetrics.speechSeconds && sensorMetrics.speechSeconds > 0
          ? sensorMetrics.speechSeconds
          : Math.max(words.length / 2.5, 0.5);
      const speakingRate =
        speechSeconds > 0 ? Math.round((words.length / speechSeconds) * 60) : sensorMetrics.speakingRate || 0;
      return {
        ...sensorMetrics,
        fillers: fillerCount,
        speakingRate,
        pauseRatio: sensorMetrics.pauseRatio,
        gaze: sensorMetrics.gaze || analytics.gaze,
        speechSeconds,
      };
    },
    [analytics.gaze, sensorMetrics],
  );

  const sendToStt = useCallback(
    async (blob: Blob) => {
      setSttPending(true);
      setSttError("");
      try {
        const form = new FormData();
        const filename = blob.type.includes("ogg") ? "answer.ogg" : blob.type.includes("mp4") ? "answer.mp4" : "answer.webm";
        form.append("file", blob, filename);
        if (sessionId) form.append("sessionId", sessionId);
        const res = await fetch(`${HTTP_BASE}/stt`, {
          method: "POST",
          body: form,
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          throw new Error(json.error || "Transcription failed");
        }
        const transcript = (json.transcript as string) || "";
        setDraft(transcript);
        if (autoSendVoice && transcript.trim()) {
          if (recordingModeRef.current === "clarification" && sendClarification) {
            sendClarification(transcript);
          } else {
            const finalMetrics = buildMetrics(transcript);
            setAnalytics(finalMetrics);
            sendAnswer(transcript, finalMetrics);
          }
        }
      } catch {
        setSttError("Transcription failed. Try again.");
      } finally {
        setSttPending(false);
      }
    },
    [autoSendVoice, buildMetrics, sendAnswer, sendClarification, sessionId, setAnalytics],
  );

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setRecording(false);
    recordStartRef.current = null;
    lastVoiceRef.current = null;
    fastSinceRef.current = null;
    offCenterSinceRef.current = null;
  }, []);

  const startRecording = useCallback(async (mode: VoiceSendMode = "answer") => {
    if (recording || sttPending) return;
    setSttError("");
    try {
      setRecordingMode(mode);
      recordingModeRef.current = mode;
      const usableAudioTracks = mediaStream?.getAudioTracks().filter((track) => track.readyState === "live") ?? [];
      const sourceStream =
        usableAudioTracks.length > 0
          ? mediaStream
          : await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false,
            });
      const ownsSourceStream = sourceStream !== mediaStream;

      const audioTracks = sourceStream?.getAudioTracks().filter((track) => track.readyState === "live") ?? [];
      if (audioTracks.length === 0) {
        throw new Error("no-audio-track");
      }

      const audioOnlyStream = new MediaStream(audioTracks);
      if (typeof MediaRecorder === "undefined") {
        throw new Error("mediarecorder-unsupported");
      }

      const mimeTypeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
      const mimeType =
        typeof MediaRecorder.isTypeSupported === "function"
          ? mimeTypeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
          : undefined;

      const recorder = new MediaRecorder(audioOnlyStream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        if (ownsSourceStream) sourceStream.getTracks().forEach((track) => track.stop());
        if (blob.size > 0) {
          void sendToStt(blob);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      recordStartRef.current = performance.now();
      lastVoiceRef.current = recordStartRef.current;
      setRecording(true);
      setNudge(null);
    } catch (err) {
      const errName =
        err && typeof err === "object" && "name" in err && typeof (err as { name?: unknown }).name === "string"
          ? (err as { name: string }).name
          : "";
      const message =
        err instanceof Error && err.message === "mediarecorder-unsupported"
          ? "Recording not supported in this browser. Please use Chrome/Edge."
          : errName === "NotAllowedError"
            ? "Microphone permission denied. Allow mic access in the browser settings, then reload."
            : errName === "NotFoundError"
              ? "No microphone found. Connect a mic and try again."
              : errName === "NotReadableError"
                ? "Microphone is busy. Close other apps using the mic and try again."
                : errName === "NotSupportedError"
                  ? "Recording format not supported in this browser. Please use Chrome/Edge."
                  : errName === "SecurityError"
                    ? "Microphone access requires a secure context (use http://localhost:3000)."
                    : "Microphone access failed. Confirm mic permission or close other apps using the mic.";
      setSttError(message);
      setRecording(false);
    }
  }, [mediaStream, recording, sendToStt, sttPending]);

  useEffect(() => {
    if (status !== "active") {
      stopRecording();
    }
  }, [status, stopRecording]);

  useEffect(() => {
    if (!nudgesEnabled) {
      setNudge(null);
      return;
    }
    const intervalId = window.setInterval(() => {
      if (statusRef.current !== "active") return;
      if (!recordingRef.current) return;
      if (recordingModeRef.current !== "answer") return;

      const now = performance.now();
      const startTs = recordStartRef.current ?? now;
      const elapsedMs = now - startTs;
      const m = metricsRef.current;
      const isTalking = userTalkingRef.current;

      if (isTalking && elapsedMs > 55_000) {
        triggerNudge({ kind: "ramble", message: "Wrap it up: land the outcome in one sentence." });
      }

      const paceTooHigh = isTalking && (m.speakingRate || 0) > 175 && (m.pauseRatio || 0) < 0.12;
      if (paceTooHigh) {
        fastSinceRef.current ??= now;
        if (fastSinceRef.current && now - fastSinceRef.current > 1300) {
          triggerNudge({ kind: "pace", message: "Slow down: add micro-pauses on key words." });
        }
      } else {
        fastSinceRef.current = null;
      }

      const gaze = typeof m.gaze === "number" ? m.gaze : 0;
      const offCenter = isTalking && gaze > 0 && gaze < 55;
      if (offCenter) {
        offCenterSinceRef.current ??= now;
        if (offCenterSinceRef.current && now - offCenterSinceRef.current > 1500) {
          triggerNudge({ kind: "center", message: "Re-center on camera." });
        }
      } else {
        offCenterSinceRef.current = null;
      }
    }, 280);

    return () => {
      clearInterval(intervalId);
    };
  }, [nudgesEnabled, triggerNudge]);

  useEffect(() => {
    if (!recording) {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      return;
    }
    const now = performance.now();
    const startTs = recordStartRef.current ?? now;
    if (userTalking) {
      lastVoiceRef.current = now;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      return;
    }

    const lastVoiceTs = lastVoiceRef.current ?? startTs;
    const elapsedMs = now - startTs;
    const silenceMs = now - lastVoiceTs;
    if (elapsedMs < MIN_RECORDING_MS) {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      return;
    }

    if (silenceMs >= SILENCE_TIMEOUT_MS) {
      stopRecording();
      return;
    }

    if (!silenceTimerRef.current) {
      const remaining = Math.max(SILENCE_TIMEOUT_MS - silenceMs, 400);
      silenceTimerRef.current = window.setTimeout(() => {
        stopRecording();
      }, remaining);
    }

    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  }, [recording, stopRecording, userTalking]);

  const fallbackSpeak = useCallback(
    (text: string, onDone?: SpeakDone) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        onDone?.();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = style === "cold" ? 0.95 : style === "supportive" ? 1.05 : 1;
      utterance.pitch = style === "supportive" ? 1.05 : style === "cold" ? 0.92 : 1;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => /female|woman|samantha|allison|ava|en-us/i.test(v.name)) ||
        voices.find((v) => /en-/i.test(v.lang)) ||
        voices[0];
      if (preferred) utterance.voice = preferred;
      utterance.onstart = () => setInterviewerTalking(true);
      utterance.onend = () => {
        setInterviewerTalking(false);
        onDone?.();
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [style],
  );

  const speakQuestion = useCallback(
    async (text: string, onDone?: SpeakDone) => {
      if (!text) {
        onDone?.();
        return;
      }
      setTtsError("");
      ttsAbortRef.current?.abort();
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      setInterviewerTalking(true);
      try {
        const res = await fetch(`${HTTP_BASE}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, style }),
          signal: controller.signal,
        });
        const contentType = res.headers.get("content-type") || "";
        if (!res.ok || !contentType.includes("audio")) {
          let msg = "tts_failed";
          try {
            const json = await res.json();
            msg = json.error || msg;
          } catch {
            // ignore
          }
          throw new Error(msg);
        }
        const arrayBuffer = await res.arrayBuffer();
        const ctx = audioCtxRef.current ?? new AudioContext();
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        await new Promise<void>((resolve) => {
          const src = ctx.createBufferSource();
          ttsSourceRef.current = src;
          src.buffer = audioBuffer;
          src.connect(ctx.destination);
          src.onended = () => {
            setInterviewerTalking(false);
            onDone?.();
            resolve();
          };
          src.start(0);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "tts_failed";
        setTtsError(`TTS failed (${msg}); using fallback voice.`);
        setInterviewerTalking(false);
        fallbackSpeak(text, onDone);
      }
    },
    [fallbackSpeak, style],
  );

  useEffect(() => {
    if (!interviewerCue?.text) return;
    if (lastCueIdRef.current === interviewerCue.id) return;
    lastCueIdRef.current = interviewerCue.id;
    if (status !== "active") return;
    stopRecording();
    speakQuestion(interviewerCue.text, () => {
      if (autoListen) {
        startRecording();
      }
    });
  }, [autoListen, interviewerCue, speakQuestion, startRecording, status, stopRecording]);

  useEffect(() => {
    if (status !== "active" || !question) {
      if (status !== "active") lastSpokenQuestionRef.current = "";
      return;
    }
    if (lastSpokenQuestionRef.current === question) return;
    lastSpokenQuestionRef.current = question;
    stopRecording();
    speakQuestion(question, () => {
      if (autoListen) {
        startRecording();
      }
    });
  }, [autoListen, question, speakQuestion, startRecording, status, stopRecording]);

  const sendDraft = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const finalMetrics = buildMetrics(trimmed);
    setAnalytics(finalMetrics);
    sendAnswer(trimmed, finalMetrics);
    setDraft("");
  }, [buildMetrics, draft, sendAnswer, setAnalytics]);

  const sendClarificationDraft = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || !sendClarification) return;
    stopRecording();
    sendClarification(trimmed);
    setDraft("");
  }, [draft, sendClarification, stopRecording]);

  useEffect(() => {
    if (status === "idle" && draft) {
      setDraft("");
      setAnalytics(initialAnalytics);
    }
  }, [draft, setAnalytics, status]);

  return {
    draft,
    setDraft,
    autoSendVoice,
    setAutoSendVoice,
    autoListen,
    setAutoListen,
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
  };
}
