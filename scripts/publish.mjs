#!/usr/bin/env node
// Publish helper: checks -> version bump -> changelog -> tag -> push -> GitHub release.
// Usage:
//   pnpm publish:release -- patch        # 0.1.0 -> 0.1.1
//   pnpm publish:release -- minor        # 0.1.0 -> 0.2.0
//   pnpm publish:release -- major        # 0.1.0 -> 1.0.0
//   pnpm publish:release -- --version 0.2.0
//   pnpm publish:release -- --dry-run -- patch   # no git writes
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "packages", "better-glimm");
const pkgPath = join(pkgDir, "package.json");
const changelogPath = join(pkgDir, "CHANGELOG.md");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const versionFlag =
  args.find((a) => a.startsWith("--version="))?.split("=")[1] ??
  (args.includes("--version") ? args[args.indexOf("--version") + 1] : undefined);
const bump = args.find((a) => ["patch", "minor", "major"].includes(a));

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  if (dryRun && !opts.readOnly) {
    console.log("(dry-run: skipped)");
    return "";
  }
  return execSync(cmd, { cwd: root, stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8" });
}

function out(cmd) {
  try {
    return execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function bumpVersion(current, kind) {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)(-.*)?$/);
  if (!m) throw new Error(`cannot bump non-semver version: ${current}`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

if (!versionFlag && !bump) {
  console.error("Usage: pnpm publish:release -- [patch|minor|major|--version x.y.z] [--dry-run]");
  process.exit(1);
}

// 1-3. Checks: lint, format, typecheck, test, build.
run("pnpm lint");
run("pnpm format");
run("pnpm format:check");
run("pnpm typecheck");
run("pnpm --filter better-glimm test");
run("pnpm --filter better-glimm build");

// 4. Resolve + write version.
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const next = versionFlag ?? bumpVersion(pkg.version, bump ?? "patch");
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) throw new Error(`bad version: ${next}`);
if (!dryRun) {
  pkg.version = next;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
const tag = `release-v${next}`;
if (out(`git tag --list ${tag}`)) throw new Error(`tag ${tag} already exists`);
console.log(`version: ${pkg.version} -> ${next} (${tag})`);

// 5. Changelog entry from commits since last release-* tag.
const lastTag = out("git describe --tags --match 'release-*' --abbrev=0 HEAD 2>/dev/null");
const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
let log = "";
try {
  log = execFileSync("git", ["log", range, "--oneline", "--no-merges"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  log = "";
}
const date = new Date().toISOString().slice(0, 10);
const entry = `## ${next} (${date})\n\n${
  log
    ? log
        .split("\n")
        .map((l) => `- ${l}`)
        .join("\n")
    : "- No notable changes."
}\n\n`;
if (!dryRun) {
  const prev = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "# Changelog\n\n";
  const header = "# Changelog\n\n";
  const body = prev.startsWith(header) ? prev.slice(header.length) : prev;
  writeFileSync(changelogPath, `${header}${entry}${body}`);
}

// 6. Commit, tag, push, GitHub release.
if (!dryRun) {
  mkdirSync(join(root, ".tmp"), { recursive: true });
  const notesPath = join(root, ".tmp", `release-${next}.md`);
  writeFileSync(notesPath, `# better-glimm v${next}\n\n${entry}`);
  run(
    `git add packages/better-glimm/package.json packages/better-glimm/CHANGELOG.md pnpm-lock.yaml`,
  );
  const status = out("git status --porcelain");
  if (status) run(`git commit -m "chore(release): better-glimm v${next}"`);
  else console.log("nothing to commit");
  run(`git tag -a ${tag} -m "better-glimm v${next}"`);
  const branch = out("git branch --show-current") || "development";
  run(`git push origin ${branch}`);
  run(`git push origin ${tag}`);
  run(`gh release create ${tag} --title "better-glimm v${next}" --notes-file "${notesPath}"`);
  console.log(`done: ${tag} pushed. CI publishes to npm.`);
} else {
  console.log(`dry-run done. Would tag ${tag}.`);
}
