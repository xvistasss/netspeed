import type { ReactNode } from "react";
import type { DetailPingStats, SpeedTestRequest } from "../utils/speedTestUtils";
import {
  calculateMean,
  calculateMedian,
  calculateMin,
  calculateMax,
  calculateJitterMASD,
  calculateStdDev,
  calculatePercentile,
} from "../utils/speedTestUtils";
import { CONFIG } from "../utils/speedTestConfig";
import { Wifi, AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import InfoTooltip from "./InfoTooltip";

interface DetailedMeasurementsProps {
  activeTab: "latency" | "packetLoss" | "download" | "upload";
  setActiveTab: (tab: "latency" | "packetLoss" | "download" | "upload") => void;
  unloadedPingStats: DetailPingStats;
  dlLoadedPingStats: DetailPingStats;
  ulLoadedPingStats: DetailPingStats;
  downloadRequests: SpeedTestRequest[];
  uploadRequests: SpeedTestRequest[];
}

export default function DetailedMeasurements({
  activeTab,
  setActiveTab,
  unloadedPingStats,
  dlLoadedPingStats,
  ulLoadedPingStats,
  downloadRequests,
  uploadRequests,
}: DetailedMeasurementsProps) {
  return (
    <div className="bg-canvas border border-hairline p-6 rounded-lg shadow-xs flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-hairline pb-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-mono text-mute uppercase tracking-wider">
            Detailed Analytics
          </span>
          <h2 className="text-lg font-semibold text-ink font-sans">
            Measurements Breakdown
          </h2>
        </div>

        {/* Tab selector container with horizontal scroll on mobile */}
        <div className="w-full sm:w-auto overflow-x-auto no-scrollbar scroll-smooth flex" role="tablist" aria-label="Measurement categories">
          <div className="flex bg-canvas-soft-2 p-1 rounded-full border border-hairline min-w-max">
            {(["latency", "packetLoss", "download", "upload"] as const).map(
              (tab) => {
                const isActive = activeTab === tab;
                const labels: Record<string, string> = {
                  latency: "Latency",
                  packetLoss: "Packet Loss",
                  download: "Download Speeds",
                  upload: "Upload Speeds",
                };
                const icons: Record<string, ReactNode> = {
                  latency: <Wifi className="w-3.5 h-3.5" />,
                  packetLoss: <AlertTriangle className="w-3.5 h-3.5" />,
                  download: <ArrowDown className="w-3.5 h-3.5" />,
                  upload: <ArrowUp className="w-3.5 h-3.5" />,
                };
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`panel-${tab}`}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-mono select-none cursor-pointer transition-[color,background-color,box-shadow] duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                      isActive
                        ? "bg-primary text-on-primary font-semibold shadow-xs"
                        : "text-mute hover:text-ink"
                    }`}
                  >
                    {icons[tab]}
                    <span>{labels[tab]}</span>
                  </button>
                );
              },
            )}
          </div>
        </div>
      </div>

      {/* Tab contents */}
      <div className="overflow-x-auto w-full transition-opacity duration-200">
          <div role="tabpanel" id="panel-latency" aria-label="Latency measurements" aria-hidden={activeTab !== "latency"} tabIndex={0} className={activeTab !== "latency" ? "hidden" : undefined}>
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
                    JITTER (MASD)
                    <InfoTooltip content="MASD (Mean Absolute Successive Differences) measures the average absolute difference between consecutive latency samples. This is more robust to outliers than RFC 3550 RMS jitter, making it suitable for browser-based measurements where GC pauses can cause spikes." />
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
                    ? calculateMean(unloadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {unloadedPingStats.latencies.length > 0
                    ? calculateMedian(unloadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {unloadedPingStats.latencies.length > 0
                    ? calculatePercentile(unloadedPingStats.latencies, 95).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {unloadedPingStats.latencies.length > 0
                    ? calculateStdDev(unloadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {unloadedPingStats.latencies.length > 0
                    ? calculateMin(unloadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {unloadedPingStats.latencies.length > 0
                    ? calculateMax(unloadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {unloadedPingStats.latencies.length > 0
                    ? calculateJitterMASD(unloadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
              </tr>
              {/* Download Loaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#eb6f20]"></span>
                  Download Loaded
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {dlLoadedPingStats.latencies.length > 0
                    ? calculateMean(dlLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {dlLoadedPingStats.latencies.length > 0
                    ? calculateMedian(dlLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {dlLoadedPingStats.latencies.length > 0
                    ? calculatePercentile(dlLoadedPingStats.latencies, 95).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {dlLoadedPingStats.latencies.length > 0
                    ? calculateStdDev(dlLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {dlLoadedPingStats.latencies.length > 0
                    ? calculateMin(dlLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {dlLoadedPingStats.latencies.length > 0
                    ? calculateMax(dlLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {dlLoadedPingStats.latencies.length > 0
                    ? calculateJitterMASD(dlLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
              </tr>
              {/* Upload Loaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]"></span>
                  Upload Loaded
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {ulLoadedPingStats.latencies.length > 0
                    ? calculateMean(ulLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {ulLoadedPingStats.latencies.length > 0
                    ? calculateMedian(ulLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {ulLoadedPingStats.latencies.length > 0
                    ? calculatePercentile(ulLoadedPingStats.latencies, 95).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {ulLoadedPingStats.latencies.length > 0
                    ? calculateStdDev(ulLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {ulLoadedPingStats.latencies.length > 0
                    ? calculateMin(ulLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {ulLoadedPingStats.latencies.length > 0
                    ? calculateMax(ulLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {ulLoadedPingStats.latencies.length > 0
                    ? calculateJitterMASD(ulLoadedPingStats.latencies).toFixed(1)
                    : "\u2014"}
                </td>
              </tr>
            </tbody>
          </table>
          </div>

          <div role="tabpanel" id="panel-packetLoss" aria-label="Packet loss measurements" aria-hidden={activeTab !== "packetLoss"} tabIndex={0} className={activeTab !== "packetLoss" ? "hidden" : undefined}>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-canvas-soft border-b border-hairline text-mute">
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  STAGE
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  PACKETS SENT
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  PACKETS LOST
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  LOSS RATE (%)
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
                  {unloadedPingStats.sent > 0 ? unloadedPingStats.sent : "—"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {unloadedPingStats.sent > 0 ? unloadedPingStats.lost : "—"}
                </td>
                <td
                  className={`py-3 px-4 font-mono font-semibold tabular-nums ${unloadedPingStats.lost > 0 ? "text-error" : "text-body"}`}
                >
                  {unloadedPingStats.sent > 0
                    ? `${((unloadedPingStats.lost / unloadedPingStats.sent) * 100).toFixed(1)}%`
                    : "—"}
                </td>
              </tr>
              {/* Download Loaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#eb6f20]"></span>
                  Download Loaded
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {dlLoadedPingStats.sent > 0 ? dlLoadedPingStats.sent : "—"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {dlLoadedPingStats.sent >= 10 ? dlLoadedPingStats.lost : "—"}
                </td>
                <td
                  className={`py-3 px-4 font-mono font-semibold tabular-nums ${dlLoadedPingStats.sent >= 10 && dlLoadedPingStats.lost > 0 ? "text-error" : "text-body"}`}
                >
                  {dlLoadedPingStats.sent >= 10
                    ? `${((dlLoadedPingStats.lost / dlLoadedPingStats.sent) * 100).toFixed(1)}%`
                    : dlLoadedPingStats.sent > 0 ? <span className="text-mute">N/A (samples &lt; 10)</span> : "—"}
                </td>
              </tr>
              {/* Upload Loaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]"></span>
                  Upload Loaded
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {ulLoadedPingStats.sent > 0 ? ulLoadedPingStats.sent : "—"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {ulLoadedPingStats.sent >= 10 ? ulLoadedPingStats.lost : "—"}
                </td>
                <td
                  className={`py-3 px-4 font-mono font-semibold tabular-nums ${ulLoadedPingStats.sent >= 10 && ulLoadedPingStats.lost > 0 ? "text-error" : "text-body"}`}
                >
                  {ulLoadedPingStats.sent >= 10
                    ? `${((ulLoadedPingStats.lost / ulLoadedPingStats.sent) * 100).toFixed(1)}%`
                    : ulLoadedPingStats.sent > 0 ? <span className="text-mute">N/A (samples &lt; 10)</span> : "—"}
                </td>
              </tr>
            </tbody>
          </table>
          </div>

          <div role="tabpanel" id="panel-download" aria-label="Download speed measurements" aria-hidden={activeTab !== "download"} tabIndex={0} className={activeTab !== "download" ? "hidden" : undefined}>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-canvas-soft border-b border-hairline text-mute">
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  PAYLOAD SIZE
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  AVG SPEED (MBPS)
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  MEDIAN (MBPS)
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  MIN SPEED (MBPS)
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  MAX SPEED (MBPS)
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  MEASUREMENTS
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {CONFIG.DOWNLOAD_BINS.map((bin) => {
                const binReqs = downloadRequests.filter(
                  (r) => r.bytes > 0 && r.phaseSize >= bin.minBytes && r.phaseSize < bin.maxBytes
                );
                const speeds = binReqs.map((r) => r.bps / 1000000);
                const hasData = speeds.length > 0;

                return (
                  <tr
                    key={bin.name}
                    className="hover:bg-canvas-soft/40 transition-colors duration-150"
                  >
                    <td className="py-3 px-4 font-medium text-ink">
                      {bin.name}
                    </td>
                    <td className="py-3 px-4 font-mono text-body tabular-nums">
                      {hasData ? calculateMean(speeds).toFixed(1) : "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-body tabular-nums">
                      {hasData ? calculateMedian(speeds).toFixed(1) : "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-body tabular-nums">
                      {hasData ? calculateMin(speeds).toFixed(1) : "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-body tabular-nums">
                      {hasData ? calculateMax(speeds).toFixed(1) : "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-mute tabular-nums">
                      {speeds.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          <div role="tabpanel" id="panel-upload" aria-label="Upload speed measurements" aria-hidden={activeTab !== "upload"} tabIndex={0} className={activeTab !== "upload" ? "hidden" : undefined}>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-canvas-soft border-b border-hairline text-mute">
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  PAYLOAD SIZE
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  AVG SPEED (MBPS)
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  MEDIAN (MBPS)
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  MIN SPEED (MBPS)
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  MAX SPEED (MBPS)
                </th>
                <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
                  MEASUREMENTS
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {CONFIG.UPLOAD_BINS.map((bin) => {
                const binReqs = uploadRequests.filter(
                  (r) => r.bytes > 0 && r.phaseSize >= bin.minBytes && r.phaseSize < bin.maxBytes
                );
                const speeds = binReqs.map((r) => r.bps / 1000000);
                const hasData = speeds.length > 0;

                return (
                  <tr
                    key={bin.name}
                    className="hover:bg-canvas-soft/40 transition-colors duration-150"
                  >
                    <td className="py-3 px-4 font-medium text-ink">
                      {bin.name}
                    </td>
                    <td className="py-3 px-4 font-mono text-body tabular-nums">
                      {hasData ? calculateMean(speeds).toFixed(1) : "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-body tabular-nums">
                      {hasData ? calculateMedian(speeds).toFixed(1) : "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-body tabular-nums">
                      {hasData ? calculateMin(speeds).toFixed(1) : "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-body tabular-nums">
                      {hasData ? calculateMax(speeds).toFixed(1) : "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-mute tabular-nums">
                      {speeds.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
      </div>
    </div>
  );
}
