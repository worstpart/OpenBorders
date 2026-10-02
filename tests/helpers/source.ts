/**
 * Helpers for tests that read the project's own source code (guardrail tests).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const PROJECT_ROOT = join(import.meta.dirname, "..", "..");

export interface SourceFile {
  /** Path relative to the project root, always with "/" separators. */
  path: string;
  source: string;
}

/** Reads every file under `dir` (relative to the project root) with one of `extensions`. */
export function readSourceFiles(dir: string, extensions: readonly string[]): SourceFile[] {
  const absoluteDir = join(PROJECT_ROOT, dir);
  const files: SourceFile[] = [];
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (extensions.some((ext) => name.endsWith(ext))) {
        files.push({
          path: relative(PROJECT_ROOT, full).split(sep).join("/"),
          source: readFileSync(full, "utf8"),
        });
      }
    }
  };
  try {
    visit(absoluteDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return files;
}

/**
 * Replaces comments (and, optionally, the contents of string/template literals) with
 * spaces, keeping newlines so line numbers stay correct. Template-literal `${...}`
 * expressions are kept as code. Regex literals are not recognized; that's acceptable
 * for guard tests because a regex containing a quote or `//` is rare in game code.
 */
export function maskSource(source: string, options: { strings: boolean }): string {
  const out = source.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const n = source.length;
  // Brace depth at which each open `${` expression returns to its template literal.
  const templateResumeDepth: number[] = [];
  let braceDepth = 0;
  let i = 0;

  const scanTemplate = (start: number): number => {
    let j = start;
    while (j < n) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
      } else if (c === "`") {
        if (options.strings) blank(start, j);
        return j + 1;
      } else if (c === "$" && source[j + 1] === "{") {
        if (options.strings) blank(start, j);
        templateResumeDepth.push(braceDepth);
        return j + 2;
      } else {
        j++;
      }
    }
    if (options.strings) blank(start, n);
    return n;
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      if (options.strings) blank(i + 1, j);
      i = j + 1;
    } else if (c === "`") {
      i = scanTemplate(i + 1);
    } else if (c === "}" && templateResumeDepth.at(-1) === braceDepth) {
      templateResumeDepth.pop();
      i = scanTemplate(i + 1);
    } else {
      if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;
      i++;
    }
  }
  return out.join("");
}

/** 1-based line number of a character offset. */
export function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let k = 0; k < offset; k++) if (source.charCodeAt(k) === 10) line++;
  return line;
}
