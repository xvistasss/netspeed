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
import InfoTooltip from "./SpeedTest/InfoTooltip";
import QualityScores from "./SpeedTest/QualityScores";
import DetailedMeasurements from "./SpeedTest/DetailedMeasurements";
import TechnicalLogs from "./SpeedTest/TechnicalLogs";
import TerminalSimulator from "./SpeedTest/TerminalSimulator";
import { useSpeedTest } from "./SpeedTest/useSpeedTest";
import { formatSpeed } from "../utils/speedTestUtils";

export default function SpeedTest() {
  const {
    phase, statusMessage, isCancelling, isStarting, activeTab, setActiveTab,
    clientInfo, latencyStats, downloadStats, uploadStats, packetLoss,
    terminalLogs, activeProgressLine, cliInput, setCliInput, handleCliSubmit,
    dlLoadedLatency, dlLoadedJitter, ulLoadedLatency, ulLoadedJitter,
    unloadedPingStats, dlLoadedPingStats, ulLoadedPingStats,
    downloadRequests, uploadRequests, downloadReliable, uploadReliable,
    completionTime, progressPercent,
    startSpeedTest, cancelSpeedTest, downloadTestResult,
    terminalBodyRef, downloadChartRef, uploadChartRef,
  } = useSpeedTest();

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8 flex-1">
      {/* Header Hero section */}
      <div className="flex flex-col gap-2 mt-4 md:mt-8 border-b border-hairline pb-6">
        <span className="font-mono text-xs uppercase tracking-wider text-mute block">
          Network Speed Engine
        </span>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-ink font-sans">
          Network Speed Test
        </h1>
        <p className="text-sm md:text-base text-body max-w-2xl mt-1">
          A professional-grade, latency-critical speed test engine measuring
          packet jitters, concurrent downloads, and uploads via optimal server selection.
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 mb-4">
          <a href="/about" className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors">About Us</a>
          <span className="text-hairline-strong text-[10px] select-none">•</span>
          <a href="/contact" className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors">Contact Us</a>
          <span className="text-hairline-strong text-[10px] select-none">•</span>
          <a href="/privacy" className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors">Privacy Policy</a>
          <span className="text-hairline-strong text-[10px] select-none">•</span>
          <a href="/terms" className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors">Terms & Conditions</a>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-stretch">
          {phase === "idle" || phase === "complete" || phase === "error" ? (
            <button
              onClick={startSpeedTest}
              type="button"
              disabled={isCancelling || isStarting}
              className="w-full h-[60px] sm:w-auto bg-primary text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary flex items-center justify-center gap-2 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isStarting ? (
                <>
                  <Loader2 className="w-4 h-4 fill-on-primary text-on-primary animate-spin" aria-hidden="true" /> Starting…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-on-primary text-on-primary" aria-hidden="true" /> Start Speed Test
                </>
              )}
            </button>
          ) : (
            <button
              onClick={cancelSpeedTest}
              type="button"
              disabled={isCancelling}
              className="w-full sm:w-auto bg-error text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary flex items-center justify-center gap-2 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isCancelling ? (
                <>
                  <Loader2 className="w-4 h-4 fill-on-primary text-on-primary animate-spin" aria-hidden="true" /> Stopping…
                </>
              ) : (
                <>
                  <Square className="w-4 h-4 fill-on-primary text-on-primary" aria-hidden="true" /> Stop Test
                </>
              )}
            </button>
          )}

          {completionTime && downloadStats.avg > 0 ? (
            <button
              onClick={downloadTestResult}
              type="button"
              title="Download results"
              className="w-full h-[60px] sm:w-auto bg-error-soft text-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary flex items-center justify-center gap-2 cursor-pointer select-none"
            >
              <Download className="w-4 h-4 fill-primary text-primary" aria-hidden="true" /> Download Results
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-4">
          {completionTime && (
            <span className="text-[11px] text-mute">Measured at {completionTime}</span>
          )}
        </div>
      </div>

      {/* Progress Bar & Status Text */}
      {phase !== "idle" && phase !== "complete" && phase !== "error" ? (
        <div className="w-full flex flex-col gap-2 bg-canvas border border-hairline p-4 rounded-lg shadow-xs" aria-live="polite">
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
        </div>
      ) : null}

      {/* Side-by-side Layout: Dashboard + Terminal */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column - Web UI Dashboard */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          {/* Main Dashboard Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch">
            {/* Download & Upload */}
            <div className="md:col-span-8 flex flex-col gap-4 bg-canvas border border-hairline p-6 rounded-lg shadow-xs justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-2">
                  <span>DOWNLOAD</span>
                  <InfoTooltip content="The speed at which data is transferred from the internet to your device. Higher download speeds enable smoother video streaming, faster file downloads, and quicker webpage loading." />
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
                    {phase === "download" ? formatSpeed(downloadStats.current).value : downloadStats.avg > 0 ? formatSpeed(downloadStats.avg).value : "0.0"}
                  </span>
                  <span className="text-xl text-mute font-mono">
                    {phase === "download" ? formatSpeed(downloadStats.current).unit : downloadStats.avg > 0 ? formatSpeed(downloadStats.avg).unit : "Mbps"}
                  </span>
                </div>
                <div className="h-44 relative w-full border border-hairline bg-canvas-soft rounded-md overflow-hidden p-2">
                  <canvas ref={downloadChartRef} />
                  {(phase === "idle" || phase === "routing" || phase === "ping") && (
                    <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-[10px] font-mono text-mute text-center p-4">
                      Chart starts drawing during download test.
                    </div>
                  )}
                </div>
                <div className="flex justify-between items-center text-xs font-mono border-t border-hairline pt-3 mt-2 text-mute">
                  <span>Peak Speed:</span>
                  <span className="font-semibold text-ink tabular-nums">
                    {downloadStats.peak > 0 ? `${formatSpeed(downloadStats.peak).value} ${formatSpeed(downloadStats.peak).unit}` : "—"}
                  </span>
                </div>
              </div>
              <hr className="border-hairline w-full h-4" />
              <div>
                <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-2">
                  <span>UPLOAD</span>
                  <InfoTooltip content="The speed at which data is transferred from your device to the internet. Higher upload speeds are critical for smooth video calls, online gaming, uploading large files, and sending emails with attachments." />
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
                    {phase === "upload" ? formatSpeed(uploadStats.current).value : uploadStats.avg > 0 ? formatSpeed(uploadStats.avg).value : "0.0"}
                  </span>
                  <span className="text-xl text-mute font-mono">
                    {phase === "upload" ? formatSpeed(uploadStats.current).unit : uploadStats.avg > 0 ? formatSpeed(uploadStats.avg).unit : "Mbps"}
                  </span>
                </div>
                <div className="h-44 relative w-full border border-hairline bg-canvas-soft rounded-md overflow-hidden p-2">
                  <canvas ref={uploadChartRef} />
                  {(phase === "idle" || phase === "routing" || phase === "ping" || phase === "download") && (
                    <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-[10px] font-mono text-mute text-center p-4">
                      Chart starts drawing during upload test.
                    </div>
                  )}
                </div>
                <div className="flex justify-between items-center text-xs font-mono border-t border-hairline pt-3 mt-2 text-mute">
                  <span>Peak Speed:</span>
                  <span className="font-semibold text-ink tabular-nums">
                    {uploadStats.peak > 0 ? `${formatSpeed(uploadStats.peak).value} ${formatSpeed(uploadStats.peak).unit}` : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Latency, Jitter, Packet Loss Stack */}
            <div className="md:col-span-4 flex flex-col gap-4">
              {/* Latency card */}
              <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-1 flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                      <span>LATENCY</span>
                      <InfoTooltip content="Latency (ping) measures the round-trip response time for data. Lower latency is vital for real-time applications like online gaming or voice calls. Unloaded represents idle latency, while Loaded (Down/Up Arrow) measures latency under heavy network load." />
                    </div>
                    <Wifi className="w-4 h-4 text-mute" aria-hidden="true" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                      {unloadedPingStats.latencies.length > 0 ? latencyStats.avg.toFixed(1) : "—"}
                    </span>
                    <span className="text-xs text-mute font-mono">ms (unloaded)</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 mt-2 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
                  <div className="flex items-center gap-1">
                    <ArrowDown className="w-3.5 h-3.5 text-[#eb6f20]" aria-hidden="true" />
                    <span>Down: <span className="font-semibold text-ink font-mono tabular-nums">{dlLoadedPingStats.latencies.length > 0 ? `${dlLoadedLatency.toFixed(0)} ms` : "—"}</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUp className="w-3.5 h-3.5 text-[#8b5cf6]" aria-hidden="true" />
                    <span>Up: <span className="font-semibold text-ink font-mono tabular-nums">{ulLoadedPingStats.latencies.length > 0 ? `${ulLoadedLatency.toFixed(0)} ms` : "—"}</span></span>
                  </div>
                </div>
              </div>

              {/* Jitter card */}
              <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-1 flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                      <span>JITTER</span>
                      <InfoTooltip content="Jitter is the variance in latency over time. Steady, consistent latency results in lower jitter, which is essential for smooth audio streams and live gaming. High jitter causes sudden lag spikes." />
                    </div>
                    <Activity className="w-4 h-4 text-mute" aria-hidden="true" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                      {unloadedPingStats.latencies.length > 1 ? latencyStats.jitter.toFixed(1) : "—"}
                    </span>
                    <span className="text-xs text-mute font-mono">ms</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 mt-2 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
                  <div className="flex items-center gap-1">
                    <ArrowDown className="w-3.5 h-3.5 text-[#eb6f20]" aria-hidden="true" />
                    <span>Down: <span className="font-semibold text-ink font-mono tabular-nums">{dlLoadedPingStats.latencies.length > 1 ? `${dlLoadedJitter.toFixed(0)} ms` : "—"}</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUp className="w-3.5 h-3.5 text-[#8b5cf6]" aria-hidden="true" />
                    <span>Up: <span className="font-semibold text-ink font-mono tabular-nums">{ulLoadedPingStats.latencies.length > 1 ? `${ulLoadedJitter.toFixed(0)} ms` : "—"}</span></span>
                  </div>
                </div>
              </div>

              {/* Packet Loss card */}
              <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-1 flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                      <span>PACKET LOSS</span>
                      <InfoTooltip content="Packet Loss occurs when data packets fail to reach their destination. Measured via HTTP request failures during dedicated ping phase. Note: HTTP operates over TCP with retransmission, so this measures application-level loss, not raw network packet loss. True network packet loss is typically higher but masked by TCP retransmits." />
                    </div>
                    <AlertTriangle className="w-4 h-4 text-mute" aria-hidden="true" />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                      {phase === "complete" ? `${packetLoss}%` : phase === "idle" ? "—" : "0.0%"}
                    </span>
                  </div>
                </div>
                <div className="text-[10px] text-mute font-mono border-t border-hairline pt-2 mt-4 flex flex-col justify-between items-center gap-1">
                  <span>HTTP-Level Loss (TCP retransmits masked)</span>
                  <span className={`transition-colors duration-150 ${packetLoss > 0 ? "text-error font-semibold" : "text-link font-semibold"}`}>
                    {packetLoss > 0 ? "Suboptimal" : "Excellent"}
                  </span>
                  {packetLoss === 0 && phase === "complete" && (
                    <span className="text-[9px] text-mute italic">Does not reflect raw network loss</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Network Quality Score Panel */}
          <QualityScores
            phase={phase}
            downloadAvg={downloadStats.avg}
            uploadAvg={uploadStats.avg}
            latencyAvg={latencyStats.avg}
            latencyJitter={latencyStats.jitter}
            packetLossPercent={packetLoss}
          />

          {/* Detailed Measurements Breakdown */}
          <DetailedMeasurements
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            unloadedPingStats={unloadedPingStats}
            dlLoadedPingStats={dlLoadedPingStats}
            ulLoadedPingStats={ulLoadedPingStats}
            downloadRequests={downloadRequests}
            uploadRequests={uploadRequests}
          />

          {/* Technical Details Drawer */}
          <TechnicalLogs clientInfo={clientInfo} />
        </div>

        {/* Right Column - Terminal Simulator */}
        <TerminalSimulator
          terminalLogs={terminalLogs}
          activeProgressLine={activeProgressLine}
          cliInput={cliInput}
          setCliInput={setCliInput}
          handleCliSubmit={handleCliSubmit}
          phase={phase}
          terminalBodyRef={terminalBodyRef}
        />
      </div>
    </div>
  );
}
