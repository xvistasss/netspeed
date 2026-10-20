import type { QualityScoreResult } from "../types";

export type UseCase = "gaming" | "streaming" | "general";

export interface CategoryRating {
  rating: string;
  color: string;
  icon: "check" | "minus" | "x";
}

export interface CategoryScoresResult {
  streaming: CategoryRating;
  gaming: CategoryRating;
  chatting: CategoryRating;
}

/**
 * Compute a 0-100 network quality score from raw metrics.
 * Components: download (30), upload (30), latency (20), jitter (10), packet loss (10).
 * Supports useCase parameter for tailored scoring (gaming/streaming/general)
 */
export function computeQualityScore(
  dlMbps: number,
  ulMbps: number,
  latencyMs: number,
  jitterMs: number,
  lossPct: number,
  useCase: UseCase = "general",
): QualityScoreResult {
  let dlWeight = 30;
  let ulWeight = 30;
  let latWeight = 20;
  let jitWeight = 10;
  let lossWeight = 10;

  if (useCase === "gaming") {
    dlWeight = 15;
    ulWeight = 10;
    latWeight = 40;
    jitWeight = 25;
    lossWeight = 10;
  } else if (useCase === "streaming") {
    dlWeight = 50;
    ulWeight = 10;
    latWeight = 15;
    jitWeight = 10;
    lossWeight = 15;
  }

  // Download: 100 Mbps = perfect
  const dlScore = Math.min(dlWeight, (dlMbps / 100) * dlWeight);
  // Upload: 50 Mbps = perfect
  const ulScore = Math.min(ulWeight, (ulMbps / 50) * ulWeight);
  // Latency: 0ms = full score, 200ms+ = 0
  const latScore = Math.max(0, latWeight * (1 - latencyMs / 200));
  // Jitter: 0ms = full score, 50ms+ = 0
  const jitScore = Math.max(0, jitWeight * (1 - jitterMs / 50));
  // Packet loss: 0% = full score, 5%+ = 0
  const lossScore = Math.max(0, lossWeight * (1 - lossPct / 5));

  const total = Math.round(dlScore + ulScore + latScore + jitScore + lossScore);

  let grade: string;
  let gradeColor: string;
  if (total >= 90) {
    grade = "Excellent";
    gradeColor = "text-link";
  } else if (total >= 70) {
    grade = "Good";
    gradeColor = "text-link";
  } else if (total >= 50) {
    grade = "Fair";
    gradeColor = "text-warning-deep";
  } else if (total >= 25) {
    grade = "Poor";
    gradeColor = "text-error";
  } else {
    grade = "Critical";
    gradeColor = "text-error";
  }

  return { total, grade, gradeColor, dlScore, ulScore, latScore, jitScore, lossScore };
}

/**
 * Compute per-category ratings using the same metrics.
 * Categories gate both "Great" and "Good" on the overall composite score so
 * ratings are consistent with the grade: Great requires >= 70 (Good tier),
 * Good requires >= 50 (Fair tier). Prevents the paradox of all categories
 * showing Good while the overall grade is Poor.
 */
export function getCategoryScores(
  dlMbps: number,
  ulMbps: number,
  latencyMs: number,
  jitterMs: number,
  lossPct: number,
  overallScore: number,
): CategoryScoresResult {
  const isGreatEligible = overallScore >= 70;
  const isGoodEligible = overallScore >= 50;

  // Video Streaming: needs download, low latency, stable connection
  let streamingRating = "Evaluating...";
  let streamingColor = "text-mute";
  if (dlMbps > 0) {
    if (
      dlMbps >= 25 &&
      latencyMs < 100 &&
      jitterMs < 15 &&
      lossPct < 2 &&
      isGreatEligible
    ) {
      streamingRating = "Great";
      streamingColor = "text-link";
    } else if (dlMbps >= 5 && latencyMs < 150 && jitterMs < 30 && lossPct < 5 && isGoodEligible) {
      streamingRating = "Good";
      streamingColor = "text-link";
    } else {
      streamingRating = "Bad";
      streamingColor = "text-error";
    }
  }

  // Online Gaming: needs latency, jitter, and zero packet loss
  let gamingRating = "Evaluating...";
  let gamingColor = "text-mute";
  if (latencyMs > 0 || jitterMs > 0) {
    if (
      latencyMs <= 40 &&
      jitterMs <= 10 &&
      lossPct < 1 &&
      isGreatEligible
    ) {
      gamingRating = "Great";
      gamingColor = "text-link";
    } else if (latencyMs <= 90 && jitterMs <= 30 && lossPct < 3 && isGoodEligible) {
      gamingRating = "Good";
      gamingColor = "text-link";
    } else {
      gamingRating = "Bad";
      gamingColor = "text-error";
    }
  }

  // Video Chatting: needs both upload and download, low latency, stable line
  let chattingRating = "Evaluating...";
  let chattingColor = "text-mute";
  if (dlMbps > 0 || ulMbps > 0 || latencyMs > 0) {
    const meetsSpeed = dlMbps >= 4 && ulMbps >= 1.5;
    const meetsLatency = latencyMs <= 120;
    const meetsStability = lossPct < 3;
    if (meetsSpeed && meetsLatency && meetsStability && isGoodEligible) {
      if (
        dlMbps >= 10 &&
        ulMbps >= 3 &&
        latencyMs <= 50 &&
        jitterMs <= 15 &&
        lossPct < 1 &&
        isGreatEligible
      ) {
        chattingRating = "Great";
      } else {
        chattingRating = "Good";
      }
      chattingColor = "text-link";
    } else {
      chattingRating = "Bad";
      chattingColor = "text-error";
    }
  }

  return {
    streaming: {
      rating: streamingRating,
      color: streamingColor,
      icon: streamingRating === "Great" ? "check" : streamingRating === "Good" ? "minus" : "x",
    },
    gaming: {
      rating: gamingRating,
      color: gamingColor,
      icon: gamingRating === "Great" ? "check" : gamingRating === "Good" ? "minus" : "x",
    },
    chatting: {
      rating: chattingRating,
      color: chattingColor,
      icon: chattingRating === "Great" ? "check" : chattingRating === "Good" ? "minus" : "x",
    },
  };
}
