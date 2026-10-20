import type { DetailPingStats } from "../../types";
import {
  calculateTrimmedMean,
  calculateMedian,
  calculateMin,
  calculateMax,
  calculateJitterRFC3550,
  calculateStdDev,
  calculatePercentile,
} from "../../utils";
import InfoTooltip from "../atoms/InfoTooltip";

interface LatencyTableProps {
  active: boolean;
  unloadedPingStats: DetailPingStats;
  dlLoadedPingStats: DetailPingStats;
  ulLoadedPingStats: DetailPingStats;
}

export default function LatencyTable({
  active,
  unloadedPingStats,
  dlLoadedPingStats,
  ulLoadedPingStats,
}: LatencyTableProps) {
  return (
    <div
      role="tabpanel"
      id="panel-latency"
      aria-label="Latency measurements"
      aria-hidden={!active}
      tabIndex={0}
      className={!active ? "hidden" : undefined}
    >
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-canvas-soft border-b border-hairline text-mute">
            <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
              STAGE
            </th>
            <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
              AVG (MS)
            </th>
            <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
              MEDIAN (MS)
            </th>
            <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
              P95 (MS)
            </th>
            <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
              STDDEV (MS)
            </th>
            <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
              MIN (MS)
            </th>
            <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
              MAX (MS)
            </th>
            <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
              <span className="flex items-center gap-1">
                JITTER (RFC 3550)
                <InfoTooltip content="RFC 3550 Section 6.4.1 Interarrival Jitter Filter. Measures statistical latency variance between successive packets. Lower is better." />
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {/* Unloaded Row */}
          <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
            <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
              Unloaded (Idle)
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {unloadedPingStats.latencies.length > 0
                ? calculateTrimmedMean(unloadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {unloadedPingStats.latencies.length > 0
                ? calculateMedian(unloadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {unloadedPingStats.latencies.length > 0
                ? calculatePercentile(unloadedPingStats.latencies, 95).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {unloadedPingStats.latencies.length > 0
                ? calculateStdDev(unloadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {unloadedPingStats.latencies.length > 0
                ? calculateMin(unloadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {unloadedPingStats.latencies.length > 0
                ? calculateMax(unloadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {unloadedPingStats.latencies.length > 0
                ? calculateJitterRFC3550(unloadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
          </tr>
          {/* Download Loaded Row */}
          <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
            <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-download"></span>
              Download Loaded
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {dlLoadedPingStats.latencies.length > 0
                ? calculateTrimmedMean(dlLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {dlLoadedPingStats.latencies.length > 0
                ? calculateMedian(dlLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {dlLoadedPingStats.latencies.length > 0
                ? calculatePercentile(dlLoadedPingStats.latencies, 95).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {dlLoadedPingStats.latencies.length > 0
                ? calculateStdDev(dlLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {dlLoadedPingStats.latencies.length > 0
                ? calculateMin(dlLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {dlLoadedPingStats.latencies.length > 0
                ? calculateMax(dlLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {dlLoadedPingStats.latencies.length > 0
                ? calculateJitterRFC3550(dlLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
          </tr>
          {/* Upload Loaded Row */}
          <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
            <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-upload"></span>
              Upload Loaded
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {ulLoadedPingStats.latencies.length > 0
                ? calculateTrimmedMean(ulLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {ulLoadedPingStats.latencies.length > 0
                ? calculateMedian(ulLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {ulLoadedPingStats.latencies.length > 0
                ? calculatePercentile(ulLoadedPingStats.latencies, 95).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {ulLoadedPingStats.latencies.length > 0
                ? calculateStdDev(ulLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {ulLoadedPingStats.latencies.length > 0
                ? calculateMin(ulLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {ulLoadedPingStats.latencies.length > 0
                ? calculateMax(ulLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {ulLoadedPingStats.latencies.length > 0
                ? calculateJitterRFC3550(ulLoadedPingStats.latencies).toFixed(1)
                : "-"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
