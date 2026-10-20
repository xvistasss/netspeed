/**
 * Pure Mathematical Statistics Utilities for Network Diagnostics
 * Single Source of Truth (SSOT)
 */

export const calculateMean = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
};

// Trimmed mean: discard top and bottom 10% of samples before averaging.
// This eliminates GC pauses, OS scheduler hiccups, and transient spikes.
// For small arrays (<= 10 samples), use median instead - more robust for small N.
export const calculateTrimmedMean = (arr: number[], trimPercent: number = 0.1): number => {
  if (arr.length === 0) return 0;
  if (arr.length <= 10) return calculateMedian(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  const trimCount = Math.max(1, Math.floor(sorted.length * trimPercent));
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  if (trimmed.length === 0) return calculateMean(arr);
  return trimmed.reduce((sum, val) => sum + val, 0) / trimmed.length;
};

export const calculateMedian = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const calculateMin = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  return arr.reduce((min, val) => (val < min ? val : min), arr[0]);
};

export const calculateMax = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  return arr.reduce((max, val) => (val > max ? val : max), arr[0]);
};

export const calculateJitter = (arr: number[]): number => {
  if (arr.length <= 1) return 0;
  let sumSquaredDiffs = 0;
  for (let i = 1; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    sumSquaredDiffs += diff * diff;
  }
  return Math.sqrt(sumSquaredDiffs / (arr.length - 1));
};

// RFC 3550 RMS jitter calculation - more sensitive to large spikes
export const calculateJitterRMS = (arr: number[]): number => {
  if (arr.length <= 1) return 0;
  let sumSquaredDiffs = 0;
  for (let i = 1; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    sumSquaredDiffs += diff * diff;
  }
  return Math.sqrt(sumSquaredDiffs / (arr.length - 1));
};

// MASD jitter (Mean Absolute Successive Differences)
export const calculateJitterMASD = (arr: number[]): number => {
  if (arr.length <= 1) return 0;
  let sumDiffs = 0;
  for (let i = 1; i < arr.length; i++) {
    sumDiffs += Math.abs(arr[i] - arr[i - 1]);
  }
  return sumDiffs / (arr.length - 1);
};

export const calculateStdDev = (arr: number[]): number => {
  if (arr.length <= 1) return 0;
  const mean = calculateMean(arr);
  const squaredDiffs = arr.map((v) => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / (arr.length - 1));
};

// Median Absolute Deviation - robust measure of variability
export const calculateMAD = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const med = calculateMedian(arr);
  const absDiffs = arr.map((v) => Math.abs(v - med));
  return calculateMedian(absDiffs);
};

// Remove outliers beyond N * MAD from the median.
// More robust than sigma-based filtering because MAD is resistant to outliers itself.
export const removeOutliers = (arr: number[], threshold: number = 3): number[] => {
  if (arr.length <= 3) return arr;
  const mad = calculateMAD(arr);
  if (mad === 0) return arr;
  const med = calculateMedian(arr);
  const madThreshold = mad * threshold;
  return arr.filter((v) => Math.abs(v - med) <= madThreshold);
};

// Filtered RMS jitter - removes outliers before calculating RFC 3550 jitter.
export const calculateFilteredJitter = (arr: number[], outlierSigma: number = 3): number => {
  if (arr.length <= 2) return calculateJitterRMS(arr);
  const filtered = removeOutliers(arr, outlierSigma);
  return calculateJitterRMS(filtered);
};

// Percentile calculation using Nearest Rank method
export const calculatePercentile = (arr: number[], percentile: number): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
};
