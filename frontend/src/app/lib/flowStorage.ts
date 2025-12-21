"use client";

import { useSyncExternalStore } from "react";
import type { ChatMessage, Style, Tip } from "./interviewClient";

export type PracticePack = "swe_behavioral" | "swe_system_design" | "data_science_ml" | "leadership";
export type Difficulty = "standard" | "hard";

export type InterviewSetup = {
  pack: PracticePack;
  difficulty: Difficulty;
  style: Style;
  group: "control" | "treatment";
  consent: boolean;
  accent: string;
  notes: string;
  autoListen: boolean;
  autoSendVoice: boolean;
  nudgesEnabled: boolean;
  nudgeSound: boolean;
  nudgeHaptics: boolean;
};

export type ReviewSnapshot = {
  sessionId: string;
  setup: InterviewSetup;
  messages: ChatMessage[];
  tips: Tip[];
  savedAt: number;
};

const SETUP_KEY = "ia.setup.v1";
const REVIEW_KEY = "ia.review.v1";
const AUTOSTART_KEY = "ia.autostart.v1";
const SETUP_CHANGED_EVENT = "ia:setup-changed";

export const DEFAULT_SETUP: InterviewSetup = {
  pack: "swe_behavioral",
  difficulty: "standard",
  style: "neutral",
  group: "treatment",
  consent: false,
  accent: "",
  notes: "",
  autoListen: true,
  autoSendVoice: true,
  nudgesEnabled: true,
  nudgeSound: false,
  nudgeHaptics: false,
};

let cachedSetupRaw: string | null | undefined;
let cachedSetupSnapshot: InterviewSetup | null = null;

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function loadSetup(): InterviewSetup | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(SETUP_KEY);
  if (raw === cachedSetupRaw) return cachedSetupSnapshot;
  cachedSetupRaw = raw;

  const parsed = safeJsonParse<Partial<InterviewSetup>>(raw);
  if (!parsed) {
    cachedSetupSnapshot = null;
    return null;
  }

  const pack =
    parsed.pack === "swe_behavioral" ||
    parsed.pack === "swe_system_design" ||
    parsed.pack === "data_science_ml" ||
    parsed.pack === "leadership"
      ? parsed.pack
      : DEFAULT_SETUP.pack;
  const difficulty = parsed.difficulty === "standard" || parsed.difficulty === "hard" ? parsed.difficulty : DEFAULT_SETUP.difficulty;
  const style = parsed.style === "supportive" || parsed.style === "neutral" || parsed.style === "cold" ? parsed.style : DEFAULT_SETUP.style;
  const group = parsed.group === "control" || parsed.group === "treatment" ? parsed.group : DEFAULT_SETUP.group;

  cachedSetupSnapshot = {
    ...DEFAULT_SETUP,
    ...parsed,
    pack,
    difficulty,
    style,
    group,
    consent: typeof parsed.consent === "boolean" ? parsed.consent : DEFAULT_SETUP.consent,
    accent: typeof parsed.accent === "string" ? parsed.accent : DEFAULT_SETUP.accent,
    notes: typeof parsed.notes === "string" ? parsed.notes : DEFAULT_SETUP.notes,
    autoListen: typeof parsed.autoListen === "boolean" ? parsed.autoListen : DEFAULT_SETUP.autoListen,
    autoSendVoice: typeof parsed.autoSendVoice === "boolean" ? parsed.autoSendVoice : DEFAULT_SETUP.autoSendVoice,
    nudgesEnabled: typeof parsed.nudgesEnabled === "boolean" ? parsed.nudgesEnabled : DEFAULT_SETUP.nudgesEnabled,
    nudgeSound: typeof parsed.nudgeSound === "boolean" ? parsed.nudgeSound : DEFAULT_SETUP.nudgeSound,
    nudgeHaptics: typeof parsed.nudgeHaptics === "boolean" ? parsed.nudgeHaptics : DEFAULT_SETUP.nudgeHaptics,
  };
  return cachedSetupSnapshot;
}

export function saveSetup(setup: InterviewSetup) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SETUP_KEY, JSON.stringify(setup));
  window.dispatchEvent(new Event(SETUP_CHANGED_EVENT));
}

export function clearSetup() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SETUP_KEY);
  window.dispatchEvent(new Event(SETUP_CHANGED_EVENT));
}

export function setAutostart(enabled: boolean) {
  if (typeof window === "undefined") return;
  if (enabled) window.sessionStorage.setItem(AUTOSTART_KEY, "1");
  else window.sessionStorage.removeItem(AUTOSTART_KEY);
}

export function consumeAutostart(): boolean {
  if (typeof window === "undefined") return false;
  const enabled = window.sessionStorage.getItem(AUTOSTART_KEY) === "1";
  if (enabled) window.sessionStorage.removeItem(AUTOSTART_KEY);
  return enabled;
}

export function saveReviewSnapshot(snapshot: ReviewSnapshot) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(REVIEW_KEY, JSON.stringify(snapshot));
}

export function loadReviewSnapshot(): ReviewSnapshot | null {
  if (typeof window === "undefined") return null;
  return safeJsonParse<ReviewSnapshot>(window.sessionStorage.getItem(REVIEW_KEY));
}

export function clearReviewSnapshot() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(REVIEW_KEY);
}

function subscribeToSetup(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const onChange = () => callback();
  window.addEventListener(SETUP_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener(SETUP_CHANGED_EVENT, onChange);
  };
}

export function useStoredSetup(): InterviewSetup | null | undefined {
  return useSyncExternalStore(subscribeToSetup, loadSetup, () => undefined);
}
