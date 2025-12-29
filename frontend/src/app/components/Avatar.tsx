"use client";

import styles from "../page.module.css";
import type { Style } from "../lib/interviewClient";

export function Avatar({
  style,
  talking,
  userTalking,
  listening,
  fill = false,
  showStatus = true,
}: {
  style: Style;
  talking: boolean;
  userTalking: boolean;
  listening: boolean;
  fill?: boolean;
  showStatus?: boolean;
}) {
  const moodClass = {
    supportive: styles.avatarSupportive,
    neutral: styles.avatarNeutral,
    cold: styles.avatarCold,
  }[style];
  const mouthClass = talking ? styles.mouthTalking : userTalking ? styles.mouthUser : styles.mouthIdle;
  const status = talking ? "Interviewer speaking" : listening ? "Listening to you" : userTalking ? "You’re speaking" : "Idle";

  return (
    <div className={`${styles.avatarShell} ${fill ? styles.avatarShellFill : ""} ${moodClass}`}>
      <div className={styles.avatarFace}>
        <div className={`${styles.eye} ${styles.eyeLeft}`} />
        <div className={`${styles.eye} ${styles.eyeRight}`} />
        <div className={`${styles.brow} ${styles.browLeft}`} />
        <div className={`${styles.brow} ${styles.browRight}`} />
        <div className={`${styles.mouth} ${mouthClass}`} />
        {listening && <div className={styles.listenGlow} />}
      </div>
      {showStatus && <div className={styles.avatarStatusText}>{status}</div>}
    </div>
  );
}
