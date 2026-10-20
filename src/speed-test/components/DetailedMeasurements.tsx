
import type { DetailPingStats, SpeedTestRequest } from "../types";
import { Wifi, AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import LatencyTable from "./molecules/LatencyTable";
import PacketLossTable from "./molecules/PacketLossTable";
import SpeedTable from "./molecules/SpeedTable";

interface DetailedMeasurementsProps {
  activeTab: "latency" | "packetLoss" | "download" | "upload";
  setActiveTab: (tab: "latency" | "packetLoss" | "download" | "upload") => void;
  unloadedPingStats: DetailPingStats;
  dlLoadedPingStats: DetailPingStats;
  ulLoadedPingStats: DetailPingStats;
  downloadRequests: SpeedTestRequest[];
  uploadRequests: SpeedTestRequest[];
}

export default function DetailedMeasurements({
  activeTab,
  setActiveTab,
  unloadedPingStats,
  dlLoadedPingStats,
  ulLoadedPingStats,
  downloadRequests,
  uploadRequests,
}: DetailedMeasurementsProps) {
  const tabs = [
    { id: "latency" as const, label: "Latency", icon: <Wifi className="w-3.5 h-3.5" /> },
    { id: "packetLoss" as const, label: "Packet Loss", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    { id: "download" as const, label: "Download Speeds", icon: <ArrowDown className="w-3.5 h-3.5" /> },
    { id: "upload" as const, label: "Upload Speeds", icon: <ArrowUp className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-canvas border border-hairline p-6 rounded-lg shadow-xs flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-hairline pb-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-mono text-mute uppercase tracking-wider">
            Detailed Analytics
          </span>
          <h2 className="text-lg font-semibold text-ink font-sans">
            Measurements Breakdown
          </h2>
        </div>

        {/* Tab selector container with horizontal scroll on mobile */}
        <div
          className="w-full sm:w-auto overflow-x-auto no-scrollbar scroll-smooth flex"
          role="tablist"
          aria-label="Measurement categories"
        >
          <div className="flex bg-canvas-soft-2 p-1 rounded-full border border-hairline min-w-max">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${tab.id}`}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-mono select-none cursor-pointer transition-[color,background-color,box-shadow] duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    isActive
                      ? "bg-primary text-on-primary font-semibold shadow-xs"
                      : "text-mute hover:text-ink"
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab contents */}
      <div className="overflow-x-auto w-full transition-opacity duration-200">
        <LatencyTable
          active={activeTab === "latency"}
          unloadedPingStats={unloadedPingStats}
          dlLoadedPingStats={dlLoadedPingStats}
          ulLoadedPingStats={ulLoadedPingStats}
        />
        <PacketLossTable
          active={activeTab === "packetLoss"}
          unloadedPingStats={unloadedPingStats}
          dlLoadedPingStats={dlLoadedPingStats}
          ulLoadedPingStats={ulLoadedPingStats}
        />
        <SpeedTable
          type="download"
          active={activeTab === "download"}
          requests={downloadRequests}
        />
        <SpeedTable
          type="upload"
          active={activeTab === "upload"}
          requests={uploadRequests}
        />
      </div>
    </div>
  );
}
