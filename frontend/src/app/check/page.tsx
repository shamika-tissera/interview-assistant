"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../flow.module.css";
import { loadSetup, setAutostart } from "../lib/flowStorage";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function CheckPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string>("");
  const [level, setLevel] = useState<number>(0);

  const canProceed = useMemo(() => loadSetup()?.consent === true, []);

  useEffect(() => {
    if (!canProceed) {
      router.replace("/setup");
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;
    let rafId: number | null = null;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        dataArray = new Uint8Array(analyser.fftSize);
        source.connect(analyser);

        const loop = () => {
          if (!analyser || !dataArray) return;
          analyser.getByteTimeDomainData(dataArray);
          let sumSquares = 0;
          for (let i = 0; i < dataArray.length; i += 1) {
            const v = (dataArray[i] - 128) / 128;
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / dataArray.length);
          setLevel(clamp(rms * 4, 0, 1));
          rafId = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setError("Microphone/camera access failed. You can still continue, but live coaching may be limited.");
      }
    };

    start();
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      audioCtx?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [canProceed, router]);

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <Link className={styles.link} href="/setup">
            Back
          </Link>
          <div className={styles.step}>Step 2 of 3</div>
        </div>

        <div className={styles.card}>
          <p className={styles.kicker}>Mic & camera</p>
          <h1 className={styles.title}>Quick check.</h1>
          <p className={styles.subtitle}>Look at the camera and say one sentence. The meter should move.</p>

          <div className={styles.section}>
            <div className={styles.twoCol}>
              <div className={styles.panel}>
                <h2 className={styles.cardTitle}>Preview</h2>
                <video ref={videoRef} muted playsInline style={{ width: "100%", borderRadius: 16, background: "#0f172a" }} />
              </div>
              <div className={styles.panel}>
                <h2 className={styles.cardTitle}>Input level</h2>
                <div className={styles.meterShell}>
                  <div className={styles.meterFill} style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
                <p className={styles.helper} style={{ marginTop: 10 }}>
                  If it stays flat, check browser permissions and your microphone selection.
                </p>
                {error && (
                  <p className={styles.helper} style={{ marginTop: 10, color: "#dc2626" }}>
                    {error}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                setAutostart(true);
                router.push("/interview");
              }}
            >
              Start interview
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setAutostart(true);
                router.push("/interview");
              }}
            >
              Skip check
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
