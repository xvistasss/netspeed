import { Wifi, Activity, AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import type { TestPhase, LatencyStats, DetailPingStats, IcmpSource } from "../../types";
import InfoTooltip from "../atoms/InfoTooltip";

interface MetricsStackProps {
  phase: TestPhase;
  latencyStats: LatencyStats;
  packetLoss: number;
  icmpEstimate: number;
  icmpSource: IcmpSource;
  icmpOffsetApplied: number;
  unloadedPingStats: DetailPingStats;
  dlLoadedPingStats: DetailPingStats;
  ulLoadedPingStats: DetailPingStats;
  dlLoadedLatency: number;
  dlLoadedJitter: number;
  ulLoadedLatency: number;
  ulLoadedJitter: number;
}

export default function MetricsStack({
  phase,
  latencyStats,
  packetLoss,
  icmpEstimate,
  icmpSource,
  icmpOffsetApplied,
  unloadedPingStats,
  dlLoadedPingStats,
  ulLoadedPingStats,
  dlLoadedLatency,
  dlLoadedJitter,
  ulLoadedLatency,
  ulLoadedJitter,
}: MetricsStackProps) {
  return (
    <div className="md:col-span-4 flex flex-col gap-4">
      {/* Latency */}
      <div className="bg-canvas border border-hairline p-4 rounded-lg shadow-xs flex-1">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
            <span>LATENCY</span>
            <InfoTooltip content="Round-trip HTTP response time. Lower is better for real-time applications." />
          </div>
          <Wifi className="w-4 h-4 text-mute" aria-hidden="true" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
            {unloadedPingStats.latencies.length > 0 ? latencyStats.avg.toFixed(1) : "-"}
          </span>
          <span className="text-xs text-mute font-mono">ms</span>
        </div>
        {icmpEstimate > 0 && (
          <div className="text-[10px] text-mute font-mono mt-1">
            Est. ICMP: ~{icmpEstimate.toFixed(1)} ms
            {icmpSource === "webrtc" ? (
              <span className="text-[9px] text-[#0070f3]"> (via WebRTC UDP)</span>
            ) : (
              <span className="text-[9px]"> (via HTTP -{icmpOffsetApplied}ms)</span>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 mt-3 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
          <div className="flex items-center gap-1">
            <ArrowDown className="w-3.5 h-3.5 text-accent-download" aria-hidden="true" />
            <span>
              Down:{" "}
              <span className="font-semibold text-ink tabular-nums">
                {dlLoadedPingStats.latencies.length > 0 ? `${dlLoadedLatency.toFixed(0)} ms` : "-"}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ArrowUp className="w-3.5 h-3.5 text-accent-upload" aria-hidden="true" />
            <span>
              Up:{" "}
              <span className="font-semibold text-ink tabular-nums">
                {ulLoadedPingStats.latencies.length > 0 ? `${ulLoadedLatency.toFixed(0)} ms` : "-"}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Jitter */}
      <div className="bg-canvas border border-hairline p-4 rounded-lg shadow-xs flex-1">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
            <span>JITTER (RMS)</span>
            <InfoTooltip content="Root Mean Square of successive latency differences. Lower jitter means more stable connections." />
          </div>
          <Activity className="w-4 h-4 text-mute" aria-hidden="true" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
            {unloadedPingStats.latencies.length > 1 ? latencyStats.jitter.toFixed(1) : "-"}
          </span>
          <span className="text-xs text-mute font-mono">ms</span>
        </div>
        <div className="grid grid-cols-1 gap-2 mt-3 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
          <div className="flex items-center gap-1">
            <ArrowDown className="w-3.5 h-3.5 text-accent-download" aria-hidden="true" />
            <span>
              Down:{" "}
              <span className="font-semibold text-ink tabular-nums">
                {dlLoadedPingStats.latencies.length > 1 ? `${dlLoadedJitter.toFixed(0)} ms` : "-"}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ArrowUp className="w-3.5 h-3.5 text-accent-upload" aria-hidden="true" />
            <span>
              Up:{" "}
              <span className="font-semibold text-ink tabular-nums">
                {ulLoadedPingStats.latencies.length > 1 ? `${ulLoadedJitter.toFixed(0)} ms` : "-"}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Packet Loss */}
      <div className="bg-canvas border border-hairline p-4 rounded-lg shadow-xs flex-1">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
            <span>PACKET LOSS</span>
            <InfoTooltip content="HTTP request failures during dedicated ping phase. TCP retransmits mask raw network loss." />
          </div>
          <AlertTriangle className="w-4 h-4 text-mute" aria-hidden="true" />
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
            {phase === "complete" ? `${packetLoss}%` : phase === "idle" ? "-" : "0.0%"}
          </span>
          <span className="text-[10px] text-mute font-mono">(HTTP)</span>
        </div>
        <div className="text-[10px] text-mute font-mono border-t border-hairline pt-2 mt-3 flex flex-col items-center gap-1">
          <span
            className={`transition-colors duration-150 ${
              packetLoss > 2
                ? "text-error font-semibold"
                : packetLoss > 0
                  ? "text-link font-semibold"
                  : "text-link font-semibold"
            }`}
          >
            {packetLoss > 2 ? "Suboptimal" : packetLoss > 0 ? "Good" : "Excellent"}
          </span>
        </div>
      </div>
    </div>
  );
}
