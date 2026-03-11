import { create } from 'zustand';

interface ControlState {
  intensity: number;
  speed: number;
  wind: number;
  saturation: number;
  glare: number;
  holoThickness: number;
  setControls: (controls: Partial<Omit<ControlState, 'setControls'>>) => void;
}

export const useStore = create<ControlState>((set) => ({
  intensity: 0.12,
  speed: 1.97,
  wind: 0.21,
  saturation: 0.38,
  glare: 1.59,
  holoThickness: 1.5,
  setControls: (controls) => set((state) => ({ ...state, ...controls })),
}));
