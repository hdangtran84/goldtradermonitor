/**
 * KeepAlive Utility for 24/7 Livestream Dashboard
 * 
 * Prevents browser tab from being throttled or suspended using multiple strategies:
 * 1. Wake Lock API (primary) - Modern browsers
 * 2. Silent Audio Loop (fallback) - Keeps audio context active to prevent throttling
 * 3. Visibility API monitoring - Tracks tab visibility state
 * 
 * Usage:
 *   import { keepAlive } from '@/utils/keep-alive';
 *   keepAlive.enable(); // Call on app init
 *   keepAlive.disable(); // Call on cleanup
 */

interface WakeLockSentinel {
  readonly released: boolean;
  readonly type: 'screen';
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockAPI {
  request(type: 'screen'): Promise<WakeLockSentinel>;
}

type VisibilityCallback = (isVisible: boolean) => void;

class KeepAliveManager {
  private wakeLockSentinel: WakeLockSentinel | null = null;
  private audioContext: AudioContext | null = null;
  private silentSource: AudioBufferSourceNode | null = null;
  private silentGainNode: GainNode | null = null;
  private isEnabled = false;
  private visibilityCallbacks: Set<VisibilityCallback> = new Set();
  private hiddenSince: number | null = null;
  private boundVisibilityHandler: () => void;
  private lastTickTime = 0;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  
  constructor() {
    this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
  }
  
  /**
   * Enable keep-alive mode for 24/7 operation
   */
  async enable(): Promise<void> {
    if (this.isEnabled) return;
    this.isEnabled = true;
    
    console.log('[KeepAlive] Enabling 24/7 mode...');
    
    // Add visibility change listener
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    
    // Try Wake Lock API first (modern Chrome, Edge, etc.)
    await this.requestWakeLock();
    
    // Start silent audio as fallback for throttling prevention
    this.startSilentAudio();
    
    // Start tick interval to keep JavaScript engine active
    this.startTickInterval();
    
    console.log('[KeepAlive] 24/7 mode enabled');
  }
  
  /**
   * Disable keep-alive mode
   */
  async disable(): Promise<void> {
    if (!this.isEnabled) return;
    this.isEnabled = false;
    
    console.log('[KeepAlive] Disabling 24/7 mode...');
    
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    
    await this.releaseWakeLock();
    this.stopSilentAudio();
    this.stopTickInterval();
    
    console.log('[KeepAlive] 24/7 mode disabled');
  }
  
  /**
   * Check if keep-alive mode is currently active
   */
  get isActive(): boolean {
    return this.isEnabled;
  }

  /**
   * Check if tab is currently visible
   */
  get isVisible(): boolean {
    return document.visibilityState === 'visible';
  }
  
  /**
   * Get timestamp when tab was hidden (null if visible)
   */
  getHiddenSince(): number | null {
    return this.hiddenSince;
  }
  
  /**
   * Get duration tab has been hidden in ms (0 if visible)
   */
  getHiddenDuration(): number {
    if (!this.hiddenSince) return 0;
    return Date.now() - this.hiddenSince;
  }
  
  /**
   * Subscribe to visibility changes
   */
  onVisibilityChange(callback: VisibilityCallback): () => void {
    this.visibilityCallbacks.add(callback);
    return () => this.visibilityCallbacks.delete(callback);
  }
  
  /**
   * Request Wake Lock API (prevents screen from sleeping)
   */
  private async requestWakeLock(): Promise<void> {
    // Check for Wake Lock API support
    const wakeLock = (navigator as { wakeLock?: WakeLockAPI }).wakeLock;
    
    if (!wakeLock) {
      console.log('[KeepAlive] Wake Lock API not supported');
      return;
    }
    
    try {
      this.wakeLockSentinel = await wakeLock.request('screen');
      
      this.wakeLockSentinel.addEventListener('release', () => {
        console.log('[KeepAlive] Wake Lock released');
        this.wakeLockSentinel = null;
        
        // Re-acquire wake lock when tab becomes visible again
        if (this.isEnabled && this.isVisible) {
          void this.requestWakeLock();
        }
      });
      
      console.log('[KeepAlive] Wake Lock acquired');
    } catch (err) {
      console.warn('[KeepAlive] Wake Lock request failed:', err);
    }
  }
  
  /**
   * Release Wake Lock
   */
  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch (err) {
        console.warn('[KeepAlive] Wake Lock release failed:', err);
      }
      this.wakeLockSentinel = null;
    }
  }
  
  /**
   * Start silent audio loop to prevent browser throttling
   * Browsers typically don't throttle tabs playing audio
   */
  private startSilentAudio(): void {
    try {
      // Create audio context
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        console.warn('[KeepAlive] AudioContext not supported');
        return;
      }
      
      this.audioContext = new AudioContextClass();
      
      // Create a very short silent buffer (0.1 seconds)
      const sampleRate = this.audioContext.sampleRate;
      const bufferSize = Math.floor(sampleRate * 0.1);
      const buffer = this.audioContext.createBuffer(1, bufferSize, sampleRate);
      
      // Fill with silence (zeros) - but add tiny imperceptible noise to
      // trick browser into thinking audio is playing
      const channelData = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        // Add minimal noise (essentially inaudible at -120dB)
        channelData[i] = (Math.random() - 0.5) * 0.000001;
      }
      
      // Create gain node to control volume (set to minimal)
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0.001; // Essentially silent
      this.silentGainNode.connect(this.audioContext.destination);
      
      // Create and start looping source
      this.createAndStartSource(buffer);
      
      console.log('[KeepAlive] Silent audio started');
    } catch (err) {
      console.warn('[KeepAlive] Silent audio setup failed:', err);
    }
  }
  
  /**
   * Create and start a new audio source (for looping)
   */
  private createAndStartSource(buffer: AudioBuffer): void {
    if (!this.audioContext || !this.silentGainNode) return;
    
    // Stop previous source if exists
    if (this.silentSource) {
      try {
        this.silentSource.stop();
        this.silentSource.disconnect();
      } catch {
        // Ignore errors from already stopped sources
      }
    }
    
    this.silentSource = this.audioContext.createBufferSource();
    this.silentSource.buffer = buffer;
    this.silentSource.loop = true;
    this.silentSource.connect(this.silentGainNode);
    this.silentSource.start();
  }
  
  /**
   * Stop silent audio
   */
  private stopSilentAudio(): void {
    if (this.silentSource) {
      try {
        this.silentSource.stop();
        this.silentSource.disconnect();
      } catch {
        // Ignore
      }
      this.silentSource = null;
    }
    
    if (this.silentGainNode) {
      try {
        this.silentGainNode.disconnect();
      } catch {
        // Ignore
      }
      this.silentGainNode = null;
    }
    
    if (this.audioContext) {
      try {
        void this.audioContext.close();
      } catch {
        // Ignore
      }
      this.audioContext = null;
    }
  }
  
  /**
   * Start a tick interval to keep JS engine active
   * This helps prevent aggressive throttling
   */
  private startTickInterval(): void {
    this.lastTickTime = Date.now();
    
    // Use a 1-second interval - this gets throttled to ~1min when hidden,
    // but the Web Worker timer (in background-timer.ts) will handle accurate timing
    this.tickInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastTickTime;
      
      // If elapsed time is much longer than expected, we were throttled
      if (elapsed > 10000) {
        console.log(`[KeepAlive] Detected throttling: ${elapsed}ms since last tick`);
      }
      
      this.lastTickTime = now;
      
      // Resume audio context if it was suspended
      if (this.audioContext?.state === 'suspended') {
        void this.audioContext.resume();
      }
    }, 1000);
  }
  
  /**
   * Stop tick interval
   */
  private stopTickInterval(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }
  
  /**
   * Handle visibility change events
   */
  private handleVisibilityChange(): void {
    const isVisible = this.isVisible;
    
    if (isVisible) {
      // Tab became visible
      const hiddenDuration = this.hiddenSince ? Date.now() - this.hiddenSince : 0;
      console.log(`[KeepAlive] Tab visible (was hidden for ${Math.round(hiddenDuration / 1000)}s)`);
      this.hiddenSince = null;
      
      // Re-acquire wake lock
      if (this.isEnabled) {
        void this.requestWakeLock();
      }
      
      // Resume audio context if needed
      if (this.audioContext?.state === 'suspended') {
        void this.audioContext.resume();
      }
    } else {
      // Tab became hidden
      console.log('[KeepAlive] Tab hidden');
      this.hiddenSince = Date.now();
    }
    
    // Notify all subscribers
    for (const callback of this.visibilityCallbacks) {
      try {
        callback(isVisible);
      } catch (err) {
        console.error('[KeepAlive] Visibility callback error:', err);
      }
    }
  }
  
  /**
   * Force refresh of all registered data sources
   * Call this when tab becomes visible after being hidden
   */
  forceRefresh(): void {
    // This triggers visibility callbacks which components can use to refresh
    for (const callback of this.visibilityCallbacks) {
      try {
        callback(true);
      } catch (err) {
        console.error('[KeepAlive] Force refresh callback error:', err);
      }
    }
  }
}

// Singleton instance
export const keepAlive = new KeepAliveManager();

// Export class for testing
export { KeepAliveManager };
