export type AudioBus = 'music' | 'ambience' | 'sfx' | 'vocals';

export type MusicState = 'silent' | 'intro' | 'combat' | 'corporate' | 'victory' | 'defeat';

export type AudioCueId =
  | 'intro.oar.stroke'
  | 'whale.vocal.near'
  | 'whale.vocal.deep'
  | 'whale.breach.start'
  | 'whale.breach.impact'
  | 'whale.tail.slap'
  | 'harpoon.fire'
  | 'harpoon.attach'
  | 'harpoon.snap'
  | 'cannon.telegraph'
  | 'cannon.fire'
  | 'cannon.impact'
  | 'cannon.splash'
  | 'hull.groan'
  | 'ship.sink'
  | 'crew.shout'
  | 'crew.scream'
  | 'corporate.arrival'
  | 'rescue.success'
  | 'rescue.failure'
  | 'victory'
  | 'defeat';

export interface AudioAssetEntry {
  bus: AudioBus;
  loop?: boolean;
  maxDistance?: number;
  playbackRate?: number;
  refDistance?: number;
  src: string;
  volume?: number;
}

export interface AudioManifest {
  ambience: string[];
  assets: Record<string, AudioAssetEntry>;
  cues: Record<AudioCueId, string[]>;
  music: Record<MusicState, string[]>;
  version: number;
}

export interface AudioVectorLike {
  x: number;
  y: number;
  z: number;
}

export interface AudioSnapshot {
  activeTethers: number;
  cameraForward: AudioVectorLike;
  cameraPosition: AudioVectorLike;
  corporateActive: boolean;
  rescueProgress: number;
  underwaterRatio: number;
  whaleSpeed: number;
}

export interface PlayCueOptions {
  intensity?: number;
  playbackRate?: number;
  volume?: number;
}
