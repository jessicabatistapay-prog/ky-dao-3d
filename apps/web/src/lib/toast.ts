import { create } from 'zustand';

interface ToastState {
  text: string;
  nonce: number;
  show(text: string): void;
  clear(): void;
}

let timer = 0;
export const useToast = create<ToastState>((set, get) => ({
  text: '',
  nonce: 0,
  show(text) {
    clearTimeout(timer);
    set({ text, nonce: get().nonce + 1 });
    timer = window.setTimeout(() => set({ text: '' }), 1900);
  },
  clear: () => set({ text: '' }),
}));
export const toast = (text: string) => useToast.getState().show(text);
