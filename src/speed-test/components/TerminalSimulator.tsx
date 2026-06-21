import { type RefObject } from "react";

interface TerminalSimulatorProps {
  terminalLogs: string[];
  activeProgressLine: string | null;
  cliInput: string;
  setCliInput: (v: string) => void;
  handleCliSubmit: (e: React.SubmitEvent) => void;
  phase: string;
  terminalBodyRef: RefObject<HTMLDivElement | null>;
}

export default function TerminalSimulator({
  terminalLogs,
  activeProgressLine,
  cliInput,
  setCliInput,
  handleCliSubmit,
  phase,
  terminalBodyRef,
}: TerminalSimulatorProps) {
  return (
    <div className="lg:col-span-4 w-full flex flex-col bg-terminal-bg rounded-lg border border-hairline overflow-hidden shadow-md lg:sticky lg:top-20">
      {/* macOS window header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-header-border bg-terminal-header-bg select-none">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] opacity-80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] opacity-80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] opacity-80" />
        </div>
        <span className="text-[10px] font-mono text-terminal-title tracking-wider uppercase">speedtest-cli</span>
        <div className="w-10" />
      </div>

      {/* Terminal output stream body */}
      <div
        ref={terminalBodyRef}
        className="h-full max-h-[calc(100vh-200px)] overflow-y-auto p-4 flex flex-col gap-1.5 text-left font-mono text-[11px] leading-relaxed text-terminal-text"
      >
        {terminalLogs.map((log, index) => {
          let className = "text-terminal-text";
          if (log.startsWith("$")) className = "text-terminal-text-cmd font-bold";
          else if (log.includes("[OK]")) className = "text-terminal-text-ok font-medium";
          else if (log.includes("[PROBE]")) className = "text-terminal-text-probe";
          else if (log.includes("[ERROR]") || log.startsWith("Error:")) className = "text-terminal-text-error";

          return (
            <div key={index} className={`whitespace-pre-wrap ${className}`}>
              {log}
            </div>
          );
        })}
        {activeProgressLine && (
          <div className="text-terminal-text-progress animate-pulse whitespace-pre-wrap">
            {activeProgressLine}
          </div>
        )}
      </div>

      {/* Terminal prompt input form */}
      <form
        onSubmit={handleCliSubmit}
        className="flex items-center gap-1.5 px-4 py-3 border-t border-terminal-input-border/80 bg-terminal-input-bg text-[11px] font-mono text-terminal-prompt"
      >
        <span aria-hidden="true">$</span>
        <label className="sr-only">Terminal command input</label>
        <input
          type="text"
          value={cliInput}
          onChange={(e) => setCliInput(e.target.value)}
          placeholder={phase !== "idle" && phase !== "complete" && phase !== "error" ? "Type 'stop' to cancel..." : "Type 'run' or 'help'..."}
          className="flex-1 bg-transparent border-none outline-hidden text-terminal-input-text font-mono p-0 focus:ring-0 text-[11px]"
          aria-label="Terminal command input"
        />
      </form>
    </div>
  );
}
