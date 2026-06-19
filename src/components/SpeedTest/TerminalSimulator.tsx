import { type RefObject } from "react";

interface TerminalSimulatorProps {
  terminalLogs: string[];
  activeProgressLine: string | null;
  cliInput: string;
  setCliInput: (v: string) => void;
  handleCliSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
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
    <div className="lg:col-span-4 w-full flex flex-1 flex-col bg-[#0a0a0a] rounded-lg border border-hairline overflow-hidden shadow-md lg:sticky lg:top-20">
      {/* macOS window header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#222222] bg-[#171717] select-none">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] opacity-80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] opacity-80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] opacity-80" />
        </div>
        <span className="text-[10px] font-mono text-mute tracking-wider uppercase">speedtest-cli --terminal</span>
        <div className="w-10" />
      </div>

      {/* Terminal output stream body */}
      <div
        ref={terminalBodyRef}
        className="h-full max-h-[calc(100vh-200px)] overflow-y-scroll p-4 flex flex-col gap-1.5 text-left font-mono text-[11px] leading-relaxed text-[#fafafa]"
      >
        {terminalLogs.map((log, index) => {
          let style: React.CSSProperties = { color: "#fafafa" };
          if (log.startsWith("$")) style = { color: "#50e3c2", fontWeight: "bold" };
          else if (log.includes("[OK]")) style = { color: "#0070f3", fontWeight: "500" };
          else if (log.includes("[PROBE]")) style = { color: "#888888" };
          else if (log.includes("[ERROR]") || log.startsWith("Error:")) style = { color: "#ee0000" };

          return (
            <div key={index} style={style} className="whitespace-pre-wrap">
              {log}
            </div>
          );
        })}
        {activeProgressLine && (
          <div style={{ color: "#e2e8f0" }} className="animate-pulse whitespace-pre-wrap">
            {activeProgressLine}
          </div>
        )}
      </div>

      {/* Terminal prompt input form */}
      <form
        onSubmit={handleCliSubmit}
        className="flex items-center gap-1.5 px-4 py-3 border-t border-[#222222]/80 bg-[#0c0c0c] text-[11px] font-mono text-[#00dfd8]"
      >
        <span>$</span>
        <input
          type="text"
          value={cliInput}
          onChange={(e) => setCliInput(e.target.value)}
          disabled={false}
          placeholder={phase !== "idle" && phase !== "complete" && phase !== "error" ? "Type 'stop' to cancel..." : "Type 'run' or 'help'..."}
          className="flex-1 bg-transparent border-none outline-hidden text-[#fafafa] font-mono p-0 focus:ring-0 text-[11px]"
        />
      </form>
    </div>
  );
}
