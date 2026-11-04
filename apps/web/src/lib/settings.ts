import { create } from 'zustand';
import { setSoundOptions } from './sound';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  particles: boolean;
  shake: boolean;
  reducedMotion: boolean;
  sound: boolean;
  volume: number;
  showNames: boolean;
}

const KEY = 'kydao.settings.v1';

const isSmall = () => window.matchMedia?.('(max-width: 820px), (pointer: coarse)').matches ?? false;

const defaults = (): Settings => ({
  quality: isSmall() ? 'medium' : 'high',
  particles: true,
  shake: true,
  reducedMotion: false,
  sound: true,
  volume: 0.7,
  showNames: false,
});

function load(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      for (const k of Object.keys(base) as (keyof Settings)[]) {
        if (typeof data[k] === typeof base[k]) (base as unknown as Record<string, unknown>)[k] = data[k];
      }
      if (!['low', 'medium', 'high'].includes(base.quality)) base.quality = 'medium';
    }
  } catch {
    /* dùng mặc định */
  }
  return base;
}

interface SettingsStore extends Settings {
  set(patch: Partial<Settings>): void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch);
    const { set: _omit, ...plain } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify(plain));
    } catch {
      /* chế độ riêng tư */
    }
    setSoundOptions({ volume: plain.volume, enabled: plain.sound });
  },
}));
setSoundOptions({ volume: useSettings.getState().volume, enabled: useSettings.getState().sound });

export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export const QUALITY = {
  low: { dpr: 1, shadow: 0, density: 0.4, physical: false },
  medium: { dpr: 1.5, shadow: 1024, density: 0.7, physical: false },
  high: { dpr: 2, shadow: 2048, density: 1, physical: true },
} as const;
