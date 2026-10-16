export const defaultPresets = ['bass-booster'] as const;
export type Preset = (typeof defaultPresets)[number];

export interface FilterConfig {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
}

export const presetConfigs: Record<Preset, FilterConfig> = {
  'bass-booster': {
    Q: 100,
    frequency: 80,
    gain: 12.0,
    type: 'lowshelf',
  },
};
