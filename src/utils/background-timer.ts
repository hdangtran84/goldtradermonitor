/**
 * BackgroundTimer - Web Worker-based timer for background execution
 * 
 * Standard setInterval/setTimeout gets throttled to ~1 call per minute when
 * the browser tab is in the background. Web Workers run in a separate thread
 * and are not subject to the same throttling.
 * 
 * This utility provides:
 * 1. Web Worker-based accurate timers (not throttled)
 * 2. Fallback to standard timers if Workers unavailable
 * 3. Visibility-aware refresh (catch up on missed updates)
 * 
 * Usage:
 *   import { backgroundTimer } from '@/utils/background-timer';
 *   const id = backgroundTimer.setInterval(() => fetchData(), 60000);
 *   backgroundTimer.clearInterval(id);
 */

type TimerCallback = () => void;

interface TimerEntry {
  callback: TimerCallback;
  intervalMs: number;
  lastRun: number;
  isInterval: boolean;
}

interface WorkerMessage {
  type: 'tick' | 'init' | 'started';
  id?: number;
  timestamp?: number;
}

// Web Worker code as a string (will be converted to Blob URL)
const WORKER_CODE = `
// Background timer worker - runs independently of main thread throttling
const timers = new Map();
let nextId = 1;

function tick() {
  const now = Date.now();
  for (const [id, timer] of timers) {
    if (now >= timer.nextTick) {
      self.postMessage({ type: 'tick', id, timestamp: now });
      if (timer.isInterval) {
        timer.nextTick = now + timer.intervalMs;
      } else {
        timers.delete(id);
      }
    }
  }
}

// Run tick check every 100ms for accuracy
setInterval(tick, 100);

self.onmessage = function(e) {
  const { type, id, intervalMs, isInterval } = e.data;
  
  if (type === 'set') {
    timers.set(id, {
      intervalMs,
      isInterval,
      nextTick: Date.now() + intervalMs
    });
    self.postMessage({ type: 'started', id });
  } else if (type === 'clear') {
    timers.delete(id);
  } else if (type === 'clearAll') {
    timers.clear();
  }
};

self.postMessage({ type: 'init' });
`;

class BackgroundTimerManager {
  private worker: Worker | null = null;
  private workerReady = false;
  private timers: Map<number, TimerEntry> = new Map();
  private nextId = 1;
  private fallbackIntervals: Map<number, ReturnType<typeof setInterval>> = new Map();
  private pendingTimers: Array<{ id: number; intervalMs: number; isInterval: boolean }> = [];
  private useWorker = true;
  
  constructor() {
    this.initWorker();
  }
  
  /**
   * Initialize the Web Worker
   */
  private initWorker(): void {
    try {
      // Create worker from blob URL
      const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      
      this.worker = new Worker(workerUrl);
      
      this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const { type, id, timestamp } = e.data;
        
        if (type === 'init') {
          console.log('[BackgroundTimer] Worker initialized');
          this.workerReady = true;
          
          // Process any pending timer registrations
          for (const pending of this.pendingTimers) {
            this.worker?.postMessage({
              type: 'set',
              id: pending.id,
              intervalMs: pending.intervalMs,
              isInterval: pending.isInterval,
            });
          }
          this.pendingTimers = [];
        } else if (type === 'tick' && id !== undefined) {
          this.handleTick(id, timestamp);
        }
      };
      
      this.worker.onerror = (err) => {
        console.error('[BackgroundTimer] Worker error:', err);
        this.useWorker = false;
        this.migrateToFallback();
      };
      
      // Clean up blob URL after worker is created
      URL.revokeObjectURL(workerUrl);
      
    } catch (err) {
      console.warn('[BackgroundTimer] Worker creation failed, using fallback:', err);
      this.useWorker = false;
    }
  }
  
  /**
   * Handle tick from worker
   */
  private handleTick(id: number, timestamp?: number): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    
    timer.lastRun = timestamp || Date.now();
    
    try {
      timer.callback();
    } catch (err) {
      console.error(`[BackgroundTimer] Timer ${id} callback error:`, err);
    }
    
    // Remove one-shot timers
    if (!timer.isInterval) {
      this.timers.delete(id);
    }
  }
  
  /**
   * Migrate all timers to fallback mode
   */
  private migrateToFallback(): void {
    for (const [id, timer] of this.timers) {
      if (!this.fallbackIntervals.has(id)) {
        const intervalId = timer.isInterval
          ? setInterval(() => this.handleTick(id, Date.now()), timer.intervalMs)
          : setTimeout(() => this.handleTick(id, Date.now()), timer.intervalMs);
        this.fallbackIntervals.set(id, intervalId as ReturnType<typeof setInterval>);
      }
    }
  }
  
  /**
   * Set an interval that runs in background without throttling
   */
  setInterval(callback: TimerCallback, intervalMs: number): number {
    const id = this.nextId++;
    
    this.timers.set(id, {
      callback,
      intervalMs,
      lastRun: Date.now(),
      isInterval: true,
    });
    
    if (this.useWorker) {
      if (this.workerReady) {
        this.worker?.postMessage({
          type: 'set',
          id,
          intervalMs,
          isInterval: true,
        });
      } else {
        this.pendingTimers.push({ id, intervalMs, isInterval: true });
      }
    } else {
      // Fallback to standard setInterval
      const intervalId = setInterval(() => this.handleTick(id, Date.now()), intervalMs);
      this.fallbackIntervals.set(id, intervalId);
    }
    
    return id;
  }
  
  /**
   * Set a timeout that runs in background without throttling
   */
  setTimeout(callback: TimerCallback, delayMs: number): number {
    const id = this.nextId++;
    
    this.timers.set(id, {
      callback,
      intervalMs: delayMs,
      lastRun: Date.now(),
      isInterval: false,
    });
    
    if (this.useWorker) {
      if (this.workerReady) {
        this.worker?.postMessage({
          type: 'set',
          id,
          intervalMs: delayMs,
          isInterval: false,
        });
      } else {
        this.pendingTimers.push({ id, intervalMs: delayMs, isInterval: false });
      }
    } else {
      // Fallback to standard setTimeout
      const timeoutId = setTimeout(() => {
        this.handleTick(id, Date.now());
        this.fallbackIntervals.delete(id);
      }, delayMs);
      this.fallbackIntervals.set(id, timeoutId as unknown as ReturnType<typeof setInterval>);
    }
    
    return id;
  }
  
  /**
   * Clear an interval
   */
  clearInterval(id: number): void {
    this.timers.delete(id);
    
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'clear', id });
    }
    
    const fallback = this.fallbackIntervals.get(id);
    if (fallback) {
      clearInterval(fallback);
      this.fallbackIntervals.delete(id);
    }
  }
  
  /**
   * Clear a timeout (same as clearInterval for this implementation)
   */
  clearTimeout(id: number): void {
    this.clearInterval(id);
  }
  
  /**
   * Clear all timers
   */
  clearAll(): void {
    this.timers.clear();
    
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'clearAll' });
    }
    
    for (const fallback of this.fallbackIntervals.values()) {
      clearInterval(fallback);
    }
    this.fallbackIntervals.clear();
  }
  
  /**
   * Check for missed intervals and run catch-up if needed
   * Call this when tab becomes visible after being hidden
   */
  catchUp(maxCatchUpMs = 300000): void {
    const now = Date.now();
    
    for (const [id, timer] of this.timers) {
      if (!timer.isInterval) continue;
      
      const elapsed = now - timer.lastRun;
      const missedIntervals = Math.floor(elapsed / timer.intervalMs);
      
      if (missedIntervals > 0 && elapsed <= maxCatchUpMs) {
        console.log(`[BackgroundTimer] Timer ${id}: ${missedIntervals} missed intervals, running catch-up`);
        
        // Run callback once to catch up (not multiple times to avoid overload)
        try {
          timer.callback();
          timer.lastRun = now;
        } catch (err) {
          console.error(`[BackgroundTimer] Catch-up callback error:`, err);
        }
      }
    }
  }
  
  /**
   * Get info about all active timers
   */
  getActiveTimers(): Array<{ id: number; intervalMs: number; lastRun: number; isInterval: boolean }> {
    return Array.from(this.timers.entries()).map(([id, timer]) => ({
      id,
      intervalMs: timer.intervalMs,
      lastRun: timer.lastRun,
      isInterval: timer.isInterval,
    }));
  }
  
  /**
   * Check if Web Worker is being used
   */
  isUsingWorker(): boolean {
    return this.useWorker && this.workerReady;
  }
  
  /**
   * Destroy the timer manager
   */
  destroy(): void {
    this.clearAll();
    
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    this.workerReady = false;
  }
}

// Singleton instance
export const backgroundTimer = new BackgroundTimerManager();

// Export class for testing
export { BackgroundTimerManager };
