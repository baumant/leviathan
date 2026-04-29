import type { ShipRole } from '../entities/Ship';

export type SurvivalSpawnRole = Extract<ShipRole, 'rowboat' | 'flagship' | 'corporate_whaler'>;

export interface SurvivalSpawnCommand {
  count: number;
  reason: 'reinforcement' | 'escalation' | 'corporate';
  role: SurvivalSpawnRole;
}

export interface SurvivalDirectorInput {
  corporateActive: boolean;
  deltaSeconds: number;
  flagshipsDestroyed: number;
  livingCombatShips: number;
  livingFlagships: number;
  livingRowboats: number;
  rescueTowActive: boolean;
  whaleHealthPercent: number;
}

export interface SurvivalDirectorSnapshot {
  elapsedSeconds: number;
  flagshipCap: number;
  overrun: boolean;
  rowboatCap: number;
  tier: 'opening' | 'pressure' | 'escalation' | 'corporate' | 'overrun';
}

interface SurvivalTierConfig {
  flagshipCap: number;
  maxRowboatsPerWave: number;
  nextWaveDelay: number;
  rowboatCap: number;
  tier: SurvivalDirectorSnapshot['tier'];
}

const CORPORATE_ARRIVAL_SECONDS = 120;
const CORPORATE_FLAGSHIP_DESTROYED_TRIGGER = 2;
const CORPORATE_RESPAWN_SECONDS = 120;
const LOW_HEALTH_RELIEF_THRESHOLD = 0.25;
const LOW_HEALTH_MINIMUM_SHIPS = 6;

export class SurvivalDirector {
  private elapsedSeconds = 0;
  private nextWaveAtSeconds = 12;
  private nextCorporateAtSeconds = CORPORATE_ARRIVAL_SECONDS;
  private firstCorporateSpawned = false;
  private corporateWasActive = false;

  reset(): void {
    this.elapsedSeconds = 0;
    this.nextWaveAtSeconds = 12;
    this.nextCorporateAtSeconds = CORPORATE_ARRIVAL_SECONDS;
    this.firstCorporateSpawned = false;
    this.corporateWasActive = false;
  }

  update(input: SurvivalDirectorInput): SurvivalSpawnCommand[] {
    this.elapsedSeconds += input.deltaSeconds;
    this.updateCorporateCooldown(input.corporateActive);

    const commands: SurvivalSpawnCommand[] = [];
    const tier = this.getTierConfig();

    const shouldSpawnCorporate =
      !input.corporateActive &&
      (this.elapsedSeconds >= this.nextCorporateAtSeconds ||
        (!this.firstCorporateSpawned && input.flagshipsDestroyed >= CORPORATE_FLAGSHIP_DESTROYED_TRIGGER));

    if (shouldSpawnCorporate) {
      commands.push({ role: 'corporate_whaler', count: 1, reason: 'corporate' });
      this.firstCorporateSpawned = true;
      this.nextCorporateAtSeconds = Number.POSITIVE_INFINITY;
      return commands;
    }

    if (input.rescueTowActive) {
      this.nextWaveAtSeconds = Math.max(this.nextWaveAtSeconds, this.elapsedSeconds + 6);
      return commands;
    }

    if (this.elapsedSeconds < this.nextWaveAtSeconds) {
      return commands;
    }

    if (
      input.whaleHealthPercent < LOW_HEALTH_RELIEF_THRESHOLD &&
      input.livingCombatShips >= LOW_HEALTH_MINIMUM_SHIPS
    ) {
      this.nextWaveAtSeconds = this.elapsedSeconds + 5;
      return commands;
    }

    const rowboatDeficit = Math.max(0, tier.rowboatCap - input.livingRowboats);
    const flagshipDeficit = Math.max(0, tier.flagshipCap - input.livingFlagships);

    if (flagshipDeficit > 0) {
      commands.push({ role: 'flagship', count: 1, reason: input.livingFlagships <= 0 ? 'reinforcement' : 'escalation' });
    }

    if (rowboatDeficit > 0) {
      commands.push({
        role: 'rowboat',
        count: Math.min(rowboatDeficit, tier.maxRowboatsPerWave),
        reason: 'reinforcement',
      });
    }

    this.nextWaveAtSeconds =
      commands.length > 0 ? this.elapsedSeconds + tier.nextWaveDelay : this.elapsedSeconds + 4;
    return commands;
  }

  getSnapshot(): SurvivalDirectorSnapshot {
    const tier = this.getTierConfig();

    return {
      elapsedSeconds: this.elapsedSeconds,
      flagshipCap: tier.flagshipCap,
      overrun: tier.tier === 'overrun',
      rowboatCap: tier.rowboatCap,
      tier: tier.tier,
    };
  }

  private updateCorporateCooldown(corporateActive: boolean): void {
    if (corporateActive) {
      this.corporateWasActive = true;
      return;
    }

    if (!this.corporateWasActive) {
      return;
    }

    this.corporateWasActive = false;
    this.nextCorporateAtSeconds = this.elapsedSeconds + CORPORATE_RESPAWN_SECONDS;
  }

  private getTierConfig(): SurvivalTierConfig {
    if (this.elapsedSeconds >= 300) {
      return {
        tier: 'overrun',
        rowboatCap: 16,
        flagshipCap: 3,
        maxRowboatsPerWave: 4,
        nextWaveDelay: 8,
      };
    }

    if (this.elapsedSeconds >= CORPORATE_ARRIVAL_SECONDS) {
      return {
        tier: 'corporate',
        rowboatCap: 12,
        flagshipCap: 2,
        maxRowboatsPerWave: 3,
        nextWaveDelay: 10,
      };
    }

    if (this.elapsedSeconds >= 105) {
      return {
        tier: 'escalation',
        rowboatCap: 10,
        flagshipCap: 2,
        maxRowboatsPerWave: 3,
        nextWaveDelay: 12,
      };
    }

    if (this.elapsedSeconds >= 45) {
      return {
        tier: 'pressure',
        rowboatCap: 8,
        flagshipCap: 1,
        maxRowboatsPerWave: 2,
        nextWaveDelay: 13,
      };
    }

    return {
      tier: 'opening',
      rowboatCap: 6,
      flagshipCap: 1,
      maxRowboatsPerWave: 2,
      nextWaveDelay: 14,
    };
  }
}
