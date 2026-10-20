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
  | 'hover'
  | 'alert';

const SFX_FILES: Record<SfxName, string> = {
  switchOn: '/sfx/switch-on.ogg?v=5',
  switchOff: '/sfx/switch-off.ogg?v=5',
  click: '/sfx/click.ogg?v=5',
  tab: '/sfx/tab.ogg?v=5',
  success: '/sfx/success.ogg?v=5',
  modalOpen: '/sfx/modal-open.ogg?v=5',
  modalClose: '/sfx/modal-close.ogg?v=5',
  notification: '/sfx/notification.ogg?v=5',
  tick: '/sfx/tick.ogg?v=5',
  hover: '/sfx/hover.ogg?v=5',
  alert: '/sfx/alert.ogg?v=5',
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
      
      // Auto unlock/preload audio on first user touch/click/cursor movement
      const unlockAudio = () => {
        this.preloadAll();
        const ctx = this.getContext();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      };
      window.addEventListener('pointerdown', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });
      window.addEventListener('pointerenter', unlockAudio, { once: true, passive: true });

      // Global interactive hover feedback on clickable elements (desktop mouse cursor only, volume ~40%)
      let lastHoverTime = 0;
      let lastHoverEl: Element | null = null;

      document.addEventListener('pointerover', (e) => {
        // Ignore touchscreen touches so mobile interactions stay clean and silent
        if (e.pointerType === 'touch') return;
        if (!this.isEnabled) return;

        const target = e.target as Element | null;
        if (!target || typeof target.closest !== 'function') return;

        let clickable: Element | null = target.closest(
          'button, a, [role="button"], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], select, .cursor-pointer, [onclick]'
        );
        if (!clickable && target instanceof HTMLElement) {
          try {
            if (window.getComputedStyle(target).cursor === 'pointer') {
              clickable = target;
            }
          } catch {}
        }
        if (!clickable) {
          lastHoverEl = null;
          return;
        }

        if (clickable === lastHoverEl) return;

        const now = performance.now();
        if (now - lastHoverTime < 65) return;

        lastHoverTime = now;
        lastHoverEl = clickable;
        this.hover(0.4);
      }, { passive: true });
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

  private async playOgg(name: SfxName, fallbackSynth?: () => void, customVolume?: number) {
    if (!this.isEnabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const url = SFX_FILES[name];
    const defaultVol = (name === 'tick' || name === 'hover') ? 0.4 : 0.6;
    const vol = customVolume !== undefined ? customVolume : defaultVol;

    // Check if buffer is already cached
    const cached = this.audioBuffers.get(url);
    if (cached) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = cached;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);
        return;
      } catch {}
    }

    // Try HTMLAudioElement as fast direct path
    try {
      const audio = new Audio(url);
      audio.volume = vol;
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
   * Click sound: muted (user requested sound only when hovering, not clicking: "chứ không phải click")
   */
  public click() {
    // Intentionally silent
  }

  /**
   * Tab sound: muted
   */
  public tab() {
    // Intentionally silent
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
   * Hover sound: gentle Kenney UI select_001 blip when hovering clickable elements (~40% volume)
   */
  public hover(volume = 0.4) {
    this.playOgg('hover', () => {
      const ctx = this.getContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(650, t);
      osc.frequency.exponentialRampToValueAtTime(850, t + 0.04);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.04);
    }, volume);
  }

  /**
   * Tick OGG sound: micro-tap for copy or lightweight actions (~40% volume)
   */
  public tick(volume = 0.4) {
    this.playOgg('tick', undefined, volume);
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
