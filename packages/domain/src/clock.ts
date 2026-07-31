export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  public constructor(private instant: Date) {}

  public now(): Date {
    return new Date(this.instant.getTime());
  }

  public advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds))
      throw new Error("Clock advance must use safe integer milliseconds");
    this.instant = new Date(this.instant.getTime() + milliseconds);
  }
}

export const demoInstant = new Date("2026-07-31T16:00:00.000Z");
export const demoClock = () => new FixedClock(demoInstant);
