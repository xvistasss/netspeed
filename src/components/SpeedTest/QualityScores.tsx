import InfoTooltip from "./InfoTooltip";
import type { TestPhase } from "../../utils/speedTestUtils";
import { Check, Minus, X } from "lucide-react";

interface QualityScoresProps {
  phase: TestPhase;
  downloadAvg: number; // bps
  uploadAvg: number; // bps
  latencyAvg: number; // ms
  latencyJitter: number; // ms
  packetLossPercent?: number; // %
  useCase?: "gaming" | "streaming" | "general";
}

// Compute a 0-100 network quality score from raw metrics.
// Components: download (30), upload (30), latency (20), jitter (10), packet loss (10).
// Supports useCase parameter for tailored scoring (gaming/streaming/general)
function computeQualityScore(
  dlMbps: number,
  ulMbps: number,
  latencyMs: number,
  jitterMs: number,
  lossPct: number,
  useCase: "gaming" | "streaming" | "general" = "general",
): { total: number; grade: string; gradeColor: string; dlScore: number; ulScore: number; latScore: number; jitScore: number; lossScore: number } {
  // Weight adjustments based on use case
  let dlWeight = 30, ulWeight = 30, latWeight = 20, jitWeight = 10, lossWeight = 10;
  if (useCase === "gaming") {
    dlWeight = 15; ulWeight = 10; latWeight = 40; jitWeight = 25; lossWeight = 10;
  } else if (useCase === "streaming") {
    dlWeight = 50; ulWeight = 10; latWeight = 15; jitWeight = 10; lossWeight = 15;
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
  if (total >= 90) { grade = "Excellent"; gradeColor = "text-link"; }
  else if (total >= 70) { grade = "Good"; gradeColor = "text-link"; }
  else if (total >= 50) { grade = "Fair"; gradeColor = "text-warning-deep"; }
  else if (total >= 25) { grade = "Poor"; gradeColor = "text-error"; }
  else { grade = "Critical"; gradeColor = "text-error"; }

  return { total, grade, gradeColor, dlScore, ulScore, latScore, jitScore, lossScore };
}

// Compute per-category ratings using the same metrics
function getCategoryScores(
  dlMbps: number,
  ulMbps: number,
  latencyMs: number,
  jitterMs: number,
) {
  // Video Streaming: needs download >= 25 Mbps, latency < 100ms
  let streamingRating = "Evaluating\u2026";
  let streamingColor = "text-mute";
  if (dlMbps > 0) {
    if (dlMbps >= 25 && latencyMs < 100) {
      streamingRating = "Great";
      streamingColor = "text-link";
    } else if (dlMbps >= 5) {
      streamingRating = "Good";
      streamingColor = "text-link";
    } else {
      streamingRating = "Bad";
      streamingColor = "text-error";
    }
  }

  // Online Gaming: needs latency < 30ms, jitter < 10ms
  let gamingRating = "Evaluating\u2026";
  let gamingColor = "text-mute";
  if (latencyMs > 0 || jitterMs > 0) {
    if (latencyMs <= 30 && jitterMs <= 10) {
      gamingRating = "Great";
      gamingColor = "text-link";
    } else if (latencyMs <= 80 && jitterMs <= 30) {
      gamingRating = "Good";
      gamingColor = "text-link";
    } else {
      gamingRating = "Bad";
      gamingColor = "text-error";
    }
  }

  // Video Chatting: needs both upload and download, low latency
  let chattingRating = "Evaluating\u2026";
  let chattingColor = "text-mute";
  if (dlMbps > 0 || ulMbps > 0 || latencyMs > 0) {
    const meetsSpeed = (dlMbps === 0 || dlMbps >= 4) && (ulMbps === 0 || ulMbps >= 1.5);
    const meetsLatency = latencyMs === 0 || latencyMs <= 120;
    if (meetsSpeed && meetsLatency) {
      chattingRating = dlMbps >= 10 && ulMbps >= 3 && latencyMs <= 50 ? "Great" : "Good";
      chattingColor = "text-link";
    } else {
      chattingRating = "Bad";
      chattingColor = "text-error";
    }
  }

  return {
    streaming: { rating: streamingRating, color: streamingColor, icon: streamingRating === "Great" ? "check" : streamingRating === "Good" ? "minus" : "x" },
    gaming: { rating: gamingRating, color: gamingColor, icon: gamingRating === "Great" ? "check" : gamingRating === "Good" ? "minus" : "x" },
    chatting: { rating: chattingRating, color: chattingColor, icon: chattingRating === "Great" ? "check" : chattingRating === "Good" ? "minus" : "x" },
  };
}

export default function QualityScores({
  phase,
  downloadAvg,
  uploadAvg,
  latencyAvg,
  latencyJitter,
  packetLossPercent = 0,
  useCase = "general",
}: QualityScoresProps) {
  const dlMbps = downloadAvg / 1_000_000;
  const ulMbps = uploadAvg / 1_000_000;
  const hasData = phase !== "idle" && phase !== "routing";

  const score = hasData
    ? computeQualityScore(dlMbps, ulMbps, latencyAvg, latencyJitter, packetLossPercent, useCase)
    : null;

  const categories = hasData
    ? getCategoryScores(dlMbps, ulMbps, latencyAvg, latencyJitter)
    : {
      streaming: { rating: "\u2014", color: "text-mute", icon: null },
      gaming: { rating: "\u2014", color: "text-mute", icon: null },
      chatting: { rating: "\u2014", color: "text-mute", icon: null },
    };

  // Stroke-dasharray for the circular gauge (r=54, circumference ~339.3)
  const circumference = 2 * Math.PI * 54;
  const dashOffset = score
    ? circumference * (1 - score.total / 100)
    : circumference;

  return (
    <div className="bg-canvas border border-hairline p-6 rounded-lg shadow-xs">
      <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-4 pb-2 border-b border-hairline">
        <span>NETWORK QUALITY SCORE</span>
        <InfoTooltip content="Composite score from download (30), upload (30), latency (20), jitter (10), and packet loss (10). Grades: Excellent 90+, Good 70+, Fair 50+, Poor 25+, Critical below 25." />
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-8">
        {/* Circular gauge */}
        <div className="relative flex-shrink-0">
          <svg width="130" height="130" viewBox="0 0 120 120" role="img" aria-label={score ? `Network quality score: ${score.total} out of 100. Grade: ${score.grade}` : "Network quality score"}>
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="var(--color-hairline)"
              strokeWidth="8"
            />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke={score ? (score.total >= 70 ? "#0070f3" : score.total >= 50 ? "#f5a623" : "#ee0000") : "var(--color-hairline)"}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 60 60)"
              className="transition-[stroke-dashoffset,stroke] duration-700 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
              {score ? score.total : "\u2014"}
            </span>
            <span className="text-[10px] font-mono text-mute uppercase">
              {score ? "/ 100" : "score"}
            </span>
          </div>
        </div>

        {/* Category breakdown + grade */}
        <div className="flex flex-col gap-4 flex-1 w-full">
          {score && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-mute uppercase tracking-wider">Grade:</span>
              <span className={`text-sm font-bold ${score.gradeColor}`}>{score.grade}</span>
            </div>
          )}

          {/* Category ratings */}
          <div className="grid grid-cols-3 gap-4 text-center divide-x divide-hairline">
            <div className="px-2 flex flex-col gap-1">
              <span className="text-[10px] font-mono text-mute uppercase tracking-wider">Streaming</span>
              <span className={`text-sm font-bold transition-colors duration-150 flex items-center justify-center gap-1 ${categories.streaming.color}`}>
                {categories.streaming.icon === "check" && <Check className="w-3.5 h-3.5" />}
                {categories.streaming.icon === "minus" && <Minus className="w-3.5 h-3.5" />}
                {categories.streaming.icon === "x" && <X className="w-3.5 h-3.5" />}
                {categories.streaming.rating}
              </span>
            </div>
            <div className="px-2 flex flex-col gap-1">
              <span className="text-[10px] font-mono text-mute uppercase tracking-wider">Gaming</span>
              <span className={`text-sm font-bold transition-colors duration-150 flex items-center justify-center gap-1 ${categories.gaming.color}`}>
                {categories.gaming.icon === "check" && <Check className="w-3.5 h-3.5" />}
                {categories.gaming.icon === "minus" && <Minus className="w-3.5 h-3.5" />}
                {categories.gaming.icon === "x" && <X className="w-3.5 h-3.5" />}
                {categories.gaming.rating}
              </span>
            </div>
            <div className="px-2 flex flex-col gap-1">
              <span className="text-[10px] font-mono text-mute uppercase tracking-wider">Video Chat</span>
              <span className={`text-sm font-bold transition-colors duration-150 flex items-center justify-center gap-1 ${categories.chatting.color}`}>
                {categories.chatting.icon === "check" && <Check className="w-3.5 h-3.5" />}
                {categories.chatting.icon === "minus" && <Minus className="w-3.5 h-3.5" />}
                {categories.chatting.icon === "x" && <X className="w-3.5 h-3.5" />}
                {categories.chatting.rating}
              </span>
            </div>
          </div>

          {/* Component breakdown bar */}
          {score && (
            <div className="flex flex-col gap-1.5 mt-1">
              <div className="flex items-center gap-2 text-[10px] font-mono text-mute">
                <span className="w-16">Download</span>
                <div className="flex-1 bg-canvas-soft-2 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-[#eb6f20] rounded-full transition-[width] duration-500" style={{ width: `${(score.dlScore / 30) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{Math.round(score.dlScore)}/30</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-mute">
                <span className="w-16">Upload</span>
                <div className="flex-1 bg-canvas-soft-2 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-[#8b5cf6] rounded-full transition-[width] duration-500" style={{ width: `${(score.ulScore / 30) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{Math.round(score.ulScore)}/30</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-mute">
                <span className="w-16">Latency</span>
                <div className="flex-1 bg-canvas-soft-2 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-success rounded-full transition-[width] duration-500" style={{ width: `${(score.latScore / 20) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{Math.round(score.latScore)}/20</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-mute">
                <span className="w-16">Jitter</span>
                <div className="flex-1 bg-canvas-soft-2 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-warning rounded-full transition-[width] duration-500" style={{ width: `${(score.jitScore / 10) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{Math.round(score.jitScore)}/10</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-mute">
                <span className="w-16">Loss</span>
                <div className="flex-1 bg-canvas-soft-2 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-error rounded-full transition-[width] duration-500" style={{ width: `${(score.lossScore / 10) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{Math.round(score.lossScore)}/10</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
