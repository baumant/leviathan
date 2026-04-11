export class Time {
  private previousTimestamp = performance.now();

  deltaSeconds = 0;
  elapsedSeconds = 0;

  tick(timestamp = performance.now()): number {
    const deltaMs = Math.min(50, timestamp - this.previousTimestamp);

    this.previousTimestamp = timestamp;
    this.deltaSeconds = deltaMs / 1000;
    this.elapsedSeconds += this.deltaSeconds;

    return this.deltaSeconds;
  }
}
