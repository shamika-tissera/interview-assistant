"use client";

import Link from "next/link";
import styles from "./flow.module.css";

export default function Home() {
  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.brand}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M7 7.5c0-1.7 1.8-3 5-3s5 1.3 5 3v3.7c0 1.1-.6 2.1-1.5 2.7l-1.9 1.2V19a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1v-2.4l-1.9-1.2A3.3 3.3 0 0 1 7 11.2V7.5Z"
                style={{ fill: "var(--primary-soft)", stroke: "var(--primary)" }}
                strokeWidth="1.6"
              />
              <path d="M10 9.4h4" style={{ stroke: "var(--primary)" }} strokeWidth="1.6" strokeLinecap="round" />
              <path d="M12 6.5v1.2" style={{ stroke: "var(--primary)" }} strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            AI Interview Trainer
          </div>
          <div className={styles.pillRow}>
            <Link className={styles.navLink} href="/history">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M7 8h10M7 12h7M7 16h10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              History
            </Link>
            <Link className={styles.navLink} href="/lab">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M7 3v6l-4 7a3 3 0 0 0 2.6 4.5h12.8A3 3 0 0 0 21 16l-4-7V3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path d="M8.5 10h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Lab
            </Link>
          </div>
        </div>

        <div className={styles.heroGrid}>
          <div className={styles.card}>
            <p className={styles.kicker}>Guided practice</p>
            <h1 className={styles.title}>A calmer, step-by-step interview loop.</h1>
            <p className={styles.subtitle}>
              Pick a persona, run a quick mic/camera check, then focus on answering. Coaching and transcript stay one tap away.
            </p>
            <div className={styles.buttonRow}>
              <Link className={styles.primary} href="/setup">
                Start practice
              </Link>
              <Link className={styles.secondary} href="/lab">
                Open lab mode
              </Link>
              <Link className={styles.secondary} href="/history">
                View history
              </Link>
            </div>

            <div className={styles.section}>
              <div className={styles.panel}>
                <div className={styles.optionTitle}>Flow</div>
                <div className={styles.cardText} style={{ marginTop: 8 }}>
                  Setup → Mic check → Interview → Review
                </div>
              </div>
            </div>
          </div>

          <div className={styles.heroArt}>
            <div className={styles.heroArtInner}>
              <svg className={styles.heroSvg} viewBox="0 0 520 360" role="img" aria-labelledby="hero-title hero-desc">
                <title id="hero-title">Interview flow preview</title>
                <desc id="hero-desc">A four-step path from setup to review with a coaching note and audio waveform.</desc>

                <rect
                  x="16"
                  y="20"
                  width="488"
                  height="320"
                  rx="28"
                  style={{ fill: "var(--surface-muted)", stroke: "var(--border)", strokeWidth: 2 }}
                />

                <rect
                  x="44"
                  y="52"
                  width="220"
                  height="46"
                  rx="16"
                  style={{ fill: "var(--surface-strong)", stroke: "var(--border)", strokeWidth: 2 }}
                />
                <circle cx="70" cy="75" r="9" style={{ fill: "var(--primary-soft)", stroke: "var(--primary)", strokeWidth: 2 }} />
                <path
                  d="M92 75h148"
                  style={{ stroke: "var(--border-strong)" }}
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.8"
                />

                <path
                  className={styles.heroDash}
                  d="M96 182H424"
                  fill="none"
                  style={{ stroke: "var(--border-strong)" }}
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.45"
                />
                <path
                  d="M96 182H424"
                  fill="none"
                  style={{ stroke: "var(--border)" }}
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.55"
                />

                {[
                  { x: 96, label: "Setup", strong: false },
                  { x: 196, label: "Check", strong: false },
                  { x: 310, label: "Interview", strong: true },
                  { x: 424, label: "Review", strong: false },
                ].map((s) => (
                  <g key={s.label}>
                    <circle cx={s.x} cy="182" r="14" style={{ fill: "var(--surface-strong)", stroke: "var(--border-strong)", strokeWidth: 2 }} />
                    <circle cx={s.x} cy="182" r="5" style={{ fill: s.strong ? "var(--primary)" : "var(--muted-2)" }} />
                    <text
                      x={s.x}
                      y="218"
                      textAnchor="middle"
                      className={`${styles.heroText} ${s.strong ? styles.heroLabelStrong : ""}`}
                    >
                      {s.label}
                    </text>
                  </g>
                ))}

                <g className={styles.heroDot}>
                  <rect
                    x="270"
                    y="112"
                    width="208"
                    height="78"
                    rx="18"
                    style={{ fill: "var(--surface-strong)", stroke: "var(--border)", strokeWidth: 2 }}
                  />
                  <path
                    d="M300 156c8-8 17-12 28-12 18 0 30 11 47 11 14 0 21-6 27-12"
                    fill="none"
                    style={{ stroke: "var(--primary)" }}
                    strokeWidth="3"
                    strokeLinecap="round"
                    opacity="0.85"
                  />
                  <text x="292" y="140" className={`${styles.heroText} ${styles.heroLabelStrong}`}>
                    Coach
                  </text>
                  <text x="292" y="162" className={styles.heroText}>
                    “Lead with the metric.”
                  </text>
                </g>

                <g opacity="0.9">
                  {Array.from({ length: 18 }).map((_, i) => {
                    const x = 70 + i * 20;
                    const h = 12 + (i % 6) * 8;
                    return (
                      <rect
                        key={x}
                        x={x}
                        y={290 - h}
                        width="10"
                        height={h}
                        rx="5"
                        style={{ fill: i % 3 === 0 ? "var(--success)" : "var(--primary)" }}
                        opacity={i % 5 === 0 ? 0.75 : 0.55}
                      />
                    );
                  })}
                </g>

                <circle cx="108" cy="118" r="34" className={styles.heroGlow} style={{ fill: "var(--primary)", opacity: 0.15 }} />
                <circle cx="108" cy="118" r="16" style={{ fill: "var(--primary-soft)", stroke: "var(--primary)", strokeWidth: 2 }} />
                <path d="M102 118h12" style={{ stroke: "var(--primary)" }} strokeWidth="2.4" strokeLinecap="round" />
                <path d="M108 112v12" style={{ stroke: "var(--primary)" }} strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>

        <div className={styles.featureGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  d="M7 8.5a5 5 0 0 1 10 0v3a5 5 0 0 1-10 0v-3Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path d="M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className={styles.featureTitle}>Voice-first</div>
            <div className={styles.featureText}>Tap to answer, transcribe, and keep going. Replay prompts whenever you need.</div>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  d="M4 12a8 8 0 1 0 16 0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path d="M4 12V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4 5h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className={styles.featureTitle}>Glanceable coaching</div>
            <div className={styles.featureText}>Pace, pauses, and centering cues help you adjust without breaking flow.</div>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  d="M7 7h10v10H7z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path d="M7 11h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M11 7v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className={styles.featureTitle}>After-action review</div>
            <div className={styles.featureText}>See highlights and transcript in one place; share a mentor link for feedback.</div>
          </div>
        </div>

        <p className={styles.footerNote}>
          <strong>Tip:</strong> For the best experience, use headphones and grant mic/camera permission — coaching stays local and exportable.
        </p>
      </div>
    </main>
  );
}
