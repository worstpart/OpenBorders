/**
 * Performance overlay (toggle with F3 or `): FPS, CPU time per frame, simulation time
 * per tick and GPU upload time. Averages refresh twice a second. On a 165 Hz display
 * FPS alone hides cost, so per-frame CPU time is the number to watch.
 */

interface Sample {
  frames: number;
  frameCpuMs: number;
  ticks: number;
  tickMs: number;
  maxTickMs: number;
  uploadMs: number;
}

const REFRESH_MS = 500;

export class PerfOverlay {
  private readonly element: HTMLElement;
  private sample: Sample = emptySample();
  private windowStart = performance.now();
  private visible = false;

  constructor(parent: HTMLElement) {
    this.element = document.createElement("pre");
    this.element.className = "perf-overlay";
    this.element.setAttribute("aria-hidden", "true");
    Object.assign(this.element.style, {
      position: "fixed",
      left: "8px",
      bottom: "8px",
      margin: "0",
      padding: "6px 8px",
      font: "12px/1.4 ui-monospace, Consolas, monospace",
      color: "#d8e2f0",
      background: "rgba(8, 12, 18, 0.72)",
      borderRadius: "6px",
      pointerEvents: "none",
      display: "none",
      zIndex: "50",
    });
    parent.appendChild(this.element);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.style.display = this.visible ? "block" : "none";
  }

  recordFrame(cpuMs: number, uploadMs: number): void {
    this.sample.frames++;
    this.sample.frameCpuMs += cpuMs;
    this.sample.uploadMs += uploadMs;
    const now = performance.now();
    if (now - this.windowStart >= REFRESH_MS) {
      if (this.visible) this.element.textContent = this.describe(now - this.windowStart);
      this.sample = emptySample();
      this.windowStart = now;
    }
  }

  recordTick(tickMs: number): void {
    this.sample.ticks++;
    this.sample.tickMs += tickMs;
    this.sample.maxTickMs = Math.max(this.sample.maxTickMs, tickMs);
  }

  private describe(elapsedMs: number): string {
    const s = this.sample;
    const avg = (total: number, count: number) => (count > 0 ? total / count : 0).toFixed(2);
    return [
      `fps      ${((s.frames * 1000) / elapsedMs).toFixed(0)}`,
      `frame    ${avg(s.frameCpuMs, s.frames)} ms cpu`,
      `upload   ${avg(s.uploadMs, s.frames)} ms/frame`,
      `tick     ${avg(s.tickMs, s.ticks)} ms avg · ${s.maxTickMs.toFixed(2)} max`,
    ].join("\n");
  }
}

function emptySample(): Sample {
  return { frames: 0, frameCpuMs: 0, ticks: 0, tickMs: 0, maxTickMs: 0, uploadMs: 0 };
}
