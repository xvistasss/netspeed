import React from 'react';
import type { DetailPingStats } from '../../utils/speedTestUtils';
import {
  calculateMean,
  calculateMedian,
  calculateMin,
  calculateMax,
  calculateJitter
} from '../../utils/speedTestUtils';

interface DetailedMeasurementsProps {
  activeTab: 'latency' | 'packetLoss' | 'download' | 'upload';
  setActiveTab: (tab: 'latency' | 'packetLoss' | 'download' | 'upload') => void;
  unloadedPingStats: DetailPingStats;
  dlLoadedPingStats: DetailPingStats;
  ulLoadedPingStats: DetailPingStats;
  downloadRequests: any[];
  uploadRequests: any[];
}

export default function DetailedMeasurements({
  activeTab,
  setActiveTab,
  unloadedPingStats,
  dlLoadedPingStats,
  ulLoadedPingStats,
  downloadRequests,
  uploadRequests
}: DetailedMeasurementsProps) {
  return (
    <div className="bg-canvas border border-hairline p-6 rounded-lg shadow-xs flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-hairline pb-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-mono text-mute uppercase tracking-wider">Detailed Analytics</span>
          <h2 className="text-lg font-semibold text-ink font-sans">Measurements Breakdown</h2>
        </div>
        
        {/* Tab selector */}
        <div className="flex flex-wrap gap-1 bg-canvas-soft-2 p-1 rounded-full border border-hairline">
          {(['latency', 'packetLoss', 'download', 'upload'] as const).map((tab) => {
            const isActive = activeTab === tab;
            const labels: Record<string, string> = {
              latency: 'Latency',
              packetLoss: 'Packet Loss',
              download: 'Download Speeds',
              upload: 'Upload Speeds'
            };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                type="button"
                className={`px-3 py-1 rounded-full text-xs font-mono select-none cursor-pointer transition-[color,background-color,box-shadow] duration-150 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary ${
                  isActive
                    ? 'bg-primary text-on-primary font-semibold shadow-xs'
                    : 'text-mute hover:text-ink'
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab contents */}
      <div className="overflow-x-auto w-full transition-opacity duration-200">
        {activeTab === 'latency' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-canvas-soft border-b border-hairline text-mute">
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">STAGE</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">AVG (MS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MEDIAN (MS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MIN (MS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MAX (MS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">JITTER (MS)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {/* Unloaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                  Unloaded (Idle)
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{unloadedPingStats.latencies.length > 0 ? calculateMean(unloadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{unloadedPingStats.latencies.length > 0 ? calculateMedian(unloadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{unloadedPingStats.latencies.length > 0 ? calculateMin(unloadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{unloadedPingStats.latencies.length > 0 ? calculateMax(unloadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{unloadedPingStats.latencies.length > 0 ? calculateJitter(unloadedPingStats.latencies).toFixed(1) : '—'}</td>
              </tr>
              {/* Download Loaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#eb6f20]"></span>
                  Download Loaded
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{dlLoadedPingStats.latencies.length > 0 ? calculateMean(dlLoadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{dlLoadedPingStats.latencies.length > 0 ? calculateMedian(dlLoadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{dlLoadedPingStats.latencies.length > 0 ? calculateMin(dlLoadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{dlLoadedPingStats.latencies.length > 0 ? calculateMax(dlLoadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{dlLoadedPingStats.latencies.length > 0 ? calculateJitter(dlLoadedPingStats.latencies).toFixed(1) : '—'}</td>
              </tr>
              {/* Upload Loaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]"></span>
                  Upload Loaded
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{ulLoadedPingStats.latencies.length > 0 ? calculateMean(ulLoadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{ulLoadedPingStats.latencies.length > 0 ? calculateMedian(ulLoadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{ulLoadedPingStats.latencies.length > 0 ? calculateMin(ulLoadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{ulLoadedPingStats.latencies.length > 0 ? calculateMax(ulLoadedPingStats.latencies).toFixed(1) : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{ulLoadedPingStats.latencies.length > 0 ? calculateJitter(ulLoadedPingStats.latencies).toFixed(1) : '—'}</td>
              </tr>
            </tbody>
          </table>
        )}

        {activeTab === 'packetLoss' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-canvas-soft border-b border-hairline text-mute">
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">STAGE</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">PACKETS SENT</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">PACKETS LOST</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">LOSS RATE (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {/* Unloaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                  Unloaded (Idle)
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{unloadedPingStats.sent > 0 ? unloadedPingStats.sent : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{unloadedPingStats.sent > 0 ? unloadedPingStats.lost : '—'}</td>
                <td className={`py-3 px-4 font-mono font-semibold tabular-nums ${unloadedPingStats.lost > 0 ? 'text-error' : 'text-body'}`}>
                  {unloadedPingStats.sent > 0 ? `${((unloadedPingStats.lost / unloadedPingStats.sent) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
              {/* Download Loaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#eb6f20]"></span>
                  Download Loaded
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{dlLoadedPingStats.sent > 0 ? dlLoadedPingStats.sent : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{dlLoadedPingStats.sent > 0 ? dlLoadedPingStats.lost : '—'}</td>
                <td className={`py-3 px-4 font-mono font-semibold tabular-nums ${dlLoadedPingStats.lost > 0 ? 'text-error' : 'text-body'}`}>
                  {dlLoadedPingStats.sent > 0 ? `${((dlLoadedPingStats.lost / dlLoadedPingStats.sent) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
              {/* Upload Loaded Row */}
              <tr className="hover:bg-canvas-soft/40 transition-colors duration-150">
                <td className="py-3 px-4 font-medium text-ink flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]"></span>
                  Upload Loaded
                </td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{ulLoadedPingStats.sent > 0 ? ulLoadedPingStats.sent : '—'}</td>
                <td className="py-3 px-4 font-mono text-body tabular-nums">{ulLoadedPingStats.sent > 0 ? ulLoadedPingStats.lost : '—'}</td>
                <td className={`py-3 px-4 font-mono font-semibold tabular-nums ${ulLoadedPingStats.lost > 0 ? 'text-error' : 'text-body'}`}>
                  {ulLoadedPingStats.sent > 0 ? `${((ulLoadedPingStats.lost / ulLoadedPingStats.sent) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {activeTab === 'download' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-canvas-soft border-b border-hairline text-mute">
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">PAYLOAD SIZE</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">AVG SPEED (MBPS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MEDIAN (MBPS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MIN SPEED (MBPS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MAX SPEED (MBPS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MEASUREMENTS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {(() => {
                const bins = [
                  { name: '100 kB', filter: (r: any) => r.bytes < 500 * 1024 },
                  { name: '1 MB', filter: (r: any) => r.bytes >= 500 * 1024 && r.bytes < 5 * 1024 * 1024 },
                  { name: '10 MB', filter: (r: any) => r.bytes >= 5 * 1024 * 1024 && r.bytes < 15 * 1024 * 1024 },
                  { name: '25 MB', filter: (r: any) => r.bytes >= 15 * 1024 * 1024 }
                ];

                return bins.map((bin) => {
                  const binReqs = downloadRequests.filter(bin.filter);
                  const speeds = binReqs.map(r => r.bps / 1000000);
                  const hasData = speeds.length > 0;

                  return (
                    <tr key={bin.name} className="hover:bg-canvas-soft/40 transition-colors duration-150">
                      <td className="py-3 px-4 font-medium text-ink">{bin.name}</td>
                      <td className="py-3 px-4 font-mono text-body tabular-nums">{hasData ? calculateMean(speeds).toFixed(1) : '—'}</td>
                      <td className="py-3 px-4 font-mono text-body tabular-nums">{hasData ? calculateMedian(speeds).toFixed(1) : '—'}</td>
                      <td className="py-3 px-4 font-mono text-body tabular-nums">{hasData ? calculateMin(speeds).toFixed(1) : '—'}</td>
                      <td className="py-3 px-4 font-mono text-body tabular-nums">{hasData ? calculateMax(speeds).toFixed(1) : '—'}</td>
                      <td className="py-3 px-4 font-mono text-mute tabular-nums">{speeds.length}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        )}

        {activeTab === 'upload' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-canvas-soft border-b border-hairline text-mute">
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">PAYLOAD SIZE</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">AVG SPEED (MBPS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MEDIAN (MBPS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MIN SPEED (MBPS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MAX SPEED (MBPS)</th>
                <th className="py-2.5 px-4 font-mono font-normal tracking-wider text-[10px]">MEASUREMENTS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {(() => {
                const bins = [
                  { name: '100 kB', filter: (r: any) => r.bytes < 500 * 1024 },
                  { name: '1 MB', filter: (r: any) => r.bytes >= 500 * 1024 && r.bytes < 5 * 1024 * 1024 },
                  { name: '10 MB', filter: (r: any) => r.bytes >= 5 * 1024 * 1024 }
                ];

                return bins.map((bin) => {
                  const binReqs = uploadRequests.filter(bin.filter);
                  const speeds = binReqs.map(r => r.bps / 1000000);
                  const hasData = speeds.length > 0;

                  return (
                    <tr key={bin.name} className="hover:bg-canvas-soft/40 transition-colors duration-150">
                      <td className="py-3 px-4 font-medium text-ink">{bin.name}</td>
                      <td className="py-3 px-4 font-mono text-body tabular-nums">{hasData ? calculateMean(speeds).toFixed(1) : '—'}</td>
                      <td className="py-3 px-4 font-mono text-body tabular-nums">{hasData ? calculateMedian(speeds).toFixed(1) : '—'}</td>
                      <td className="py-3 px-4 font-mono text-body tabular-nums">{hasData ? calculateMin(speeds).toFixed(1) : '—'}</td>
                      <td className="py-3 px-4 font-mono text-body tabular-nums">{hasData ? calculateMax(speeds).toFixed(1) : '—'}</td>
                      <td className="py-3 px-4 font-mono text-mute tabular-nums">{speeds.length}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
