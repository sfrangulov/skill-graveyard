// Lightweight TTY spinner for hiding the "blank screen for N seconds" period
// while the audit is computing. Emits frames on the chosen stream (stderr by
// default) only when that stream is a TTY — pipes/CI/redirects see nothing.

const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerOptions {
  stream?: NodeJS.WriteStream;
  intervalMs?: number;
  frames?: string[];
}

export class Spinner {
  private readonly stream: NodeJS.WriteStream;
  private readonly frames: string[];
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private frameIdx = 0;
  private message = "";
  private active = false;

  constructor(opts: SpinnerOptions = {}) {
    this.stream = opts.stream ?? process.stderr;
    this.frames = opts.frames ?? DEFAULT_FRAMES;
    this.intervalMs = opts.intervalMs ?? 80;
  }

  start(message: string): void {
    if (this.active) return;
    this.message = message;
    if (!this.stream.isTTY) return;
    this.active = true;
    this.frameIdx = 0;
    this.render();
    this.timer = setInterval(() => this.render(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.active) return;
    this.active = false;
    if (this.stream.isTTY) {
      this.stream.write("\r\x1b[K");
    }
  }

  private render(): void {
    const frame = this.frames[this.frameIdx % this.frames.length];
    this.frameIdx++;
    this.stream.write(`\r\x1b[K${frame} ${this.message}`);
  }
}
