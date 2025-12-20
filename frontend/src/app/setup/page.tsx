"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import styles from "../flow.module.css";
import { STYLE_HELP, STYLE_LABELS } from "../lib/interviewClient";
import { loadSetup, saveSetup, type InterviewSetup } from "../lib/flowStorage";

const DEFAULT_SETUP: InterviewSetup = {
  style: "neutral",
  group: "treatment",
  consent: false,
  accent: "",
  notes: "",
  autoListen: true,
  autoSendVoice: true,
};

export default function SetupPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<InterviewSetup>(() => loadSetup() ?? DEFAULT_SETUP);
  const [showOptions, setShowOptions] = useState<boolean>(false);

  const canContinue = useMemo(() => setup.consent, [setup.consent]);

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <Link className={styles.link} href="/">
            Home
          </Link>
          <div className={styles.step}>Step 1 of 3</div>
        </div>

        <div className={styles.card}>
          <p className={styles.kicker}>Persona</p>
          <h1 className={styles.title}>Choose your interviewer.</h1>
          <p className={styles.subtitle}>Pick a tone for this session. You can change it later from the Coach tab.</p>

          <div className={styles.section}>
            <div className={styles.optionGrid} role="radiogroup" aria-label="Interviewer style">
              {(["supportive", "neutral", "cold"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={setup.style === s}
                  className={`${styles.option} ${setup.style === s ? styles.optionActive : ""}`}
                  onClick={() => setSetup((prev) => ({ ...prev, style: s }))}
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
                onChange={(e) => setSetup((prev) => ({ ...prev, consent: e.target.checked }))}
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
                      onChange={(e) => setSetup((prev) => ({ ...prev, accent: e.target.value }))}
                      placeholder="e.g., US Southern, Nigerian English"
                    />
                  </label>
                  <label className={styles.field}>
                    Notes (optional)
                    <input
                      className={styles.input}
                      type="text"
                      value={setup.notes}
                      onChange={(e) => setSetup((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="Any accessibility or fairness notes"
                    />
                  </label>
                </div>

                <div className={styles.section}>
                  <h3 className={styles.cardTitle}>Automation</h3>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={setup.autoListen}
                      onChange={(e) => setSetup((prev) => ({ ...prev, autoListen: e.target.checked }))}
                    />
                    <span>Auto-listen after each question</span>
                  </label>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={setup.autoSendVoice}
                      onChange={(e) => setSetup((prev) => ({ ...prev, autoSendVoice: e.target.checked }))}
                    />
                    <span>Auto-send when speech finishes</span>
                  </label>
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
                        onClick={() => setSetup((prev) => ({ ...prev, group: g }))}
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
