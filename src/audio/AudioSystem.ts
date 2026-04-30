import {
  AudioBus,
  AudioCueId,
  AudioManifest,
  AudioSnapshot,
  AudioVectorLike,
  MusicState,
  PlayCueOptions,
} from './types';

const MANIFEST_URL = '/audio/manifest.json';
const MASTER_VOLUME = 0.88;
const MUSIC_FADE_SECONDS = 1.4;
const AMBIENCE_FADE_SECONDS = 1;

const REQUIRED_MUSIC_STATES: readonly MusicState[] = ['silent', 'intro', 'combat', 'corporate', 'victory', 'defeat'];
const REQUIRED_CUES: readonly AudioCueId[] = [
  'intro.oar.stroke',
  'whale.vocal.near',
  'whale.vocal.deep',
  'whale.breach.start',
  'whale.breach.impact',
  'whale.tail.slap',
  'harpoon.fire',
  'harpoon.attach',
  'harpoon.snap',
  'cannon.telegraph',
  'cannon.fire',
  'cannon.impact',
  'cannon.splash',
  'hull.groan',
  'ship.sink',
  'crew.shout',
  'crew.scream',
  'corporate.arrival',
  'rescue.success',
  'rescue.failure',
  'victory',
  'defeat',
];

const CUE_COOLDOWNS: Partial<Record<AudioCueId, number>> = {
  'intro.oar.stroke': 0.38,
  'whale.vocal.near': 5.5,
  'whale.vocal.deep': 8,
  'whale.breach.start': 1.2,
  'whale.breach.impact': 1.2,
  'whale.tail.slap': 0.7,
  'harpoon.fire': 0.08,
  'harpoon.attach': 0.18,
  'harpoon.snap': 0.22,
  'cannon.telegraph': 0.45,
  'cannon.fire': 0.12,
  'cannon.impact': 0.12,
  'cannon.splash': 0.12,
  'hull.groan': 1.6,
  'ship.sink': 0.6,
  'crew.shout': 2.8,
  'crew.scream': 1.2,
  'corporate.arrival': 8,
  'rescue.success': 8,
  'rescue.failure': 8,
  victory: 8,
  defeat: 8,
};

const LAYERED_CUES = new Set<AudioCueId>([
  'whale.breach.start',
  'whale.breach.impact',
  'whale.tail.slap',
  'harpoon.fire',
  'harpoon.attach',
  'ship.sink',
  'corporate.arrival',
  'rescue.success',
  'rescue.failure',
  'victory',
  'defeat',
]);

interface BusNodes {
  filter: BiquadFilterNode;
  gain: GainNode;
  input: GainNode;
}

interface LoopInstance {
  assetId: string;
  baseVolume: number;
  gain: GainNode;
  source: AudioBufferSourceNode;
}

type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export class AudioSystem {
  private readonly context: AudioContext | null;
  private readonly masterGain: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly buses: Record<AudioBus, BusNodes> | null = null;
  private readonly lastCueTimes = new Map<AudioCueId, number>();
  private readonly activeMusic = new Map<string, LoopInstance>();
  private readonly activeAmbience = new Map<string, LoopInstance>();
  private readonly cameraPosition = { x: 0, y: 0, z: 0 };
  private readonly cameraForward = { x: 0, y: 0, z: 1 };
  private manifest: AudioManifest | null = null;
  private currentMusicState: MusicState = 'silent';
  private loadPromise: Promise<void> | null = null;
  private unlocked = false;
  private disposed = false;
  private muted = false;
  private underwaterRatio = 0;
  private corporatePressure = 0;

  constructor() {
    const AudioContextCtor = (window as BrowserWindow).AudioContext ?? (window as BrowserWindow).webkitAudioContext;
    this.context = AudioContextCtor ? new AudioContextCtor() : null;

    if (this.context) {
      const master = this.context.createGain();
      this.masterGain = master;
      this.applyMasterVolume();
      master.connect(this.context.destination);

      this.buses = {
        music: this.createBus(master),
        ambience: this.createBus(master),
        sfx: this.createBus(master),
        vocals: this.createBus(master),
      };
      this.applyBusMix(0);
    }

    this.bindUnlockListeners();
    this.loadPromise = this.load();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): boolean {
    this.muted = muted;
    this.applyMasterVolume(0.12);
    return this.muted;
  }

  setMusicState(state: MusicState): void {
    this.currentMusicState = state;
    this.syncMusicLoops();
  }

  playCue(id: AudioCueId, position?: AudioVectorLike, options: PlayCueOptions = {}): void {
    if (!this.context || !this.buses || !this.manifest || !this.unlocked || this.disposed) {
      return;
    }

    const now = this.context.currentTime;
    const cooldown = CUE_COOLDOWNS[id] ?? 0;
    const lastPlayed = this.lastCueTimes.get(id) ?? -Infinity;

    if (now - lastPlayed < cooldown) {
      return;
    }

    const assetIds = this.manifest.cues[id];
    if (!assetIds?.length) {
      this.reportAudioError(`Missing audio cue: ${id}`);
      return;
    }

    this.lastCueTimes.set(id, now);

    const selectedAssets = LAYERED_CUES.has(id)
      ? assetIds
      : [assetIds[Math.floor(Math.random() * assetIds.length)]];

    for (const assetId of selectedAssets) {
      this.playAsset(assetId, position, options);
    }
  }

  updateOceanMix(snapshot: AudioSnapshot): void {
    this.cameraPosition.x = snapshot.cameraPosition.x;
    this.cameraPosition.y = snapshot.cameraPosition.y;
    this.cameraPosition.z = snapshot.cameraPosition.z;
    this.cameraForward.x = snapshot.cameraForward.x;
    this.cameraForward.y = snapshot.cameraForward.y;
    this.cameraForward.z = snapshot.cameraForward.z;
    this.underwaterRatio = clamp01(snapshot.underwaterRatio);
    this.corporatePressure = snapshot.corporateActive ? 1 : Math.max(0, this.corporatePressure - 0.015);

    if (!this.context || !this.buses || !this.manifest || !this.unlocked || this.disposed) {
      return;
    }

    this.ensureAmbienceLoops();
    this.applyBusMix(this.underwaterRatio);
    this.updateAmbienceMix(snapshot);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('pointerdown', this.unlock, true);
    window.removeEventListener('keydown', this.unlock, true);

    for (const loop of [...this.activeMusic.values(), ...this.activeAmbience.values()]) {
      loop.source.stop();
    }

    this.activeMusic.clear();
    this.activeAmbience.clear();
    void this.context?.close();
  }

  private async load(): Promise<void> {
    if (!this.context) {
      return;
    }

    const context = this.context;
    const manifestResponse = await fetch(MANIFEST_URL);

    if (!manifestResponse.ok) {
      throw new Error(`Failed to load ${MANIFEST_URL}: ${manifestResponse.status}`);
    }

    const manifest = (await manifestResponse.json()) as AudioManifest;
    this.validateManifest(manifest);

    await Promise.all(
      Object.entries(manifest.assets).map(async ([assetId, asset]) => {
        const response = await fetch(asset.src);

        if (!response.ok) {
          throw new Error(`Failed to load audio asset ${assetId} from ${asset.src}: ${response.status}`);
        }

        const data = await response.arrayBuffer();
        this.buffers.set(assetId, await context.decodeAudioData(data));
      }),
    );

    this.manifest = manifest;

    if (this.unlocked) {
      this.syncMusicLoops();
      this.ensureAmbienceLoops();
    }
  }

  private bindUnlockListeners(): void {
    window.addEventListener('pointerdown', this.unlock, true);
    window.addEventListener('keydown', this.unlock, true);
  }

  private readonly unlock = (): void => {
    if (!this.context || this.disposed) {
      return;
    }

    this.unlocked = true;
    void this.context.resume();
    window.removeEventListener('pointerdown', this.unlock, true);
    window.removeEventListener('keydown', this.unlock, true);
    void this.loadPromise
      ?.then(() => {
        this.syncMusicLoops();
        this.ensureAmbienceLoops();
      })
      .catch((error) => this.reportAudioError(error instanceof Error ? error.message : String(error)));
  };

  private createBus(master: AudioNode): BusNodes {
    if (!this.context) {
      throw new Error('Missing AudioContext');
    }

    const input = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 12000;
    filter.Q.value = 0.65;
    gain.gain.value = 1;
    input.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    return { input, filter, gain };
  }

  private validateManifest(manifest: AudioManifest): void {
    const missing: string[] = [];

    for (const state of REQUIRED_MUSIC_STATES) {
      if (!manifest.music[state]) {
        missing.push(`music.${state}`);
      }
    }

    for (const cue of REQUIRED_CUES) {
      if (!manifest.cues[cue]?.length) {
        missing.push(`cue.${cue}`);
      }
    }

    for (const assetIds of [
      ...Object.values(manifest.music),
      ...Object.values(manifest.cues),
      manifest.ambience,
    ]) {
      for (const assetId of assetIds) {
        if (!manifest.assets[assetId]) {
          missing.push(`asset.${assetId}`);
        }
      }
    }

    if (missing.length > 0) {
      this.reportAudioError(`Audio manifest is missing: ${missing.join(', ')}`);
    }
  }

  private syncMusicLoops(): void {
    if (!this.context || !this.manifest || !this.unlocked || this.disposed) {
      return;
    }

    const targetAssetIds = new Set(this.manifest.music[this.currentMusicState] ?? []);

    for (const [assetId, loop] of this.activeMusic) {
      if (!targetAssetIds.has(assetId)) {
        this.fadeOutLoop(loop, MUSIC_FADE_SECONDS);
        this.activeMusic.delete(assetId);
      }
    }

    for (const assetId of targetAssetIds) {
      if (!this.activeMusic.has(assetId)) {
        this.activeMusic.set(assetId, this.startLoop(assetId, MUSIC_FADE_SECONDS));
      }
    }
  }

  private ensureAmbienceLoops(): void {
    if (!this.context || !this.manifest || !this.unlocked || this.disposed) {
      return;
    }

    for (const assetId of this.manifest.ambience) {
      if (!this.activeAmbience.has(assetId)) {
        this.activeAmbience.set(assetId, this.startLoop(assetId, AMBIENCE_FADE_SECONDS, true));
      }
    }
  }

  private startLoop(assetId: string, fadeSeconds: number, randomOffset = false): LoopInstance {
    if (!this.context || !this.manifest || !this.buses) {
      throw new Error('Audio system not ready');
    }

    const asset = this.manifest.assets[assetId];
    const buffer = this.buffers.get(assetId);

    if (!asset || !buffer) {
      throw new Error(`Missing audio loop asset: ${assetId}`);
    }

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const bus = this.buses[asset.bus];
    const baseVolume = asset.volume ?? 1;
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = asset.playbackRate ?? 1;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(bus.input);

    const now = this.context.currentTime;
    const offset = randomOffset && buffer.duration > 0.1 ? Math.random() * buffer.duration : 0;
    source.start(now, offset);
    rampGain(gain, now, baseVolume, fadeSeconds);
    return { assetId, baseVolume, gain, source };
  }

  private fadeOutLoop(loop: LoopInstance, fadeSeconds: number): void {
    if (!this.context) {
      return;
    }

    const now = this.context.currentTime;
    rampGain(loop.gain, now, 0, fadeSeconds);
    loop.source.stop(now + fadeSeconds + 0.05);
  }

  private playAsset(assetId: string, position: AudioVectorLike | undefined, options: PlayCueOptions): void {
    if (!this.context || !this.manifest || !this.buses) {
      return;
    }

    const asset = this.manifest.assets[assetId];
    const buffer = this.buffers.get(assetId);

    if (!asset || !buffer) {
      this.reportAudioError(`Missing audio asset: ${assetId}`);
      return;
    }

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const pan = this.context.createStereoPanner();
    const distanceGain = position ? this.computeDistanceGain(position, asset) : 1;
    const baseVolume = asset.volume ?? 1;
    const intensity = options.intensity ?? 1;
    const randomRate = 1 + (Math.random() - 0.5) * 0.08;

    source.buffer = buffer;
    source.playbackRate.value = (options.playbackRate ?? asset.playbackRate ?? 1) * randomRate;
    gain.gain.value = baseVolume * (options.volume ?? 1) * intensity * distanceGain;
    pan.pan.value = position ? this.computePan(position) : 0;

    source.connect(gain);
    gain.connect(pan);
    pan.connect(this.buses[asset.bus].input);
    source.start();
  }

  private computeDistanceGain(position: AudioVectorLike, asset: { maxDistance?: number; refDistance?: number }): number {
    const refDistance = asset.refDistance ?? 12;
    const maxDistance = Math.max(refDistance + 1, asset.maxDistance ?? 120);
    const distance = horizontalDistance(position, this.cameraPosition);

    if (distance <= refDistance) {
      return 1;
    }

    return Math.max(0.12, 1 - (distance - refDistance) / (maxDistance - refDistance));
  }

  private computePan(position: AudioVectorLike): number {
    const forwardLength = Math.hypot(this.cameraForward.x, this.cameraForward.z) || 1;
    const forwardX = this.cameraForward.x / forwardLength;
    const forwardZ = this.cameraForward.z / forwardLength;
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const offsetX = position.x - this.cameraPosition.x;
    const offsetZ = position.z - this.cameraPosition.z;
    const distance = Math.hypot(offsetX, offsetZ) || 1;
    return clamp((offsetX * rightX + offsetZ * rightZ) / distance, -0.78, 0.78);
  }

  private applyBusMix(underwaterRatio: number): void {
    if (!this.context || !this.buses) {
      return;
    }

    const now = this.context.currentTime;
    const musicGain = lerp(0.86, 0.36, underwaterRatio);
    const sfxGain = lerp(0.92, 0.42, underwaterRatio);
    const ambienceGain = lerp(0.78, 0.92, underwaterRatio);
    const vocalGain = lerp(0.7, 0.82, underwaterRatio);

    this.setBus(this.buses.music, lerp(10500, 850, underwaterRatio), musicGain, now);
    this.setBus(this.buses.ambience, lerp(9800, 720, underwaterRatio), ambienceGain, now);
    this.setBus(this.buses.sfx, lerp(11000, 900, underwaterRatio), sfxGain, now);
    this.setBus(this.buses.vocals, lerp(9200, 3200, underwaterRatio), vocalGain, now);
  }

  private updateAmbienceMix(snapshot: AudioSnapshot): void {
    if (!this.context || !this.manifest) {
      return;
    }

    const now = this.context.currentTime;
    const underwater = clamp01(snapshot.underwaterRatio);
    const pressure = clamp01(snapshot.whaleSpeed / 24) * 0.16 + clamp01(snapshot.activeTethers / 3) * 0.18;
    const rescueDread = clamp01(snapshot.rescueProgress) * 0.12;

    for (const [assetId, loop] of this.activeAmbience) {
      let target = loop.baseVolume;

      if (assetId === 'ambience.surface') {
        target *= (1 - underwater) * 0.9 + 0.08;
      } else if (assetId === 'ambience.underwater') {
        target *= 0.12 + underwater * (0.78 + pressure);
      } else if (assetId === 'ambience.deepRumble') {
        target *= this.corporatePressure * 0.75 + rescueDread;
      }

      rampGain(loop.gain, now, target, 0.5);
    }
  }

  private setBus(bus: BusNodes, frequency: number, gain: number, now: number): void {
    bus.filter.frequency.setTargetAtTime(frequency, now, 0.08);
    bus.gain.gain.setTargetAtTime(gain, now, 0.08);
  }

  private applyMasterVolume(fadeSeconds = 0): void {
    if (!this.context || !this.masterGain || this.disposed) {
      return;
    }

    const targetVolume = this.muted ? 0 : MASTER_VOLUME;

    if (fadeSeconds <= 0) {
      this.masterGain.gain.value = targetVolume;
      return;
    }

    rampGain(this.masterGain, this.context.currentTime, targetVolume, fadeSeconds);
  }

  private reportAudioError(message: string): void {
    if (import.meta.env.DEV) {
      throw new Error(message);
    }

    console.warn(message);
  }
}

function rampGain(gain: GainNode, now: number, target: number, duration: number): void {
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(Math.max(0, target), now + Math.max(0.01, duration));
}

function horizontalDistance(a: AudioVectorLike, b: AudioVectorLike): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}
