import * as THREE from 'three';

interface ControlTile {
  root: HTMLElement;
}

interface ShipBarElements {
  fill: HTMLDivElement;
  root: HTMLDivElement;
}

export interface HUDShipBarSnapshot {
  health: number;
  id: string;
  opacity: number;
  screenX: number;
  screenY: number;
  width: number;
}

export type HUDLeaderboardStatus = 'unavailable' | 'loading' | 'needs_name' | 'submitting' | 'ready' | 'error';

export interface HUDRunSummarySnapshot {
  bestText?: string;
  score: number;
  shipsDestroyed: number;
  timeSurvivedSeconds: number;
}

export interface HUDLeaderboardEntrySnapshot {
  isCurrentPlayer?: boolean;
  rank: number;
  score: number;
  shipsDestroyed: number;
  timeSurvivedSeconds: number;
  username: string;
}

export interface HUDLeaderboardSnapshot {
  entries: HUDLeaderboardEntrySnapshot[];
  message: string;
  showUsernameForm: boolean;
  status: HUDLeaderboardStatus;
  usernameInputValue?: string;
}

export interface HUDSnapshot {
  capitalShipBars: HUDShipBarSnapshot[];
  objective: string;
  whaleHealth: number;
  whaleAir: number;
  shipStatus: string;
  speed: number;
  depth: number;
  submerged: boolean;
  score: number;
  timeSurvivedSeconds: number;
  shipsDestroyed: number;
  activeTethers: number;
  whaleHealFeedbackAlpha?: number;
  whaleHealFeedbackText?: string;
  overlayTitle?: string;
  overlayCopy?: string;
  overlaySummary?: HUDRunSummarySnapshot;
  overlayLeaderboard?: HUDLeaderboardSnapshot;
  presentation?: 'combat' | 'intro';
  showActionControls?: boolean;
  tailSlapAvailable?: boolean;
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
  private readonly introHintEl = document.createElement('p');
  private readonly controlsStrip = document.createElement('div');
  private readonly eyebrowEl = document.createElement('p');
  private readonly whaleFill = document.createElement('div');
  private readonly airFill = document.createElement('div');
  private readonly whaleValue = document.createElement('span');
  private readonly airValue = document.createElement('span');
  private readonly whaleHealFeedbackEl = document.createElement('span');
  private readonly statusEl = document.createElement('div');
  private readonly debugEl = document.createElement('p');
  private readonly scoreValueEl = document.createElement('div');
  private readonly timeValueEl = document.createElement('div');
  private readonly shipsDestroyedValueEl = document.createElement('div');
  private readonly shipBarsLayer = document.createElement('div');
  private readonly overlayCard = document.createElement('section');
  private readonly overlayTitle = document.createElement('h2');
  private readonly overlayCopy = document.createElement('p');
  private readonly overlaySummary = document.createElement('div');
  private readonly overlayLeaderboard = document.createElement('section');
  private readonly overlayLeaderboardList = document.createElement('ol');
  private readonly overlayLeaderboardMessage = document.createElement('p');
  private readonly overlayLeaderboardForm = document.createElement('form');
  private readonly overlayUsernameInput = document.createElement('input');
  private readonly overlayUsernameButton = document.createElement('button');
  private readonly keyboardGuard = document.createElement('section');
  private readonly fadeEl = document.createElement('div');
  private readonly shipBars = new Map<string, ShipBarElements>();
  private readonly movementTile: ControlTile;
  private readonly diveTile: ControlTile;
  private readonly riseTile: ControlTile;
  private readonly tailSlapTile: ControlTile;
  private leaderboardFormWasVisible = false;
  private leaderboardSubmitHandler: ((username: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.className = 'hud';

    this.topRow.className = 'hud__top';

    this.introCard.className = 'hud__card';

    this.eyebrowEl.className = 'hud__eyebrow';
    this.eyebrowEl.textContent = 'The Hunt';

    const title = document.createElement('h1');
    title.className = 'hud__title';
    title.textContent = 'LEVIATHAN';

    this.objectiveEl.className = 'hud__copy';

    this.introHintEl.className = 'hud__subtle hud__hint';
    this.introHintEl.textContent = 'Enter to skip';

    this.introCard.append(this.eyebrowEl, title, this.objectiveEl, this.introHintEl);

    this.metricsCard.className = 'hud__card';

    const bars = document.createElement('div');
    bars.className = 'hud__bars';

    bars.append(
      this.createBarRow('Whale hull', this.whaleFill, this.whaleValue, 'hud__bar-fill--whale', this.whaleHealFeedbackEl),
      this.createBarRow('Air', this.airFill, this.airValue, 'hud__bar-fill--air'),
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
      this.createFact('Time', this.timeValueEl),
      this.createFact('Ships sunk', this.shipsDestroyedValueEl),
    );
    this.bottomRow.append(scoreCard);

    this.controlsStrip.className = 'hud__controls';
    this.movementTile = this.createControlTile({
      icon: this.createMovementIcon(),
      modifierClassName: 'hud__control--movement',
    });
    this.diveTile = this.createControlTile({
      keyset: this.createSingleKeyset('Shift', 'wide'),
      icon: this.createDiveIcon(),
    });
    this.riseTile = this.createControlTile({
      keyset: this.createSingleKeyset('Space', 'space'),
      icon: this.createRiseIcon(),
    });
    this.tailSlapTile = this.createControlTile({
      keyset: this.createSingleKeyset('F'),
      icon: this.createTailSlapIcon(),
    });
    this.controlsStrip.append(
      this.movementTile.root,
      this.diveTile.root,
      this.riseTile.root,
      this.tailSlapTile.root,
    );

    this.shipBarsLayer.className = 'hud__ship-bars';

    this.overlayCard.className = 'hud__overlay';
    this.overlayCard.hidden = true;

    const overlayEyebrow = document.createElement('p');
    overlayEyebrow.className = 'hud__eyebrow';
    overlayEyebrow.textContent = 'Run complete';

    this.overlayTitle.className = 'hud__overlay-title';
    this.overlayCopy.className = 'hud__overlay-copy';

    this.overlaySummary.className = 'hud__overlay-summary';
    this.overlaySummary.hidden = true;

    this.overlayLeaderboard.className = 'hud__leaderboard';
    this.overlayLeaderboard.hidden = true;

    const leaderboardHeader = document.createElement('div');
    leaderboardHeader.className = 'hud__leaderboard-header';

    const leaderboardTitle = document.createElement('h3');
    leaderboardTitle.className = 'hud__leaderboard-title';
    leaderboardTitle.textContent = 'Leaderboard';

    this.overlayLeaderboardMessage.className = 'hud__leaderboard-message';
    leaderboardHeader.append(leaderboardTitle, this.overlayLeaderboardMessage);

    this.overlayLeaderboardList.className = 'hud__leaderboard-list';

    this.overlayLeaderboardForm.className = 'hud__leaderboard-form';
    this.overlayLeaderboardForm.hidden = true;
    this.overlayLeaderboardForm.addEventListener('submit', this.handleLeaderboardFormSubmit);

    this.overlayUsernameInput.className = 'hud__leaderboard-input';
    this.overlayUsernameInput.type = 'text';
    this.overlayUsernameInput.name = 'leaderboardUsername';
    this.overlayUsernameInput.maxLength = 24;
    this.overlayUsernameInput.setAttribute('autocomplete', 'nickname');
    this.overlayUsernameInput.placeholder = 'Name';

    this.overlayUsernameButton.className = 'hud__leaderboard-button';
    this.overlayUsernameButton.type = 'submit';
    this.overlayUsernameButton.textContent = 'Submit';

    this.overlayLeaderboardForm.append(this.overlayUsernameInput, this.overlayUsernameButton);
    this.overlayLeaderboard.append(leaderboardHeader, this.overlayLeaderboardList, this.overlayLeaderboardForm);

    this.overlayCard.append(
      overlayEyebrow,
      this.overlayTitle,
      this.overlaySummary,
      this.overlayCopy,
      this.overlayLeaderboard,
    );

    this.keyboardGuard.className = 'hud__keyboard-guard';

    const guardEyebrow = document.createElement('p');
    guardEyebrow.className = 'hud__eyebrow';
    guardEyebrow.textContent = 'Desktop build';

    const guardTitle = document.createElement('h2');
    guardTitle.className = 'hud__keyboard-title';
    guardTitle.textContent = 'Keyboard Required';

    const guardCopy = document.createElement('p');
    guardCopy.className = 'hud__keyboard-copy';
    guardCopy.textContent = 'Open Leviathan on a wider screen with a keyboard to enter the hunt.';

    this.keyboardGuard.append(guardEyebrow, guardTitle, guardCopy);

    this.fadeEl.className = 'hud__fade';
    this.fadeEl.hidden = true;

    this.root.append(
      this.topRow,
      this.bottomRow,
      this.shipBarsLayer,
      this.controlsStrip,
      this.overlayCard,
      this.keyboardGuard,
      this.fadeEl,
    );
    parent.append(this.root);
  }

  setLeaderboardSubmitHandler(handler: ((username: string) => void) | null): void {
    this.leaderboardSubmitHandler = handler;
  }

  update(snapshot: HUDSnapshot): void {
    const presentation = snapshot.presentation ?? 'combat';
    const isIntro = presentation === 'intro';
    const showActionControls = snapshot.showActionControls ?? !isIntro;
    const showTailSlapControl = showActionControls && (snapshot.tailSlapAvailable ?? true);
    this.objectiveEl.textContent = snapshot.objective;
    this.eyebrowEl.textContent = snapshot.eyebrowText ?? (isIntro ? 'Prologue' : 'The Hunt');
    this.introHintEl.hidden = !isIntro;
    this.controlsStrip.classList.toggle('hud__controls--intro', isIntro);
    this.diveTile.root.hidden = !showActionControls;
    this.riseTile.root.hidden = !showActionControls;
    this.tailSlapTile.root.hidden = !showTailSlapControl;
    this.setBar(this.whaleFill, this.whaleValue, snapshot.whaleHealth);
    this.setBar(this.airFill, this.airValue, snapshot.whaleAir);
    this.updateWhaleHealFeedback(snapshot.whaleHealFeedbackText, snapshot.whaleHealFeedbackAlpha ?? 0);
    this.syncCapitalShipBars(snapshot.capitalShipBars);

    this.statusEl.textContent = snapshot.shipStatus;
    this.debugEl.textContent = [
      `${snapshot.submerged ? 'Submerged' : 'Surface'} run`,
      `speed ${snapshot.speed.toFixed(1)}`,
      `depth ${snapshot.depth.toFixed(1)} m`,
      `air ${Math.round(snapshot.whaleAir * 100)}%`,
      `${snapshot.activeTethers} tether${snapshot.activeTethers === 1 ? '' : 's'}`,
    ].join('  /  ');

    this.scoreValueEl.textContent = `${snapshot.score}`;
    this.timeValueEl.textContent = this.formatTime(snapshot.timeSurvivedSeconds);
    this.shipsDestroyedValueEl.textContent = `${snapshot.shipsDestroyed}`;

    const showOverlay = Boolean(
      snapshot.overlayTitle ||
        snapshot.overlayCopy ||
        snapshot.overlaySummary ||
        snapshot.overlayLeaderboard,
    );
    this.overlayCard.hidden = !showOverlay;
    this.overlayCard.classList.toggle('hud__overlay--leaderboard', Boolean(snapshot.overlayLeaderboard));

    if (showOverlay) {
      this.overlayTitle.textContent = snapshot.overlayTitle ?? '';
      this.overlayCopy.textContent = snapshot.overlayCopy ?? '';
      this.overlayCopy.hidden = !snapshot.overlayCopy;
      this.updateOverlaySummary(snapshot.overlaySummary);
      this.updateOverlayLeaderboard(snapshot.overlayLeaderboard);
    } else {
      this.overlaySummary.hidden = true;
      this.overlayLeaderboard.hidden = true;
      this.leaderboardFormWasVisible = false;
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
    this.overlayLeaderboardForm.removeEventListener('submit', this.handleLeaderboardFormSubmit);
    this.root.remove();
  }

  private updateOverlaySummary(summary: HUDRunSummarySnapshot | undefined): void {
    this.overlaySummary.hidden = !summary;

    if (!summary) {
      this.overlaySummary.replaceChildren();
      return;
    }

    const facts = [
      this.createOverlaySummaryFact('Survived', this.formatTime(summary.timeSurvivedSeconds)),
      this.createOverlaySummaryFact('Ships sunk', `${summary.shipsDestroyed}`),
      this.createOverlaySummaryFact('Score', `${summary.score}`),
    ];

    if (summary.bestText) {
      const best = document.createElement('p');
      best.className = 'hud__overlay-best';
      best.textContent = summary.bestText;
      this.overlaySummary.replaceChildren(...facts, best);
      return;
    }

    this.overlaySummary.replaceChildren(...facts);
  }

  private updateOverlayLeaderboard(leaderboard: HUDLeaderboardSnapshot | undefined): void {
    this.overlayLeaderboard.hidden = !leaderboard;

    if (!leaderboard) {
      this.overlayLeaderboardList.replaceChildren();
      this.overlayLeaderboardMessage.textContent = '';
      this.overlayLeaderboardForm.hidden = true;
      this.leaderboardFormWasVisible = false;
      return;
    }

    this.overlayLeaderboard.dataset.status = leaderboard.status;
    this.overlayLeaderboardMessage.textContent = leaderboard.message;
    this.updateOverlayLeaderboardRows(leaderboard.entries);

    const showForm = leaderboard.showUsernameForm;

    if (showForm && !this.leaderboardFormWasVisible) {
      this.overlayUsernameInput.value = leaderboard.usernameInputValue ?? '';
    }

    this.overlayLeaderboardForm.hidden = !showForm;
    this.leaderboardFormWasVisible = showForm;

    const submitting = leaderboard.status === 'submitting';
    this.overlayUsernameInput.disabled = submitting;
    this.overlayUsernameButton.disabled = submitting;
    this.overlayUsernameButton.textContent = submitting ? 'Submitting' : 'Submit';
  }

  private updateOverlayLeaderboardRows(entries: readonly HUDLeaderboardEntrySnapshot[]): void {
    if (entries.length <= 0) {
      const emptyRow = document.createElement('li');
      emptyRow.className = 'hud__leaderboard-empty';
      emptyRow.textContent = 'No recorded runs yet.';
      this.overlayLeaderboardList.replaceChildren(emptyRow);
      return;
    }

    this.overlayLeaderboardList.replaceChildren(
      ...entries.map((entry) => this.createOverlayLeaderboardRow(entry)),
    );
  }

  private createOverlaySummaryFact(label: string, value: string): HTMLElement {
    const fact = document.createElement('div');
    fact.className = 'hud__overlay-fact';

    const labelEl = document.createElement('span');
    labelEl.className = 'hud__overlay-fact-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'hud__overlay-fact-value';
    valueEl.textContent = value;

    fact.append(labelEl, valueEl);
    return fact;
  }

  private createOverlayLeaderboardRow(entry: HUDLeaderboardEntrySnapshot): HTMLElement {
    const row = document.createElement('li');
    row.className = 'hud__leaderboard-row';
    row.classList.toggle('hud__leaderboard-row--current', entry.isCurrentPlayer === true);

    const rank = document.createElement('span');
    rank.className = 'hud__leaderboard-rank';
    rank.textContent = `${entry.rank}`;

    const nameGroup = document.createElement('span');
    nameGroup.className = 'hud__leaderboard-name-group';

    const username = document.createElement('span');
    username.className = 'hud__leaderboard-name';
    username.textContent = entry.username;

    const detail = document.createElement('span');
    detail.className = 'hud__leaderboard-detail';
    detail.textContent = `${this.formatTime(entry.timeSurvivedSeconds)} / ${entry.shipsDestroyed} sunk`;

    nameGroup.append(username, detail);

    const score = document.createElement('span');
    score.className = 'hud__leaderboard-score';
    score.textContent = `${entry.score}`;

    row.append(rank, nameGroup, score);
    return row;
  }

  private readonly handleLeaderboardFormSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    this.leaderboardSubmitHandler?.(this.overlayUsernameInput.value);
  };

  private createBarRow(
    label: string,
    fill: HTMLDivElement,
    value: HTMLSpanElement,
    fillClassName: string,
    feedback?: HTMLSpanElement,
    detail?: HTMLSpanElement,
  ): HTMLElement {
    const row = document.createElement('div');

    const labelRow = document.createElement('div');
    labelRow.className = 'hud__bar-label';

    const name = document.createElement('span');
    name.textContent = label;

    const valueGroup = document.createElement('span');
    valueGroup.className = 'hud__bar-value-group';

    if (feedback) {
      feedback.className = 'hud__bar-feedback';
      feedback.hidden = true;
      valueGroup.append(feedback);
    }

    valueGroup.append(value);
    labelRow.append(name, valueGroup);

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

  private updateWhaleHealFeedback(text: string | undefined, alpha: number): void {
    const clampedAlpha = THREE.MathUtils.clamp(alpha, 0, 1);
    this.whaleFill.style.setProperty('--hud-whale-heal-alpha', `${clampedAlpha.toFixed(3)}`);

    if (text) {
      this.whaleHealFeedbackEl.textContent = text;
    }

    this.whaleHealFeedbackEl.hidden = clampedAlpha <= 0.001;
    this.whaleHealFeedbackEl.style.opacity = `${clampedAlpha}`;
    this.whaleHealFeedbackEl.style.transform = `translateY(${(1 - clampedAlpha) * 3}px)`;
  }

  private syncCapitalShipBars(shipBars: readonly HUDShipBarSnapshot[]): void {
    const activeIds = new Set<string>();

    for (const bar of shipBars) {
      let elements = this.shipBars.get(bar.id);

      if (!elements) {
        elements = this.createCapitalShipBar();
        this.shipBars.set(bar.id, elements);
        this.shipBarsLayer.append(elements.root);
      }

      activeIds.add(bar.id);
      const clampedHealth = THREE.MathUtils.clamp(bar.health, 0, 1);
      const clampedOpacity = THREE.MathUtils.clamp(bar.opacity, 0, 1);
      elements.root.style.left = `${bar.screenX}px`;
      elements.root.style.top = `${bar.screenY}px`;
      elements.root.style.opacity = `${clampedOpacity}`;
      elements.root.style.setProperty('--hud-ship-bar-width', `${Math.max(48, Math.round(bar.width))}px`);
      elements.fill.style.transform = `scaleX(${clampedHealth})`;
      this.shipBarsLayer.append(elements.root);
    }

    for (const [shipId, elements] of this.shipBars.entries()) {
      if (activeIds.has(shipId)) {
        continue;
      }

      elements.root.remove();
      this.shipBars.delete(shipId);
    }
  }

  private createCapitalShipBar(): ShipBarElements {
    const root = document.createElement('div');
    root.className = 'hud__ship-health';

    const track = document.createElement('div');
    track.className = 'hud__ship-health-track';

    const fill = document.createElement('div');
    fill.className = 'hud__ship-health-fill';
    track.append(fill);
    root.append(track);

    return { root, fill };
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

  private formatTime(seconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  private createControlTile(options: {
    keyset?: HTMLElement;
    icon?: HTMLElement;
    modifierClassName?: string;
  }): ControlTile {
    const tile = document.createElement('section');
    tile.className = 'hud__control';

    if (options.modifierClassName) {
      tile.classList.add(options.modifierClassName);
    }

    const visual = document.createElement('div');
    visual.className = 'hud__control-visual';

    if (options.keyset) {
      visual.append(options.keyset);
    }

    if (options.icon) {
      const iconFrame = document.createElement('div');
      iconFrame.className = 'hud__control-icon-frame';
      iconFrame.append(options.icon);
      visual.append(iconFrame);
    }

    tile.append(visual);

    return { root: tile };
  }

  private createSingleKeyset(label: string, width: 'standard' | 'wide' | 'space' = 'standard'): HTMLElement {
    const keyset = document.createElement('div');
    keyset.className = 'hud__control-keyset';
    keyset.append(this.createKeycap(label, width));
    return keyset;
  }

  private createKeycap(label: string, width: 'standard' | 'wide' | 'space' = 'standard'): HTMLElement {
    const keycap = document.createElement('span');
    keycap.className = 'hud__keycap';

    if (width !== 'standard') {
      keycap.classList.add(`hud__keycap--${width}`);
    }

    keycap.textContent = label;
    return keycap;
  }

  private createMovementIcon(): HTMLElement {
    return this.createImageIcon('/control-icons/wsad.png');
  }

  private createDiveIcon(): HTMLElement {
    return this.createImageIcon('/control-icons/dive.png');
  }

  private createRiseIcon(): HTMLElement {
    return this.createImageIcon('/control-icons/rise.png');
  }

  private createTailSlapIcon(): HTMLElement {
    return this.createImageIcon('/control-icons/tailslap.png');
  }

  private createImageIcon(src: string): HTMLImageElement {
    const image = document.createElement('img');
    image.className = 'hud__control-icon';
    image.src = src;
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false;
    image.setAttribute('aria-hidden', 'true');
    return image;
  }
}
