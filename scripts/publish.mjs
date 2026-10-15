#!/usr/bin/env node
// Release helper for better-glimm.
// Verify -> bump -> changelog -> commit -> tag -> push -> GitHub release.
//
// Usage:
//   pnpm publish:release -- patch              # 0.1.0 -> 0.1.1
//   pnpm publish:release -- minor              # 0.1.0 -> 0.2.0
//   pnpm publish:release -- major              # 0.1.0 -> 1.0.0
//   pnpm publish:release -- --version=0.2.0
//   pnpm publish:release -- --dry-run patch    # print the plan, write nothing
//
// Environment:
//   GIT_AUTHOR_DATE, GIT_COMMITTER_DATE  forwarded to the release commit
//   SKIP_CHECKS=1                        skip lint/format/typecheck/test/build
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgName = "better-glimm";
const pkgDir = join(root, "packages", pkgName);
const pkgPath = join(pkgDir, "package.json");
const changelogPath = join(pkgDir, "CHANGELOG.md");
const lockPath = join(root, "pnpm-lock.yaml");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipChecks = process.env.SKIP_CHECKS === "1" || args.includes("--skip-checks");
const bumps = args.filter((a) => ["patch", "minor", "major"].includes(a));
const bump = bumps[0];
const versionFlag =
  args.find((a) => a.startsWith("--version="))?.slice("--version=".length) ??
  (args.includes("--version") ? args[args.indexOf("--version") + 1] : undefined);

const usage = "Usage: pnpm publish:release -- [patch|minor|major|--version x.y.z] [--dry-run]";

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

// Run a command from the repo root with an argv array. No shell, so nothing in
// a version string or commit message can be re-parsed as a command.
function run(cmd, cmdArgs) {
  console.log(`$ ${[cmd, ...cmdArgs].join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", env: process.env });
}

// Same, but return trimmed stdout. `allowFail` turns a non-zero exit into "".
function capture(cmd, cmdArgs, { allowFail = false } = {}) {
  try {
    return execFileSync(cmd, cmdArgs, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: process.env,
    }).trim();
  } catch (err) {
    if (allowFail) return "";
    throw err;
  }
}

function hasCommand(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function bumpVersion(current, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(current);
  if (!m) throw new Error(`cannot bump non-semver version: ${current}`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function semver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
}

function isGreater(a, b) {
  const x = semver(a);
  const y = semver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i];
  }
  return y.pre !== null && x.pre === null;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}
if (!versionFlag && !bump) fail(usage);
if (bumps.length > 1) fail(`pass one bump, not ${bumps.join(" + ")}`);
if (versionFlag && bump) fail("pass either a bump (patch|minor|major) or --version, not both");
if (versionFlag && !semver(versionFlag)) fail(`not a semver version: ${versionFlag}`);

// --- resolve the target version --------------------------------------------

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const next = versionFlag ?? bumpVersion(current, bump);
const tag = `release-v${next}`;

if (!isGreater(next, current)) fail(`${next} is not greater than the current version ${current}`);
if (capture("git", ["tag", "--list", tag])) fail(`tag ${tag} already exists`);

// --- preflight -------------------------------------------------------------

const branch = capture("git", ["branch", "--show-current"]) || "development";
if (!capture("git", ["remote"], { allowFail: true }).split("\n").includes("origin")) {
  fail("no git remote named origin");
}
if (!dryRun) {
  const dirty = capture("git", ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) fail(`working tree has uncommitted changes, commit or stash them first:\n${dirty}`);
}

// --- checks ----------------------------------------------------------------

if (skipChecks) {
  console.log("skipping checks (SKIP_CHECKS set)");
} else {
  run("pnpm", ["lint"]);
  run("pnpm", ["format:check"]);
  run("pnpm", ["typecheck"]);
  run("pnpm", ["--filter", pkgName, "test"]);
  run("pnpm", ["--filter", pkgName, "build"]);
}

// --- write the new version -------------------------------------------------

if (!dryRun) {
  pkg.version = next;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
console.log(`version ${current} -> ${next} (${tag})`);

// --- changelog entry from commits since the last release tag ---------------

const lastTag = capture(
  "git",
  ["describe", "--tags", "--match", "release-*", "--abbrev=0", "HEAD"],
  { allowFail: true },
);
const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const log = capture("git", ["log", range, "--no-merges", "--pretty=format:- %s (%h)"], {
  allowFail: true,
});
const date = new Date().toISOString().slice(0, 10);
const entry = `## ${next} (${date})\n\n${log || "- No notable changes."}\n\n`;

const header = "# Changelog\n\n";
const prev = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : header;
if (prev.includes(`## ${next} (`)) fail(`CHANGELOG.md already has an entry for ${next}`);
if (!dryRun) {
  const body = prev.startsWith(header) ? prev.slice(header.length) : prev;
  writeFileSync(changelogPath, `${header}${entry}${body}`);
}

// --- commit, tag, push, GitHub release -------------------------------------

if (dryRun) {
  console.log(`dry-run complete. Would create commit and tag ${tag}.`);
  process.exit(0);
}

const tmpDir = mkdtempSync(join(tmpdir(), "better-glimm-release-"));
const notesPath = join(tmpDir, `${tag}.md`);
writeFileSync(notesPath, `# ${pkgName} v${next}\n\n${entry}`);

try {
  const files = [pkgPath, changelogPath, lockPath].filter(existsSync).map((p) => relative(root, p));
  run("git", ["add", "--", ...files]);
  const staged = capture("git", ["diff", "--cached", "--name-only"]);
  if (staged) run("git", ["commit", "-m", `chore(release): ${pkgName} v${next}`]);
  else console.log("nothing staged to commit, tagging the current HEAD");

  run("git", ["tag", "-a", tag, "-m", `${pkgName} v${next}`]);
  run("git", ["push", "origin", branch]);
  run("git", ["push", "origin", tag]);

  if (hasCommand("gh")) {
    run("gh", [
      "release",
      "create",
      tag,
      "--title",
      `${pkgName} v${next}`,
      "--notes-file",
      notesPath,
    ]);
  } else {
    console.warn(`gh not found, skipped the GitHub release for ${tag}`);
  }
  console.log(`done: ${tag} pushed. CI publishes to npm.`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
