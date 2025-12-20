"use client";

import styles from "../page.module.css";
import type { Style } from "../lib/interviewClient";

export function Avatar({
  style,
  talking,
  userTalking,
  listening,
}: {
  style: Style;
  talking: boolean;
  userTalking: boolean;
  listening: boolean;
}) {
  const moodClass = {
    supportive: styles.avatarSupportive,
    neutral: styles.avatarNeutral,
    cold: styles.avatarCold,
  }[style];
  const mouthClass = talking ? styles.mouthTalking : userTalking ? styles.mouthUser : styles.mouthIdle;
  const status = talking ? "Interviewer speaking" : listening ? "Listening to you" : userTalking ? "You’re speaking" : "Idle";

  return (
    <div className={`${styles.avatarShell} ${moodClass}`}>
      <div className={styles.avatarFace}>
        <div className={`${styles.eye} ${styles.eyeLeft}`} />
        <div className={`${styles.eye} ${styles.eyeRight}`} />
        <div className={`${styles.brow} ${styles.browLeft}`} />
        <div className={`${styles.brow} ${styles.browRight}`} />
        <div className={`${styles.mouth} ${mouthClass}`} />
        {listening && <div className={styles.listenGlow} />}
      </div>
      <div className={styles.avatarStatusText}>{status}</div>
    </div>
  );
}

