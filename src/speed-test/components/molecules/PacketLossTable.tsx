import type { DetailPingStats } from "../../types";

interface PacketLossTableProps {
  active: boolean;
  unloadedPingStats: DetailPingStats;
  dlLoadedPingStats: DetailPingStats;
  ulLoadedPingStats: DetailPingStats;
}

export default function PacketLossTable({
  active,
  unloadedPingStats,
  dlLoadedPingStats,
  ulLoadedPingStats,
}: PacketLossTableProps) {
  return (
    <div
      role="tabpanel"
      id="panel-packetLoss"
      aria-label="Packet loss measurements"
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
              {unloadedPingStats.sent > 0 ? unloadedPingStats.sent : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {unloadedPingStats.sent > 0 ? unloadedPingStats.lost : "-"}
            </td>
            <td
              className={`py-3 px-4 font-mono font-semibold tabular-nums ${unloadedPingStats.lost > 0 ? "text-error" : "text-body"}`}
            >
              {unloadedPingStats.sent > 0
                ? `${((unloadedPingStats.lost / unloadedPingStats.sent) * 100).toFixed(1)}%`
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
              {dlLoadedPingStats.sent > 0 ? dlLoadedPingStats.sent : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {dlLoadedPingStats.sent >= 10 ? dlLoadedPingStats.lost : "-"}
            </td>
            <td
              className={`py-3 px-4 font-mono font-semibold tabular-nums ${dlLoadedPingStats.sent >= 10 && dlLoadedPingStats.lost > 0 ? "text-error" : "text-body"}`}
            >
              {dlLoadedPingStats.sent >= 10
                ? `${((dlLoadedPingStats.lost / dlLoadedPingStats.sent) * 100).toFixed(1)}%`
                : dlLoadedPingStats.sent > 0 ? <span className="text-mute">N/A (samples &lt; 10)</span> : "-"}
            </td>
          </tr>
          {/* Upload Loaded Row */}
          <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
            <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-upload"></span>
              Upload Loaded
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {ulLoadedPingStats.sent > 0 ? ulLoadedPingStats.sent : "-"}
            </td>
            <td className="py-3 px-4 font-mono text-body tabular-nums">
              {ulLoadedPingStats.sent >= 10 ? ulLoadedPingStats.lost : "-"}
            </td>
            <td
              className={`py-3 px-4 font-mono font-semibold tabular-nums ${ulLoadedPingStats.sent >= 10 && ulLoadedPingStats.lost > 0 ? "text-error" : "text-body"}`}
            >
              {ulLoadedPingStats.sent >= 10
                ? `${((ulLoadedPingStats.lost / ulLoadedPingStats.sent) * 100).toFixed(1)}%`
                : ulLoadedPingStats.sent > 0 ? <span className="text-mute">N/A (samples &lt; 10)</span> : "-"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
