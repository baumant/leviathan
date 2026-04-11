import * as THREE from 'three';

import { OceanScene } from '../scenes/OceanScene';
import { UISystem } from '../systems/UISystem';
import { Input } from './Input';
import { StateMachine } from './StateMachine';
import { Time } from './Time';
import { GameStateId } from './types';

export class Game {
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  private readonly input = new Input();
  private readonly time = new Time();
  private readonly states = new StateMachine<GameStateId>();
  private readonly ui: UISystem;
  private readonly scene: OceanScene;

  constructor(private readonly mount: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.mount.append(this.renderer.domElement);
    this.ui = new UISystem(document.body);
    this.scene = new OceanScene(this.input, this.ui, window.innerWidth, window.innerHeight);

    this.registerStates();
    this.states.change('BOOT');

    window.addEventListener('resize', this.handleResize);
    requestAnimationFrame(this.loop);
  }

  private registerStates(): void {
    this.states.add('BOOT', {
      enter: () => this.states.change('WHALE_PLAY'),
      update: () => undefined,
    });

    this.states.add('INTRO_DECK', { update: () => undefined });
    this.states.add('ATTACK_CINEMATIC', { update: () => undefined });
    this.states.add('ENDGAME', { update: () => undefined });
    this.states.add('GAME_OVER', { update: () => undefined });

    this.states.add('WHALE_PLAY', {
      update: (deltaSeconds) => {
        this.scene.update(deltaSeconds, this.time.elapsedSeconds);
      },
    });
  }

  private readonly loop = (timestamp: number): void => {
    const deltaSeconds = this.time.tick(timestamp);
    this.states.update(deltaSeconds);
    this.scene.render(this.renderer);
    requestAnimationFrame(this.loop);
  };

  private readonly handleResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scene.resize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.input.dispose();
    this.ui.dispose();
    this.renderer.dispose();
  }
}
