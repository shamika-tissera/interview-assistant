"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "../flow.module.css";
import { STYLE_HELP, STYLE_LABELS } from "../lib/interviewClient";
import { DEFAULT_SETUP, saveSetup, useStoredSetup, type Difficulty, type LimitMode, type PracticePack } from "../lib/flowStorage";

const PACK_LABELS: Record<PracticePack, string> = {
  swe_behavioral: "SWE behavioral",
  swe_system_design: "SWE system design",
  data_science_ml: "Data science / ML",
  leadership: "Leadership",
};

const PACK_HELP: Record<PracticePack, string> = {
  swe_behavioral: "STAR answers, conflict, ownership, impact.",
  swe_system_design: "Architecture, tradeoffs, scaling, reliability.",
  data_science_ml: "Modeling, evaluation, experimentation, monitoring.",
  leadership: "Stakeholders, prioritization, influence, delivery.",
};

const PACK_RUBRIC: Record<PracticePack, string[]> = {
  swe_behavioral: ["Headline first", "Clear role (I vs we)", "Measurable impact", "Tight STAR structure"],
  swe_system_design: ["Clarify requirements", "Tradeoffs + constraints", "Reliability + failure modes", "APIs + data model"],
  data_science_ml: ["Evaluation + baselines", "Monitoring + drift", "Experiment design", "Failure analysis"],
  leadership: ["Stakeholder alignment", "Decision clarity", "Execution plan", "Learning + accountability"],
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  standard: "Standard",
  hard: "Hard",
};

const LIMIT_MODE_LABELS: Record<LimitMode, string> = {
  none: "Unlimited",
  questions: "Question count",
  time: "Time limit",
};

export default function SetupPage() {
  const router = useRouter();
  const storedSetup = useStoredSetup();
  const setup = storedSetup ?? DEFAULT_SETUP;
  const [showOptions, setShowOptions] = useState<boolean>(false);

  const canContinue = setup.consent;

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <Link className={styles.navLink} href="/">
            Home
          </Link>
          <div className={styles.step}>Step 1 of 3</div>
        </div>

        <div className={styles.card}>
          <p className={styles.kicker}>Setup</p>
          <h1 className={styles.title}>Pick your practice.</h1>
          <p className={styles.subtitle}>Choose a pack, then choose your interviewer tone. We keep the session focused once you start.</p>

          <div className={styles.section}>
            <h2 className={styles.cardTitle}>Practice pack</h2>
            <div className={styles.optionGridTwo} role="radiogroup" aria-label="Practice pack">
              {(Object.keys(PACK_LABELS) as PracticePack[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={setup.pack === p}
                  className={`${styles.option} ${setup.pack === p ? styles.optionActive : ""}`}
                  onClick={() => saveSetup({ ...setup, pack: p })}
                >
                  <div className={styles.optionTitle}>{PACK_LABELS[p]}</div>
                  <span className={styles.optionHelp}>{PACK_HELP[p]}</span>
                </button>
              ))}
            </div>
            <div className={styles.panel} style={{ marginTop: 12 }}>
              <div className={styles.optionTitle}>Rubric</div>
              <div className={styles.cardText} style={{ marginTop: 8 }}>
                {PACK_RUBRIC[setup.pack].map((item) => (
                  <div key={item}>• {item}</div>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.cardTitle}>Difficulty</h2>
            <div className={styles.pillRow} role="radiogroup" aria-label="Difficulty">
              {(["standard", "hard"] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={setup.difficulty === d}
                  className={`${styles.pill} ${setup.difficulty === d ? styles.pillActive : ""}`}
                  onClick={() => saveSetup({ ...setup, difficulty: d })}
                >
                  {DIFFICULTY_LABELS[d]}
                </button>
              ))}
            </div>
            <p className={styles.helper}>Hard mode pushes for concision and numbers.</p>
          </div>

          <div className={styles.section}>
            <h2 className={styles.cardTitle}>Interviewer tone</h2>
            <div className={styles.optionGrid} role="radiogroup" aria-label="Interviewer style">
              {(["supportive", "neutral", "cold"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={setup.style === s}
                  className={`${styles.option} ${setup.style === s ? styles.optionActive : ""}`}
                  onClick={() => saveSetup({ ...setup, style: s })}
                >
                  <div className={styles.optionTitle}>{STYLE_LABELS[s]}</div>
                  <span className={styles.optionHelp}>{STYLE_HELP[s]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.cardTitle}>Consent</h2>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={setup.consent}
                onChange={(e) => saveSetup({ ...setup, consent: e.target.checked })}
              />
              <span>
                I consent to local processing of mic/camera signals for coaching (pace/gaze/latency). You can export session
                data after the interview.
              </span>
            </label>
            <p className={styles.helper}>No emotion inference. Opt-in metadata is optional.</p>
          </div>

          <div className={styles.section}>
            <div className={styles.buttonRow}>
              <button type="button" className={styles.secondary} onClick={() => setShowOptions((v) => !v)}>
                {showOptions ? "Hide options" : "More options"}
              </button>
            </div>

            {showOptions && (
              <div className={styles.section}>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    Accent / dialect (optional)
                    <input
                      className={styles.input}
                      type="text"
                      value={setup.accent}
                      onChange={(e) => saveSetup({ ...setup, accent: e.target.value })}
                      placeholder="e.g., US Southern, Nigerian English"
                    />
                  </label>
                  <label className={styles.field}>
                    Notes (optional)
                    <input
                      className={styles.input}
                      type="text"
                      value={setup.notes}
                      onChange={(e) => saveSetup({ ...setup, notes: e.target.value })}
                      placeholder="Any accessibility or fairness notes"
                    />
                  </label>
                </div>

                <div className={styles.section}>
                  <h3 className={styles.cardTitle}>Session length</h3>
                  <div className={styles.pillRow} role="radiogroup" aria-label="Session length">
                    {(["none", "questions", "time"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={setup.limitMode === mode}
                        className={`${styles.pill} ${setup.limitMode === mode ? styles.pillActive : ""}`}
                        onClick={() => saveSetup({ ...setup, limitMode: mode })}
                      >
                        {LIMIT_MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                  {setup.limitMode === "questions" && (
                    <label className={styles.field} style={{ marginTop: 10, maxWidth: 260 }}>
                      Questions
                      <input
                        className={styles.input}
                        type="number"
                        min={1}
                        max={50}
                        value={setup.maxQuestions}
                        onChange={(e) => {
                          const next = Math.min(50, Math.max(1, Math.round(Number(e.target.value || setup.maxQuestions))));
                          saveSetup({ ...setup, maxQuestions: next });
                        }}
                      />
                    </label>
                  )}
                  {setup.limitMode === "time" && (
                    <label className={styles.field} style={{ marginTop: 10, maxWidth: 260 }}>
                      Minutes
                      <input
                        className={styles.input}
                        type="number"
                        min={1}
                        max={180}
                        value={setup.durationMinutes}
                        onChange={(e) => {
                          const next = Math.min(180, Math.max(1, Math.round(Number(e.target.value || setup.durationMinutes))));
                          saveSetup({ ...setup, durationMinutes: next });
                        }}
                      />
                    </label>
                  )}
                  <p className={styles.helper}>
                    Question count includes follow-ups. Time limit ends the session automatically when it expires.
                  </p>
                </div>

                <div className={styles.section}>
                  <h3 className={styles.cardTitle}>Your questions (optional)</h3>
                  <label className={styles.field}>
                    Add one per line
                    <textarea
                      className={styles.textarea}
                      value={setup.customQuestions.join("\n")}
                      placeholder={"e.g.\nTell me about a time you handled a production incident.\nExplain eventual consistency in simple terms."}
                      onChange={(e) => {
                        const next = e.target.value.split("\n").slice(0, 24);
                        saveSetup({ ...setup, customQuestions: next });
                      }}
                    />
                  </label>
                  <p className={styles.helper}>We’ll ask these first, then continue with the selected pack.</p>
                </div>

                <div className={styles.section}>
                  <h3 className={styles.cardTitle}>Automation</h3>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={setup.autoListen}
                      onChange={(e) => saveSetup({ ...setup, autoListen: e.target.checked })}
                    />
                    <span>Auto-listen after each question</span>
                  </label>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={setup.autoSendVoice}
                      onChange={(e) => saveSetup({ ...setup, autoSendVoice: e.target.checked })}
                    />
                    <span>Auto-send when speech finishes</span>
                  </label>
                </div>

                <div className={styles.section}>
                  <h3 className={styles.cardTitle}>Live nudges</h3>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={setup.nudgesEnabled}
                      onChange={(e) => saveSetup({ ...setup, nudgesEnabled: e.target.checked })}
                    />
                    <span>Show real-time nudges while you speak (pace, rambling, centering)</span>
                  </label>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={setup.nudgeSound}
                      onChange={(e) => saveSetup({ ...setup, nudgeSound: e.target.checked })}
                      disabled={!setup.nudgesEnabled}
                    />
                    <span>Play a subtle sound cue</span>
                  </label>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={setup.nudgeHaptics}
                      onChange={(e) => saveSetup({ ...setup, nudgeHaptics: e.target.checked })}
                      disabled={!setup.nudgesEnabled}
                    />
                    <span>Vibrate on mobile (if supported)</span>
                  </label>
                  <p className={styles.helper}>Nudges are throttled so they only appear when you cross a threshold.</p>
                </div>

                <div className={styles.section}>
                  <h3 className={styles.cardTitle}>Study mode</h3>
                  <div className={styles.pillRow} role="radiogroup" aria-label="Experiment group">
                    {(["treatment", "control"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        role="radio"
                        aria-checked={setup.group === g}
                        className={`${styles.pill} ${setup.group === g ? styles.pillActive : ""}`}
                        onClick={() => saveSetup({ ...setup, group: g })}
                      >
                        {g === "treatment" ? "Treatment (multi-style)" : "Control (neutral only)"}
                      </button>
                    ))}
                  </div>
                  <p className={styles.helper}>Leave this on treatment unless you’re running the experiment.</p>
                </div>
              </div>
            )}
          </div>

          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primary}
              disabled={!canContinue}
              onClick={() => {
                saveSetup(setup);
                router.push("/check");
              }}
            >
              Continue
            </button>
            <Link className={styles.secondary} href="/lab">
              Use lab mode instead
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
