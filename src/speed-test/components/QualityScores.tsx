import InfoTooltip from "./atoms/InfoTooltip";

import type { TestPhase } from "../types";
import { computeQualityScore, getCategoryScores, type UseCase } from "../utils";
import { Check, Minus, X } from "lucide-react";

interface QualityScoresProps {
  phase: TestPhase;
  downloadAvg: number; // bps
  uploadAvg: number; // bps
  latencyAvg: number; // ms
  latencyJitter: number; // ms
  packetLossPercent?: number; // %
  useCase?: UseCase;
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
    ? getCategoryScores(dlMbps, ulMbps, latencyAvg, latencyJitter, packetLossPercent, score?.total ?? 0)
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
        <InfoTooltip content="Composite score from download (30), upload (30), latency (20), jitter (10), and packet loss (10). Grades: Excellent 90+, Good 70+, Fair 50+, Poor 25+, Critical below 25. Category ratings gate Great on score >= 70 and Good on score >= 50 to stay consistent with the grade." />
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
                  <div className="h-full bg-accent-download rounded-full transition-[width] duration-500" style={{ width: `${(score.dlScore / 30) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{Math.round(score.dlScore)}/30</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-mute">
                <span className="w-16">Upload</span>
                <div className="flex-1 bg-canvas-soft-2 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-accent-upload rounded-full transition-[width] duration-500" style={{ width: `${(score.ulScore / 30) * 100}%` }} />
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
