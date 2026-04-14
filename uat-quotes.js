#!/usr/bin/env node
/**
 * DAP Zoho CRM – UAT Formula Test Runner  TC-F-01 to TC-F-10
 *
 * FLOW (integration scenarios)
 * ─────────────────────────────
 *   1. POST Quote with real Kode_Bom + scenario extras (Corp.Price, Discounts, Qty)
 *   2. Poll until DAP API writes back COGS, MUF, KODE_KAIN
 *   3. Read actual COGS that arrived from integration
 *   4. computeDynamicExpected() derives all formula assertions from that COGS
 *   5. Assert Price, Price_Quote, Final_Price, Total_COGS, Total_Price, Net_Income, GPR
 *
 * TC-F-09 is two-step:
 *   POST (no Corp.Price) → poll → PATCH Corp.Price = actualPrice → re-fetch → assert
 *
 * FLOW (direct scenarios – TC-F-02, TC-F-03, TC-F-04)
 * ─────────────────────────────
 *   COGS injected directly, Kode_Bom omitted so integration does NOT fire.
 *   Used only for edge cases that require controlling the exact COGS value.
 *
 * Usage:
 *   node DAP_UAT_Formula_TC01_TC10.js                    # integration (default)
 *   node DAP_UAT_Formula_TC01_TC10.js --mode=direct      # direct only
 *   node DAP_UAT_Formula_TC01_TC10.js --mode=all         # both
 */
'use strict';

const fs   = require('fs/promises');
const path = require('path');
require('dotenv').config();

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const REAL_BOM  = 'PKS.FTD.200X200+35.148S-1';
const REAL_DATE = '2026-04';

const CONFIG = {
  token:               null,
  baseUrl:             'https://www.zohoapis.com/crm/v3',
  subform:             'Quoted_Items_2',
  delayMs:             1500,       // pause between scenarios
  formulaWaitMs:       3000,       // fixed wait after POST/PATCH (direct & two-step)
  integrationWaitMs:   20000,      // max wait for DAP API callback
  integrationPollMs:   2500,       // polling interval
  tolerance:           0.02,       // Rp floating-point tolerance
  logFile:             './uat_results_TC01_TC10.json',
  placeholderProduct:  null,

  // Polling ends when ALL of these are non-null and non-zero
  integrationSignalFields: ['COGS', 'MUF'],
};

const CLI_MODE = (() => {
  const a = process.argv.find(x => x.startsWith('--mode='));
  return a ? a.split('=')[1] : 'integration';
})();

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const sleep  = ms => new Promise(r => setTimeout(r, ms));
const round2 = n  => Math.round(n * 100) / 100;

const approxEq = (a, e, tol = CONFIG.tolerance) => {
  if (e === null || e === undefined) return a === null || a === undefined;
  return Math.abs(Number(a) - Number(e)) <= tol;
};

const fmt = n =>
  n == null ? 'null'
  : Number(n).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  green:'\x1b[32m', red:'\x1b[31m', yellow:'\x1b[33m',
  cyan:'\x1b[36m', grey:'\x1b[90m', blue:'\x1b[34m',
};
const log = {
  pass: m => console.log(`  ${C.green}✓ LULUS${C.reset}  ${m}`),
  fail: m => console.log(`  ${C.red}✗ GAGAL${C.reset}  ${m}`),
  warn: m => console.log(`  ${C.yellow}⚠ WARN ${C.reset}  ${m}`),
  info: m => console.log(`  ${C.grey}ℹ${C.reset}       ${m}`),
  poll: m => console.log(`  ${C.blue}↻ POLL ${C.reset}  ${m}`),
  head: m => console.log(`\n${C.bold}${C.cyan}${m}${C.reset}`),
  sep:  () => console.log(`${C.grey}${'─'.repeat(72)}${C.reset}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────
async function getAccessToken() {
  let creds;
  try {
    creds = JSON.parse(await fs.readFile(path.join(process.cwd(), 'self_client.json'), 'utf8'));
  } catch { throw new Error('Cannot read self_client.json'); }

  if (creds.access_token && creds.expiry_time && Date.now() < creds.expiry_time - 60000) {
    log.info('Using cached access token.'); return creds.access_token;
  }
  log.info('Requesting new access token...');
  const params = new URLSearchParams({
    client_id: creds.client_id, client_secret: creds.client_secret,
    grant_type: creds.refresh_token ? 'refresh_token' : 'authorization_code',
    ...(creds.refresh_token ? { refresh_token: creds.refresh_token } : { code: creds.code }),
  });
  const data = await (await fetch('https://accounts.zoho.com/oauth/v2/token',
    { method: 'POST', body: params })).json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  const updated = { ...creds, access_token: data.access_token,
    expiry_time: Date.now() + data.expires_in * 1000,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}) };
  await fs.writeFile(path.join(process.cwd(), 'self_client.json'), JSON.stringify(updated, null, 2));
  log.info('New token saved.'); return data.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// API WRAPPERS
// ─────────────────────────────────────────────────────────────────────────────
const apiH = () => ({
  'Authorization': `Zoho-oauthtoken ${CONFIG.token}`,
  'Content-Type': 'application/json',
});

async function discoverPlaceholder() {
  log.info('Fetching placeholder product...');
  const j = await (await fetch(`${CONFIG.baseUrl}/Products?fields=id,Product_Name&per_page=1`,
    { headers: apiH() })).json();
  const p = j?.data?.[0];
  if (!p?.id) throw new Error('No active products found. Create one first.');
  log.info(`Placeholder: "${p.Product_Name}" (${p.id})`); return { id: p.id, name: p.Product_Name };
}

const placeholderRow = () => ({
  Product_Name: { id: CONFIG.placeholderProduct.id, name: CONFIG.placeholderProduct.name },
  Quantity: 1, Unit_Price: 0, Total: 0,
});

async function createQuote(subject, customRow) {
  const body = { data: [{
    Subject: subject, Quote_Stage: 'Draft',
    Quoted_Items:     [placeholderRow()],
    [CONFIG.subform]: [customRow],
  }]};
  const j = await (await fetch(`${CONFIG.baseUrl}/Quotes`,
    { method: 'POST', headers: apiH(), body: JSON.stringify(body) })).json();
  const item = j?.data?.[0] ?? {};
  return { id: item?.details?.id ?? null, apiCode: item?.code ?? 'UNKNOWN',
           message: item?.message ?? '', raw: item };
}

async function getQuote(id) {
  const r = await fetch(`${CONFIG.baseUrl}/Quotes/${id}`, { headers: apiH() });
  const d = (await r.json())?.data?.[0] ?? {};
  return { httpStatus: r.status, subformRow: (d[CONFIG.subform] ?? [])[0] ?? {} };
}

/** Update specific fields on an existing subform row via PUT */
async function patchSubformRow(quoteId, rowId, updates) {
  const body = { data: [{ id: quoteId,
    [CONFIG.subform]: [{ id: rowId, ...updates }] }] };
  const r = await fetch(`${CONFIG.baseUrl}/Quotes`, {
    method: 'PUT', headers: apiH(), body: JSON.stringify(body) });
  return await r.json();
}

async function deleteQuote(id) {
  await fetch(`${CONFIG.baseUrl}/Quotes?ids=${id}`, { method: 'DELETE', headers: apiH() });
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION POLLING
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Poll the quote record until the DAP API has written COGS and MUF,
 * or CONFIG.integrationWaitMs is exceeded.
 * Returns the populated subform row.
 */
async function pollUntilIntegrated(quoteId) {
  const deadline = Date.now() + CONFIG.integrationWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    await sleep(CONFIG.integrationPollMs);
    const { httpStatus, subformRow } = await getQuote(quoteId);
    if (httpStatus !== 200) throw new Error(`Poll GET HTTP ${httpStatus}`);
    const pending = CONFIG.integrationSignalFields.filter(
      f => subformRow[f] == null || subformRow[f] === 0);
    const elapsed = ((Date.now() - deadline + CONFIG.integrationWaitMs) / 1000).toFixed(1);
    if (pending.length === 0) {
      log.poll(`Attempt ${attempt} (${elapsed}s) — ${C.green}Integration complete!${C.reset}`);
      return subformRow;
    }
    log.poll(`Attempt ${attempt} (${elapsed}s) — Waiting for: ${pending.join(', ')}`);
  }
  throw new Error(
    `Integration timeout after ${CONFIG.integrationWaitMs/1000}s. ` +
    `[${CONFIG.integrationSignalFields.join(',')}] still null. ` +
    `Check: (1) Kode_Bom valid? (2) DAP API reachable? (3) Zoho workflow active?`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC EXPECTED (mirrors confirmed Zoho formulas)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Given actual COGS (from integration) + the inputs we posted,
 * compute what Zoho's formula fields SHOULD equal.
 *
 * This validates formula correctness without knowing COGS in advance.
 * We do NOT assert COGS itself — that's a separate integration test.
 *
 * Formula source (confirmed from Zoho API):
 *   Price            = COGS / 0.65
 *   Price_Quote      = Corp.Price if filled, else Price
 *   Final_Price      = Price_Quote × (1-D1%) × (1-D2%) × (1-D3%)
 *   Total_COGS       = (COGS × Qty) + (Shipping_per_Product × Qty)
 *   Total_Price      = Final_Price × Qty
 *   Total_Net_Income = Total_Price - Total_COGS
 *   GPR              = if Total_Price≠0 → Net/Total×100, else 0
 */
function computeDynamicExpected(actualRow, input, overrides = {}) {
  const merged    = { ...input, ...overrides };
  const cogs      = Number(actualRow.COGS)                      || 0;
  const corpPrice = merged.Corporate_Price != null               ? Number(merged.Corporate_Price) : null;
  const d1        = merged.Discount_1 != null                    ? Number(merged.Discount_1) / 100 : 0;
  const d2        = merged.Discount_2 != null                    ? Number(merged.Discount_2) / 100 : 0;
  const d3        = merged.Discount_3 != null                    ? Number(merged.Discount_3) / 100 : 0;
  const qty       = Number(merged.Quantity)                      || 1;
  const ship      = Number(merged.Shipping_Cost_per_Product)     || 0;

  const price      = round2(cogs / 0.65);
  const priceQuote = corpPrice !== null ? corpPrice : price;
  const finalPrice = round2(priceQuote * (1 - d1) * (1 - d2) * (1 - d3));
  const totalCOGS  = round2((cogs * qty) + (ship * qty));
  const totalPrice = round2(finalPrice * qty);
  const netIncome  = round2(totalPrice - totalCOGS);
  const gpr        = totalPrice !== 0 ? round2((netIncome / totalPrice) * 100) : 0;

  return { Price: price, Price_Quote: priceQuote, Final_Price: finalPrice,
           Total_COGS: totalCOGS, Total_Price: totalPrice,
           Total_Net_Income: netIncome, GPR: gpr };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIOS  TC-F-01 → TC-F-10
// ─────────────────────────────────────────────────────────────────────────────
/**
 * mode: 'integration'  — uses REAL_BOM, polls DAP API, dynamic expected
 * mode: 'direct'       — injects COGS directly (edge cases only), hardcoded expected
 * twoStep: true        — TC-F-09 only: POST without Corp.Price → poll → PATCH → re-fetch
 */
const SCENARIOS = [

  // ── INTEGRATION MODE ──────────────────────────────────────────────────────
  // All use Kode_Bom = REAL_BOM. COGS comes from DAP API. Expected = dynamic.

  {
    id: 'TC-F-01', mode: 'integration',
    name: 'Price = COGS/0.65 via integrasi DAP (formula dasar)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 10 },
    input: { Quoted_Item: [
        { Kode_Bom: REAL_BOM, Product_Name: 'Test Product', Quantity: 10, Shipping_Cost_per_Product: 5000 }
    ], Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 10 },
    notes: 'Verifikasi Price = actual_COGS/0.65. COGS dari DAP API, bukan injeksi manual.',
  },

  {
    id: 'TC-F-05', mode: 'integration',
    name: 'Price Quote – Corp.Price kosong → Price_Quote = Price',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 1 },
    notes: 'Path default. Price_Quote harus identik dengan Price dari formula COGS/0.65.',
  },

  {
    id: 'TC-F-06', mode: 'integration',
    name: 'Price Quote – Corp.Price = 45.000 → override Price',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Corporate_Price: 45000, Quantity: 1 },
    notes: 'Price_Quote harus = 45.000 terlepas dari nilai COGS aktual.',
  },

  {
    id: 'TC-F-07', mode: 'integration',
    name: 'Price Quote – Corp.Price = 0 eksplisit',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Corporate_Price: 0, Quantity: 1 },
    notes: '⚠ IsEmpty(0)=FALSE → Corp.Price digunakan → Price_Quote=0. Intended untuk sample?',
  },

  {
    id: 'TC-F-08', mode: 'integration',
    name: 'Price Quote – Corp.Price = 1 (selalu di bawah COGS nyata → jual rugi)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Corporate_Price: 1, Quantity: 10 },
    notes: 'Corp.Price=1 selalu << COGS nyata. GPR% harus sangat negatif. Catat apakah ada warning.',
  },

  {
    id: 'TC-F-09', mode: 'integration', twoStep: true,
    name: 'Price Quote – Corp.Price = Price (identik, no effect)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 1 },
    notes: (
      'Two-step: (1) POST tanpa Corp.Price → poll → baca actual Price = COGS/0.65. ' +
      '(2) PATCH Corp.Price = actual Price → re-fetch → assert Price_Quote = Price.'
    ),
  },

  {
    id: 'TC-F-10', mode: 'integration',
    name: 'Final Price – 3 diskon cascade, Corp.Price = 45.000',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Corporate_Price: 45000,
             Discount_1: 2.5, Discount_2: 2, Discount_3: 2,
             Quantity: 100 },
    notes: (
      'Final Price harus 42.137,55 = 45.000×0,975×0,98×0,98 (cascade, bukan sum). ' +
      'Nilai ini deterministik terlepas dari COGS aktual.'
    ),
  },

  // ── DIRECT MODE ───────────────────────────────────────────────────────────
  // COGS injected directly. Kode_Bom excluded so integration does NOT fire.
  // Only for edge cases where we need to control the exact COGS value.

  {
    id: 'TC-F-02', mode: 'direct',
    name: 'Price – COGS = 0 (produk gratis, edge case)',
    input: { COGS: 0, Quantity: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
    expected: { Price: 0, Price_Quote: 0, Final_Price: 0, Total_Price: 0, Total_COGS: 0 },
    notes: 'COGS=0 tidak bisa datang dari integrasi → direct. 0/0.65 = 0, tidak ada error.',
  },

  {
    id: 'TC-F-03', mode: 'direct', expectError: true,
    name: 'Price – COGS negatif (validasi input)',
    input: { COGS: -5000, Quantity: 1, Tahun_Bulan_yyyy_mm: REAL_DATE },
    expected: {},
    notes: 'Zoho harus menolak currency negatif. Jika diterima → catat sebagai BUG.',
  },

  {
    id: 'TC-F-04', mode: 'direct',
    name: 'Price – COGS sangat besar (batas field 16 digit)',
    input: { COGS: 99999999, Quantity: 1, Tahun_Bulan_yyyy_mm: REAL_DATE },
    expected: { Price: round2(99999999 / 0.65) },  // 153846152.31
    notes: 'Nilai ~153 juta. Verifikasi tidak overflow field 16 digit.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY
// ─────────────────────────────────────────────────────────────────────────────
function verify(row, expectedMap) {
  const assertions = Object.entries(expectedMap).map(([field, expVal]) => {
    const actual = row[field] ?? null;
    return { field, expected: expVal, actual, pass: approxEq(actual, expVal) };
  });
  return { assertions, allPassed: assertions.every(a => a.pass) };
}

function printAssertions(assertions) {
  for (const a of assertions) {
    const line =
      `${a.field.padEnd(24)} expected: ${fmt(a.expected).padStart(16)}  actual: ${fmt(a.actual).padStart(16)}`;
    a.pass ? log.pass(line) : log.fail(line);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO RUNNER
// ─────────────────────────────────────────────────────────────────────────────
async function runScenario(scenario) {
  const subject = `${scenario.id} - ${scenario.name} - UAT`;
  log.head(`[${scenario.id}] ${scenario.name}`);
  log.info(`Mode: ${scenario.mode}${scenario.twoStep ? ' (two-step)' : ''}`);
  log.info(`Subject: "${subject}"`);
  log.sep();

  const result = {
    id: scenario.id, name: scenario.name, mode: scenario.mode,
    subject, status: 'PENDING', quoteId: null,
    actualCOGS: null, assertions: [], apiCode: null, error: null, notes: scenario.notes,
  };

  try {
    // ── Build payload ─────────────────────────────────────────────────────
    const payload = { ...scenario.input };

    if (scenario.mode === 'direct') {
    //   delete payload.Kode_Bom;  // no integration
      log.info('Kode_Bom removed from payload → integration will NOT fire.');
    } else {
      delete payload.COGS;       // integration will write COGS
      if (scenario.twoStep) delete payload.Corporate_Price;  // set after polling
      log.info(`Kode_Bom: "${payload.Kode_Bom}" → DAP integration will be triggered.`);
      log.info('COGS not in payload — DAP API will write it back.');
    }

    // ── Step 1: Create Quote ─────────────────────────────────────────────
    log.info('Step 1: Creating Quote...');
    const created = await createQuote(subject, payload);
    result.apiCode = created.apiCode;

    // expectError path
    if (scenario.expectError) {
      if (created.apiCode !== 'SUCCESS') {
        log.pass(`API correctly rejected. Code: ${created.apiCode} | ${created.message}`);
        result.status = 'PASS';
      } else {
        log.fail(`Should have rejected but created ID: ${created.id}`);
        result.status = 'FAIL'; result.error = 'Expected rejection — record created';
        result.quoteId = created.id;
        if (created.id) await deleteQuote(created.id);
      }
      return result;
    }

    if (created.apiCode !== 'SUCCESS' || !created.id) {
      log.fail(`Create failed. Code: ${created.apiCode} | ${created.message}`);
      log.fail(`Raw: ${JSON.stringify(created.raw)}`);
      result.status = 'ERROR'; result.error = `${created.apiCode} – ${created.message}`;
      return result;
    }

    result.quoteId = created.id;
    log.info(`Quote created. ID: ${created.id}`);

    // ── Step 2: Wait for COGS ─────────────────────────────────────────────
    let row;
    if (scenario.mode === 'integration') {
      log.info(`Step 2: Polling DAP integration (max ${CONFIG.integrationWaitMs/1000}s, every ${CONFIG.integrationPollMs/1000}s)...`);
      row = await pollUntilIntegrated(created.id);

      result.actualCOGS = row.COGS;
      log.info('Fields written by DAP integration:');
      ['COGS', 'MUF', 'KODE_KAIN'].forEach(f =>
        log.info(`  ${f.padEnd(12)} = ${row[f] ?? 'null'}`));

    } else {
      log.info(`Step 2: Waiting ${CONFIG.formulaWaitMs}ms for Zoho formula calc...`);
      await sleep(CONFIG.formulaWaitMs);
      const fetched = await getQuote(created.id);
      if (fetched.httpStatus !== 200) {
        result.status = 'ERROR'; result.error = `GET HTTP ${fetched.httpStatus}`; return result;
      }
      row = fetched.subformRow;
    }

    // ── Step 3 (two-step only): PATCH Corp.Price = actual Price ───────────
    let inputOverrides = {};
    if (scenario.twoStep) {
      const actualPrice = round2(Number(row.COGS) / 0.65);
      const rowId = row.id;

      if (!rowId) {
        result.status = 'ERROR'; result.error = 'Subform row id missing — cannot PATCH';
        return result;
      }

      log.info(`Step 3 (two-step): PATCHing Corporate_Price = ${fmt(actualPrice)} (= actual Price)...`);
      await patchSubformRow(created.id, rowId, { Corporate_Price: actualPrice });
      await sleep(CONFIG.formulaWaitMs);

      const refetched = await getQuote(created.id);
      if (refetched.httpStatus !== 200) {
        result.status = 'ERROR'; result.error = `Re-fetch HTTP ${refetched.httpStatus}`; return result;
      }
      row = refetched.subformRow;
      inputOverrides = { Corporate_Price: actualPrice };
      log.info(`Corp.Price patched to ${fmt(actualPrice)}. Re-fetched row.`);
    }

    log.info(`Subform fields available: ${Object.keys(row).join(', ')}`);

    // ── Step 4: Compute expected ──────────────────────────────────────────
    let expectedMap;
    if (scenario.mode === 'integration') {
      expectedMap = computeDynamicExpected(row, scenario.input, inputOverrides);
      log.info(`Expected values computed from actual COGS = ${fmt(row.COGS)}:`);
      Object.entries(expectedMap).forEach(([k, v]) =>
        log.info(`  ${k.padEnd(22)} → ${fmt(v)}`));
    } else {
      expectedMap = scenario.expected;
    }

    // ── Step 5: Assert ────────────────────────────────────────────────────
    log.info('Asserting formula fields...');
    const { assertions, allPassed } = verify(row, expectedMap);
    result.assertions = assertions;
    printAssertions(assertions);

    result.status = allPassed ? 'PASS' : 'FAIL';
    if (scenario.notes) log.warn(`Note: ${scenario.notes}`);

  } catch (err) {
    log.fail(`Exception: ${err.message}`);
    result.status = 'ERROR'; result.error = err.message;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(72));
  console.log(`${C.bold}  DAP UAT – Formula Test Runner  |  TC-F-01 → TC-F-10${C.reset}`);
  console.log(`  CLI mode: ${C.cyan}${CLI_MODE}${C.reset}  |  BOM: ${REAL_BOM}  |  Period: ${REAL_DATE}`);
  console.log('═'.repeat(72));

  CONFIG.token             = await getAccessToken();
  CONFIG.placeholderProduct = await discoverPlaceholder();
  console.log(`  Token: ${CONFIG.token.slice(0,12)}...  |  Subform: ${CONFIG.subform}`);
  console.log(`  Integration wait: ${CONFIG.integrationWaitMs/1000}s  |  Formula wait: ${CONFIG.formulaWaitMs/1000}s`);
  console.log('═'.repeat(72));

  const toRun = SCENARIOS.filter(s => {
    if (CLI_MODE === 'all')    return true;
    if (CLI_MODE === 'direct') return s.mode === 'direct';
    return s.mode === 'integration'; // default
  });

  if (!toRun.length) {
    console.log(`\n  No scenarios match mode "${CLI_MODE}"\n`); return;
  }
  log.info(`Running ${toRun.length} scenario(s)  [mode: ${CLI_MODE}]\n`);

  const results = [];
  let passed = 0, failed = 0, errors = 0;

  for (const scenario of toRun) {
    const result = await runScenario(scenario);
    results.push(result);
    if (result.status === 'PASS')      passed++;
    else if (result.status === 'FAIL') failed++;
    else                               errors++;
    await sleep(CONFIG.delayMs);
  }

  // Summary
  console.log('\n' + '═'.repeat(72));
  console.log(`${C.bold}  HASIL UAT${C.reset}`);
  console.log('═'.repeat(72));
  for (const r of results) {
    const icon = r.status==='PASS' ? `${C.green}LULUS${C.reset}` :
                 r.status==='FAIL' ? `${C.red}GAGAL${C.reset}` : `${C.yellow}ERROR${C.reset}`;
    const tag  = r.mode==='integration' ? `${C.blue}[INT]${C.reset} ` : `${C.grey}[DIR]${C.reset} `;
    const cogs = r.actualCOGS != null ? ` COGS=${fmt(r.actualCOGS)}` : '';
    const qid  = r.quoteId ? ` [ID: ${r.quoteId}]` : '';
    console.log(`  ${icon}  ${tag}${r.id.padEnd(10)} ${r.name.padEnd(42)}${C.grey}${cogs}${qid}${C.reset}`);
  }
  console.log('\n' + '─'.repeat(72));
  console.log(
    `  Total: ${toRun.length}  |  ${C.green}Lulus: ${passed}${C.reset}  |  ` +
    `${C.red}Gagal: ${failed}${C.reset}  |  ${C.yellow}Error: ${errors}${C.reset}`);
  console.log('─'.repeat(72) + '\n');

  await fs.writeFile(CONFIG.logFile, JSON.stringify({
    runAt: new Date().toISOString(), cliMode: CLI_MODE,
    bom: REAL_BOM, period: REAL_DATE,
    summary: { total: toRun.length, passed, failed, errors }, results,
  }, null, 2));
  console.log(`  Log: ${CONFIG.logFile}\n`);
  process.exit(failed > 0 || errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n${C.red}Fatal: ${err.message}${C.reset}`);
  console.error(err.stack); process.exit(1);
});