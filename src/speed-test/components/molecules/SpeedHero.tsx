import { Play, Square, Loader2, Download } from "lucide-react";

interface SpeedHeroProps {
  isTestRunning: boolean;
  isStarting: boolean;
  isCancelling: boolean;
  completionTime: string;
  downloadAvg: number;
  startSpeedTest: () => Promise<void>;
  cancelSpeedTest: () => void;
  downloadTestResult: () => void;
}

export default function SpeedHero({
  isTestRunning,
  isStarting,
  isCancelling,
  completionTime,
  downloadAvg,
  startSpeedTest,
  cancelSpeedTest,
  downloadTestResult,
}: SpeedHeroProps) {
  return (
    <div className="flex flex-col gap-2 mt-4 md:mt-8 border-b border-hairline pb-6">
      <span className="font-mono text-xs uppercase tracking-wider text-mute">
        Speed Test &bull; Network Diagnostics
      </span>
      <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-ink font-sans">
        NetSpeed - Accurate Internet Speed Test
      </h1>
      <p className="text-sm md:text-base text-body max-w-2xl mt-1 leading-relaxed">
        Test your internet download speed, upload speed, ping latency, jitter, and bufferbloat with NetSpeed's free online speed test and latency checker.
      </p>
      <p className="text-xs text-mute mt-1">
        Uncompressed cryptographic edge payloads for accurate, real-world connection diagnostics.
      </p>

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
            {isCancelling ? "Stopping..." : "Stop Test"}
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
            {isStarting ? "Starting..." : "Start Speed Test"}
          </button>
        )}

        {completionTime && downloadAvg > 0 && (
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
  );
}
