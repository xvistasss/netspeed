import InfoTooltip from "./InfoTooltip";
import type { TestPhase } from "../../utils/speedTestUtils";

interface QualityScoresProps {
  phase: TestPhase;
  downloadAvg: number; // bps
  uploadAvg: number; // bps
  latencyAvg: number; // ms
  latencyJitter: number; // ms
  packetLossPercent?: number; // %
}

// Compute a 0-100 network quality score from raw metrics.
// Components: download (30), upload (30), latency (20), jitter (10), packet loss (10).
function computeQualityScore(
  dlMbps: number,
  ulMbps: number,
  latencyMs: number,
  jitterMs: number,
  lossPct: number,
): { total: number; grade: string; gradeColor: string; dlScore: number; ulScore: number; latScore: number; jitScore: number; lossScore: number } {
  // Download: 100 Mbps = perfect (30 pts)
  const dlScore = Math.min(30, (dlMbps / 100) * 30);
  // Upload: 50 Mbps = perfect (30 pts)
  const ulScore = Math.min(30, (ulMbps / 50) * 30);
  // Latency: 0ms = 20 pts, 200ms+ = 0
  const latScore = Math.max(0, 20 * (1 - latencyMs / 200));
  // Jitter: 0ms = 10 pts, 50ms+ = 0
  const jitScore = Math.max(0, 10 * (1 - jitterMs / 50));
  // Packet loss: 0% = 10 pts, 5%+ = 0
  const lossScore = Math.max(0, 10 * (1 - lossPct / 5));

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
    streaming: { rating: streamingRating, color: streamingColor },
    gaming: { rating: gamingRating, color: gamingColor },
    chatting: { rating: chattingRating, color: chattingColor },
  };
}

export default function QualityScores({
  phase,
  downloadAvg,
  uploadAvg,
  latencyAvg,
  latencyJitter,
  packetLossPercent = 0,
}: QualityScoresProps) {
  const dlMbps = downloadAvg / 1_000_000;
  const ulMbps = uploadAvg / 1_000_000;
  const hasData = phase !== "idle" && phase !== "routing";

  const score = hasData
    ? computeQualityScore(dlMbps, ulMbps, latencyAvg, latencyJitter, packetLossPercent)
    : null;

  const categories = hasData
    ? getCategoryScores(dlMbps, ulMbps, latencyAvg, latencyJitter)
    : {
        streaming: { rating: "\u2014", color: "text-mute" },
        gaming: { rating: "\u2014", color: "text-mute" },
        chatting: { rating: "\u2014", color: "text-mute" },
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
        <InfoTooltip content="Composite 0\u2013100 score from download (30), upload (30), latency (20), jitter (10), and packet loss (10). Grades: Excellent 90+, Good 70+, Fair 50+, Poor 25+, Critical <25." />
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-8">
        {/* Circular gauge */}
        <div className="relative flex-shrink-0">
          <svg width="130" height="130" viewBox="0 0 120 120">
            {/* Background track */}
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="#ebebeb"
              strokeWidth="8"
            />
            {/* Score arc */}
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke={score ? (score.total >= 70 ? "#0070f3" : score.total >= 50 ? "#f5a623" : "#ee0000") : "#ebebeb"}
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
          {/* Grade badge */}
          {score && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-mute uppercase tracking-wider">Grade:</span>
              <span className={`text-sm font-bold ${score.gradeColor}`}>{score.grade}</span>
            </div>
          )}

          {/* Category ratings */}
          <div className="grid grid-cols-3 gap-4 text-center divide-x divide-hairline">
            <div className="px-2 flex flex-col gap-1">
              <span className="text-[10px] font-mono text-mute uppercase tracking-wider">
                Streaming
              </span>
              <span className={`text-sm font-bold transition-colors duration-150 ${categories.streaming.color}`}>
                {categories.streaming.rating}
              </span>
            </div>
            <div className="px-2 flex flex-col gap-1">
              <span className="text-[10px] font-mono text-mute uppercase tracking-wider">
                Gaming
              </span>
              <span className={`text-sm font-bold transition-colors duration-150 ${categories.gaming.color}`}>
                {categories.gaming.rating}
              </span>
            </div>
            <div className="px-2 flex flex-col gap-1">
              <span className="text-[10px] font-mono text-mute uppercase tracking-wider">
                Video Chat
              </span>
              <span className={`text-sm font-bold transition-colors duration-150 ${categories.chatting.color}`}>
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
