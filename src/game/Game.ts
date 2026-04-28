import * as THREE from 'three';

import { AudioSystem } from '../audio/AudioSystem';
import { OceanScene } from '../scenes/OceanScene';
import { IntroScene } from '../scenes/IntroScene';
import { UISystem } from '../systems/UISystem';
import { Input } from './Input';
import { StateMachine } from './StateMachine';
import { Time } from './Time';
import { GameStateId } from './types';

export class Game {
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: true,
  });
  private readonly audio = new AudioSystem();
  private readonly input = new Input();
  private readonly time = new Time();
  private readonly states = new StateMachine<GameStateId>();
  private readonly ui: UISystem;
  private readonly introScene: IntroScene;
  private readonly oceanScene: OceanScene;

  constructor(private readonly mount: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.localClippingEnabled = true;

    this.mount.append(this.renderer.domElement);
    this.ui = new UISystem(document.body);
    this.introScene = new IntroScene(this.input, this.ui, this.audio, window.innerWidth, window.innerHeight);
    this.oceanScene = new OceanScene(this.input, this.ui, this.audio, window.innerWidth, window.innerHeight);

    this.registerStates();
    this.states.change('BOOT');

    window.addEventListener('resize', this.handleResize);
    requestAnimationFrame(this.loop);
  }

  private registerStates(): void {
    this.states.add('BOOT', {
      enter: () => {
        this.audio.setMusicState('silent');
        this.states.change('INTRO_DECK');
      },
      update: () => undefined,
    });

    this.states.add('INTRO_DECK', {
      enter: () => {
        this.audio.setMusicState('intro');
        this.introScene.reset();
      },
      update: (deltaSeconds) => {
        const result = this.introScene.update(deltaSeconds, this.time.elapsedSeconds);

        if (result === 'start_attack') {
          this.states.change('ATTACK_CINEMATIC');
        } else if (result === 'complete') {
          this.states.change('WHALE_PLAY');
        }
      },
    });
    this.states.add('ATTACK_CINEMATIC', {
      enter: () => {
        this.audio.setMusicState('intro');
      },
      update: (deltaSeconds) => {
        const result = this.introScene.update(deltaSeconds, this.time.elapsedSeconds);

        if (result === 'complete') {
          this.states.change('WHALE_PLAY');
        }
      },
    });
    this.states.add('ENDGAME', {
      enter: () => {
        this.audio.setMusicState('victory');
        this.audio.playCue('victory');
      },
      update: (deltaSeconds) => {
        this.oceanScene.update(deltaSeconds, this.time.elapsedSeconds);

        if (this.input.consumeRestartRequested()) {
          this.states.change('WHALE_PLAY');
        }
      },
    });
    this.states.add('GAME_OVER', {
      enter: () => {
        this.audio.setMusicState('defeat');
        this.audio.playCue('defeat');
      },
      update: (deltaSeconds) => {
        this.oceanScene.update(deltaSeconds, this.time.elapsedSeconds);

        if (this.input.consumeRestartRequested()) {
          this.states.change('WHALE_PLAY');
        }
      },
    });

    this.states.add('WHALE_PLAY', {
      enter: () => {
        this.audio.setMusicState('combat');
        this.oceanScene.reset();
      },
      update: (deltaSeconds) => {
        this.oceanScene.update(deltaSeconds, this.time.elapsedSeconds);

        if (this.oceanScene.outcome === 'victory') {
          this.states.change('ENDGAME');
        } else if (this.oceanScene.outcome === 'defeat') {
          this.states.change('GAME_OVER');
        }
      },
    });
  }

  private readonly loop = (timestamp: number): void => {
    const deltaSeconds = this.time.tick(timestamp);
    this.states.update(deltaSeconds);
    this.getActiveScene().render(this.renderer);
    requestAnimationFrame(this.loop);
  };

  private readonly handleResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.introScene.resize(window.innerWidth, window.innerHeight);
    this.oceanScene.resize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.input.dispose();
    this.ui.dispose();
    this.introScene.dispose();
    this.oceanScene.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }

  private getActiveScene(): IntroScene | OceanScene {
    const current = this.states.current;
    return current === 'INTRO_DECK' || current === 'ATTACK_CINEMATIC' ? this.introScene : this.oceanScene;
  }
}
