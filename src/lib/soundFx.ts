/**
 * High-Performance OGG Sound Effects Engine
 * Plays new .ogg SFX files with instant 0ms response via Web Audio Buffer Cache:
 * - /sfx/switch-on.ogg
 * - /sfx/switch-off.ogg
 * - /sfx/click.ogg
 * - /sfx/tab.ogg
 * - /sfx/success.ogg
 * - /sfx/modal-open.ogg
 * - /sfx/modal-close.ogg
 * - /sfx/notification.ogg
 * - /sfx/tick.ogg
 * - /sfx/alert.ogg
 */

type SfxName = 
  | 'switchOn' 
  | 'switchOff' 
  | 'click' 
  | 'tab' 
  | 'success' 
  | 'modalOpen' 
  | 'modalClose' 
  | 'notification' 
  | 'tick' 
  | 'alert';

const SFX_FILES: Record<SfxName, string> = {
  switchOn: '/sfx/switch-on.ogg?v=2',
  switchOff: '/sfx/switch-off.ogg?v=2',
  click: '/sfx/click.ogg',
  tab: '/sfx/tab.ogg',
  success: '/sfx/success.ogg?v=2',
  modalOpen: '/sfx/modal-open.ogg',
  modalClose: '/sfx/modal-close.ogg',
  notification: '/sfx/notification.ogg',
  tick: '/sfx/tick.ogg',
  alert: '/sfx/alert.ogg',
};

class SoundFxEngine {
  private ctx: AudioContext | null = null;
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private isEnabled: boolean = true;
  private isPreloading: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sfx_enabled');
      this.isEnabled = saved !== null ? saved === 'true' : true;
      
      // Auto preload on first user touch/click
      const preloadOnFirstInteraction = () => {
        this.preloadAll();
        window.removeEventListener('pointerdown', preloadOnFirstInteraction);
        window.removeEventListener('keydown', preloadOnFirstInteraction);
      };
      window.addEventListener('pointerdown', preloadOnFirstInteraction, { once: true });
      window.addEventListener('keydown', preloadOnFirstInteraction, { once: true });
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.ctx = new AudioContextClass();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  public preloadAll() {
    if (this.isPreloading || typeof window === 'undefined') return;
    this.isPreloading = true;
    const ctx = this.getContext();
    if (!ctx) return;

    Object.values(SFX_FILES).forEach(async (url) => {
      try {
        if (this.audioBuffers.has(url)) return;
        const res = await fetch(url);
        if (!res.ok) return;
        const arrayBuf = await res.arrayBuffer();
        ctx.decodeAudioData(arrayBuf, (decoded) => {
          this.audioBuffers.set(url, decoded);
        });
      } catch {}
    });
  }

  private async playOgg(name: SfxName, fallbackSynth?: () => void) {
    if (!this.isEnabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const url = SFX_FILES[name];

    // Check if buffer is already cached
    const cached = this.audioBuffers.get(url);
    if (cached) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = cached;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.6, ctx.currentTime);
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);
        return;
      } catch {}
    }

    // Try HTMLAudioElement as fast direct path
    try {
      const audio = new Audio(url);
      audio.volume = 0.6;
      audio.play().catch(() => {
        if (fallbackSynth) fallbackSynth();
      });
      
      // Also cache for next time
      fetch(url)
        .then(r => r.arrayBuffer())
        .then(b => ctx.decodeAudioData(b))
        .then(decoded => this.audioBuffers.set(url, decoded))
        .catch(() => {});
    } catch {
      if (fallbackSynth) fallbackSynth();
    }
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('sfx_enabled', String(enabled));
    }
  }

  public getEnabled(): boolean {
    return this.isEnabled;
  }

  public toggle(): boolean {
    this.setEnabled(!this.isEnabled);
    return this.isEnabled;
  }

  /**
   * Switch ON OGG sound: tactile Apple switch ON
   */
  public switchOn() {
    this.playOgg('switchOn', () => {
      const ctx = this.getContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.035);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.04);
    });
  }

  /**
   * Switch OFF OGG sound: muted mechanical Apple switch OFF
   */
  public switchOff() {
    this.playOgg('switchOff', () => {
      const ctx = this.getContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(320, t + 0.035);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.035);
    });
  }

  /**
   * Click OGG sound: crisp UI button tap
   */
  public click() {
    this.playOgg('click', () => {
      const ctx = this.getContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(380, t + 0.025);
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.025);
    });
  }

  /**
   * Tab OGG sound: navigation switch tone
   */
  public tab() {
    this.playOgg('tab', () => {
      const ctx = this.getContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.exponentialRampToValueAtTime(587.33, t + 0.05);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    });
  }

  /**
   * Success OGG sound: rewarding confirmation chime
   */
  public success() {
    this.playOgg('success');
  }

  /**
   * Modal Open OGG sound: bubble pop
   */
  public modalOpen() {
    this.playOgg('modalOpen');
  }

  /**
   * Modal Close OGG sound: gentle dismissal drop
   */
  public modalClose() {
    this.playOgg('modalClose');
  }

  /**
   * Tick OGG sound: micro-tap for copy
   */
  public tick() {
    this.playOgg('tick');
  }

  /**
   * Notification OGG sound: acoustic bell
   */
  public notification() {
    this.playOgg('notification');
  }

  /**
   * Alert OGG sound: gentle warning prompt
   */
  public alert() {
    this.playOgg('alert');
  }
}

export const soundFx = new SoundFxEngine();
