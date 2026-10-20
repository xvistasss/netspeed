import type { SpeedTestRequest } from "../../types";
import { CONFIG } from "../../constants";
import { calculateMean, calculateMedian, calculateMin, calculateMax } from "../../utils";

interface SpeedTableProps {
  type: "download" | "upload";
  active: boolean;
  requests: SpeedTestRequest[];
}

export default function SpeedTable({ type, active, requests }: SpeedTableProps) {
  const bins = type === "download" ? CONFIG.DOWNLOAD_BINS : CONFIG.UPLOAD_BINS;
  const label = type === "download" ? "Download speed measurements" : "Upload speed measurements";

  return (
    <div
      role="tabpanel"
      id={`panel-${type}`}
      aria-label={label}
      aria-hidden={!active}
      tabIndex={0}
      className={!active ? "hidden" : undefined}
    >
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-canvas-soft border-b border-hairline text-mute">
            <th scope="col" className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">
              {type === "download" ? "STREAM PHASE" : "CHUNK PAYLOAD SIZE"}
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
          {bins.map((bin) => {
            const binReqs = requests.filter(
              (r) => r.bytes > 0 && r.phaseSize >= bin.minBytes && r.phaseSize < bin.maxBytes,
            );
            const speeds = binReqs.map((r) => r.bps / 1000000);
            const hasData = speeds.length > 0;

            return (
              <tr
                key={bin.name}
                className="hover:bg-canvas-soft/40 transition-colors duration-150"
              >
                <td className="py-3 px-4 font-medium text-ink">
                  {type === "download" && binReqs[0]?.phaseName ? binReqs[0].phaseName : bin.name}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {hasData ? calculateMean(speeds).toFixed(1) : "-"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {hasData ? calculateMedian(speeds).toFixed(1) : "-"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {hasData ? calculateMin(speeds).toFixed(1) : "-"}
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">
                  {hasData ? calculateMax(speeds).toFixed(1) : "-"}
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
  );
}
