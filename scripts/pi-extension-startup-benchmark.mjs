#!/usr/bin/env node
/**
 * Benchmark pi startup cost per installed extension package.
 *
 * What it measures:
 *   - baseline: pi startup with extension/resource discovery disabled
 *   - each package: baseline + that package's pi.extensions entries via explicit -e
 *   - all-installed: normal installed-extension discovery, with other resource types disabled
 *
 * Usage:
 *   node ~/bin/pi-extension-startup-benchmark.mjs
 *   node ~/bin/pi-extension-startup-benchmark.mjs --repeats 7 --warmup 2
 *   node ~/bin/pi-extension-startup-benchmark.mjs --json
 *
 * Notes:
 *   Uses `pi --help` as a safe startup probe, so it measures extension loading and
 *   CLI registration without contacting a model. Hooks that only run inside an
 *   agent session may not be included.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_REPEATS = 5;
const DEFAULT_WARMUP = 1;
const TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const opts = {
    repeats: Number(process.env.PI_BENCH_REPEATS || DEFAULT_REPEATS),
    warmup: Number(process.env.PI_BENCH_WARMUP || DEFAULT_WARMUP),
    json: false,
    keepSkills: false,
    keepThemes: false,
    keepPrompts: false,
    keepContextFiles: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repeats' || arg === '-n') opts.repeats = Number(argv[++i]);
    else if (arg.startsWith('--repeats=')) opts.repeats = Number(arg.split('=')[1]);
    else if (arg === '--warmup') opts.warmup = Number(argv[++i]);
    else if (arg.startsWith('--warmup=')) opts.warmup = Number(arg.split('=')[1]);
    else if (arg === '--json') opts.json = true;
    else if (arg === '--keep-skills') opts.keepSkills = true;
    else if (arg === '--keep-themes') opts.keepThemes = true;
    else if (arg === '--keep-prompts') opts.keepPrompts = true;
    else if (arg === '--keep-context-files') opts.keepContextFiles = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: pi-extension-startup-benchmark.mjs [options]\n\nOptions:\n  -n, --repeats <n>        measured runs per target (default ${DEFAULT_REPEATS})\n      --warmup <n>         unrecorded warmup runs per target (default ${DEFAULT_WARMUP})\n      --json               print JSON instead of a table\n      --keep-skills        do not pass --no-skills\n      --keep-themes        do not pass --no-themes\n      --keep-prompts       do not pass --no-prompt-templates\n      --keep-context-files do not pass --no-context-files\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(opts.repeats) || opts.repeats < 1) throw new Error('--repeats must be a positive integer');
  if (!Number.isInteger(opts.warmup) || opts.warmup < 0) throw new Error('--warmup must be a non-negative integer');
  return opts;
}

function run(cmd, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: { ...process.env, PI_OFFLINE: '1', NO_COLOR: '1' },
    ...options,
  });
  const ms = performance.now() - started;
  return {
    ms,
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error.message || result.error) : '',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function parsePiList(output) {
  const packages = [];
  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const sourceMatch = lines[i].match(/^\s{2}(\S.*)$/);
    const pathMatch = lines[i + 1]?.match(/^\s{4}(\/.*)$/);
    if (sourceMatch && pathMatch) {
      packages.push({ source: sourceMatch[1].trim(), root: pathMatch[1].trim() });
      i++;
    }
  }
  return packages;
}

function extensionEntriesForPackage(pkg) {
  const packageJson = path.join(pkg.root, 'package.json');
  if (!existsSync(packageJson)) return [];
  const json = JSON.parse(readFileSync(packageJson, 'utf8'));
  const entries = Array.isArray(json.pi?.extensions) ? json.pi.extensions : [];
  return entries.map((entry) => path.resolve(pkg.root, entry));
}

function targetExists(target) {
  try {
    return existsSync(target) || existsSync(`${target}.js`) || existsSync(`${target}.ts`);
  } catch {
    return false;
  }
}

function displayName(pkg) {
  return pkg.source.replace(/^npm:/, '');
}

function commonArgs(opts) {
  const args = ['--offline', '--no-session'];
  if (!opts.keepSkills) args.push('--no-skills');
  if (!opts.keepPrompts) args.push('--no-prompt-templates');
  if (!opts.keepThemes) args.push('--no-themes');
  if (!opts.keepContextFiles) args.push('--no-context-files');
  return args;
}

function argsForTarget(target, opts) {
  const args = commonArgs(opts);
  if (target.mode === 'baseline') {
    args.push('--no-extensions');
  } else if (target.mode === 'single') {
    args.push('--no-extensions');
    for (const entry of target.entries) args.push('-e', entry);
  } else if (target.mode === 'all-installed') {
    // Let pi discover installed extensions from settings, but keep non-extension
    // resources disabled unless the caller opted back in.
  }
  args.push('--help');
  return args;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(samples) {
  const values = samples.map((s) => s.ms);
  return {
    runs: samples.length,
    minMs: Math.round(Math.min(...values)),
    medianMs: Math.round(median(values)),
    p95Ms: Math.round(percentile(values, 95)),
    maxMs: Math.round(Math.max(...values)),
  };
}

function benchmarkTarget(target, opts) {
  const args = argsForTarget(target, opts);
  const warmups = [];
  for (let i = 0; i < opts.warmup; i++) warmups.push(run('pi', args));

  const samples = [];
  for (let i = 0; i < opts.repeats; i++) samples.push(run('pi', args));

  const failures = [...warmups, ...samples].filter((r) => r.status !== 0 || r.error || r.signal);
  return {
    ...target,
    args: ['pi', ...args],
    ...summarize(samples),
    failed: failures.length > 0,
    failure: failures[0]
      ? {
          status: failures[0].status,
          signal: failures[0].signal,
          error: failures[0].error,
          stderr: failures[0].stderr.slice(0, 800),
        }
      : null,
  };
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function printTable(results, opts) {
  const baseline = results.find((r) => r.mode === 'baseline')?.medianMs || 0;
  const rows = results.map((r) => ({
    name: r.name,
    entries: r.entries?.length ?? '',
    median: r.medianMs,
    overhead: r.mode === 'baseline' ? 0 : r.medianMs - baseline,
    min: r.minMs,
    p95: r.p95Ms,
    max: r.maxMs,
    status: r.failed ? 'FAIL' : 'ok',
  }));

  rows.sort((a, b) => {
    if (a.name === 'baseline-no-extensions') return -1;
    if (b.name === 'baseline-no-extensions') return 1;
    if (a.name === 'all-installed-extensions') return -1;
    if (b.name === 'all-installed-extensions') return 1;
    return b.overhead - a.overhead;
  });

  const widths = {
    name: Math.max('target'.length, ...rows.map((r) => r.name.length)),
    entries: Math.max('exts'.length, ...rows.map((r) => String(r.entries).length)),
    median: 'median'.length,
    overhead: 'overhead'.length,
    min: 'min'.length,
    p95: 'p95'.length,
    max: 'max'.length,
    status: 'status'.length,
  };

  console.log(`pi extension startup benchmark (${opts.repeats} runs, ${opts.warmup} warmup, PI_OFFLINE=1)`);
  console.log('Probe: pi --help with extensions isolated via --no-extensions + -e');
  console.log('');
  console.log([
    pad('target', widths.name),
    pad('exts', widths.entries),
    pad('median', widths.median),
    pad('overhead', widths.overhead),
    pad('min', widths.min),
    pad('p95', widths.p95),
    pad('max', widths.max),
    pad('status', widths.status),
  ].join('  '));
  console.log([
    '-'.repeat(widths.name),
    '-'.repeat(widths.entries),
    '-'.repeat(widths.median),
    '-'.repeat(widths.overhead),
    '-'.repeat(widths.min),
    '-'.repeat(widths.p95),
    '-'.repeat(widths.max),
    '-'.repeat(widths.status),
  ].join('  '));

  for (const r of rows) {
    const overhead = `${r.overhead >= 0 ? '+' : ''}${r.overhead}ms`;
    console.log([
      pad(r.name, widths.name),
      pad(r.entries, widths.entries),
      pad(`${r.median}ms`, widths.median),
      pad(overhead, widths.overhead),
      pad(`${r.min}ms`, widths.min),
      pad(`${r.p95}ms`, widths.p95),
      pad(`${r.max}ms`, widths.max),
      pad(r.status, widths.status),
    ].join('  '));
  }

  const failures = results.filter((r) => r.failed);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`- ${f.name}: ${f.failure?.error || f.failure?.stderr || `status ${f.failure?.status}`}`);
    }
  }

  console.log('\nTip: higher overhead means that package adds more startup time relative to baseline.');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const list = run('pi', ['list']);
  if (list.status !== 0) {
    throw new Error(`pi list failed:\n${list.stderr || list.stdout || list.error}`);
  }

  const packages = parsePiList(list.stdout || list.stderr);
  const singleTargets = packages
    .map((pkg) => ({
      mode: 'single',
      name: displayName(pkg),
      source: pkg.source,
      root: pkg.root,
      entries: extensionEntriesForPackage(pkg),
    }))
    .filter((target) => target.entries.length > 0)
    .map((target) => ({
      ...target,
      entries: target.entries.filter(targetExists),
    }))
    .filter((target) => target.entries.length > 0);

  const skipped = packages.filter((pkg) => extensionEntriesForPackage(pkg).length === 0).map(displayName);

  const targets = [
    { mode: 'baseline', name: 'baseline-no-extensions', entries: [] },
    { mode: 'all-installed', name: 'all-installed-extensions', entries: [] },
    ...singleTargets,
  ];

  const results = [];
  for (const target of targets) {
    if (!opts.json) process.stderr.write(`benchmarking ${target.name}...\n`);
    results.push(benchmarkTarget(target, opts));
  }

  const output = {
    createdAt: new Date().toISOString(),
    repeats: opts.repeats,
    warmup: opts.warmup,
    skippedPackagesWithoutExtensions: skipped,
    results,
  };

  if (opts.json) console.log(JSON.stringify(output, null, 2));
  else {
    printTable(results, opts);
    if (skipped.length) console.log(`\nSkipped packages with no pi.extensions: ${skipped.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
