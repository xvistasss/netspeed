/**
 * Canonical Component Exports for Speed Test Feature
 * Single Source of Truth (SSOT)
 */

// Atoms
export { default as InfoTooltip } from "./atoms/InfoTooltip";
export { default as LocationPrompt } from "./atoms/LocationPrompt";
export { default as TestProgressBar } from "./atoms/TestProgressBar";

// Molecules
export { default as SpeedHero } from "./molecules/SpeedHero";
export { default as ThroughputCard } from "./molecules/ThroughputCard";
export { default as MetricsStack } from "./molecules/MetricsStack";
export { default as LatencyTable } from "./molecules/LatencyTable";
export { default as PacketLossTable } from "./molecules/PacketLossTable";
export { default as SpeedTable } from "./molecules/SpeedTable";

// Organisms / Feature Blocks
export { default as SpeedTest } from "./SpeedTest";
export { default as DetailedMeasurements } from "./DetailedMeasurements";
export { default as QualityScores } from "./QualityScores";
export { default as TechnicalLogs } from "./TechnicalLogs";
export { default as TerminalSimulator } from "./TerminalSimulator";
export { default as FAQ } from "./FAQ.astro";
