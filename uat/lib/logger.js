'use strict';

const C = {
  reset:   '\x1b[0m',  bold:    '\x1b[1m',  dim:     '\x1b[2m',
  green:   '\x1b[32m', red:     '\x1b[31m', yellow:  '\x1b[33m',
  cyan:    '\x1b[36m', grey:    '\x1b[90m', blue:    '\x1b[34m',
  magenta: '\x1b[35m',
};

const log = {
  pass: m => console.log(`  ${C.green}✓ LULUS${C.reset}  ${m}`),
  fail: m => console.log(`  ${C.red}✗ GAGAL${C.reset}  ${m}`),
  warn: m => console.log(`  ${C.yellow}⚠ WARN ${C.reset}  ${m}`),
  bug:  m => console.log(`  ${C.magenta}🔴 BUG ${C.reset}  ${m}`),
  info: m => console.log(`  ${C.grey}ℹ${C.reset}       ${m}`),
  poll: m => console.log(`  ${C.blue}↻ POLL ${C.reset}  ${m}`),
  head: m => console.log(`\n${C.bold}${C.cyan}${m}${C.reset}`),
  sep:  () => console.log(`${C.grey}${'─'.repeat(72)}${C.reset}`),
};

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const round2 = n  => Math.round(n * 100) / 100;

// Default tolerance = 0.02 Rp (matches CONFIG.tolerance; avoids needing CONFIG import in assert.js)
const approxEq = (a, e, tol = 0.02) => {
  if (e === null || e === undefined) return a === null || a === undefined;
  return Math.abs(Number(a) - Number(e)) <= tol;
};

const fmt = n =>
  n == null ? 'null'
  : Number(n).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

module.exports = { C, log, sleep, round2, approxEq, fmt };
