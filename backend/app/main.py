"""
Lightweight FastAPI backend for the multi-style AI interviewer.
Exposes a WebSocket endpoint for the interview loop and a simple health check.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import re
import time
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from io import BytesIO
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlmodel import SQLModel
from tempfile import NamedTemporaryFile
from collections import OrderedDict

import httpx
from app.db import get_session, init_db
from app.models import AnswerRecord, CheckInRecord, SessionRecord, TelemetryRecord
from faster_whisper import WhisperModel
from TTS.api import TTS
import soundfile as sf
import logging
import traceback


class InterviewerStyle(str, Enum):
    SUPPORTIVE = "supportive"
    NEUTRAL = "neutral"
    COLD = "cold"


class SessionState:
    """Per-connection state to keep the loop simple and testable."""

    def __init__(
        self,
        style: InterviewerStyle = InterviewerStyle.NEUTRAL,
        group: str = "treatment",
        consented: bool = False,
        accent: Optional[str] = None,
        notes: Optional[str] = None,
        pack: str = "swe_behavioral",
        difficulty: str = "standard",
    ) -> None:
        self.session_id = str(uuid.uuid4())
        self.style = style
        self.group = group
        self.consented = consented
        self.accent = accent
        self.notes = notes
        self.pack = pack
        self.difficulty = difficulty
        self.turn = 0
        self.last_question: Optional[str] = None
        self.history: List[Tuple[str, str]] = []  # recent (question, answer) pairs
        self.awaiting_followup: bool = False


QUESTION_BANK: Dict[InterviewerStyle, List[str]] = {
    InterviewerStyle.SUPPORTIVE: [
        "Tell me about a project you loved working on and why.",
        "What is a strength you’re proud of, and how do you use it on teams?",
    ],
    InterviewerStyle.NEUTRAL: [
        "Walk me through a challenging problem you recently solved.",
        "Describe a time you disagreed with a teammate. What happened?",
    ],
    InterviewerStyle.COLD: [
        "Why should we trust you with high-stakes work?",
        "Explain a recent mistake. How did you recover? Be concise.",
    ],
}

QUESTION_PACKS: Dict[str, Dict[str, List[str]]] = {
    "swe_behavioral": {
        "standard": [
            "Tell me about a time you had to make a tradeoff. What did you choose and why?",
            "Describe a disagreement with a teammate. How did you resolve it?",
            "Tell me about a project where you took ownership end-to-end. What was the outcome?",
            "Describe a time you got critical feedback. What did you change afterward?",
            "Tell me about a time you improved a process. What changed because of you?",
            "What’s a technical decision you’re proud of? Walk me through your reasoning.",
        ],
        "hard": [
            "Pick one project. In 60 seconds, tell me the problem, your role, and the measurable outcome.",
            "Tell me about a time you missed the mark. What did you do next week to fix it?",
            "Describe a tradeoff you made under time pressure. What did you sacrifice, and what did you protect?",
            "Tell me about a conflict you caused. What would your teammate say you did wrong?",
            "What’s the hardest bug you’ve shipped? How did you detect and remediate it?",
            "Explain your impact with numbers. If you don’t have exact metrics, estimate responsibly.",
        ],
    },
    "swe_system_design": {
        "standard": [
            "Design a URL shortener. What are your APIs, storage, and scaling plan?",
            "Design a real-time chat system. How do you handle delivery, ordering, and offline clients?",
            "Design a rate limiter for an API gateway. What data structures do you use?",
            "Design a notifications system (email/push). How do you handle retries and deduplication?",
            "Design a file upload service. How do you handle large files and resumable uploads?",
            "Design a metrics pipeline for product analytics. What is your event model and storage?",
        ],
        "hard": [
            "Design a feed ranking service. What are your latency targets, failure modes, and fallbacks?",
            "Design a multi-tenant system. How do you isolate noisy neighbors and enforce quotas?",
            "Design a caching layer. When does caching hurt correctness, and how do you invalidate safely?",
            "Design an idempotent payments API. What are your consistency guarantees?",
            "Design a search autocomplete service. How do you keep it fast and fresh?",
            "Design a logging pipeline. How do you protect PII and handle high-cardinality labels?",
        ],
    },
    "data_science_ml": {
        "standard": [
            "Explain a model you deployed. How did you evaluate it and monitor drift?",
            "Design an A/B test for a ranking change. What metrics and pitfalls matter?",
            "Walk me through feature engineering for a sparse, high-cardinality dataset.",
            "How would you debug a sudden drop in model performance in production?",
            "Design a recommendation system for a new product with cold start.",
            "How do you decide between a simpler baseline and a more complex model?",
        ],
        "hard": [
            "You have label leakage. How do you detect it and fix the pipeline end-to-end?",
            "Design an online learning system. What are your safeguards against feedback loops?",
            "Explain precision/recall tradeoffs for an imbalanced classifier and how you pick thresholds.",
            "Design a monitoring suite: drift, bias, latency, and business KPIs. What alerts fire first?",
            "Your model is unfair across a subgroup. What is your investigation and mitigation plan?",
            "Design an LLM evaluation harness for a support agent. How do you measure correctness and harm?",
        ],
    },
    "leadership": {
        "standard": [
            "Tell me about a time you led without authority. What did you do?",
            "Describe a project that went off track. How did you re-plan and communicate?",
            "Tell me about a stakeholder conflict. How did you align priorities?",
            "Describe a time you mentored someone. What changed afterward?",
            "How do you balance speed vs quality on a team?",
            "Tell me about a time you changed your mind after learning new info.",
        ],
        "hard": [
            "A project is late and stakeholders are angry. What do you do in the next 48 hours?",
            "Tell me about a time you made a decision with incomplete data. What guardrails did you use?",
            "You have to cut scope by 40%. What do you cut, and how do you sell it?",
            "Describe a failure you were responsible for. What did you change systemically?",
            "How do you handle a high performer who is toxic to the team?",
            "Tell me about a time you pushed back on leadership. What did it cost you?",
        ],
    },
}

FOLLOW_UPS: Dict[InterviewerStyle, List[str]] = {
    InterviewerStyle.SUPPORTIVE: [
        "Nice—can you share a detail that shows your impact?",
        "How did that experience shape how you collaborate now?",
    ],
    InterviewerStyle.NEUTRAL: [
        "What was your exact role, and what did you deliver?",
        "What would you do differently if you faced this again?",
    ],
    InterviewerStyle.COLD: [
        "Your answer felt light on specifics. Give numbers.",
        "Time is short—summarize the critical decision you made.",
    ],
}


FOLLOW_UP_INTENTS: Dict[str, Dict[InterviewerStyle, List[str]]] = {
    "clarify": {
        InterviewerStyle.SUPPORTIVE: [
            "Can you share one concrete example of what you personally did?",
            "What’s one specific action you took that made the difference?",
        ],
        InterviewerStyle.NEUTRAL: [
            "What exactly did you do, step by step?",
            "What was your role, and what did you deliver?",
        ],
        InterviewerStyle.COLD: [
            "You’re being vague. What did you do?",
            "Cut the fluff—what did you deliver?",
        ],
    },
    "numbers": {
        InterviewerStyle.SUPPORTIVE: [
            "What metric moved? Even a rough before/after is helpful.",
            "Can you quantify the impact—time saved, errors reduced, or revenue influenced?",
        ],
        InterviewerStyle.NEUTRAL: [
            "Give numbers: scope, timeline, and measurable outcome.",
            "Quantify the result. What changed, and by how much?",
        ],
        InterviewerStyle.COLD: [
            "Numbers. Now.",
            "You didn’t quantify anything. Give me metrics.",
        ],
    },
    "role": {
        InterviewerStyle.SUPPORTIVE: [
            "What part was you vs the team?",
            "Where did you personally take ownership?",
        ],
        InterviewerStyle.NEUTRAL: [
            "What was your role versus others on the team?",
            "What decisions were yours, and what did you execute?",
        ],
        InterviewerStyle.COLD: [
            "Stop saying “we.” What did you do?",
            "What exactly was your responsibility?",
        ],
    },
    "tradeoff": {
        InterviewerStyle.SUPPORTIVE: [
            "What tradeoff did you consider, and what pushed you to that choice?",
            "What options did you reject, and why?",
        ],
        InterviewerStyle.NEUTRAL: [
            "What tradeoffs did you make, and why were they acceptable?",
            "What constraints shaped your decision?",
        ],
        InterviewerStyle.COLD: [
            "What did you sacrifice, and why was it worth it?",
            "What was the risk, and how did you mitigate it?",
        ],
    },
    "impact": {
        InterviewerStyle.SUPPORTIVE: [
            "What was the outcome, and who benefited?",
            "How did you know it worked?",
        ],
        InterviewerStyle.NEUTRAL: [
            "What was the result?",
            "What changed because of your work?",
        ],
        InterviewerStyle.COLD: [
            "What changed because of you?",
            "What’s the bottom-line impact?",
        ],
    },
    "summarize": {
        InterviewerStyle.SUPPORTIVE: [
            "Can you summarize that in one crisp sentence?",
            "Give me the headline in one sentence, then stop.",
        ],
        InterviewerStyle.NEUTRAL: [
            "Give a one-sentence headline.",
            "Summarize in one sentence, then we’ll go deeper.",
        ],
        InterviewerStyle.COLD: [
            "One sentence. Go.",
            "Summarize in one line.",
        ],
    },
}


def pick_question(style: InterviewerStyle, turn: int, pack: Optional[str] = None, difficulty: Optional[str] = None) -> str:
    diff = difficulty or "standard"
    if pack and pack in QUESTION_PACKS:
        items = QUESTION_PACKS[pack].get(diff) or QUESTION_PACKS[pack]["standard"]
    else:
        items = QUESTION_BANK.get(style) or QUESTION_BANK[InterviewerStyle.NEUTRAL]
    return items[turn % len(items)]


def fallback_clarification_response(
    style: InterviewerStyle,
    prompt_question: str,
    clarification_question: str,
    pack: Optional[str] = None,
    difficulty: Optional[str] = None,
) -> str:
    prompt_question = (prompt_question or "").strip()
    clarification_question = (clarification_question or "").strip()
    diff = (difficulty or "standard").strip()

    tone_prefix = {
        InterviewerStyle.SUPPORTIVE: "Good question — ",
        InterviewerStyle.NEUTRAL: "Clarifying — ",
        InterviewerStyle.COLD: "Listen — ",
    }[style]

    pack_hint = (pack or "").lower()
    is_system_design = "system" in pack_hint or "design" in pack_hint

    if is_system_design:
        guidance = (
            "State your assumptions explicitly (scale/traffic, latency, consistency), then focus on APIs, data model, and scaling. "
            "If constraints aren’t specified, choose reasonable ones and justify them."
        )
    else:
        guidance = (
            "Pick one concrete example and answer with STAR (situation, task, actions, result). "
            "If timeframe/scope isn’t specified, a recent 1–2 year example is fine; lead with the outcome."
        )

    if diff == "hard" and is_system_design:
        guidance = (
            "Be decisive: state assumptions (traffic, SLOs, data size) and tradeoffs, then outline APIs, storage, and failure modes."
        )
    elif diff == "hard":
        guidance = "Be concise: lead with the outcome, then 2–3 specific actions and one measurable result."

    restated = prompt_question if prompt_question.endswith("?") else f"{prompt_question}?"
    response = f"{tone_prefix}{guidance}"
    if clarification_question:
        response = f"{response} On your question: {clarification_question}"
    return f"{response} Original prompt: {restated}".strip()


def _is_answer_seeking_clarification(text: str) -> bool:
    lower = (text or "").strip().lower()
    if not lower:
        return False
    patterns = [
        r"\bwhat should i say\b",
        r"\bwhat do i say\b",
        r"\bwrite (me )?an answer\b",
        r"\bgive (me )?(a )?sample answer\b",
        r"\bgive (me )?the answer\b",
        r"\bhow would you answer\b",
        r"\bwhat is the best answer\b",
        r"\bcan you answer\b",
    ]
    return any(re.search(pattern, lower) for pattern in patterns)


def refusal_clarification_response(style: InterviewerStyle, prompt_question: str) -> str:
    prompt_question = (prompt_question or "").strip()
    restated = prompt_question if prompt_question.endswith("?") else f"{prompt_question}?"

    if style == InterviewerStyle.SUPPORTIVE:
        message = (
            "I can clarify what I’m looking for, but I can’t write the answer for you. "
            "Pick one example, lead with the outcome, then walk me through your actions and the measurable result."
        )
    elif style == InterviewerStyle.COLD:
        message = (
            "I’m not giving you the answer. "
            "Pick one example and give me: context, what you did, and the outcome—numbers if you have them."
        )
    else:
        message = (
            "I can clarify expectations, but I won’t provide a model answer. "
            "Use one concrete example and structure it as situation, task, actions, result."
        )

    return f"{message} Original prompt: {restated}".strip()


def pick_follow_up(style: InterviewerStyle, answer: str, metrics: Optional[Dict[str, Any]] = None) -> str:
    raw = (answer or "").strip()
    lower = raw.lower()
    metrics = metrics or {}

    # Prefer a summarization follow-up when the answer is very long or delivered at high pace.
    speaking_rate = _coerce_float(metrics.get("speakingRate"))
    if len(raw) > 900 or (speaking_rate is not None and speaking_rate > 190):
        intent = "summarize"
    else:
        has_digits = any(ch.isdigit() for ch in raw)
        tokenized = re.findall(r"\b[a-z']+\b", lower)
        we_count = sum(1 for t in tokenized if t == "we")
        i_count = sum(1 for t in tokenized if t == "i")
        too_short = len(raw) < 160
        has_metric_words = any(w in lower for w in ["percent", "%", "ms", "latency", "revenue", "users", "kpi", "roi", "errors", "cost"])

        if too_short:
            intent = "clarify"
        elif not has_digits and not has_metric_words:
            intent = "numbers"
        elif we_count > i_count + 2:
            intent = "role"
        elif any(w in lower for w in ["tradeoff", "trade-offs", "decision", "chose", "choice", "versus", "vs", "constraint"]):
            intent = "tradeoff"
        else:
            intent = "impact"

    options = FOLLOW_UP_INTENTS.get(intent, {}).get(style)
    if options:
        return random.choice(options)
    fallback = FOLLOW_UPS.get(style) or FOLLOW_UPS[InterviewerStyle.NEUTRAL]
    return random.choice(fallback)


def _coerce_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def generate_coaching(style: InterviewerStyle, answer: str, metrics: Optional[Dict[str, Any]] = None) -> List[Dict[str, str]]:
    """Heuristic coach that blends content + delivery signals into two actionable tips."""
    metrics = metrics or {}
    raw = answer.strip()
    length = len(raw)
    has_digits = any(ch.isdigit() for ch in raw)
    has_pause_text = "..." in raw or "  " in raw
    fillers_text = sum(raw.lower().count(f) for f in [" um", " uh", " like "])

    speaking_rate = _coerce_float(metrics.get("speakingRate"))
    pause_ratio = _coerce_float(metrics.get("pauseRatio"))
    gaze = _coerce_float(metrics.get("gaze"))
    fillers_metric = _coerce_int(metrics.get("fillers"))
    fillers = fillers_metric if fillers_metric is not None else fillers_text

    candidates: List[Tuple[int, Dict[str, str]]] = []

    def add(priority: int, summary: str, detail: str) -> None:
        candidates.append((priority, {"summary": summary, "detail": detail}))

    # Content fundamentals.
    if length < 80 or (length < 140 and not has_digits):
        add(
            70 if length < 80 else 55,
            "Add a concrete detail",
            "Give one number (scope, latency, users) or one decision you made so impact is unmistakable.",
        )
    if length > 520:
        add(
            45,
            "Lead with a headline",
            "Start with one sentence (what you did + outcome), then 2–3 supporting facts. Stop before you ramble.",
        )

    # Delivery signals (when available).
    if speaking_rate is not None:
        if speaking_rate > 175:
            add(
                80 if speaking_rate > 195 else 65,
                "Slow your pace",
                "Aim for ~120–160 wpm. Add a half‑beat pause after key nouns (tool, metric, outcome).",
            )
        elif speaking_rate < 105 and length >= 120:
            add(
                55,
                "Tighten your tempo",
                "Speed up slightly by shortening sentences. Remove extra setup and get to the decision/result sooner.",
            )

    if pause_ratio is not None:
        if pause_ratio > 0.18:
            add(
                70 if pause_ratio > 0.26 else 55,
                "Reduce long pauses",
                "Take one planning pause before you start, then keep sentences flowing. If you need time, say “Let me think for a second.”",
            )
        elif pause_ratio < 0.05 and speaking_rate and speaking_rate > 165:
            add(
                50,
                "Add deliberate micro-pauses",
                "A tiny pause before your key point makes you sound more confident (and improves comprehension).",
            )

    if gaze is not None and gaze < 60:
        add(
            60 if gaze < 45 else 50,
            "Re-center eye contact",
            "Look at the camera for the first and last sentence. Move your notes closer to the lens to reduce eye travel.",
        )

    if fillers > 1:
        add(
            60 if fillers > 3 else 50,
            "Replace fillers with silence",
            "When you feel “um/like” coming, pause silently and restart the sentence. One clean pause beats three fillers.",
        )
    elif has_pause_text and pause_ratio is None:
        add(
            40,
            "Smooth your pacing",
            "Finish sentences before pausing; keep your eyes steady through the final word.",
        )

    if not candidates:
        add(
            10,
            "Keep the structure",
            "You’re clear and concise. Next answer: add one crisp metric to make it unforgettable.",
        )

    candidates.sort(key=lambda item: item[0], reverse=True)
    tips: List[Dict[str, str]] = []
    seen: set[str] = set()
    for _, tip in candidates:
        if tip["summary"] in seen:
            continue
        tips.append(tip)
        seen.add(tip["summary"])
        if len(tips) >= 2:
            break

    tone_prefix = {
        InterviewerStyle.SUPPORTIVE: "Encouraging: ",
        InterviewerStyle.NEUTRAL: "",
        InterviewerStyle.COLD: "Direct: ",
    }[style]
    return [{**tip, "detail": f"{tone_prefix}{tip['detail']}"} for tip in tips]


def _extract_json_block(text: str) -> Optional[Dict[str, Any]]:
    """Tolerant JSON extraction so we survive code fences or preambles."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
    return None


def parse_coaching_response(text: str) -> Optional[Tuple[Optional[str], List[Dict[str, str]]]]:
    data = _extract_json_block(text)
    if not data:
        return None
    follow_up = (data.get("follow_up") or data.get("followup") or data.get("followUp") or "").strip()
    tips_payload = data.get("tips") or []
    tips: List[Dict[str, str]] = []
    if isinstance(tips_payload, list):
        for item in tips_payload:
            if not isinstance(item, dict):
                continue
            summary = str(item.get("summary") or "").strip()
            detail = str(item.get("detail") or item.get("text") or "").strip()
            if summary and detail:
                tips.append({"summary": summary, "detail": detail})
            if len(tips) >= 2:
                break
    if not follow_up and not tips:
        return None
    return follow_up or None, tips


def parse_question_response(text: str) -> Optional[str]:
    data = _extract_json_block(text)
    question: Optional[str] = None
    if data:
        question = data.get("question") or data.get("prompt") or data.get("text")
    if isinstance(question, list):
        question = " ".join(str(part) for part in question)
    if not isinstance(question, str) or not question:
        # Fall back to interpreting the raw text as the question (helps if the LLM ignored JSON instructions).
        question = (text or "").strip().splitlines()[0] if text else None
    if not question:
        return None
    cleaned = question.strip().strip('"').strip()
    if cleaned and not cleaned.endswith("?"):
        cleaned = f"{cleaned}?"
    return cleaned or None


def parse_clarification_response(text: str) -> Optional[str]:
    data = _extract_json_block(text)
    message: Optional[str] = None
    if data:
        message = data.get("message") or data.get("clarification") or data.get("response") or data.get("text")
    if isinstance(message, list):
        message = " ".join(str(part) for part in message)
    if not isinstance(message, str) or not message.strip():
        message = (text or "").strip()
    cleaned = (message or "").strip()
    return cleaned or None


async def llm_generate_coaching(
    style: InterviewerStyle, question: str, answer: str, turn: int, metrics: Optional[Dict[str, Any]] = None
) -> Optional[Tuple[Optional[str], List[Dict[str, str]]]]:
    api_key = NVIDIA_API_KEY or os.getenv("NVIDIA_API_KEY")
    if not api_key:
        LOG.warning("NVIDIA_API_KEY missing; coaching fallback engaged (style=%s turn=%s)", style, turn)
        return None
    system_prompt = (
        "You are an interview coach speaking as the interviewer. "
        "Respond with JSON only: {\"follow_up\":\"string\",\"tips\":[{\"summary\":\"string\",\"detail\":\"string\"},...]}. "
        "Keep follow_up one sentence, pointed and natural. Return 2 concise, actionable tips that reference delivery "
        "(pacing, confidence, specificity). Tone varies by style: supportive=warm & encouraging; neutral=direct & calm; "
        "cold=pressuring and blunt. Avoid markdown/code fences."
    )
    metrics = metrics or {}
    metrics_block = ", ".join(
        f"{key}={metrics.get(key)}"
        for key in ["speakingRate", "pauseRatio", "gaze", "fillers"]
        if metrics.get(key) is not None
    )
    user_prompt = (
        f"Style: {style.value}\nTurn: {turn}\nQuestion: {question}\nUser answer: {answer}\n"
        f"Delivery signals (if present): {metrics_block or 'None'}\n"
        "Return JSON only."
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "model": NVIDIA_LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": 240,
        "temperature": 0.8,
        "top_p": 1.0,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=NVIDIA_LLM_TIMEOUT) as client:
            LOG.info(
                "Calling NVIDIA LLM (coaching): style=%s turn=%s question_len=%s answer_len=%s",
                style,
                turn,
                len(question),
                len(answer),
            )
            resp = await client.post(NVIDIA_LLM_URL, headers=headers, json=payload)
    except Exception as exc:  # pragma: no cover - network/runtime safety
        LOG.warning("NVIDIA LLM coaching request failed: %s", exc)
        return None

    if resp.status_code != 200:
        LOG.warning("NVIDIA LLM responded with %s (coaching): %s", resp.status_code, resp.text[:200])
        return None

    try:
        data = resp.json()
        choices = data.get("choices") or []
        content = choices[0].get("message", {}).get("content", "").strip() if choices else ""
    except Exception:
        content = ""
    if not content:
        LOG.warning("NVIDIA LLM coaching returned empty content")
        return None
    parsed = parse_coaching_response(content)
    if not parsed:
        LOG.warning("NVIDIA LLM coaching parse failed; raw content: %s", content[:200])
    return parsed


async def llm_generate_question(
    style: InterviewerStyle,
    turn: int,
    previous_question: Optional[str] = None,
    history: Optional[List[Tuple[str, str]]] = None,
    pack: Optional[str] = None,
    difficulty: Optional[str] = None,
) -> Optional[str]:
    api_key = NVIDIA_API_KEY or os.getenv("NVIDIA_API_KEY")
    if not api_key:
        LOG.warning("NVIDIA_API_KEY missing; question fallback engaged (style=%s turn=%s)", style, turn)
        return None
    system_prompt = (
        "You are an interviewer generating the next question. Respond with JSON only: {\"question\":\"string\"}. "
        "Tone varies by style: supportive=warm/encouraging, neutral=calm/direct, cold=pressuring/blunt. "
        "Keep it concise, natural, and behaviorally specific. Avoid code fences or commentary."
    )
    recent_pairs = history[-3:] if history else []
    history_block = "\n".join([f"Q: {q}\nA: {a}" for q, a in recent_pairs]) or "None yet"
    user_prompt = (
        f"Style: {style.value}\n"
        f"Practice pack: {pack or 'default'}\n"
        f"Difficulty: {difficulty or 'standard'}\n"
        f"Turn index (0-based): {turn}\n"
        f"Previous question: {previous_question or 'None'}\n"
        f"Recent Q/A (most recent last):\n{history_block}\n"
        "Give the next single interview question in JSON only. Ask something that logically follows the last answer; avoid repeats."
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "model": NVIDIA_LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": 80,
        "temperature": 0.85,
        "top_p": 1.0,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=NVIDIA_LLM_TIMEOUT) as client:
            LOG.info(
                "Calling NVIDIA LLM (question): style=%s turn=%s prev_len=%s history_pairs=%s",
                style,
                turn,
                len(previous_question or ""),
                len(recent_pairs),
            )
            resp = await client.post(NVIDIA_LLM_URL, headers=headers, json=payload)
    except Exception as exc:  # pragma: no cover - network/runtime safety
        LOG.warning("NVIDIA LLM question request failed: %s", exc)
        return None

    if resp.status_code != 200:
        LOG.warning("NVIDIA LLM question responded with %s: %s", resp.status_code, resp.text[:200])
        return None

    try:
        data = resp.json()
        choices = data.get("choices") or []
        content = choices[0].get("message", {}).get("content", "").strip() if choices else ""
    except Exception:
        content = ""
    if not content:
        LOG.warning("NVIDIA LLM question returned empty content")
        return None
    parsed = parse_question_response(content)
    if not parsed:
        LOG.warning("NVIDIA LLM question parse failed; raw content: %s", content[:200])
    return parsed


async def llm_generate_clarification(
    style: InterviewerStyle,
    prompt_question: str,
    clarification_question: str,
    turn: int,
    history: Optional[List[Tuple[str, str]]] = None,
    pack: Optional[str] = None,
    difficulty: Optional[str] = None,
) -> Optional[str]:
    api_key = NVIDIA_API_KEY or os.getenv("NVIDIA_API_KEY")
    if not api_key:
        LOG.warning("NVIDIA_API_KEY missing; clarification fallback engaged (style=%s turn=%s)", style, turn)
        return None

    system_prompt = (
        "You are an interviewer. The candidate is asking a clarification question about the current interview prompt. "
        "Answer the clarification succinctly (1–3 short sentences) without giving a full solution/model answer. "
        "End by restating the original prompt as one sentence. "
        "Return JSON only: {\"message\":\"string\"}. Avoid markdown/code fences."
    )
    recent_pairs = history[-3:] if history else []
    history_block = "\n".join([f"Q: {q}\nA: {a}" for q, a in recent_pairs]) or "None yet"
    user_prompt = (
        f"Style: {style.value}\n"
        f"Practice pack: {pack or 'default'}\n"
        f"Difficulty: {difficulty or 'standard'}\n"
        f"Turn index (0-based): {turn}\n"
        f"Current prompt: {prompt_question}\n"
        f"Candidate clarification question: {clarification_question}\n"
        f"Recent Q/A (most recent last):\n{history_block}\n"
        "Return JSON only."
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "model": NVIDIA_LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": 180,
        "temperature": 0.5,
        "top_p": 1.0,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=NVIDIA_LLM_TIMEOUT) as client:
            LOG.info(
                "Calling NVIDIA LLM (clarification): style=%s turn=%s prompt_len=%s clarification_len=%s",
                style,
                turn,
                len(prompt_question),
                len(clarification_question),
            )
            resp = await client.post(NVIDIA_LLM_URL, headers=headers, json=payload)
    except Exception as exc:  # pragma: no cover - network/runtime safety
        LOG.warning("NVIDIA LLM clarification request failed: %s", exc)
        return None

    if resp.status_code != 200:
        LOG.warning("NVIDIA LLM responded with %s (clarification): %s", resp.status_code, resp.text[:200])
        return None

    try:
        data = resp.json()
        choices = data.get("choices") or []
        content = choices[0].get("message", {}).get("content", "").strip() if choices else ""
    except Exception:
        content = ""

    if not content:
        LOG.warning("NVIDIA LLM clarification returned empty content")
        return None
    parsed = parse_clarification_response(content)
    if not parsed:
        LOG.warning("NVIDIA LLM clarification parse failed; raw content: %s", content[:200])
    return parsed


app = FastAPI(title="AI Interview Trainer", version="0.1.0")
whisper_model: Optional[WhisperModel] = None
tts_model: Optional[TTS] = None
TTS_SPEAKER = os.getenv("TTS_SPEAKER")
TTS_LANGUAGE = os.getenv("TTS_LANGUAGE", "en")
DEFAULT_TTS_SPEAKER: Optional[str] = None
FALLBACK_TTS_SPEAKER = os.getenv("TTS_FALLBACK_SPEAKER", "Claribel Dervla")
TTS_CACHE_MAX = 32  # simple in-memory LRU for duplicate TTS requests
TTS_CACHE: "OrderedDict[tuple, bytes]" = OrderedDict()
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
NVIDIA_LLM_MODEL = os.getenv("NVIDIA_LLM_MODEL", "meta/llama-4-maverick-17b-128e-instruct")
NVIDIA_LLM_URL = os.getenv("NVIDIA_LLM_URL", "https://integrate.api.nvidia.com/v1/chat/completions")
NVIDIA_LLM_TIMEOUT = float(os.getenv("NVIDIA_LLM_TIMEOUT", "12"))
LOG = logging.getLogger("interview")


@app.on_event("startup")
async def on_startup() -> None:
    await init_db()
    model_size = os.getenv("WHISPER_MODEL", "medium")
    device = os.getenv("WHISPER_DEVICE", "cpu")
    compute_type = os.getenv("WHISPER_COMPUTE_TYPE") or ("float16" if device not in ("cpu", "auto-cpu") else "int8")
    global whisper_model
    try:
        whisper_model = WhisperModel(model_size, device=device, compute_type=compute_type)
        print(f"[whisper] loaded {model_size} on {device} ({compute_type})")
    except Exception as exc:  # pragma: no cover - defensive
        # Fall back to None so the app still boots even if model load fails.
        whisper_model = None
        print(f"[whisper] failed to load model {model_size}: {exc}")

    tts_name = os.getenv("TTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
    tts_device = os.getenv("TTS_DEVICE", device)
    global tts_model, DEFAULT_TTS_SPEAKER, TTS_SPEAKER
    try:
        tts_model = TTS(model_name=tts_name).to(tts_device)
        DEFAULT_TTS_SPEAKER = None
        # Try several ways to discover a default speaker so /tts works out of the box.
        if hasattr(tts_model, "speakers") and tts_model.speakers:
            DEFAULT_TTS_SPEAKER = tts_model.speakers[0]
        elif getattr(tts_model, "speaker_manager", None) and getattr(tts_model.speaker_manager, "speaker_names", None):
            DEFAULT_TTS_SPEAKER = tts_model.speaker_manager.speaker_names[0]
        # Last-resort fallback so /tts never hard-fails on speaker selection.
        if DEFAULT_TTS_SPEAKER is None:
            DEFAULT_TTS_SPEAKER = FALLBACK_TTS_SPEAKER
        if TTS_SPEAKER is None and DEFAULT_TTS_SPEAKER:
            TTS_SPEAKER = DEFAULT_TTS_SPEAKER
        print(f"[tts] loaded {tts_name} on {tts_device}; default speaker={DEFAULT_TTS_SPEAKER}")
    except Exception as exc:
        tts_model = None
        print(f"[tts] failed to load model {tts_name}: {exc}")

# CORS for local dev; adjust allowed origins for prod if needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


class TtsRequest(BaseModel):
    text: str
    style: Optional[str] = None
    speaker: Optional[str] = None
    language: Optional[str] = None


@app.post("/tts")
async def tts_endpoint(payload: TtsRequest) -> Response:
    """Neural TTS via Coqui XTTS; returns WAV bytes."""
    if tts_model is None:
        return Response(content=json.dumps({"error": "tts_not_loaded"}), media_type="application/json", status_code=500)

    text = payload.text.strip()
    if not text:
        return Response(content=json.dumps({"error": "empty_text"}), media_type="application/json", status_code=400)

    style = payload.style or "neutral"
    speed = {"supportive": 1.06, "neutral": 1.0, "cold": 0.94}.get(style, 1.0)
    speaker = payload.speaker or TTS_SPEAKER or DEFAULT_TTS_SPEAKER or FALLBACK_TTS_SPEAKER
    if speaker is None:
        candidates: List[str] = []
        try:
            if hasattr(tts_model, "speakers") and tts_model.speakers:
                candidates = list(tts_model.speakers)
            elif hasattr(tts_model, "speaker_manager") and hasattr(tts_model.speaker_manager, "speaker_names"):
                candidates = list(tts_model.speaker_manager.speaker_names)
        except Exception:
            candidates = []
        if candidates:
            speaker = candidates[0]
        else:
            # Still nothing? use the hard-coded fallback to avoid hard 400s.
            speaker = FALLBACK_TTS_SPEAKER
    cache_key = (text, style, speaker, payload.language or TTS_LANGUAGE, speed)
    if cache_key in TTS_CACHE:
        # Move to end to keep LRU ordering.
        audio_bytes = TTS_CACHE.pop(cache_key)
        TTS_CACHE[cache_key] = audio_bytes
        return Response(content=audio_bytes, media_type="audio/wav")
    try:
        wav = tts_model.tts(
            text=text,
            speaker=speaker,
            language=payload.language or TTS_LANGUAGE,
            speed=speed,
        )
        sample_rate = getattr(tts_model.synthesizer, "output_sample_rate", 24000)
        buf = BytesIO()
        sf.write(buf, wav, sample_rate, format="WAV")
        audio_bytes = buf.getvalue()
        TTS_CACHE[cache_key] = audio_bytes
        if len(TTS_CACHE) > TTS_CACHE_MAX:
            TTS_CACHE.popitem(last=False)
        return Response(content=audio_bytes, media_type="audio/wav")
    except Exception as exc:  # pragma: no cover - runtime safeguard
        logging.error("TTS synthesis failed: %s\n%s", exc, traceback.format_exc())
        return Response(content=json.dumps({"error": f"tts_failed: {exc}"}), media_type="application/json", status_code=500)


@app.post("/stt")
async def transcribe_audio(
    file: UploadFile = File(...),
    session_id: Optional[str] = Form(default=None, alias="sessionId"),
    language: Optional[str] = Form(default=None),
) -> Dict[str, Any]:
    """Speech-to-text via local Whisper (faster-whisper)."""
    if whisper_model is None:
        return {"error": "whisper_not_loaded"}

    started = time.perf_counter()
    suffix = os.path.splitext(file.filename or "audio.webm")[1] or ".webm"
    payload = await file.read()
    if not payload:
        LOG.warning("STT received empty payload (session=%s)", session_id)
        return {"error": "empty_audio"}
    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(payload)
        tmp_path = tmp.name

    transcript = ""
    info_payload: Dict[str, Any] = {}
    try:
        segments, info = whisper_model.transcribe(
            tmp_path,
            beam_size=4,
            language=language or "en",
            vad_filter=True,
            condition_on_previous_text=False,
        )
        texts: List[str] = []
        for seg in segments:
            seg_text = seg.text.strip()
            if seg_text:
                texts.append(seg_text)
        transcript = " ".join(texts).strip()
        info_payload = {"duration": info.duration, "language": info.language, "num_segments": len(texts)}
    except Exception as exc:
        LOG.warning("STT failed: %s", exc)
        return {"error": f"stt_failed: {exc}"}
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    latency_ms = round((time.perf_counter() - started) * 1000, 2)

    if session_id:
        async with get_session() as session:
            group = None
            session_row = await session.get(SessionRecord, session_id)
            if session_row:
                group = session_row.group_name
            session.add(
                TelemetryRecord(
                    session_id=session_id,
                    event_type="stt",
                    latency_ms=latency_ms,
                    group_name=group,
                    payload=json.dumps(
                        {"language": language or info_payload.get("language"), "duration": info_payload.get("duration")}
                    ),
                )
            )
            await session.commit()

    return {
        "transcript": transcript,
        "latency_ms": latency_ms,
        **info_payload,
    }


async def send_question(
    ws: WebSocket,
    state: SessionState,
    override_question: Optional[str] = None,
    source: Optional[str] = None,
) -> None:
    question_source = source or "llm"
    if override_question:
        question = override_question
    else:
        question = await llm_generate_question(state.style, state.turn, state.last_question, state.history, state.pack, state.difficulty)
        if not question:
            question_source = "fallback"
            question = pick_question(state.style, state.turn, state.pack, state.difficulty)
            LOG.info("Question fallback: style=%s turn=%s", state.style, state.turn)

    state.last_question = question
    await ws.send_json(
        {"type": "question", "turn": state.turn, "question": question, "style": state.style, "source": question_source}
    )
    if question_source == "follow_up":
        await ws.send_json(
            {
                "type": "interviewer_message",
                "turn": state.turn,
                "style": state.style,
                "message": question,
            }
        )

    try:
        async with get_session() as session:
            session.add(
                TelemetryRecord(
                    session_id=state.session_id,
                    event_type="question",
                    group_name=state.group,
                    payload=json.dumps(
                        {
                            "turn": state.turn,
                            "answer_turn": state.turn + 1,
                            "question": question,
                            "style": state.style.value,
                            "pack": state.pack,
                            "difficulty": state.difficulty,
                            "source": question_source,
                        }
                    ),
                )
            )
            await session.commit()
    except Exception as exc:
        LOG.warning("Failed to log question telemetry (session=%s): %s", state.session_id, exc)


async def send_reaction(
    ws: WebSocket, state: SessionState, answer: str, question: str, turn: int, metrics: Optional[Dict[str, Any]] = None
) -> Tuple[str, List[Dict[str, str]]]:
    follow_up: Optional[str] = None
    tips: Optional[List[Dict[str, str]]] = None

    llm_result = await llm_generate_coaching(state.style, question, answer, turn, metrics)
    if llm_result:
        follow_up, tips = llm_result

    if not follow_up:
        follow_up = pick_follow_up(state.style, answer, metrics)
        LOG.info("Follow-up fallback: style=%s turn=%s", state.style, turn)
    if not tips:
        tips = generate_coaching(state.style, answer, metrics)
        LOG.info("Tips fallback: style=%s turn=%s", state.style, turn)

    return follow_up or "", tips


async def handle_message(ws: WebSocket, state: SessionState, payload: Dict[str, Any]) -> None:
    msg_type = payload.get("type")
    if not isinstance(msg_type, str):
        await ws.send_json({"type": "error", "message": "Message type must be a string."})
        return
    if msg_type == "start_session":
        # Always mint a fresh session id so "restart" creates a new DB row (no PK collisions).
        state.session_id = str(uuid.uuid4())
        requested_style = payload.get("style")
        group = payload.get("group") or state.group
        requested_pack = payload.get("pack")
        requested_difficulty = payload.get("difficulty")
        state.turn = 0
        state.last_question = None
        state.history = []
        state.awaiting_followup = False
        state.consented = bool(payload.get("consent"))
        state.accent = payload.get("accent")
        state.notes = payload.get("notes")
        if isinstance(requested_pack, str) and requested_pack in QUESTION_PACKS:
            state.pack = requested_pack
        if isinstance(requested_difficulty, str) and requested_difficulty in ("standard", "hard"):
            state.difficulty = requested_difficulty
        if requested_style and requested_style in InterviewerStyle._value2member_map_:
            state.style = InterviewerStyle(requested_style)
        state.group = group
        async with get_session() as session:
            session.add(
                SessionRecord(
                    id=state.session_id,
                    style=state.style.value,
                    group_name=group,
                    consented=state.consented,
                    accent=state.accent,
                    notes=state.notes,
                )
            )
            session.add(
                TelemetryRecord(
                    session_id=state.session_id,
                    event_type="session_meta",
                    group_name=group,
                    payload=json.dumps({"pack": state.pack, "difficulty": state.difficulty}),
                )
            )
            await session.commit()
        await ws.send_json(
            {
                "type": "session_started",
                "session_id": state.session_id,
                "style": state.style,
                "turn": state.turn,
                "group": group,
                "consent": state.consented,
                "pack": state.pack,
                "difficulty": state.difficulty,
            }
        )
        await send_question(ws, state)
        return

    if msg_type == "switch_style":
        new_style = payload.get("style")
        if new_style and new_style in InterviewerStyle._value2member_map_:
            state.style = InterviewerStyle(new_style)
            await ws.send_json({"type": "style_switched", "style": state.style})
            await send_question(ws, state)
        return

    if msg_type == "user_clarification":
        clarification = payload.get("question") or payload.get("clarification") or payload.get("text") or ""
        clarification = str(clarification).strip()
        if not clarification:
            await ws.send_json({"type": "error", "message": "Clarification question is empty."})
            return

        prompt_question = (state.last_question or "").strip()
        if not prompt_question:
            await ws.send_json({"type": "error", "message": "No active prompt yet. Start a session first."})
            return

        prompt_question = prompt_question[:800]
        clarification = clarification[:600]

        if _is_answer_seeking_clarification(clarification):
            source = "guardrail"
            response = refusal_clarification_response(state.style, prompt_question)
        else:
            source = "llm"
            response = await llm_generate_clarification(
                state.style,
                prompt_question=prompt_question,
                clarification_question=clarification,
                turn=state.turn,
                history=state.history,
                pack=state.pack,
                difficulty=state.difficulty,
            )
            if not response:
                source = "fallback"
                response = fallback_clarification_response(
                    state.style,
                    prompt_question=prompt_question,
                    clarification_question=clarification,
                    pack=state.pack,
                    difficulty=state.difficulty,
                )

        await ws.send_json(
            {
                "type": "clarification",
                "turn": state.turn,
                "style": state.style,
                "message": (response or "")[:1400],
                "source": source,
            }
        )
        try:
            async with get_session() as session:
                session.add(
                    TelemetryRecord(
                        session_id=state.session_id,
                        event_type="clarification",
                        group_name=state.group,
                        payload=json.dumps(
                            {
                                "turn": state.turn,
                                "prompt": prompt_question,
                                "clarification": clarification,
                                "source": source,
                            }
                        ),
                    )
                )
                await session.commit()
        except Exception as exc:
            LOG.warning("Failed to log clarification telemetry (session=%s): %s", state.session_id, exc)
        return

    if msg_type == "user_answer":
        answer = payload.get("answer", "")
        asked_question = state.last_question or pick_question(state.style, state.turn, state.pack, state.difficulty)
        state.turn += 1
        turn_label = state.turn  # maintain existing turn numbering for the UI/DB
        metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}
        async with get_session() as session:
            session.add(
                AnswerRecord(
                    session_id=state.session_id,
                    turn=turn_label,
                    answer=answer,
                    style=state.style.value,
                    group_name=state.group,
                    speaking_rate=metrics.get("speakingRate"),
                    pause_ratio=metrics.get("pauseRatio"),
                    gaze=metrics.get("gaze"),
                    fillers=metrics.get("fillers"),
                )
            )
            await session.commit()
        # keep a small rolling history to guide the next question
        state.history.append((asked_question, answer))
        if len(state.history) > 4:
            state.history = state.history[-4:]

        follow_up, tips = await send_reaction(ws, state, answer, asked_question, turn_label, metrics)
        if tips:
            await ws.send_json({"type": "tips", "turn": turn_label, "items": tips})
            try:
                async with get_session() as session:
                    session.add(
                        TelemetryRecord(
                            session_id=state.session_id,
                            event_type="tips",
                            group_name=state.group,
                            payload=json.dumps({"turn": turn_label, "items": tips}),
                        )
                    )
                    await session.commit()
            except Exception as exc:
                LOG.warning("Failed to log tips telemetry (session=%s): %s", state.session_id, exc)

        if state.awaiting_followup:
            # This answer was for a follow-up; resume normal questioning.
            state.awaiting_followup = False
            await send_question(ws, state)
        else:
            # This answer was for the main prompt; if we have a follow-up, ask it and wait for the answer before moving on.
            if follow_up:
                state.awaiting_followup = True
                await send_question(ws, state, override_question=follow_up, source="follow_up")
            else:
                await send_question(ws, state)
        return

    if msg_type == "ping":
        await ws.send_json({"type": "pong"})
        return

    if msg_type == "checkin":
        async with get_session() as session:
            session.add(
                CheckInRecord(
                    session_id=state.session_id,
                    group_name=payload.get("group") or state.group,
                    confidence=int(payload.get("confidence", 0)),
                    stress=int(payload.get("stress", 0)),
                )
            )
            await session.commit()
        await ws.send_json({"type": "checkin_logged"})
        return

    if msg_type == "telemetry":
        async with get_session() as session:
            session.add(
                TelemetryRecord(
                    session_id=state.session_id,
                    event_type=payload.get("event") or "unknown",
                    latency_ms=payload.get("latencyMs"),
                    group_name=state.group,
                    payload=json.dumps(payload.get("data") or {}),
                )
            )
            await session.commit()
        return

    await ws.send_json({"type": "error", "message": f"Unrecognized message type: {msg_type}"})


@app.websocket("/ws/interview")
async def interview_socket(ws: WebSocket) -> None:
    await ws.accept()
    state = SessionState()
    await ws.send_json({"type": "session_ready", "session_id": state.session_id, "style": state.style})

    try:
        while True:
            raw = await ws.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "Payload must be JSON"})
                continue
            if not isinstance(payload, dict):
                await ws.send_json({"type": "error", "message": "Payload must be a JSON object"})
                continue

            await handle_message(ws, state, payload)
            await asyncio.sleep(0)  # yield control
    except WebSocketDisconnect:
        return


class CheckInPayload(BaseModel):
    session_id: str = Field(..., alias="sessionId")
    group: Optional[str] = None
    confidence: int
    stress: int


@app.post("/checkins")
async def log_checkin(payload: CheckInPayload) -> Dict[str, str]:
    async with get_session() as session:
        session.add(
            CheckInRecord(
                session_id=payload.session_id,
                group_name=payload.group,
                confidence=payload.confidence,
                stress=payload.stress,
            )
        )
        await session.commit()
    return {"status": "ok"}


class CommentPayload(BaseModel):
    session_id: str = Field(..., alias="sessionId")
    turn: int
    text: str
    author: Optional[str] = None
    kind: Optional[str] = "comment"  # "comment" | "assignment"


@app.post("/comments")
async def add_comment(payload: CommentPayload) -> Dict[str, str]:
    event_type = "assignment" if payload.kind == "assignment" else "comment"
    async with get_session() as session:
        group = None
        session_row = await session.get(SessionRecord, payload.session_id)
        if session_row:
            group = session_row.group_name
        session.add(
            TelemetryRecord(
                session_id=payload.session_id,
                event_type=event_type,
                group_name=group,
                payload=json.dumps(
                    {
                        "turn": payload.turn,
                        "text": payload.text,
                        "author": payload.author,
                        "kind": payload.kind,
                    }
                ),
            )
        )
        await session.commit()
    return {"status": "ok"}


@app.get("/comments/{session_id}")
async def list_comments(session_id: str) -> Dict[str, Any]:
    async with get_session() as session:
        comments = (
            await session.exec(
                select(TelemetryRecord)
                .where(
                    TelemetryRecord.session_id == session_id,
                    TelemetryRecord.event_type.in_(["comment", "assignment"]),
                )
                .order_by(TelemetryRecord.created_at.asc())
            )
        ).all()
        return {"items": [c.model_dump() for c in comments]}


@app.get("/export/session/{session_id}")
async def export_session(session_id: str) -> Dict[str, Any]:
    async with get_session() as session:
        session_row = await session.get(SessionRecord, session_id)
        answers = (
            await session.exec(select(AnswerRecord).where(AnswerRecord.session_id == session_id))
        ).all()
        checkins = (
            await session.exec(select(CheckInRecord).where(CheckInRecord.session_id == session_id))
        ).all()
        telemetry = (
            await session.exec(select(TelemetryRecord).where(TelemetryRecord.session_id == session_id))
        ).all()

        if not session_row:
            return {"error": "not_found"}

        return {
            "session": session_row.model_dump(),
            "answers": [a.model_dump() for a in answers],
            "checkins": [c.model_dump() for c in checkins],
            "telemetry": [t.model_dump() for t in telemetry],
        }


@app.get("/sessions")
async def list_sessions(limit: int = 20) -> Dict[str, Any]:
    limit = max(1, min(int(limit), 100))

    def mean(values: List[Optional[float]]) -> Optional[float]:
        vals = [v for v in values if v is not None]
        return sum(vals) / len(vals) if vals else None

    async with get_session() as session:
        sessions = (
            await session.exec(select(SessionRecord).order_by(SessionRecord.created_at.desc()).limit(limit))
        ).all()

        items: List[Dict[str, Any]] = []
        for row in sessions:
            answers = (
                await session.exec(select(AnswerRecord).where(AnswerRecord.session_id == row.id))
            ).all()
            last_answer_at = max((a.created_at for a in answers), default=None)
            items.append(
                {
                    **row.model_dump(),
                    "n_answers": len(answers),
                    "last_turn": max((a.turn for a in answers), default=0),
                    "last_answer_at": last_answer_at,
                    "avg_speaking_rate": mean([a.speaking_rate for a in answers]),
                    "avg_pause_ratio": mean([a.pause_ratio for a in answers]),
                    "avg_gaze": mean([a.gaze for a in answers]),
                    "avg_fillers": mean([float(a.fillers) if a.fillers is not None else None for a in answers]),
                }
            )

        return {"items": items}


@app.get("/metrics/summary")
async def metrics_summary() -> Dict[str, Any]:
    async with get_session() as session:
        stats: Dict[str, Dict[str, Any]] = {}
        for group in ["control", "treatment"]:
            answers = (
                await session.exec(select(AnswerRecord).where(AnswerRecord.group_name == group))
            ).all()
            checkins = (
                await session.exec(select(CheckInRecord).where(CheckInRecord.group_name == group))
            ).all()
            telemetry = (
                await session.exec(
                    select(TelemetryRecord).where(
                        TelemetryRecord.event_type == "latency", TelemetryRecord.group_name == group
                    )
                )
            ).all()
            stt_events = (
                await session.exec(
                    select(TelemetryRecord).where(
                        TelemetryRecord.event_type == "stt", TelemetryRecord.group_name == group
                    )
                )
            ).all()

            def mean(values: List[Optional[float]]) -> Optional[float]:
                vals = [v for v in values if v is not None]
                return sum(vals) / len(vals) if vals else None

            stats[group] = {
                "n_answers": len(answers),
                "n_checkins": len(checkins),
                "n_latency": len(telemetry),
                "n_stt": len(stt_events),
                "avg_speaking_rate": mean([a.speaking_rate for a in answers]),
                "avg_pause_ratio": mean([a.pause_ratio for a in answers]),
                "avg_gaze": mean([a.gaze for a in answers]),
                "avg_fillers": mean([float(a.fillers) if a.fillers is not None else None for a in answers]),
                "avg_confidence": mean([float(c.confidence) for c in checkins]),
                "avg_stress": mean([float(c.stress) for c in checkins]),
                "avg_latency_ms": mean([t.latency_ms for t in telemetry]),
                "avg_stt_latency_ms": mean([t.latency_ms for t in stt_events]),
            }

        def delta(key: str) -> Optional[float]:
            t = stats["treatment"].get(key)
            c = stats["control"].get(key)
            if t is None or c is None:
                return None
            return t - c

        return {
            "groups": stats,
            "delta": {
                "speaking_rate": delta("avg_speaking_rate"),
                "pause_ratio": delta("avg_pause_ratio"),
                "gaze": delta("avg_gaze"),
                "fillers": delta("avg_fillers"),
                "confidence": delta("avg_confidence"),
                "stress": delta("avg_stress"),
            },
        }
