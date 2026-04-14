import * as THREE from 'three';

export interface HUDSnapshot {
  objective: string;
  whaleHealth: number;
  whaleAir: number;
  targetHealth: number;
  targetLabel: string;
  shipStatus: string;
  speed: number;
  depth: number;
  submerged: boolean;
  burstActive: boolean;
  score: number;
  fleetRemaining: number;
  activeTethers: number;
  overlayTitle?: string;
  overlayCopy?: string;
  presentation?: 'combat' | 'intro';
  controlsText?: string;
  eyebrowText?: string;
  fadeAlpha?: number;
}

export class UISystem {
  private readonly root = document.createElement('div');
  private readonly topRow = document.createElement('div');
  private readonly bottomRow = document.createElement('div');
  private readonly introCard = document.createElement('section');
  private readonly metricsCard = document.createElement('section');
  private readonly objectiveEl = document.createElement('p');
  private readonly controlsEl = document.createElement('p');
  private readonly eyebrowEl = document.createElement('p');
  private readonly whaleFill = document.createElement('div');
  private readonly airFill = document.createElement('div');
  private readonly shipFill = document.createElement('div');
  private readonly whaleValue = document.createElement('span');
  private readonly airValue = document.createElement('span');
  private readonly shipValue = document.createElement('span');
  private readonly shipLabel = document.createElement('span');
  private readonly statusEl = document.createElement('div');
  private readonly debugEl = document.createElement('p');
  private readonly scoreValueEl = document.createElement('div');
  private readonly fleetValueEl = document.createElement('div');
  private readonly tetherValueEl = document.createElement('div');
  private readonly overlayCard = document.createElement('section');
  private readonly overlayTitle = document.createElement('h2');
  private readonly overlayCopy = document.createElement('p');
  private readonly fadeEl = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.root.className = 'hud';

    this.topRow.className = 'hud__top';

    this.introCard.className = 'hud__card';

    this.eyebrowEl.className = 'hud__eyebrow';
    this.eyebrowEl.textContent = 'First playable';

    const title = document.createElement('h1');
    title.className = 'hud__title';
    title.textContent = 'LEVIATHAN';

    this.objectiveEl.className = 'hud__copy';

    this.controlsEl.className = 'hud__copy';
    this.controlsEl.textContent =
      'W/S accelerate or brake  A/D turn  Shift dive and burst  Space rise / breach auto  F tail slap  R restart';

    this.introCard.append(this.eyebrowEl, title, this.objectiveEl, this.controlsEl);

    this.metricsCard.className = 'hud__card';

    const bars = document.createElement('div');
    bars.className = 'hud__bars';

    bars.append(
      this.createBarRow('Whale hull', this.whaleFill, this.whaleValue, 'hud__bar-fill--whale'),
      this.createBarRow('Air', this.airFill, this.airValue, 'hud__bar-fill--air'),
      this.createBarRow('Target hull', this.shipFill, this.shipValue, 'hud__bar-fill--ship', this.shipLabel),
    );

    this.statusEl.className = 'hud__status';
    this.debugEl.className = 'hud__debug';

    this.metricsCard.append(bars, this.statusEl, this.debugEl);
    this.topRow.append(this.introCard, this.metricsCard);

    this.bottomRow.className = 'hud__bottom';

    const scoreCard = document.createElement('section');
    scoreCard.className = 'hud__card hud__card--compact';
    scoreCard.append(
      this.createFact('Score', this.scoreValueEl),
      this.createFact('Fleet remaining', this.fleetValueEl),
      this.createFact('Tethers', this.tetherValueEl),
    );
    this.bottomRow.append(scoreCard);

    this.overlayCard.className = 'hud__overlay';
    this.overlayCard.hidden = true;

    const overlayEyebrow = document.createElement('p');
    overlayEyebrow.className = 'hud__eyebrow';
    overlayEyebrow.textContent = 'Run complete';

    this.overlayTitle.className = 'hud__overlay-title';
    this.overlayCopy.className = 'hud__overlay-copy';

    this.overlayCard.append(overlayEyebrow, this.overlayTitle, this.overlayCopy);

    this.fadeEl.className = 'hud__fade';
    this.fadeEl.hidden = true;

    this.root.append(this.topRow, this.bottomRow, this.overlayCard, this.fadeEl);
    parent.append(this.root);
  }

  update(snapshot: HUDSnapshot): void {
    const presentation = snapshot.presentation ?? 'combat';
    const isIntro = presentation === 'intro';
    this.objectiveEl.textContent = snapshot.objective;
    this.controlsEl.textContent =
      snapshot.controlsText ??
      'W/S accelerate or brake  A/D turn  Shift dive and burst  Space rise / breach auto  F tail slap  R restart';
    this.eyebrowEl.textContent = snapshot.eyebrowText ?? 'First playable';
    this.setBar(this.whaleFill, this.whaleValue, snapshot.whaleHealth);
    this.setBar(this.airFill, this.airValue, snapshot.whaleAir);
    this.setBar(this.shipFill, this.shipValue, snapshot.targetHealth);
    this.shipLabel.textContent = snapshot.targetLabel;

    this.statusEl.textContent = snapshot.shipStatus;
    this.debugEl.textContent = [
      `${snapshot.submerged ? 'Submerged' : 'Surface'} run`,
      `speed ${snapshot.speed.toFixed(1)}`,
      `depth ${snapshot.depth.toFixed(1)} m`,
      `air ${Math.round(snapshot.whaleAir * 100)}%`,
      `${snapshot.activeTethers} tether${snapshot.activeTethers === 1 ? '' : 's'}`,
      snapshot.burstActive ? 'burst lit' : 'burst idle',
    ].join('  /  ');

    this.scoreValueEl.textContent = `${snapshot.score}`;
    this.fleetValueEl.textContent = `${snapshot.fleetRemaining}`;
    this.tetherValueEl.textContent = `${snapshot.activeTethers}`;

    const showOverlay = Boolean(snapshot.overlayTitle && snapshot.overlayCopy);
    this.overlayCard.hidden = !showOverlay;

    if (showOverlay) {
      this.overlayTitle.textContent = snapshot.overlayTitle ?? '';
      this.overlayCopy.textContent = snapshot.overlayCopy ?? '';
    }

    this.metricsCard.hidden = isIntro;
    this.bottomRow.hidden = isIntro;
    this.statusEl.hidden = isIntro;
    this.debugEl.hidden = isIntro;
    this.root.classList.toggle('hud--intro', isIntro);

    const fadeAlpha = THREE.MathUtils.clamp(snapshot.fadeAlpha ?? 0, 0, 1);
    this.fadeEl.hidden = fadeAlpha <= 0.001;
    this.fadeEl.style.opacity = `${fadeAlpha}`;
  }

  dispose(): void {
    this.root.remove();
  }

  private createBarRow(
    label: string,
    fill: HTMLDivElement,
    value: HTMLSpanElement,
    fillClassName: string,
    detail?: HTMLSpanElement,
  ): HTMLElement {
    const row = document.createElement('div');

    const labelRow = document.createElement('div');
    labelRow.className = 'hud__bar-label';

    const name = document.createElement('span');
    name.textContent = label;

    labelRow.append(name, value);

    if (detail) {
      detail.className = 'hud__subtle';
      row.append(labelRow, detail);
    } else {
      row.append(labelRow);
    }

    const bar = document.createElement('div');
    bar.className = 'hud__bar';

    fill.className = `hud__bar-fill ${fillClassName}`;
    bar.append(fill);

    row.append(bar);
    return row;
  }

  private setBar(fill: HTMLDivElement, value: HTMLSpanElement, normalizedValue: number): void {
    const clamped = Math.max(0, Math.min(1, normalizedValue));
    fill.style.transform = `scaleX(${clamped})`;
    value.textContent = `${Math.round(clamped * 100)}%`;
  }

  private createFact(label: string, valueEl: HTMLDivElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'hud__fact';

    const labelEl = document.createElement('div');
    labelEl.className = 'hud__fact-label';
    labelEl.textContent = label;

    valueEl.className = 'hud__fact-value';

    row.append(labelEl, valueEl);
    return row;
  }
}
