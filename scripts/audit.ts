/**
 * Code Audit Script
 *
 * Comprehensive code quality audit for the Sonde codebase.
 * Checks for type safety holes, dead code, design system violations,
 * console statements, large files, tech debt markers, and unused deps.
 *
 * Run:  pnpm audit:code
 * Flags:
 *   --fix     (future: auto-fix safe issues)
 *   --json    output JSON instead of human-readable
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, relative, extname } from "path";

// ── Terminal colors ──────────────────────────────────────────────────────────

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ── Types ────────────────────────────────────────────────────────────────────

interface Finding {
  file: string;
  line?: number;
  text?: string;
  message: string;
}

interface AuditSection {
  name: string;
  severity: "error" | "warning" | "info";
  findings: Finding[];
}

// ── File walker ──────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  ".vercel",
]);

function walk(
  dir: string,
  extensions: string[],
  results: string[] = []
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, extensions, results);
    } else if (extensions.includes(extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function rel(file: string): string {
  return relative(ROOT, file);
}

function readLines(file: string): string[] {
  return readFileSync(file, "utf-8").split("\n");
}

function grepFiles(
  pattern: RegExp,
  files: string[],
  message: string,
  exclude?: RegExp
): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const lines = readLines(file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (pattern.test(line) && (!exclude || !exclude.test(line))) {
        findings.push({
          file: rel(file),
          line: i + 1,
          text: line.trim().slice(0, 120),
          message,
        });
      }
    }
  }
  return findings;
}

// ── Audit checks ─────────────────────────────────────────────────────────────

const srcFiles = walk(SRC, [".ts", ".tsx"]);
const scriptFiles = walk(join(ROOT, "scripts"), [".ts"]);
const allTsFiles = [...srcFiles, ...scriptFiles];


// 1. Explicit `any` usage
function auditAnyTypes(): AuditSection {
  const findings = grepFiles(
    /:\s*any\b|<any>|as\s+any\b|\bany\[\]/,
    srcFiles,
    "Explicit `any` type — consider using a specific type",
    // Exclude eslint-disable, catch blocks, comments, and string content
    /\/\/\s*eslint|catch\s*\(|\.catch\(|@ts-|^\s*\*|^\s*\/\/|\/\*.*any/
  );

  return { name: "Explicit `any` Types", severity: "warning", findings };
}

// 2. Console statements in production code
function auditConsoleStatements(): AuditSection {
  // Only check server-side files (not hooks or client components)
  const serverFiles = srcFiles.filter((f) => {
    if (f.includes("/hooks/")) return false;
    // Read first line to check for "use client" directive
    const firstLines = readLines(f).slice(0, 3).join("\n");
    return !firstLines.includes('"use client"');
  });
  const findings = grepFiles(
    /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/,
    serverFiles,
    "Console statement in server code — use pino logger or remove",
    // Exclude files that legitimately use console
    /\/\/\s*audit-ok|logger|pino/
  );

  return { name: "Console Statements (server)", severity: "warning", findings };
}

// 3. Large files (>150 lines for components, >400 for lib)
function auditLargeFiles(): AuditSection {
  const findings: Finding[] = [];

  for (const file of srcFiles) {
    const lines = readLines(file).length;
    const isComponent =
      file.includes("/components/") || file.includes("/app/");
    const threshold = isComponent ? 150 : 400;

    if (lines > threshold) {
      findings.push({
        file: rel(file),
        message: `${lines} lines (threshold: ${threshold} for ${isComponent ? "components" : "lib"})`,
      });
    }
  }

  // Sort by line count descending
  findings.sort((a, b) => {
    const aLines = parseInt(a.message);
    const bLines = parseInt(b.message);
    return bLines - aLines;
  });

  return { name: "Large Files", severity: "info", findings };
}

// 4. TODO/FIXME/HACK markers
function auditTechDebt(): AuditSection {
  const findings = grepFiles(
    /\b(TODO|FIXME|HACK|XXX|TEMP|WORKAROUND)\b/,
    allTsFiles,
    "Tech debt marker",
    /scripts\/audit\.ts/ // don't match ourselves
  );

  // Add the marker type to each finding
  for (const f of findings) {
    const match = f.text?.match(/\b(TODO|FIXME|HACK|XXX|TEMP|WORKAROUND)\b/);
    if (match) f.message = `${match[1]}: ${f.text}`;
  }

  return { name: "Tech Debt Markers", severity: "info", findings };
}

// 5. Design system violations
function auditDesignSystem(): AuditSection {
  const findings: Finding[] = [];

  // Files where hardcoded hex/font is unavoidable (charts, OG images, canvas, color maps)
  const chartAndImageFiles = (f: string) =>
    f.includes("globals.css") ||
    f.includes("tailwind") ||
    f.includes("opengraph-image") ||
    f.includes("social-image") ||
    f.includes("/og.tsx") ||
    f.includes("apple-icon") ||
    f.includes("manifest.ts") ||
    f.includes("mock-data") ||
    f.includes("xrpl-helpers") || // transaction type color map
    // Chart/data-viz components (Recharts/D3/canvas require inline hex + fontFamily)
    f.includes("Chart") ||
    f.includes("GraphView") ||
    f.includes("NetworkCanvas") ||
    f.includes("FeaturePreview") ||
    f.includes("Treemap") ||
    f.includes("Gauge") ||
    f.includes("Renderer") ||
    f.includes("AMMFeeRevenue") ||
    f.includes("MonthlyReturns") ||
    f.includes("IssuerAnalysis") ||
    f.includes("TokenHolders") ||
    // Admin dashboards (Recharts-heavy)
    f.includes("SiteAnalytics") ||
    f.includes("BusinessMetrics") ||
    f.includes("AiUsageMetrics");

  // Hardcoded hex colors
  findings.push(
    ...grepFiles(
      /#[0-9a-fA-F]{3,8}\b/,
      srcFiles.filter((f) => !chartAndImageFiles(f)),
      "Hardcoded hex color — use design tokens from globals.css",
      // Exclude comments, HTML entities (&#XXXX), SVG, IDs/hashes
      /\/\/|\/\*|\*\/|&#\d|tx_hash|hash|nft_id|ledger_hash|amendment|0x[0-9a-f]/i
    )
  );

  // max-w-[1800px] instead of max-w-container
  findings.push(
    ...grepFiles(
      /max-w-\[1800px\]/,
      srcFiles,
      "Use `max-w-container` instead of `max-w-[1800px]`"
    )
  );

  // bg-white/5 instead of bg-elevated
  findings.push(
    ...grepFiles(
      /bg-white\/5/,
      srcFiles,
      "Use `bg-elevated` instead of `bg-white/5` (invisible in light mode)"
    )
  );

  // border-surface instead of border-elevated for dividers
  findings.push(
    ...grepFiles(
      /border-surface\b/,
      srcFiles,
      "Consider `border-elevated` instead of `border-surface` for dividers"
    )
  );

  // Hardcoded font families — exclude chart/OG files (Recharts needs inline fontFamily)
  findings.push(
    ...grepFiles(
      /font-family:|fontFamily/,
      srcFiles.filter((f) => !chartAndImageFiles(f)),
      "Hardcoded font-family — use font-display/font-body/font-mono tokens"
    )
  );

  // Arbitrary pixel sizes in Tailwind that should use tokens
  findings.push(
    ...grepFiles(
      /text-\[\d+px\]/,
      srcFiles,
      "Arbitrary text size — use design system text tokens"
    )
  );

  return { name: "Design System Violations", severity: "warning", findings };
}

// 6. Unused exports (exports not imported anywhere else)
function auditDeadExports(): AuditSection {
  const findings: Finding[] = [];

  // Build a map of all export names from src/lib/
  const libFiles = srcFiles.filter((f) => f.includes("/lib/"));

  for (const file of libFiles) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    // Find named exports: export function X, export const X, export type X, export interface X
    const exportPattern =
      /^export\s+(?:async\s+)?(?:function|const|let|var|type|interface|enum|class)\s+(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(exportPattern);
      if (!match) continue;

      const name = match[1];
      // Skip common patterns that are always used (React components, default exports)
      if (name.startsWith("_")) continue;

      // Search for this name being imported anywhere in src/
      let imported = false;
      for (const other of srcFiles) {
        if (other === file) continue;
        const otherContent = readFileSync(other, "utf-8");
        // Check for import { name } or import { ..., name, ... } or usage of the name
        if (
          otherContent.includes(name) &&
          (otherContent.includes(`import`) || otherContent.includes(`from`))
        ) {
          imported = true;
          break;
        }
      }

      if (!imported) {
        // Also check scripts/
        for (const script of scriptFiles) {
          const scriptContent = readFileSync(script, "utf-8");
          if (scriptContent.includes(name)) {
            imported = true;
            break;
          }
        }
      }

      if (!imported) {
        findings.push({
          file: rel(file),
          line: i + 1,
          text: lines[i].trim().slice(0, 120),
          message: `Export \`${name}\` is never imported elsewhere`,
        });
      }
    }
  }

  return { name: "Dead Exports (src/lib/)", severity: "warning", findings };
}

// 7. Unused dependencies
function auditUnusedDeps(): AuditSection {
  const findings: Finding[] = [];
  const pkgJson = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf-8")
  );
  const deps = Object.keys(pkgJson.dependencies || {});

  // Framework deps that are required without explicit imports
  const frameworkDeps = new Set(["react-dom"]);

  // Read all source files content once
  const allContent = [...srcFiles, ...scriptFiles]
    .map((f) => readFileSync(f, "utf-8"))
    .join("\n");

  // Also check config files
  const configFiles = ["next.config.ts", "next.config.mjs", "next.config.js",
    "eslint.config.mjs", "postcss.config.mjs", "drizzle.config.ts"]
    .map((f) => join(ROOT, f))
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, "utf-8"))
    .join("\n");

  const allSearchable = allContent + "\n" + configFiles;

  for (const dep of deps) {
    // Normalize: @scope/name -> various import patterns
    const importPatterns = [
      `"${dep}"`,
      `'${dep}'`,
      `"${dep}/`,
      `'${dep}/`,
      `from "${dep}`,
      `from '${dep}`,
      `require("${dep}`,
      `require('${dep}`,
    ];

    const used = frameworkDeps.has(dep) || importPatterns.some((p) => allSearchable.includes(p));
    if (!used) {
      findings.push({
        file: "package.json",
        message: `Dependency \`${dep}\` is never imported in source code`,
      });
    }
  }

  return { name: "Unused Dependencies", severity: "warning", findings };
}

// 8. Type assertions (as X) — potential type safety holes
function auditTypeAssertions(): AuditSection {
  const findings = grepFiles(
    /\bas\s+(?!const\b)[A-Z]\w+/,
    srcFiles,
    "Type assertion — verify this is necessary",
    // Exclude legitimate patterns
    /import\s+.*\s+as\s+|\/\/|\/\*|\*\//
  );

  return { name: "Type Assertions (as X)", severity: "info", findings };
}

// 9. Files never imported (dead files)
function auditDeadFiles(): AuditSection {
  const findings: Finding[] = [];

  for (const file of srcFiles) {
    const relPath = rel(file);

    // Skip entry points and special files
    if (
      relPath.includes("/app/") || // Next.js pages/layouts are entry points
      relPath === "src/middleware.ts" ||
      relPath.endsWith(".d.ts") ||
      relPath.endsWith("globals.css") ||
      relPath.includes("/types/")
    ) {
      continue;
    }

    // Get the module name for import matching
    const baseName = relPath
      .replace(/\/index\.(ts|tsx)$/, "")
      .replace(/\.(ts|tsx)$/, "");

    // Check if any other file imports this one
    let imported = false;
    const shortName = baseName.split("/").pop()!;

    for (const other of [...srcFiles, ...scriptFiles]) {
      if (other === file) continue;
      const content = readFileSync(other, "utf-8");
      // Check for @/path or relative imports containing this file's name
      if (
        content.includes(`@/${baseName.replace("src/", "")}`) ||
        content.includes(`/${shortName}"`) ||
        content.includes(`/${shortName}'`)
      ) {
        imported = true;
        break;
      }
    }

    if (!imported) {
      findings.push({
        file: relPath,
        message: "File is never imported — may be dead code",
      });
    }
  }

  return { name: "Potentially Dead Files", severity: "info", findings };
}

// ── Report ───────────────────────────────────────────────────────────────────

function printSection(section: AuditSection): void {
  const color =
    section.severity === "error"
      ? RED
      : section.severity === "warning"
        ? YELLOW
        : CYAN;
  const icon =
    section.severity === "error"
      ? "x"
      : section.severity === "warning"
        ? "!"
        : "i";

  console.log(
    `\n${color}${BOLD}[${icon}] ${section.name}${RESET} ${DIM}(${section.findings.length} findings)${RESET}`
  );

  if (section.findings.length === 0) {
    console.log(`  ${GREEN}Clean${RESET}`);
    return;
  }

  // Cap display at 25 per section to avoid overwhelming output
  const display = section.findings.slice(0, 25);
  for (const f of display) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`  ${DIM}${loc}${RESET}`);
    console.log(`    ${f.message}`);
  }

  if (section.findings.length > 25) {
    console.log(
      `  ${DIM}... and ${section.findings.length - 25} more${RESET}`
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`${BOLD}${CYAN}Sonde Code Audit${RESET}`);
console.log(`${DIM}Scanning ${srcFiles.length} source files...${RESET}\n`);

const sections: AuditSection[] = [
  auditAnyTypes(),
  auditConsoleStatements(),
  auditDesignSystem(),
  auditLargeFiles(),
  auditTechDebt(),
  auditDeadExports(),
  auditUnusedDeps(),
  auditTypeAssertions(),
  auditDeadFiles(),
];

for (const section of sections) {
  printSection(section);
}

// Summary
console.log(`\n${BOLD}${"─".repeat(60)}${RESET}`);
const errors = sections.filter((s) => s.severity === "error");
const warnings = sections.filter((s) => s.severity === "warning");
const infos = sections.filter((s) => s.severity === "info");

const errorCount = errors.reduce((n, s) => n + s.findings.length, 0);
const warnCount = warnings.reduce((n, s) => n + s.findings.length, 0);
const infoCount = infos.reduce((n, s) => n + s.findings.length, 0);

console.log(
  `${BOLD}Summary:${RESET} ${RED}${errorCount} errors${RESET}, ${YELLOW}${warnCount} warnings${RESET}, ${CYAN}${infoCount} info${RESET}`
);

if (errorCount > 0) {
  process.exit(1);
}
