import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_DIR = path.join(ROOT_DIR, 'public/audio');
const TMP_DIR = path.join(AUDIO_DIR, '.import-tmp');
const CREDITS_PATH = path.join(ROOT_DIR, 'docs/audio_credits.md');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'manifest.json');

const DOWNLOADS = [
  {
    id: 'music.shanty',
    url: 'https://opengameart.org/sites/default/files/oga_jam_menu_music_loopable_0.ogg',
    output: 'music/sailors-chant.ogg',
  },
  {
    id: 'music.dread',
    url: 'https://opengameart.org/sites/default/files/lost_2.ogg',
    output: 'music/lost-in-a-bad-place.ogg',
  },
  {
    id: 'ambience.surface',
    url: 'https://opengameart.org/sites/default/files/jasinski-wave-prev.ogg',
    output: 'ambience/ocean-waves.ogg',
  },
  {
    id: 'ambience.underwater',
    url: 'https://opengameart.org/sites/default/files/underwater_or_space_engine_0.ogg',
    output: 'ambience/underwater-rumble.ogg',
  },
  {
    id: 'ambience.deepRumble',
    url: 'https://opengameart.org/sites/default/files/deep_rumble.ogg',
    output: 'ambience/deep-rumble.ogg',
  },
  {
    id: 'sfx.cannon.fire',
    url: 'https://opengameart.org/sites/default/files/cannon_fire_1.ogg',
    output: 'sfx/cannon-fire.ogg',
  },
  {
    id: 'sfx.cannon.hit',
    url: 'https://opengameart.org/sites/default/files/cannon_hit_1.ogg',
    output: 'sfx/cannon-hit.ogg',
  },
  {
    id: 'sfx.cannon.miss',
    url: 'https://opengameart.org/sites/default/files/cannon_miss_1.ogg',
    output: 'sfx/cannon-miss.ogg',
  },
  {
    id: 'sfx.hull.hit',
    url: 'https://opengameart.org/sites/default/files/cannon_hit_ship_short.ogg',
    output: 'sfx/hull-hit.ogg',
  },
  {
    id: 'sfx.ship.destroyed',
    url: 'https://opengameart.org/sites/default/files/ship_destroyed_short.ogg',
    output: 'sfx/ship-destroyed.ogg',
  },
  {
    id: 'sfx.hull.groan',
    url: 'https://opengameart.org/sites/default/files/ship_ram_ship_shortened.ogg',
    output: 'sfx/hull-groan.ogg',
  },
  {
    id: 'sfx.harpoon.throw',
    url: 'https://opengameart.org/sites/default/files/spear.wav',
    output: 'sfx/harpoon-throw.wav',
  },
  {
    id: 'sfx.harpoon.snapLayer',
    url: 'https://opengameart.org/sites/default/files/snd_throw1.wav',
    output: 'sfx/harpoon-throw-short.wav',
  },
  {
    id: 'sfx.crew.scream',
    url: 'https://opengameart.org/sites/default/files/screams_0.ogg',
    output: 'sfx/crew-screams.ogg',
  },
  {
    id: 'vocal.whale.sperm',
    url: 'https://www.fisheries.noaa.gov/s3/2023-04/Phma-clicks-NOAA-PAGroup-01-sperm-clip.mp3',
    output: 'vocals/sperm-whale-clicks.mp3',
  },
  {
    id: 'vocal.whale.humpback',
    url: 'https://www.fisheries.noaa.gov/s3/2023-04/Meno-song-NOAA-PAGroup-13-humpback-clip.mp3',
    output: 'vocals/humpback-whale-song.mp3',
  },
  {
    id: 'vocal.whale.fin',
    url: 'https://www.fisheries.noaa.gov/s3/2023-04/Baph-song-NOAA-PAGroup-05-x5speed-fin-clip.mp3',
    output: 'vocals/fin-whale-song.mp3',
  },
  {
    id: 'vocal.whale.right',
    url: 'https://www.fisheries.noaa.gov/s3/2023-04/Eugl-upcall-NOAA-PAGroup-01-right-clip-1.mp3',
    output: 'vocals/right-whale-upcall.mp3',
  },
];

const ZIP_DOWNLOADS = [
  {
    id: 'thwack',
    url: 'https://opengameart.org/sites/default/files/thwack-1.0.zip',
    archive: 'thwack-1.0.zip',
    entries: [
      { from: 'PCM/thwack-06.wav', to: 'sfx/tether-snap-a.wav' },
      { from: 'PCM/thwack-08.wav', to: 'sfx/tether-snap-b.wav' },
      { from: 'PCM/thwack-10.wav', to: 'sfx/tail-slap-thwack.wav' },
    ],
  },
  {
    id: 'crew-yells',
    url: 'https://opengameart.org/sites/default/files/yelling%20sounds.zip',
    archive: 'yelling-sounds.zip',
    entries: [
      { from: 'yelling sounds/1yell2.wav', to: 'sfx/crew-shout-a.wav' },
      { from: 'yelling sounds/2yell3.wav', to: 'sfx/crew-shout-b.wav' },
      { from: 'yelling sounds/3yell7.wav', to: 'sfx/crew-shout-c.wav' },
    ],
  },
];

const LOCAL_ASSETS = [
  {
    source: 'source-assets/audio/fog-bells-below.mp3',
    output: 'music/fog-bells-below.mp3',
  },
  {
    source: 'source-assets/audio/corporate-sting.mp3',
    output: 'sfx/corporate-sting.mp3',
  },
  {
    source: 'source-assets/audio/ded.mp3',
    output: 'sfx/ded.mp3',
  },
];

const manifest = {
  version: 1,
  assets: {
    'music.shanty': {
      src: '/audio/music/sailors-chant.ogg',
      bus: 'music',
      loop: true,
      volume: 0.08,
      playbackRate: 0.76,
    },
    'music.dread': {
      src: '/audio/music/lost-in-a-bad-place.ogg',
      bus: 'music',
      loop: true,
      volume: 0.48,
    },
    'music.fogBellsBelow': {
      src: '/audio/music/fog-bells-below.mp3',
      bus: 'music',
      loop: true,
      volume: 0.42,
    },
    'ambience.surface': {
      src: '/audio/ambience/ocean-waves.ogg',
      bus: 'ambience',
      loop: true,
      volume: 0.42,
    },
    'ambience.underwater': {
      src: '/audio/ambience/underwater-rumble.ogg',
      bus: 'ambience',
      loop: true,
      volume: 0.5,
    },
    'ambience.deepRumble': {
      src: '/audio/ambience/deep-rumble.ogg',
      bus: 'ambience',
      loop: true,
      volume: 0.34,
    },
    'sfx.cannon.fire': {
      src: '/audio/sfx/cannon-fire.ogg',
      bus: 'sfx',
      volume: 0.52,
      refDistance: 18,
      maxDistance: 150,
    },
    'sfx.cannon.hit': {
      src: '/audio/sfx/cannon-hit.ogg',
      bus: 'sfx',
      volume: 0.46,
      refDistance: 15,
      maxDistance: 130,
    },
    'sfx.cannon.miss': {
      src: '/audio/sfx/cannon-miss.ogg',
      bus: 'sfx',
      volume: 0.4,
      refDistance: 12,
      maxDistance: 125,
    },
    'sfx.hull.hit': {
      src: '/audio/sfx/hull-hit.ogg',
      bus: 'sfx',
      volume: 0.45,
      refDistance: 16,
      maxDistance: 120,
    },
    'sfx.ship.destroyed': {
      src: '/audio/sfx/ship-destroyed.ogg',
      bus: 'sfx',
      volume: 0.56,
      refDistance: 20,
      maxDistance: 160,
    },
    'sfx.hull.groan': {
      src: '/audio/sfx/hull-groan.ogg',
      bus: 'sfx',
      volume: 0.26,
      refDistance: 18,
      maxDistance: 115,
    },
    'sfx.harpoon.throw': {
      src: '/audio/sfx/harpoon-throw.wav',
      bus: 'sfx',
      volume: 0.34,
      playbackRate: 1.35,
      refDistance: 10,
      maxDistance: 90,
    },
    'sfx.harpoon.throwShort': {
      src: '/audio/sfx/harpoon-throw-short.wav',
      bus: 'sfx',
      volume: 0.22,
      playbackRate: 1.1,
      refDistance: 10,
      maxDistance: 90,
    },
    'sfx.tether.snapA': {
      src: '/audio/sfx/tether-snap-a.wav',
      bus: 'sfx',
      volume: 0.32,
      playbackRate: 0.82,
      refDistance: 12,
      maxDistance: 105,
    },
    'sfx.tether.snapB': {
      src: '/audio/sfx/tether-snap-b.wav',
      bus: 'sfx',
      volume: 0.28,
      playbackRate: 0.78,
      refDistance: 12,
      maxDistance: 105,
    },
    'sfx.tail.thwack': {
      src: '/audio/sfx/tail-slap-thwack.wav',
      bus: 'sfx',
      volume: 0.42,
      playbackRate: 0.62,
      refDistance: 18,
      maxDistance: 145,
    },
    'sfx.crew.scream': {
      src: '/audio/sfx/crew-screams.ogg',
      bus: 'sfx',
      volume: 0.18,
      refDistance: 12,
      maxDistance: 95,
    },
    'sfx.crew.shoutA': {
      src: '/audio/sfx/crew-shout-a.wav',
      bus: 'sfx',
      volume: 0.13,
      playbackRate: 0.92,
      refDistance: 16,
      maxDistance: 118,
    },
    'sfx.crew.shoutB': {
      src: '/audio/sfx/crew-shout-b.wav',
      bus: 'sfx',
      volume: 0.12,
      playbackRate: 1.04,
      refDistance: 16,
      maxDistance: 118,
    },
    'sfx.crew.shoutC': {
      src: '/audio/sfx/crew-shout-c.wav',
      bus: 'sfx',
      volume: 0.11,
      playbackRate: 0.86,
      refDistance: 16,
      maxDistance: 118,
    },
    'sfx.stinger.corporate': {
      src: '/audio/sfx/corporate-sting.mp3',
      bus: 'sfx',
      volume: 0.64,
    },
    'sfx.defeat': {
      src: '/audio/sfx/ded.mp3',
      bus: 'sfx',
      volume: 0.72,
    },
    'vocal.whale.sperm': {
      src: '/audio/vocals/sperm-whale-clicks.mp3',
      bus: 'vocals',
      volume: 0.3,
      playbackRate: 0.72,
      refDistance: 20,
      maxDistance: 180,
    },
    'vocal.whale.humpback': {
      src: '/audio/vocals/humpback-whale-song.mp3',
      bus: 'vocals',
      volume: 0.42,
      playbackRate: 0.66,
      refDistance: 26,
      maxDistance: 210,
    },
    'vocal.whale.fin': {
      src: '/audio/vocals/fin-whale-song.mp3',
      bus: 'vocals',
      volume: 0.34,
      playbackRate: 0.68,
      refDistance: 28,
      maxDistance: 220,
    },
    'vocal.whale.right': {
      src: '/audio/vocals/right-whale-upcall.mp3',
      bus: 'vocals',
      volume: 0.3,
      playbackRate: 0.72,
      refDistance: 24,
      maxDistance: 190,
    },
  },
  music: {
    silent: [],
    intro: ['music.fogBellsBelow', 'ambience.deepRumble'],
    combat: ['music.fogBellsBelow'],
    corporate: ['music.fogBellsBelow', 'ambience.deepRumble'],
    victory: ['music.fogBellsBelow'],
    defeat: ['music.fogBellsBelow', 'ambience.deepRumble'],
  },
  ambience: ['ambience.surface', 'ambience.underwater'],
  cues: {
    'intro.oar.stroke': ['sfx.harpoon.throwShort'],
    'whale.vocal.near': ['vocal.whale.humpback', 'vocal.whale.fin', 'vocal.whale.right'],
    'whale.vocal.deep': ['vocal.whale.sperm', 'vocal.whale.humpback'],
    'whale.breach.start': ['vocal.whale.humpback', 'sfx.cannon.miss'],
    'whale.breach.impact': ['sfx.cannon.hit', 'sfx.hull.hit', 'vocal.whale.fin'],
    'whale.tail.slap': ['sfx.tail.thwack', 'sfx.cannon.miss'],
    'harpoon.fire': ['sfx.harpoon.throw', 'sfx.harpoon.throwShort'],
    'harpoon.attach': ['sfx.hull.hit', 'sfx.tether.snapA'],
    'harpoon.snap': ['sfx.tether.snapA', 'sfx.tether.snapB'],
    'cannon.telegraph': ['sfx.hull.groan'],
    'cannon.fire': ['sfx.cannon.fire'],
    'cannon.impact': ['sfx.cannon.hit'],
    'cannon.splash': ['sfx.cannon.miss'],
    'hull.groan': ['sfx.hull.groan'],
    'ship.sink': ['sfx.ship.destroyed', 'sfx.crew.scream'],
    'crew.shout': ['sfx.crew.shoutA', 'sfx.crew.shoutB', 'sfx.crew.shoutC'],
    'crew.scream': ['sfx.crew.scream'],
    'corporate.arrival': ['sfx.stinger.corporate', 'ambience.deepRumble'],
    'rescue.success': ['sfx.tail.thwack', 'vocal.whale.humpback', 'vocal.whale.right'],
    'rescue.failure': ['sfx.stinger.corporate', 'sfx.crew.scream'],
    victory: ['vocal.whale.fin', 'music.fogBellsBelow'],
    defeat: ['sfx.defeat', 'ambience.deepRumble'],
  },
};

const credits = `# Audio Credits

Runtime audio lives in \`public/audio/\` and is generated by \`npm run asset:audio\`.

## Music
- "A sailor's chant" by Thimras, CC0, OpenGameArt: https://opengameart.org/content/a-sailors-chant
- "Lost in a bad place (horror ambience loop)" by congusbongus, CC0, OpenGameArt: https://opengameart.org/content/lost-in-a-bad-place-horror-ambience-loop
- "Fog Bells Below", user-provided local track. Confirm distribution rights before publishing.

## Naval Sound Effects
- "corporate-sting", user-provided local cue. Confirm distribution rights before publishing.
- "ded", user-provided local cue. Confirm distribution rights before publishing.
- "Battle at sea" by Thimras, CC0, OpenGameArt: https://opengameart.org/content/battle-at-sea
- "Various Sound Effects" by Spring Spring, CC0, OpenGameArt: https://opengameart.org/content/various-sound-effects-0
- "Thwack Sounds" by Jordan Irwin / AntumDeluge, CC0, OpenGameArt: https://opengameart.org/content/thwack-sounds
- "Female high-pitched scream SFX" by WuxiaScrub, CC0, OpenGameArt: https://opengameart.org/content/female-high-pitched-scream-sfx
- "Male Grunt/Yelling sounds" by HaelDB, CC0, OpenGameArt: https://opengameart.org/content/male-gruntyelling-sounds

## Ocean Ambience
- "Beach Ocean Waves" by jasinski, submitted by qubodup, CC0, OpenGameArt: https://opengameart.org/content/beach-ocean-waves
- "underwater or space engine rumble" by gmason, CC0, OpenGameArt: https://opengameart.org/content/underwater-or-space-engine-rumble

## Whale Vocals
- NOAA [National Oceanic and Atmospheric Administration]. Passive Acoustics Group. 2021. Phma-clicks-NOAA-PAGroup-01-sperm-clip. https://www.fisheries.noaa.gov/national/science-data/sounds-ocean-mammals
- NOAA [National Oceanic and Atmospheric Administration]. Passive Acoustics Group. 2021. Meno-song-NOAA-PAGroup-13-humpback-clip. https://www.fisheries.noaa.gov/national/science-data/sounds-ocean-mammals
- NOAA [National Oceanic and Atmospheric Administration]. Passive Acoustics Group. 2021. Baph-song-NOAA-PAGroup-05-x5speed-fin-clip. https://www.fisheries.noaa.gov/national/science-data/sounds-ocean-mammals
- NOAA [National Oceanic and Atmospheric Administration]. Passive Acoustics Group. 2021. Eugl-upcall-NOAA-PAGroup-01-right-clip-1. https://www.fisheries.noaa.gov/national/science-data/sounds-ocean-mammals
`;

async function main() {
  await mkdir(AUDIO_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });

  for (const download of DOWNLOADS) {
    await downloadFile(download.url, path.join(AUDIO_DIR, download.output));
  }

  for (const asset of LOCAL_ASSETS) {
    const source = path.join(ROOT_DIR, asset.source);
    const target = path.join(AUDIO_DIR, asset.output);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(source));
    console.log(`audio asset: ${path.relative(ROOT_DIR, target)}`);
  }

  for (const archive of ZIP_DOWNLOADS) {
    const archivePath = path.join(TMP_DIR, archive.archive);
    await downloadFile(archive.url, archivePath);
    const extractDir = path.join(TMP_DIR, archive.id);
    await rm(extractDir, { force: true, recursive: true });
    await mkdir(extractDir, { recursive: true });
    await execFileAsync('unzip', ['-q', archivePath, '-d', extractDir]);

    for (const entry of archive.entries) {
      const source = path.join(extractDir, entry.from);
      const target = path.join(AUDIO_DIR, entry.to);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(source));
    }
  }

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(CREDITS_PATH, credits);
  await rm(TMP_DIR, { force: true, recursive: true });
}

async function downloadFile(url, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(outputPath));
  console.log(`audio asset: ${path.relative(ROOT_DIR, outputPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
