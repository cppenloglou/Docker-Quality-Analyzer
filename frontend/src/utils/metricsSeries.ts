import type { ContainerMetricsPayload } from "./api";

export interface MetricSample {
  timestamp: number;
  label: string;
  cpuPercent: number | null;
  memoryMb: number | null;
  memoryPercent: number | null;
  rxBps: number | null;
  txBps: number | null;
  readBps: number | null;
  writeBps: number | null;
}

export const DEFAULT_MAX_METRIC_POINTS = 120;
export const PERSIST_METRIC_POINTS = 60;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "-";
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatBps(bps: number | null | undefined): string {
  if (bps == null || Number.isNaN(bps)) return "-";
  return `${formatBytes(bps)}/s`;
}

function parseEventTimestamp(eventTimestamp: string | undefined): number {
  if (!eventTimestamp) return Date.now();
  const ts = new Date(eventTimestamp).getTime();
  return Number.isNaN(ts) ? Date.now() : ts;
}

function num(value: unknown): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

export function computeRates(
  prev: ContainerMetricsPayload | null,
  next: ContainerMetricsPayload,
  deltaMs: number,
): { rxBps: number | null; txBps: number | null; readBps: number | null; writeBps: number | null } {
  if (!prev || deltaMs <= 0) {
    return { rxBps: null, txBps: null, readBps: null, writeBps: null };
  }
  const deltaSec = deltaMs / 1000;
  const prevNet = prev.network?.totals;
  const nextNet = next.network?.totals;
  const prevRx = num(prevNet?.rx_bytes);
  const nextRx = num(nextNet?.rx_bytes);
  const prevTx = num(prevNet?.tx_bytes);
  const nextTx = num(nextNet?.tx_bytes);
  const prevRead = num(prev.io?.read_bytes);
  const nextRead = num(next.io?.read_bytes);
  const prevWrite = num(prev.io?.write_bytes);
  const nextWrite = num(next.io?.write_bytes);

  const rate = (before: number | null, after: number | null): number | null => {
    if (before == null || after == null || after < before) return null;
    return (after - before) / deltaSec;
  };

  return {
    rxBps: rate(prevRx, nextRx),
    txBps: rate(prevTx, nextTx),
    readBps: rate(prevRead, nextRead),
    writeBps: rate(prevWrite, nextWrite),
  };
}

export function appendMetricSample(
  points: MetricSample[],
  payload: ContainerMetricsPayload,
  eventTimestamp: string | undefined,
  prevPayload: ContainerMetricsPayload | null,
  maxPoints = DEFAULT_MAX_METRIC_POINTS,
): MetricSample[] {
  const timestamp = parseEventTimestamp(eventTimestamp);
  const prevTs = points.length > 0 ? points[points.length - 1].timestamp : null;
  const deltaMs = prevTs != null ? timestamp - prevTs : 0;
  const rates = computeRates(prevPayload, payload, deltaMs);

  const cpu = num(payload.cpu_percent) ?? num(payload.cpu?.percent);
  const memBytes = num(payload.memory_bytes) ?? num(payload.memory?.usage_bytes);
  const memoryMb = memBytes == null ? null : memBytes / (1024 * 1024);
  const memoryPercent = num(payload.memory_percent) ?? num(payload.memory?.percent);

  const sample: MetricSample = {
    timestamp,
    label: new Date(timestamp).toLocaleTimeString(),
    cpuPercent: cpu,
    memoryMb,
    memoryPercent,
    rxBps: rates.rxBps,
    txBps: rates.txBps,
    readBps: rates.readBps,
    writeBps: rates.writeBps,
  };

  return [...points, sample].slice(-maxPoints);
}

/** Trim payload for sessionStorage (drop bulky network interface maps). */
export function trimPayloadForPersist(payload: ContainerMetricsPayload): ContainerMetricsPayload {
  const { network, ...rest } = payload;
  return {
    ...rest,
    network: network
      ? {
          totals: network.totals,
        }
      : undefined,
  };
}
