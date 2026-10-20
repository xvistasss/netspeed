import type { RefObject } from "react";
import type { TestPhase, SpeedStats } from "../../types";
import { formatSpeed } from "../../utils";
import InfoTooltip from "../atoms/InfoTooltip";

interface ThroughputCardProps {
  phase: TestPhase;
  downloadStats: SpeedStats;
  uploadStats: SpeedStats;
  downloadChartRef: RefObject<HTMLCanvasElement | null>;
  uploadChartRef: RefObject<HTMLCanvasElement | null>;
}

export default function ThroughputCard({
  phase,
  downloadStats,
  uploadStats,
  downloadChartRef,
  uploadChartRef,
}: ThroughputCardProps) {
  const currentDlSpeed = formatSpeed(downloadStats.current);
  const avgDlSpeed = formatSpeed(downloadStats.avg);
  const peakDlSpeed = formatSpeed(downloadStats.peak);

  const currentUlSpeed = formatSpeed(uploadStats.current);
  const avgUlSpeed = formatSpeed(uploadStats.avg);
  const peakUlSpeed = formatSpeed(uploadStats.peak);

  return (
    <div className="md:col-span-8 flex flex-col bg-canvas border border-hairline rounded-lg shadow-xs overflow-hidden">
      {/* Download Section */}
      <div className="p-5 md:p-6">
        <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-2">
          <span>DOWNLOAD</span>
          <InfoTooltip content="Speed at which data transfers from the internet to your device." />
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
            {phase === "download"
              ? currentDlSpeed.value
              : downloadStats.avg > 0
                ? avgDlSpeed.value
                : "0.0"}
          </span>
          <span className="text-xl text-mute font-mono">
            {phase === "download"
              ? currentDlSpeed.unit
              : downloadStats.avg > 0
                ? avgDlSpeed.unit
                : "Mbps"}
          </span>
        </div>
        <div className="h-40 md:h-44 relative w-full border border-hairline bg-canvas-soft rounded-md overflow-hidden p-2">
          <canvas ref={downloadChartRef} />
          {(phase === "idle" || phase === "routing" || phase === "ping") && (
            <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-[10px] font-mono text-mute text-center p-4">
              Chart starts drawing during download test.
            </div>
          )}
        </div>
        <div className="flex justify-between items-center text-xs font-mono border-t border-hairline pt-3 mt-3 text-mute">
          <span>Peak Speed:</span>
          <span className="font-semibold text-ink tabular-nums">
            {downloadStats.peak > 0 ? `${peakDlSpeed.value} ${peakDlSpeed.unit}` : "-"}
          </span>
        </div>
      </div>

      <hr className="border-hairline mx-5" />

      {/* Upload Section */}
      <div className="p-5 md:p-6">
        <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-2">
          <span>UPLOAD</span>
          <InfoTooltip content="Speed at which data transfers from your device to the internet." />
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
            {phase === "upload"
              ? currentUlSpeed.value
              : uploadStats.avg > 0
                ? avgUlSpeed.value
                : "0.0"}
          </span>
          <span className="text-xl text-mute font-mono">
            {phase === "upload"
              ? currentUlSpeed.unit
              : uploadStats.avg > 0
                ? avgUlSpeed.unit
                : "Mbps"}
          </span>
        </div>
        <div className="h-40 md:h-44 relative w-full border border-hairline bg-canvas-soft rounded-md overflow-hidden p-2">
          <canvas ref={uploadChartRef} />
          {(phase === "idle" ||
            phase === "routing" ||
            phase === "ping" ||
            phase === "download") && (
            <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-[10px] font-mono text-mute text-center p-4">
              Chart starts drawing during upload test.
            </div>
          )}
        </div>
        <div className="flex justify-between items-center text-xs font-mono border-t border-hairline pt-3 mt-3 text-mute">
          <span>Peak Speed:</span>
          <span className="font-semibold text-ink tabular-nums">
            {uploadStats.peak > 0 ? `${peakUlSpeed.value} ${peakUlSpeed.unit}` : "-"}
          </span>
        </div>
      </div>
    </div>
  );
}
