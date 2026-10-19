// Learns this phone's GPU memory limit. iOS gives no memory API: if Safari kills the page while a card's
// textures are being uploaded, the next start finds the "pending" marker and lowers the limit below that
// card's size, so the same card then loads with half textures instead of crashing again. The same happens when
// the GPU reports out-of-memory or drops the context during an upload while the app is visible.
// Stored in localStorage (a per-device hint; it moves to the IndexedDB settings store in M3).
import { DEFAULT_GPU_BUDGET } from './memory';

const KEY = 'binder.gpuLimit';

interface GpuLimitRecord {
  /** Upload in progress: bytes being loaded. */
  pending: number | null;
  /** Highest amount known to be too much, minus one byte; null = unknown. */
  limit: number | null;
}

function read(): GpuLimitRecord {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { pending: null, limit: null };
    const parsed = JSON.parse(raw) as Partial<GpuLimitRecord>;
    return {
      pending: typeof parsed.pending === 'number' ? parsed.pending : null,
      limit: typeof parsed.limit === 'number' ? parsed.limit : null,
    };
  } catch {
    return { pending: null, limit: null };
  }
}

function write(record: GpuLimitRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // storage unavailable: the limit is simply not remembered
  }
}

function lowerLimit(record: GpuLimitRecord, failedBytes: number): GpuLimitRecord {
  const limit = Math.min(record.limit ?? Infinity, failedBytes - 1);
  return { ...record, limit };
}

/** Call once at startup: an upload still marked pending means the previous session crashed during it. */
export function recoverAfterCrash(): void {
  const record = read();
  if (record.pending !== null) write({ ...lowerLimit(record, record.pending), pending: null });
}

export function gpuBudget(): number {
  const { limit } = read();
  return limit === null ? DEFAULT_GPU_BUDGET : Math.min(DEFAULT_GPU_BUDGET, limit);
}

export function gpuLimit(): number | null {
  return read().limit;
}

export function beginUpload(bytes: number): void {
  write({ ...read(), pending: bytes });
}

export function endUpload(): void {
  write({ ...read(), pending: null });
}

/** The GPU refused this amount (out of memory, or context lost while visible). */
export function reportUploadFailure(bytes: number): void {
  write({ ...lowerLimit(read(), bytes), pending: null });
}

/** Debug: forget what was learned. */
export function resetGpuLimit(): void {
  write({ pending: null, limit: null });
}
