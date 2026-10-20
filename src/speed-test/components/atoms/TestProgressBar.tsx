import type { TestPhase } from "../../types";

interface TestProgressBarProps {
  isTestRunning: boolean;
  progressPercent: number;
  phase: TestPhase;
  statusMessage: string;
}

export default function TestProgressBar({
  isTestRunning,
  progressPercent,
  phase,
  statusMessage,
}: TestProgressBarProps) {
  if (!isTestRunning) return null;

  return (
    <section
      className="w-full flex flex-col gap-2 bg-canvas border border-hairline p-4 rounded-lg shadow-xs"
      aria-live="polite"
    >
      <div className="flex justify-between items-center text-xs font-mono text-mute">
        <span>PROGRESS</span>
        <span className="tabular-nums">{progressPercent}%</span>
      </div>
      <div className="w-full bg-canvas-soft-2 h-1.5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-[width,background-color] duration-300"
          style={{
            width: `${progressPercent}%`,
            backgroundColor:
              phase === "download"
                ? "var(--color-accent-download)"
                : phase === "upload"
                  ? "var(--color-accent-upload)"
                  : "var(--color-primary)",
          }}
        />
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="w-2 h-2 rounded-full bg-success animate-ping" aria-hidden="true" />
        <span className="text-wrap text-xs text-body font-mono truncate">{statusMessage}</span>
      </div>
    </section>
  );
}
