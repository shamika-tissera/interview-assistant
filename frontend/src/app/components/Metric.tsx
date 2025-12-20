"use client";

import styles from "../page.module.css";

export function Metric({ label, value, target }: { label: string; value: string | number; target?: string }) {
  return (
    <div className={styles.metric}>
      <p className={styles.metricLabel}>{label}</p>
      <div className={styles.metricValue}>{value}</div>
      {target && <div className={styles.metricTarget}>Target: {target}</div>}
    </div>
  );
}

