/**
 * SOUND_SERVICE.ts
 * Professional audio management for Kinetic Vault.
 * Source: Production-ready local assets.
 */

const SOUNDS = {
  // These should be placed in public/audio/ in a real production build
  MONEY: '/audio/cash-register.mp3',
  NOTIFICATION: '/audio/notification-chime.mp3'
};

class SoundService {
  private audioMap: Map<string, HTMLAudioElement> = new Map();
  private lastPlayTime: Map<string, number> = new Map();
  private MIN_INTERVAL = 300; 

  constructor() {
    // In production, we assume these exist in the public folder
    Object.entries(SOUNDS).forEach(([key, url]) => {
      const audio = new Audio(url);
      audio.preload = 'auto';
      this.audioMap.set(key, audio);
    });
  }

  private getSettings() {
    const volume = localStorage.getItem('vault-volume');
    const enabled = localStorage.getItem('vault-sound-enabled');
    return {
      volume: volume ? parseFloat(volume) : 0.5,
      enabled: enabled === null ? true : enabled === 'true'
    };
  }

  private async play(key: string) {
    const { volume, enabled } = this.getSettings();
    if (!enabled) return;

    const now = Date.now();
    const last = this.lastPlayTime.get(key) || 0;
    if (now - last < this.MIN_INTERVAL) return;

    const audio = this.audioMap.get(key);
    if (audio) {
      try {
        audio.currentTime = 0;
        audio.volume = volume;
        await audio.play();
        this.lastPlayTime.set(key, now);
      } catch (e) {
        console.warn(`SoundService: Could not play ${key}. Ensure the file exists in 'public/audio/'. Use the 'Open Audio Folder' button in Settings to place your files.`, e);
      }
    }
  }

  playMoney() { this.play('MONEY'); }
  playNotification() { this.play('NOTIFICATION'); }
}

export const soundService = new SoundService();
