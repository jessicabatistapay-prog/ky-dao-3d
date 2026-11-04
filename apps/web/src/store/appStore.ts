import { create } from 'zustand';

export type Screen = 'menu' | 'setup' | 'game' | 'online';

interface AppState {
  screen: Screen;
  dialog: 'settings' | 'rules' | null;
  go(screen: Screen): void;
  openDialog(d: 'settings' | 'rules' | null): void;
}

export const useApp = create<AppState>((set) => ({
  screen: 'menu',
  dialog: null,
  go: (screen) => set({ screen }),
  openDialog: (dialog) => set({ dialog }),
}));
