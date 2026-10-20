import { MapPin } from "lucide-react";

interface LocationPromptProps {
  waiting: boolean;
  timeLeft: number | null;
  onAllow: () => void;
  onSkip: () => void;
}

export default function LocationPrompt({
  waiting,
  timeLeft,
  onAllow,
  onSkip,
}: LocationPromptProps) {
  if (!waiting) return null;

  const displayTime = timeLeft !== null ? `${timeLeft}s` : "5s";

  return (
    <section
      className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 bg-primary/5 border border-primary/20 p-4 rounded-lg shadow-xs border-l-4 border-l-primary"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-primary/10 rounded-full text-primary shrink-0 mt-0.5">
          <MapPin className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight text-ink font-sans">
            Share precise location?
          </h3>
          <p className="text-xs text-body leading-relaxed max-w-xl">
            Use GPS to find the closest edge server for highest accuracy.
            Falls back to IP location in{" "}
            <span className="font-mono font-bold text-primary tabular-nums">{displayTime}</span>
            {" "}if no action is taken.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
        <button
          onClick={onAllow}
          type="button"
          className="flex-1 md:flex-none min-h-[36px] bg-primary text-on-primary font-medium text-xs rounded-md py-2 px-4 shadow-xs hover:opacity-90 active:scale-[0.97] transition-[opacity,transform] duration-150 cursor-pointer select-none flex items-center justify-center gap-1.5"
        >
          Allow
        </button>
        <button
          onClick={onSkip}
          type="button"
          className="flex-1 md:flex-none min-h-[36px] bg-canvas hover:bg-canvas-soft border border-hairline hover:border-hairline-strong text-ink font-mono text-xs rounded-md py-2 px-4 shadow-xs transition-colors duration-150 cursor-pointer select-none flex items-center justify-center gap-1.5"
        >
          Skip
        </button>
      </div>
    </section>
  );
}
