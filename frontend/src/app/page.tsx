"use client";

import Link from "next/link";
import styles from "./flow.module.css";

export default function Home() {
  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.brand}>AI Interview Trainer</div>
          <Link className={styles.link} href="/lab">
            Lab view
          </Link>
        </div>

        <div className={styles.card}>
          <p className={styles.kicker}>Guided practice</p>
          <h1 className={styles.title}>A calmer, step-by-step interview loop.</h1>
          <p className={styles.subtitle}>
            Pick a persona, check your mic/camera, then focus on answering. Coaching and transcript stay one tap away.
          </p>
          <div className={styles.buttonRow}>
            <Link className={styles.primary} href="/setup">
              Start practice
            </Link>
            <Link className={styles.secondary} href="/lab">
              Open lab mode
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

