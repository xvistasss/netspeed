import {
  Activity,
  ArrowDown,
  ArrowUp,
  Download,
  Wifi,
  AlertTriangle,
  Play,
  Square,
  Loader2,
} from "lucide-react";
import InfoTooltip from "./InfoTooltip";
import QualityScores from "./QualityScores";
import DetailedMeasurements from "./DetailedMeasurements";
import TechnicalLogs from "./TechnicalLogs";
import TerminalSimulator from "./TerminalSimulator";
import { useSpeedTest } from "../hooks/useSpeedTest";
import { formatSpeed } from "../utils/speedTestUtils";

export default function SpeedTest() {
  const {
    phase, statusMessage, isCancelling, isStarting, activeTab, setActiveTab,
    clientInfo, latencyStats, downloadStats, uploadStats, packetLoss,
    terminalLogs, activeProgressLine, cliInput, setCliInput, handleCliSubmit,
    dlLoadedLatency, dlLoadedJitter, ulLoadedLatency, ulLoadedJitter,
    unloadedPingStats, dlLoadedPingStats, ulLoadedPingStats,
    downloadRequests, uploadRequests,
    completionTime, progressPercent,
    startSpeedTest, cancelSpeedTest, downloadTestResult,
    isTerminalOpen,
    terminalBodyRef, downloadChartRef, uploadChartRef,
    icmpEstimate, webrtcLatency, icmpSource, icmpOffsetApplied,
  } = useSpeedTest();

  const isTestRunning = phase !== "idle" && phase !== "complete" && phase !== "error";

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 flex-1">
      {/* Hero Section */}
      <div className="flex flex-col gap-2 mt-4 md:mt-8 border-b border-hairline pb-6">
        <span className="font-mono text-xs uppercase tracking-wider text-mute">
          Network Speed Engine
        </span>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-ink">
          Network Speed Test
        </h1>
        <p className="text-sm md:text-base text-body max-w-2xl mt-1">
          A professional-grade speed test measuring packet jitters, concurrent
          downloads, and uploads via optimal server selection.
        </p>
        <p className="text-xs text-mute mt-1">
          Measures near ICMP latency. Results approximate real-world
          network performance.
        </p>

        <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 mb-4">
          <a href="/about" className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors">About</a>
          <span className="text-hairline-strong text-[10px] select-none">·</span>
          <a href="/contact" className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors">Contact</a>
          <span className="text-hairline-strong text-[10px] select-none">·</span>
          <a href="/privacy" className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors">Privacy</a>
          <span className="text-hairline-strong text-[10px] select-none">·</span>
          <a href="/terms" className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors">Terms</a>
        </nav>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
          {isTestRunning ? (
            <button
              onClick={cancelSpeedTest}
              type="button"
              disabled={isCancelling}
              className="w-full sm:w-auto min-h-[44px] bg-error text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 flex items-center justify-center gap-2 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isCancelling ? (
                <Loader2 className="w-4 h-4 fill-on-primary text-on-primary animate-spin" aria-hidden="true" />
              ) : (
                <Square className="w-4 h-4 fill-on-primary text-on-primary" aria-hidden="true" />
              )}
              {isCancelling ? "Stopping…" : "Stop Test"}
            </button>
          ) : (
            <button
              onClick={startSpeedTest}
              type="button"
              disabled={isCancelling || isStarting}
              className="w-full sm:w-auto min-h-[44px] bg-primary text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 flex items-center justify-center gap-2 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isStarting ? (
                <Loader2 className="w-4 h-4 fill-on-primary text-on-primary animate-spin" aria-hidden="true" />
              ) : (
                <Play className="w-4 h-4 fill-on-primary text-on-primary" aria-hidden="true" />
              )}
              {isStarting ? "Starting…" : "Start Speed Test"}
            </button>
          )}

          {completionTime && downloadStats.avg > 0 && (
            <button
              onClick={downloadTestResult}
              type="button"
              title="Download results"
              className="w-full sm:w-auto min-h-[44px] bg-error-soft text-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 flex items-center justify-center gap-2 cursor-pointer select-none"
            >
              <Download className="w-4 h-4 fill-primary text-primary" aria-hidden="true" />
              Download Results
            </button>
          )}
        </div>

        {completionTime && (
          <span className="text-[11px] text-mute">Measured at {completionTime}</span>
        )}
      </div>

      {/* Progress Bar */}
      {isTestRunning && (
        <section className="w-full flex flex-col gap-2 bg-canvas border border-hairline p-4 rounded-lg shadow-xs" aria-live="polite">
          <div className="flex justify-between items-center text-xs font-mono text-mute">
            <span>PROGRESS</span>
            <span className="tabular-nums">{progressPercent}%</span>
          </div>
          <div className="w-full bg-canvas-soft-2 h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width,background-color] duration-300"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: phase === "download" ? "#eb6f20" : phase === "upload" ? "#8b5cf6" : "var(--color-primary)",
              }}
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full bg-success animate-ping" aria-hidden="true" />
            <span className="text-wrap text-xs text-body font-mono truncate">{statusMessage}</span>
          </div>
        </section>
      )}

      {/* Main Layout: Dashboard + Terminal */}
      <div className={isTerminalOpen ? "grid grid-cols-1 lg:grid-cols-12 gap-8 items-start" : "flex flex-col gap-8"}>
        {/* Dashboard */}
        <div className={isTerminalOpen ? "lg:col-span-8 flex flex-col gap-8" : "flex flex-col gap-8"}>
          {/* Speed Cards + Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
            {/* Download & Upload Card */}
            <div className="md:col-span-8 flex flex-col bg-canvas border border-hairline rounded-lg shadow-xs overflow-hidden">
              {/* Download Section */}
              <div className="p-5 md:p-6">
                <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-2">
                  <span>DOWNLOAD</span>
                  <InfoTooltip content="Speed at which data transfers from the internet to your device." />
                </div>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
                    {phase === "download" ? formatSpeed(downloadStats.current).value : downloadStats.avg > 0 ? formatSpeed(downloadStats.avg).value : "0.0"}
                  </span>
                  <span className="text-xl text-mute font-mono">
                    {phase === "download" ? formatSpeed(downloadStats.current).unit : downloadStats.avg > 0 ? formatSpeed(downloadStats.avg).unit : "Mbps"}
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
                    {downloadStats.peak > 0 ? `${formatSpeed(downloadStats.peak).value} ${formatSpeed(downloadStats.peak).unit}` : "—"}
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
                    {phase === "upload" ? formatSpeed(uploadStats.current).value : uploadStats.avg > 0 ? formatSpeed(uploadStats.avg).value : "0.0"}
                  </span>
                  <span className="text-xl text-mute font-mono">
                    {phase === "upload" ? formatSpeed(uploadStats.current).unit : uploadStats.avg > 0 ? formatSpeed(uploadStats.avg).unit : "Mbps"}
                  </span>
                </div>
                <div className="h-40 md:h-44 relative w-full border border-hairline bg-canvas-soft rounded-md overflow-hidden p-2">
                  <canvas ref={uploadChartRef} />
                  {(phase === "idle" || phase === "routing" || phase === "ping" || phase === "download") && (
                    <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-[10px] font-mono text-mute text-center p-4">
                      Chart starts drawing during upload test.
                    </div>
                  )}
                </div>
                <div className="flex justify-between items-center text-xs font-mono border-t border-hairline pt-3 mt-3 text-mute">
                  <span>Peak Speed:</span>
                  <span className="font-semibold text-ink tabular-nums">
                    {uploadStats.peak > 0 ? `${formatSpeed(uploadStats.peak).value} ${formatSpeed(uploadStats.peak).unit}` : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Stats Stack: Latency, Jitter, Packet Loss */}
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
                    {unloadedPingStats.latencies.length > 0 ? latencyStats.avg.toFixed(1) : "—"}
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
                    <ArrowDown className="w-3.5 h-3.5 text-[#eb6f20]" aria-hidden="true" />
                    <span>Down: <span className="font-semibold text-ink tabular-nums">{dlLoadedPingStats.latencies.length > 0 ? `${dlLoadedLatency.toFixed(0)} ms` : "—"}</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUp className="w-3.5 h-3.5 text-[#8b5cf6]" aria-hidden="true" />
                    <span>Up: <span className="font-semibold text-ink tabular-nums">{ulLoadedPingStats.latencies.length > 0 ? `${ulLoadedLatency.toFixed(0)} ms` : "—"}</span></span>
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
                    {unloadedPingStats.latencies.length > 1 ? latencyStats.jitter.toFixed(1) : "—"}
                  </span>
                  <span className="text-xs text-mute font-mono">ms</span>
                </div>
                <div className="grid grid-cols-1 gap-2 mt-3 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
                  <div className="flex items-center gap-1">
                    <ArrowDown className="w-3.5 h-3.5 text-[#eb6f20]" aria-hidden="true" />
                    <span>Down: <span className="font-semibold text-ink tabular-nums">{dlLoadedPingStats.latencies.length > 1 ? `${dlLoadedJitter.toFixed(0)} ms` : "—"}</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUp className="w-3.5 h-3.5 text-[#8b5cf6]" aria-hidden="true" />
                    <span>Up: <span className="font-semibold text-ink tabular-nums">{ulLoadedPingStats.latencies.length > 1 ? `${ulLoadedJitter.toFixed(0)} ms` : "—"}</span></span>
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
                    {phase === "complete" ? `${packetLoss}%` : phase === "idle" ? "—" : "0.0%"}
                  </span>
                  <span className="text-[10px] text-mute font-mono">(HTTP)</span>
                </div>
                <div className="text-[10px] text-mute font-mono border-t border-hairline pt-2 mt-3 flex flex-col items-center gap-1">
                  <span className={`transition-colors duration-150 ${packetLoss > 2 ? "text-error font-semibold" : packetLoss > 0 ? "text-link font-semibold" : "text-link font-semibold"}`}>
                    {packetLoss > 2 ? "Suboptimal" : packetLoss > 0 ? "Good" : "Excellent"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Network Quality Score */}
          <QualityScores
            phase={phase}
            downloadAvg={downloadStats.avg}
            uploadAvg={uploadStats.avg}
            latencyAvg={latencyStats.avg}
            latencyJitter={latencyStats.jitter}
            packetLossPercent={packetLoss}
          />

          {/* Detailed Measurements */}
          <DetailedMeasurements
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            unloadedPingStats={unloadedPingStats}
            dlLoadedPingStats={dlLoadedPingStats}
            ulLoadedPingStats={ulLoadedPingStats}
            downloadRequests={downloadRequests}
            uploadRequests={uploadRequests}
          />

          {/* Technical Details */}
          <TechnicalLogs
            clientInfo={clientInfo}
            latencyStats={latencyStats}
            icmpEstimate={icmpEstimate}
            webrtcLatency={webrtcLatency}
            icmpSource={icmpSource}
            icmpOffsetApplied={icmpOffsetApplied}
          />
        </div>

        {/* Terminal Panel */}
        {isTerminalOpen && (
          <TerminalSimulator
            terminalLogs={terminalLogs}
            activeProgressLine={activeProgressLine}
            cliInput={cliInput}
            setCliInput={setCliInput}
            handleCliSubmit={handleCliSubmit}
            phase={phase}
            terminalBodyRef={terminalBodyRef}
          />
        )}
      </div>
    </div>
  );
}
