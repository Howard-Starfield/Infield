import confetti from 'canvas-confetti';
import { UiPreferences } from '../types';

class CelebrationService {
  private preferences: UiPreferences | null = null;
  private activeInterval: any = null;

  setPreferences(prefs: UiPreferences) {
    this.preferences = prefs;
  }

  celebrateOrder(amount: number) {
    if (!this.preferences?.confettiEnabled) return;
    
    if (amount >= (this.preferences?.confettiThreshold || 500)) {
      this.fireConfetti();
    }
  }

  private fireConfetti() {
    if (this.activeInterval) {
      clearInterval(this.activeInterval);
    }

    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    this.activeInterval = setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        clearInterval(this.activeInterval);
        this.activeInterval = null;
        return;
      }

      const particleCount = 50 * (timeLeft / duration);
      
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);
  }

  fireSingleBurst() {
    if (!this.preferences?.confettiEnabled) return;
    
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      zIndex: 9999
    });
  }
}

export const celebrationService = new CelebrationService();
