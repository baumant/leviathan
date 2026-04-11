export interface HUDSnapshot {
  objective: string;
  whaleHealth: number;
  shipHealth: number;
  shipStatus: string;
  speed: number;
  depth: number;
  submerged: boolean;
  burstActive: boolean;
}

export class UISystem {
  private readonly root = document.createElement('div');
  private readonly objectiveEl = document.createElement('p');
  private readonly whaleFill = document.createElement('div');
  private readonly shipFill = document.createElement('div');
  private readonly whaleValue = document.createElement('span');
  private readonly shipValue = document.createElement('span');
  private readonly statusEl = document.createElement('div');
  private readonly debugEl = document.createElement('p');

  constructor(parent: HTMLElement) {
    this.root.className = 'hud';

    const topRow = document.createElement('div');
    topRow.className = 'hud__top';

    const introCard = document.createElement('section');
    introCard.className = 'hud__card';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'hud__eyebrow';
    eyebrow.textContent = 'First playable';

    const title = document.createElement('h1');
    title.className = 'hud__title';
    title.textContent = 'LEVIATHAN';

    this.objectiveEl.className = 'hud__copy';

    const controls = document.createElement('p');
    controls.className = 'hud__copy';
    controls.textContent = 'W/S accelerate or brake  A/D turn  Shift dive and burst  Space rise';

    introCard.append(eyebrow, title, this.objectiveEl, controls);

    const metricsCard = document.createElement('section');
    metricsCard.className = 'hud__card';

    const bars = document.createElement('div');
    bars.className = 'hud__bars';

    bars.append(
      this.createBarRow('Whale hull', this.whaleFill, this.whaleValue, 'hud__bar-fill--whale'),
      this.createBarRow('Whaler', this.shipFill, this.shipValue, 'hud__bar-fill--ship'),
    );

    this.statusEl.className = 'hud__status';
    this.debugEl.className = 'hud__debug';

    metricsCard.append(bars, this.statusEl, this.debugEl);
    topRow.append(introCard, metricsCard);

    const bottomRow = document.createElement('div');
    bottomRow.className = 'hud__bottom';

    this.root.append(topRow, bottomRow);
    parent.append(this.root);
  }

  update(snapshot: HUDSnapshot): void {
    this.objectiveEl.textContent = snapshot.objective;
    this.setBar(this.whaleFill, this.whaleValue, snapshot.whaleHealth);
    this.setBar(this.shipFill, this.shipValue, snapshot.shipHealth);

    this.statusEl.textContent = snapshot.shipStatus;
    this.debugEl.textContent = [
      `${snapshot.submerged ? 'Submerged' : 'Surface'} run`,
      `speed ${snapshot.speed.toFixed(1)}`,
      `depth ${snapshot.depth.toFixed(1)} m`,
      snapshot.burstActive ? 'burst lit' : 'burst idle',
    ].join('  /  ');
  }

  dispose(): void {
    this.root.remove();
  }

  private createBarRow(
    label: string,
    fill: HTMLDivElement,
    value: HTMLSpanElement,
    fillClassName: string,
  ): HTMLElement {
    const row = document.createElement('div');

    const labelRow = document.createElement('div');
    labelRow.className = 'hud__bar-label';

    const name = document.createElement('span');
    name.textContent = label;

    labelRow.append(name, value);

    const bar = document.createElement('div');
    bar.className = 'hud__bar';

    fill.className = `hud__bar-fill ${fillClassName}`;
    bar.append(fill);

    row.append(labelRow, bar);
    return row;
  }

  private setBar(fill: HTMLDivElement, value: HTMLSpanElement, normalizedValue: number): void {
    const clamped = Math.max(0, Math.min(1, normalizedValue));
    fill.style.transform = `scaleX(${clamped})`;
    value.textContent = `${Math.round(clamped * 100)}%`;
  }
}
