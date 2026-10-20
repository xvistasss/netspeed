import { useRef, useCallback, useEffect } from "react";
import { CONFIG, SPEED_TEST_THEME } from "../constants";


// Lazy-loaded Chart.js module — only loaded when first test starts
let ChartJSModule: typeof import("chart.js") | null = null;
let ChartJSInstance: any = null;

async function ensureChartJS() {
  if (ChartJSModule) return ChartJSModule;
  ChartJSModule = await import("chart.js");
  ChartJSInstance = ChartJSModule.Chart;
  ChartJSInstance.register(
    ChartJSModule.CategoryScale,
    ChartJSModule.LinearScale,
    ChartJSModule.PointElement,
    ChartJSModule.LineElement,
    ChartJSModule.LineController,
    ChartJSModule.Filler,
    ChartJSModule.Tooltip,
    ChartJSModule.Legend,
  );
  return ChartJSModule;
}

export function useSpeedTestCharts(theme: "light" | "dark") {
  const downloadChartRef = useRef<HTMLCanvasElement | null>(null);
  const uploadChartRef = useRef<HTMLCanvasElement | null>(null);
  const downloadChartInstance = useRef<any>(null);
  const uploadChartInstance = useRef<any>(null);
  const downloadSpeedHistory = useRef<number[]>([]);
  const uploadSpeedHistory = useRef<number[]>([]);

  const lastChartUpdate = useRef<number>(0);
  const pendingChartUpdate = useRef<{ type: "download" | "upload"; mbps: number } | null>(null);
  const chartRafId = useRef<number | null>(null);

  const CHART_THROTTLE_MS = 500;

  const destroyCharts = useCallback(() => {
    if (downloadChartInstance.current) {
      downloadChartInstance.current.destroy();
      downloadChartInstance.current = null;
    }
    if (uploadChartInstance.current) {
      uploadChartInstance.current.destroy();
      uploadChartInstance.current = null;
    }
  }, []);

  const initCharts = useCallback(async () => {
    destroyCharts();
    downloadSpeedHistory.current = [];
    uploadSpeedHistory.current = [];

    const mod = await ensureChartJS();
    const ChartClass = mod.Chart;
    const gridColor = theme === "dark" ? "#222222" : "#ebebeb";
    const textColor = theme === "dark" ? "#a1a1a1" : "#888888";

    if (downloadChartRef.current) {
      downloadChartInstance.current = new ChartClass(downloadChartRef.current, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Download Speed",
              data: [],
              borderColor: SPEED_TEST_THEME.accentDownload,
              backgroundColor: "rgba(235, 111, 32, 0.08)",
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
            },
            {
              label: "90th Percentile",
              data: [],
              borderColor: theme === "dark" ? "#444444" : "#b5b5b5",
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            x: { grid: { display: false }, ticks: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: "JetBrains Mono", size: 10 },
                callback: (val: string | number) => `${val} M`,
                maxTicksLimit: 6,
                padding: 4,
              },
            },
          },
        },
      });
    }

    if (uploadChartRef.current) {
      uploadChartInstance.current = new ChartClass(uploadChartRef.current, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Upload Speed",
              data: [],
              borderColor: SPEED_TEST_THEME.accentUpload,
              backgroundColor: "rgba(139, 92, 246, 0.08)",
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
            },
            {
              label: "90th Percentile",
              data: [],
              borderColor: theme === "dark" ? "#444444" : "#b5b5b5",
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            x: { grid: { display: false }, ticks: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: "JetBrains Mono", size: 10 },
                callback: (val: string | number) => `${val} M`,
                maxTicksLimit: 6,
                padding: 4,
              },
            },
          },
        },
      });
    }
  }, [theme, destroyCharts]);

  const computeP95 = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const p95Idx = Math.min(Math.ceil(arr.length * 0.95) - 1, arr.length - 1);
    const sample = arr.length <= 200 ? [...arr] : arr;
    sample.sort((a, b) => a - b);
    return sample[p95Idx] || 0;
  };

  const renderChart = useCallback((type: "download" | "upload") => {
    const chart = type === "download" ? downloadChartInstance.current : uploadChartInstance.current;
    const history = type === "download" ? downloadSpeedHistory : uploadSpeedHistory;
    if (!chart || history.current.length === 0) return;

    chart.data.labels = history.current.map(() => "");
    chart.data.datasets[0].data = history.current;

    const p95 = computeP95(history.current);
    chart.data.datasets[1].data = history.current.map(() => p95);

    let currentMax = 0;
    for (const v of history.current) {
      if (v > currentMax) currentMax = v;
    }
    const rawMax = Math.max(10, currentMax * 1.3);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const dynamicMax = Math.ceil(rawMax / magnitude) * magnitude;
    if (chart.options.scales?.y) {
      (chart.options.scales.y as any).max = dynamicMax;
    }

    chart.update("none");
  }, []);

  const updateThroughputChart = useCallback(
    (type: "download" | "upload", mbps: number) => {
      const history = type === "download" ? downloadSpeedHistory : uploadSpeedHistory;
      history.current.push(mbps);
      if (history.current.length > CONFIG.CHART_MAX_POINTS) history.current.shift();

      const now = performance.now();
      if (now - lastChartUpdate.current < CHART_THROTTLE_MS) {
        pendingChartUpdate.current = { type, mbps };
        return;
      }
      lastChartUpdate.current = now;
      pendingChartUpdate.current = null;

      renderChart(type);
    },
    [renderChart],
  );

  useEffect(() => {
    const gridColor = theme === "dark" ? "#222222" : "#ebebeb";
    const textColor = theme === "dark" ? "#a1a1a1" : "#888888";
    for (const chart of [downloadChartInstance.current, uploadChartInstance.current]) {
      if (chart) {
        const opts = chart.options as any;
        if (opts.scales?.y) {
          opts.scales.y.grid.color = gridColor;
          opts.scales.y.ticks.color = textColor;
        }
        chart.update("none");
      }
    }
  }, [theme]);

  useEffect(() => {
    return () => {
      destroyCharts();
      if (chartRafId.current) cancelAnimationFrame(chartRafId.current);
    };
  }, [destroyCharts]);

  return {
    downloadChartRef,
    uploadChartRef,
    initCharts,
    destroyCharts,
    updateThroughputChart,
  };
}
