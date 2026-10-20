import SpeedHero from "./molecules/SpeedHero";
import LocationPrompt from "./atoms/LocationPrompt";
import TestProgressBar from "./atoms/TestProgressBar";
import ThroughputCard from "./molecules/ThroughputCard";
import MetricsStack from "./molecules/MetricsStack";
import QualityScores from "./QualityScores";
import DetailedMeasurements from "./DetailedMeasurements";
import TechnicalLogs from "./TechnicalLogs";
import TerminalSimulator from "./TerminalSimulator";
import { useSpeedTest } from "../hooks/useSpeedTest";

export default function SpeedTest() {
  const {
    phase,
    statusMessage,
    isCancelling,
    isStarting,
    activeTab,
    setActiveTab,
    clientInfo,
    latencyStats,
    downloadStats,
    uploadStats,
    packetLoss,
    terminalLogs,
    activeProgressLine,
    cliInput,
    setCliInput,
    handleCliSubmit,
    dlLoadedLatency,
    dlLoadedJitter,
    ulLoadedLatency,
    ulLoadedJitter,
    unloadedPingStats,
    dlLoadedPingStats,
    ulLoadedPingStats,
    downloadRequests,
    uploadRequests,
    completionTime,
    progressPercent,
    startSpeedTest,
    cancelSpeedTest,
    downloadTestResult,
    isTerminalOpen,
    terminalBodyRef,
    downloadChartRef,
    uploadChartRef,
    icmpEstimate,
    webrtcLatency,
    icmpSource,
    icmpOffsetApplied,
    skipLocationPrompt,
    allowLocationPrompt,
    locationPrePromptWaiting,
    locationPrePromptTimeLeft,
  } = useSpeedTest();

  const isTestRunning = phase !== "idle" && phase !== "complete" && phase !== "error";

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 flex-1">
      <SpeedHero
        isTestRunning={isTestRunning}
        isStarting={isStarting}
        isCancelling={isCancelling}
        completionTime={completionTime}
        downloadAvg={downloadStats.avg}
        startSpeedTest={startSpeedTest}
        cancelSpeedTest={cancelSpeedTest}
        downloadTestResult={downloadTestResult}
      />

      <LocationPrompt
        waiting={locationPrePromptWaiting}
        timeLeft={locationPrePromptTimeLeft}
        onAllow={allowLocationPrompt}
        onSkip={skipLocationPrompt}
      />

      <TestProgressBar
        isTestRunning={isTestRunning}
        progressPercent={progressPercent}
        phase={phase}
        statusMessage={statusMessage}
      />

      <div
        className={
          isTerminalOpen
            ? "grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
            : "flex flex-col gap-8"
        }
      >
        <div
          className={
            isTerminalOpen ? "lg:col-span-8 flex flex-col gap-8" : "flex flex-col gap-8"
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
            <ThroughputCard
              phase={phase}
              downloadStats={downloadStats}
              uploadStats={uploadStats}
              downloadChartRef={downloadChartRef}
              uploadChartRef={uploadChartRef}
            />

            <MetricsStack
              phase={phase}
              latencyStats={latencyStats}
              packetLoss={packetLoss}
              icmpEstimate={icmpEstimate}
              icmpSource={icmpSource}
              icmpOffsetApplied={icmpOffsetApplied}
              unloadedPingStats={unloadedPingStats}
              dlLoadedPingStats={dlLoadedPingStats}
              ulLoadedPingStats={ulLoadedPingStats}
              dlLoadedLatency={dlLoadedLatency}
              dlLoadedJitter={dlLoadedJitter}
              ulLoadedLatency={ulLoadedLatency}
              ulLoadedJitter={ulLoadedJitter}
            />
          </div>

          <QualityScores
            phase={phase}
            downloadAvg={downloadStats.avg}
            uploadAvg={uploadStats.avg}
            latencyAvg={latencyStats.avg}
            latencyJitter={latencyStats.jitter}
            packetLossPercent={packetLoss}
          />

          <DetailedMeasurements
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            unloadedPingStats={unloadedPingStats}
            dlLoadedPingStats={dlLoadedPingStats}
            ulLoadedPingStats={ulLoadedPingStats}
            downloadRequests={downloadRequests}
            uploadRequests={uploadRequests}
          />

          <TechnicalLogs
            clientInfo={clientInfo}
            latencyStats={latencyStats}
            icmpEstimate={icmpEstimate}
            webrtcLatency={webrtcLatency}
            icmpSource={icmpSource}
            icmpOffsetApplied={icmpOffsetApplied}
          />
        </div>

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
