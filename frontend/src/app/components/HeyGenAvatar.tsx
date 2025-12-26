"use client";

import { useEffect, useRef, useState } from "react";
import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskMode,
  TaskType,
  VoiceEmotion,
  StartAvatarRequest,
} from "@heygen/streaming-avatar";

interface HeyGenAvatarProps {
  /** 面试官提出的问题文本 */
  questionText?: string;
  /** 问题的唯一标识（用于检测变化） */
  questionId?: number;
  /** 是否显示调试信息 */
  debug?: boolean;
  /** Avatar 准备就绪回调 */
  onReady?: () => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: "Ann_Therapist_public",
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
  },
  language: "en",
};

export function HeyGenAvatar({
  questionText = "",
  questionId = 0,
  debug = false,
  onReady,
  onError,
}: HeyGenAvatarProps) {
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string>("");
  const [isAvatarReady, setIsAvatarReady] = useState(false);
  
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatar | null>(null);
  const lastQuestionId = useRef<number>(-1);

  // 获取 Access Token
  async function fetchAccessToken() {
    try {
      const response = await fetch("/api/get-access-token", {
        method: "POST",
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const token = await response.text();
      if (debug) console.log("[HeyGen] Access Token received");
      return token;
    } catch (error) {
      console.error("[HeyGen] Error fetching access token:", error);
      throw error;
    }
  }

  // 初始化 Avatar（完全按照 Demo 的方式）
  async function initializeAvatarSession() {
    if (isAvatarReady) {
      if (debug) console.log("[HeyGen] Already initialized");
      return;
    }

    setIsLoadingSession(true);
    setError("");

    try {
      // 1. 获取 token
      if (debug) console.log("[HeyGen] Fetching access token...");
      const token = await fetchAccessToken();
      if (debug) console.log("[HeyGen] Token received, length:", token.length);
      
      // 2. 创建 StreamingAvatar 实例
      if (debug) console.log("[HeyGen] Creating StreamingAvatar instance...");
      const newAvatar = new StreamingAvatar({ token });
      avatar.current = newAvatar;

      // 3. 注册所有事件监听器
      newAvatar.on(StreamingEvents.AVATAR_START_TALKING, (e) => {
        if (debug) console.log("[HeyGen] Avatar started talking", e);
        setIsLoadingRepeat(true);
      });

      newAvatar.on(StreamingEvents.AVATAR_STOP_TALKING, (e) => {
        if (debug) console.log("[HeyGen] Avatar stopped talking", e);
        setIsLoadingRepeat(false);
      });

      newAvatar.on(StreamingEvents.STREAM_READY, (event) => {
        if (debug) console.log("[HeyGen] Stream ready:", event.detail);
        if (event.detail) {
          setStream(event.detail);
          // 等待一小段时间确保视频流稳定
          setTimeout(() => {
            setIsAvatarReady(true);
            setIsLoadingSession(false);
            if (debug) console.log("[HeyGen] Avatar ready for use");
            onReady?.(); // 通知外部组件 Avatar 已准备好
          }, 2000); // 等待 2 秒让视频流稳定
        }
      });

      newAvatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        if (debug) console.log("[HeyGen] Stream disconnected");
        setStream(null);
        setIsAvatarReady(false);
      });

      newAvatar.on(StreamingEvents.USER_START, (event) => {
        if (debug) console.log("[HeyGen] User started talking:", event);
      });

      newAvatar.on(StreamingEvents.USER_STOP, (event) => {
        if (debug) console.log("[HeyGen] User stopped talking:", event);
      });

      // 4. 启动 Avatar（使用 Demo 的默认配置）
      if (debug) {
        console.log("[HeyGen] Creating avatar with config:", JSON.stringify(DEFAULT_CONFIG, null, 2));
      }
      await newAvatar.createStartAvatar(DEFAULT_CONFIG);

      if (debug) console.log("[HeyGen] Avatar session created successfully");
    } catch (err) {
      console.error("[HeyGen] Failed to initialize avatar:", err);
      // 尝试提取更详细的错误信息
      if (err && typeof err === 'object') {
        console.error("[HeyGen] Error details:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
      }
      const errorMsg = err instanceof Error ? err.message : "Failed to initialize avatar";
      setError(errorMsg);
      setIsLoadingSession(false);
      setIsAvatarReady(false);
      onError?.(errorMsg); // 通知外部组件错误
    }
  }

  // Repeat 功能：让 Avatar 播报问题文本（使用 REPEAT 任务）
  async function repeatQuestion(text: string) {
    if (!avatar.current || !text || !isAvatarReady) {
      if (debug) console.log("[HeyGen] Cannot repeat: avatar not ready");
      return;
    }

    setIsLoadingRepeat(true);
    try {
      // 使用 REPEAT 任务类型，ASYNC 模式
      await avatar.current.speak({
        text: text,
        taskType: TaskType.REPEAT,
        taskMode: TaskMode.ASYNC,
      });
      if (debug) console.log("[HeyGen] Avatar repeating:", text);
    } catch (err) {
      console.error("[HeyGen] Failed to repeat:", err);
      setIsLoadingRepeat(false);
    }
  }

  // 自动启动 - 组件挂载时立即初始化
  useEffect(() => {
    if (!isAvatarReady && !isLoadingSession) {
      initializeAvatarSession();
    }
  }, []);

  // 当问题变化或 Avatar 准备就绪时，触发 repeat
  useEffect(() => {
    if (isAvatarReady && questionText && questionId !== lastQuestionId.current) {
      if (debug) console.log(`[HeyGen] Triggering repeat for question ${questionId}: ${questionText.substring(0, 30)}...`);
      lastQuestionId.current = questionId;
      repeatQuestion(questionText);
    }
  }, [questionText, questionId, isAvatarReady]);

  // 绑定视频流到 video 元素
  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current?.play().catch((err) => {
          console.error("[HeyGen] Failed to play video:", err);
        });
      };
    }
  }, [stream]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (avatar.current && isAvatarReady) {
        avatar.current.stopAvatar();
        avatar.current = null;
        setIsAvatarReady(false);
      }
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* 视频显示区域 */}
      <video
        ref={mediaStream}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "8px",
          backgroundColor: "#000",
        }}
      />

      {/* 加载中状态 */}
      {isLoadingSession && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            color: "white",
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            padding: "20px",
            borderRadius: "8px",
          }}
        >
          <div style={{ marginBottom: "10px" }}>🔄 Loading Avatar...</div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>Please wait</div>
        </div>
      )}

      {/* Repeat 状态 */}
      {isLoadingRepeat && stream && (
        <div
          style={{
            position: "absolute",
            bottom: "10px",
            left: "10px",
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            color: "white",
            padding: "8px 12px",
            borderRadius: "4px",
            fontSize: "12px",
          }}
        >
          Speaking...
        </div>
      )}

      {/* 错误信息 */}
      {error && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            right: "10px",
            backgroundColor: "rgba(220, 38, 38, 0.9)",
            color: "white",
            padding: "12px",
            borderRadius: "4px",
            fontSize: "14px",
          }}
        >
          <div>Error: {error}</div>
          <button
            onClick={initializeAvatarSession}
            style={{
              marginTop: "8px",
              padding: "4px 12px",
              fontSize: "12px",
              backgroundColor: "white",
              color: "var(--danger)",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 调试信息 */}
      {debug && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            color: "white",
            padding: "8px",
            borderRadius: "4px",
            fontSize: "11px",
            maxWidth: "200px",
          }}
        >
          <div>Question ID: {questionId}</div>
          <div>Stream: {stream ? "✓" : "✗"}</div>
          <div>Initialized: {isAvatarReady ? "✓" : "✗"}</div>
          <div>Speaking: {isLoadingRepeat ? "Yes" : "No"}</div>
        </div>
      )}
    </div>
  );
}
