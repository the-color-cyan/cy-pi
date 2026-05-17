import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";

const FRAME_INTERVAL_MS = 120;
const MAX_ANIMATED_FRAMES = 8;

const BOOT_LINES = ["$ init context", "$ mount tools", "$ open tui"];
const FIXED_HEADER_HEIGHT = 2 + BOOT_LINES.length;
const SPINNER = ["-", "∙", "•", "∙"];

class StartupHeader implements Component {
  private frame = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
  ) {
    this.timer = setInterval(() => {
      this.frame += 1;
      this.tui.requestRender();

      if (this.frame >= MAX_ANIMATED_FRAMES) {
        clearInterval(this.timer);
      }
    }, FRAME_INTERVAL_MS);
  }

  render(width: number): string[] {
    const lines =
      this.frame >= MAX_ANIMATED_FRAMES
        ? this.renderSigil()
        : this.renderBootSequence();

    return this.fixedHeight(
      lines.map((line) => truncateToWidth(line, width, "")),
      FIXED_HEADER_HEIGHT,
    );
  }

  private renderBootSequence(): string[] {
    const revealedLines = Math.min(
      BOOT_LINES.length,
      Math.floor(this.frame / 3) + 1,
    );
    const spinner = SPINNER[this.frame % SPINNER.length] ?? "·";
    const lines = ["", `  ${this.theme.fg("accent", "[ cy-pi ]")}`];

    for (const [index, line] of BOOT_LINES.entries()) {
      if (index < revealedLines) {
        lines.push(`  ${this.theme.fg("borderAccent", line)}`);
      }
    }

    lines.push(`  ${this.theme.fg("dim", spinner)}`, "");
    return lines;
  }

  private renderSigil(): string[] {
    return [
      "",
      `  ${this.theme.fg("accent", "   π")}`,
      `  ${this.theme.fg("borderAccent", "───────")}`,
      `  ${this.theme.fg("dim", "  p i")}`,
      "",
    ];
  }

  private fixedHeight(output: string[], height: number): string[] {
    return output
      .slice(0, height)
      .concat(Array(Math.max(0, height - output.length)).fill(""));
  }

  invalidate(): void {
    // Render is computed fresh each time so theme changes need no cache reset.
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setHeader((tui, theme) => new StartupHeader(tui, theme));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setHeader(undefined);
  });
}
