import path from "node:path";

import { formatLocation } from "../../../src";
import {
  formatDisplayPath,
  formatLocationDisplay,
  linkSourceLocation,
} from "../../../src/cli/output/hyperlinks";
import type { SourceLocation } from "../../../src/model";

const loc: SourceLocation = {
  file: "/abs/path/arch.puml",
  start: { line: 12, col: 5, offset: 200 },
  end: { line: 12, col: 25, offset: 220 },
};

// ESC = 27 (0x1B) — chose decimal to sidestep the prettier/unicorn
// hex-casing fight (prettier wants `0x1b`, unicorn `0x1B`).
const ESC = String.fromCodePoint(27);

describe("formatLocation", () => {
  it("renders <file>:<line>:<col> inline", () => {
    expect(formatLocation(loc)).toBe("/abs/path/arch.puml:12:5");
  });

  it("is library-safe — no escape sequences", () => {
    expect(formatLocation(loc).includes(ESC)).toBe(false);
  });
});

describe("formatDisplayPath", () => {
  it("relativises an absolute path that lives under cwd", () => {
    const cwd = "/Users/me/project";
    expect(formatDisplayPath(`${cwd}/src/arch.puml`, cwd)).toBe(
      path.join("src", "arch.puml"),
    );
  });

  it("keeps the absolute form when the file is outside cwd (path.relative `..`)", () => {
    expect(formatDisplayPath("/etc/hosts", "/Users/me/project")).toBe(
      "/etc/hosts",
    );
  });

  it("keeps the original string when the path is already relative", () => {
    expect(formatDisplayPath("examples/x.puml", "/Users/me/project")).toBe(
      "examples/x.puml",
    );
  });

  it("returns the absolute file when it equals cwd exactly", () => {
    // `path.relative(cwd, cwd) === ""` — the helper falls back to
    // the absolute form so the user sees a real address.
    const cwd = "/Users/me/project";
    expect(formatDisplayPath(cwd, cwd)).toBe(cwd);
  });
});

describe("formatLocationDisplay", () => {
  it("pairs relativised path with the canonical :line:col suffix", () => {
    const cwd = "/Users/me/project";
    const here: SourceLocation = {
      ...loc,
      file: `${cwd}/src/arch.puml`,
    };
    expect(formatLocationDisplay(here, cwd)).toBe(
      `${path.join("src", "arch.puml")}:12:5`,
    );
  });

  it("falls back to the absolute path for files outside cwd", () => {
    expect(formatLocationDisplay(loc, "/Users/me/project")).toBe(
      "/abs/path/arch.puml:12:5",
    );
  });
});

describe("linkSourceLocation — plain-text fallbacks", () => {
  // `terminal-link.isSupported` returns false under vitest (no TTY),
  // so the helper consistently falls back to plain text in this
  // environment — exactly the contract we want for library users
  // piping output through.

  it("returns plain text when sourceLocation is undefined", () => {
    expect(linkSourceLocation("text")).toBe("text");
  });

  it("returns plain text when explicitly disabled", () => {
    expect(linkSourceLocation("text", loc, { disabled: true })).toBe("text");
  });

  it("returns plain text when terminal does not support OSC 8 (piped)", () => {
    expect(linkSourceLocation("text", loc)).toBe("text");
  });

  it("preserves display text untouched even with spaces / unicode", () => {
    expect(linkSourceLocation("api  ", loc, { disabled: true })).toBe("api  ");
    expect(linkSourceLocation("→ b", loc, { disabled: true })).toBe("→ b");
  });
});

const withMockedSupport = async (
  run: (mod: typeof import("../../../src/cli/output/hyperlinks")) => void,
): Promise<void> => {
  vi.resetModules();
  vi.doMock("terminal-link", () => ({
    default: Object.assign(
      (text: string, url: string) =>
        `${ESC}]8;;${url}${ESC}\\${text}${ESC}]8;;${ESC}\\`,
      { isSupported: true },
    ),
  }));
  const mod = await import("../../../src/cli/output/hyperlinks");
  try {
    run(mod);
  } finally {
    vi.doUnmock("terminal-link");
    vi.resetModules();
  }
};

describe("linkSourceLocation — per-terminal URL schemes", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TERM_PROGRAM;
    delete process.env.CURSOR_TRACE_ID;
    delete process.env.AACT_FILE_OPENER;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("uses `file://abs:line:col` inside VSCode integrated terminal", async () => {
    process.env.TERM_PROGRAM = "vscode";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toContain("file:///abs/path/arch.puml:12:5");
      expect(rendered).not.toContain("vscode://");
    });
  });

  it("uses `file://abs:line:col` inside Cursor integrated terminal", async () => {
    process.env.CURSOR_TRACE_ID = "abc-123";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toContain("file:///abs/path/arch.puml:12:5");
    });
  });

  it("skips OSC 8 entirely inside Zed integrated terminal", async () => {
    // Zed has built-in `path:line:col` autodetection; OSC 8 with
    // an external URL would route via OS handler and bypass Zed's
    // "open in this window" flow.
    process.env.TERM_PROGRAM = "zed";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toBe("text");
    });
  });

  it("defaults to `vscode://file/abs:line:col` in external terminals", async () => {
    // No TERM_PROGRAM set — represents Ghostty / iTerm2 / WezTerm
    // / Kitty etc. where the OSC 8 URL goes through the OS handler.
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toContain("vscode://file//abs/path/arch.puml:12:5");
    });
  });

  it("honours AACT_FILE_OPENER=cursor → emits cursor://file/...", async () => {
    process.env.AACT_FILE_OPENER = "cursor";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toContain("cursor://file//abs/path/arch.puml:12:5");
    });
  });

  it("honours AACT_FILE_OPENER=vscode-insiders", async () => {
    process.env.AACT_FILE_OPENER = "vscode-insiders";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toContain(
        "vscode-insiders://file//abs/path/arch.puml:12:5",
      );
    });
  });

  it("honours AACT_FILE_OPENER=windsurf", async () => {
    process.env.AACT_FILE_OPENER = "windsurf";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toContain("windsurf://file//abs/path/arch.puml:12:5");
    });
  });

  it("AACT_FILE_OPENER=none disables OSC 8 and returns plain text", async () => {
    process.env.AACT_FILE_OPENER = "none";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toBe("text");
    });
  });

  it("ignores unknown AACT_FILE_OPENER values and falls back to vscode default", async () => {
    process.env.AACT_FILE_OPENER = "emacs";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toContain("vscode://file//abs/path/arch.puml:12:5");
    });
  });

  it("opts.fileOpener parameter overrides AACT_FILE_OPENER env", async () => {
    process.env.AACT_FILE_OPENER = "cursor";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc, {
        fileOpener: "vscode",
      });
      expect(rendered).toContain("vscode://file//abs/path/arch.puml:12:5");
      expect(rendered).not.toContain("cursor://");
    });
  });

  it("integrated-terminal detection takes precedence over fileOpener", async () => {
    // Inside VSCode integrated terminal the file:// shortcut is
    // always correct — there's no other editor to "open in".
    process.env.TERM_PROGRAM = "vscode";
    process.env.AACT_FILE_OPENER = "cursor";
    await withMockedSupport((mod) => {
      const rendered = mod.linkSourceLocation("text", loc);
      expect(rendered).toContain("file:///abs/path/arch.puml:12:5");
      expect(rendered).not.toContain("cursor://");
    });
  });
});
