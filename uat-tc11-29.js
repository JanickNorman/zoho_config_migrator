#!/usr/bin/env node
/**
 * DAP UAT Formula – TC-F-11 to TC-F-29
 * Final Price variations (11-17) | Total COGS per Product (18-22) | Total Price / Net Income / GPR (23-29)
 * All assertions on subform row fields.
 *
 * Usage:
 *   node DAP_UAT_TC11_TC29.js              # integration (default)
 *   node DAP_UAT_TC11_TC29.js --mode=direct
 *   node DAP_UAT_TC11_TC29.js --mode=all
 */
'use strict';

const fs   = require('fs/promises');
const path = require('path');
require('dotenv').config();

const REAL_BOM  = 'PKS.FTD.200X200+35.148S-1';
const REAL_DATE = '2026-04';

const CONFIG = {
  token: null, baseUrl: 'https://www.zohoapis.com/crm/v3',
  subform: 'Quoted_Items', delayMs: 1500, formulaWaitMs: 3000,
  integrationWaitMs: 20000, integrationPollMs: 2500, tolerance: 0.02,
  logFile: './uat_results_TC11_TC29.json', placeholderProduct: null,
  integrationSignalFields: ['COGS', 'MUF'],
};

const CLI_MODE = (() => {
  const a = process.argv.find(x => x.startsWith('--mode='));
  return a ? a.split('=')[1] : 'integration';
})();

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const round2 = n  => Math.round(n * 100) / 100;
const approxEq = (a, e, tol = CONFIG.tolerance) => {
  if (e === null || e === undefined) return a === null || a === undefined;
  return Math.abs(Number(a) - Number(e)) <= tol;
};
const fmt = n => n == null ? 'null'
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

// ── AUTH ─────────────────────────────────────────────────────────────────────
async function getAccessToken() {
  let creds;
  try { creds = JSON.parse(await fs.readFile(path.join(process.cwd(), 'self_client.json'), 'utf8')); }
  catch { throw new Error('Cannot read self_client.json'); }
  if (creds.access_token && creds.expiry_time && Date.now() < creds.expiry_time - 60000) {
    log.info('Using cached token.'); return creds.access_token;
  }
  const params = new URLSearchParams({
    client_id: creds.client_id, client_secret: creds.client_secret,
    grant_type: creds.refresh_token ? 'refresh_token' : 'authorization_code',
    ...(creds.refresh_token ? { refresh_token: creds.refresh_token } : { code: creds.code }),
  });
  const data = await (await fetch('https://accounts.zoho.com/oauth/v2/token', { method: 'POST', body: params })).json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  const updated = { ...creds, access_token: data.access_token, expiry_time: Date.now() + data.expires_in * 1000,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}) };
  await fs.writeFile(path.join(process.cwd(), 'self_client.json'), JSON.stringify(updated, null, 2));
  log.info('New token saved.'); return data.access_token;
}

// ── API ───────────────────────────────────────────────────────────────────────
const apiH = () => ({ 'Authorization': `Zoho-oauthtoken ${CONFIG.token}`, 'Content-Type': 'application/json' });

async function discoverPlaceholder() {
  const j = await (await fetch(`${CONFIG.baseUrl}/Products?fields=id,Product_Name&per_page=1`, { headers: apiH() })).json();
  const p = j?.data?.[0];
  if (!p?.id) throw new Error('No active product found.');
  log.info(`Placeholder: "${p.Product_Name}" (${p.id})`); return { id: p.id, name: p.Product_Name };
}

const placeholderRow = () => ({
  Product_Name: { id: CONFIG.placeholderProduct.id, name: CONFIG.placeholderProduct.name },
  Quantity: 1, Unit_Price: 0, Total: 0,
});

async function createQuote(subject, customRow) {
  const body = { data: [{ Subject: subject, Quote_Stage: 'Draft',
    [CONFIG.subform]: [{ ...placeholderRow(), ...customRow }] }] };
  const j = await (await fetch(`${CONFIG.baseUrl}/Quotes`, { method: 'POST', headers: apiH(), body: JSON.stringify(body) })).json();
  const item = j?.data?.[0] ?? {};
  return { id: item?.details?.id ?? null, apiCode: item?.code ?? 'UNKNOWN', message: item?.message ?? '', raw: item };
}

async function getQuote(id) {
  const r = await fetch(`${CONFIG.baseUrl}/Quotes/${id}`, { headers: apiH() });
  const d = (await r.json())?.data?.[0] ?? {};
  return { httpStatus: r.status, subformRow: (d[CONFIG.subform] ?? [])[0] ?? {} };
}

async function deleteQuote(id) {
  await fetch(`${CONFIG.baseUrl}/Quotes?ids=${id}`, { method: 'DELETE', headers: apiH() });
}

// ── POLL ──────────────────────────────────────────────────────────────────────
async function pollUntilIntegrated(quoteId) {
  const deadline = Date.now() + CONFIG.integrationWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++; await sleep(CONFIG.integrationPollMs);
    const { httpStatus, subformRow } = await getQuote(quoteId);
    if (httpStatus !== 200) throw new Error(`Poll GET HTTP ${httpStatus}`);
    const pending = CONFIG.integrationSignalFields.filter(f => subformRow[f] == null || subformRow[f] === 0);
    const elapsed = ((Date.now() - deadline + CONFIG.integrationWaitMs) / 1000).toFixed(1);
    if (!pending.length) {
      log.poll(`Attempt ${attempt} (${elapsed}s) — ${C.green}Integration complete!${C.reset}`);
      return subformRow;
    }
    log.poll(`Attempt ${attempt} (${elapsed}s) — Waiting: ${pending.join(', ')}`);
  }
  throw new Error(`Integration timeout after ${CONFIG.integrationWaitMs/1000}s.`);
}

// ── DYNAMIC EXPECTED ──────────────────────────────────────────────────────────
function computeDynamicExpected(actualRow, input, overrides = {}) {
  const merged    = { ...input, ...overrides };
  const cogs      = Number(actualRow.COGS)                   || 0;
  const corpPrice = merged.Corporate_Price != null            ? Number(merged.Corporate_Price) : null;
  const d1        = merged.Discount_1 != null                 ? Number(merged.Discount_1) / 100 : 0;
  const d2        = merged.Discount_2 != null                 ? Number(merged.Discount_2) / 100 : 0;
  const d3        = merged.Discount_3 != null                 ? Number(merged.Discount_3) / 100 : 0;
  const qty       = Number(merged.Quantity)                   || 1;
  const ship      = Number(merged.Shipping_Cost_per_Product)  || 0;
  const price      = round2(cogs / 0.65);
  const priceQuote = corpPrice !== null ? corpPrice : price;
  const finalPrice = round2(priceQuote * (1 - d1) * (1 - d2) * (1 - d3));
  const totalCOGS  = round2((cogs * qty) + (ship * qty));
  const totalPrice = round2(finalPrice * qty);
  const netIncome  = round2(totalPrice - totalCOGS);
  const gpr        = totalPrice !== 0 ? round2((netIncome / totalPrice) * 100) : 0;
  return { Price: price, Price_Quote: priceQuote, Final_Price: finalPrice,
           Total_COGS: totalCOGS, Total_Price: totalPrice, Total_Net_Income: netIncome, GPR: gpr };
}

// ── SCENARIOS ─────────────────────────────────────────────────────────────────
const SCENARIOS = [

  // ─── FINAL PRICE VARIATIONS (TC-F-11 to TC-F-17) ────────────────────────

  {
    id: 'TC-F-11', mode: 'integration',
    name: 'Final Price – hanya Disc 1 = 5 (Disc 2 & 3 kosong)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Discount_1: 5, Quantity: 10 },
    notes: 'Disc 2 & 3 null diperlakukan sebagai 0%. Final Price = Price × 0.95.',
  },

  {
    id: 'TC-F-12', mode: 'integration',
    name: 'Final Price – semua diskon kosong (no discount)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 10 },
    notes: 'Tanpa diskon → Final Price = Price = COGS/0.65. Tidak ada pengurangan.',
  },

  {
    id: 'TC-F-13', mode: 'integration',
    name: 'Final Price – Disc 1 = 100% (harga jadi 0)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Discount_1: 100, Quantity: 5 },
    notes: 'Final Price = Price × 0 = 0. Total Price = 0. GPR guard div/0 → GPR = 0.',
  },

  {
    id: 'TC-F-14', mode: 'integration',
    name: 'Final Price – Disc 1=50, Disc 2=50, Disc 3=50 (cascade mendekati nol)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Discount_1: 50, Discount_2: 50, Discount_3: 50, Quantity: 1 },
    notes: 'Cascade: Price×0.5×0.5×0.5 = Price×0.125. Tidak pernah negatif karena bertingkat.',
  },

  {
    id: 'TC-F-15', mode: 'integration',
    name: 'Final Price – Disc 1 = 2.5 (nilai desimal)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Discount_1: 2.5, Quantity: 1 },
    notes: 'Verifikasi sistem menerima nilai desimal. Separator: pastikan koma vs titik konsisten.',
  },

  {
    id: 'TC-F-16', mode: 'integration',
    name: 'Final Price – Corp.Price = 45.000 + Disc 1 = 5',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Corporate_Price: 45000, Discount_1: 5, Quantity: 50 },
    notes: 'Diskon dihitung dari Corp.Price (45.000), bukan dari Price (COGS/0.65). Final Price = 42.750.',
  },

  {
    id: 'TC-F-17', mode: 'direct', expectError: true,
    name: 'Final Price – Disc 1 negatif (validasi input)',
    input: { COGS: 15435, Discount_1: -5, Quantity: 1, Tahun_Bulan_yyyy_mm: REAL_DATE },
    expected: {},
    notes: 'Diskon negatif tidak valid. Jika Zoho menerima: Final Price naik (anomali) → BUG.',
  },

  // ─── TOTAL COGS PER PRODUCT (TC-F-18 to TC-F-22) ────────────────────────
  // Formula: (COGS × Qty) + (Shipping_Cost_per_Product × Qty)

  {
    id: 'TC-F-18', mode: 'integration',
    name: 'Total COGS – normal dengan Shipping per Product = 10.000',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Shipping_Cost_per_Product: 10000, Quantity: 100 },
    notes: 'Total COGS = (COGS×100) + (10.000×100). Shipping row-level masuk ke biaya.',
  },

  {
    id: 'TC-F-19', mode: 'integration',
    name: 'Total COGS – Shipping per Product = 0',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Shipping_Cost_per_Product: 0, Quantity: 100 },
    notes: 'Total COGS = COGS×100 (shipping tidak menambah biaya). Path paling umum.',
  },

  {
    id: 'TC-F-20', mode: 'integration',
    name: 'Total COGS – Shipping per Product dikosongkan (null)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    notes: '⚠ Null harus diperlakukan sebagai 0. Total COGS = COGS×100. Tidak ada error formula.',
  },

  {
    id: 'TC-F-21', mode: 'integration',
    name: 'Total COGS – Qty = 1 (unit tunggal)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Shipping_Cost_per_Product: 15000, Quantity: 1 },
    notes: 'Total COGS = COGS + 15.000. Verifikasi tidak ada pembulatan ganda.',
  },

  {
    id: 'TC-F-22', mode: 'integration',
    name: 'Total COGS – Qty = 1000 (order besar)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Shipping_Cost_per_Product: 5000, Quantity: 1000 },
    notes: 'Uji batas untuk order hotel besar. Total COGS = (COGS×1000) + (5.000×1000).',
  },

  // ─── TOTAL PRICE / NET INCOME / GPR (TC-F-23 to TC-F-29) ────────────────

  {
    id: 'TC-F-23', mode: 'integration',
    name: 'Total Price = Final Price × Qty (verifikasi presisi)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Discount_1: 2.5, Discount_2: 2, Quantity: 100 },
    notes: 'Verifikasi tidak ada rounding error akumulatif di Total Price.',
  },

  {
    id: 'TC-F-24', mode: 'integration',
    name: 'Total Net Income – positif (margin normal)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50 },
    notes: 'Total Net Income = Total Price - Total COGS. Harus positif jika Price = COGS/0.65.',
  },

  {
    id: 'TC-F-25', mode: 'integration',
    name: 'Total Net Income – negatif (Corp.Price << COGS)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Corporate_Price: 1, Quantity: 10 },
    notes: '⚠ Corp.Price=1 << COGS nyata. Net Income = Total Price - Total COGS < 0. Catat warning.',
  },

  {
    id: 'TC-F-26', mode: 'integration',
    name: 'GPR(%) – tanpa diskon harusnya tepat 35%',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 10 },
    // GPR = (Price - COGS)/Price = (COGS/0.65 - COGS)/(COGS/0.65) = 0.35/1 = 35% selalu
    assertOverride: { GPR: 35 },
    notes: 'INSIGHT: Price=COGS/0.65 → margin selalu 35% sebelum diskon. GPR harus = 35.00%.',
  },

  {
    id: 'TC-F-27', mode: 'integration',
    name: 'GPR(%) – Disc 1=100% → Total Price=0 → div-by-zero guard',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Discount_1: 100, Quantity: 5 },
    assertOverride: { GPR: 0 },
    notes: 'Total Price=0 → formula: If(Total Price≠0,...,0). GPR harus = 0, bukan error.',
  },

  {
    id: 'TC-F-28', mode: 'integration',
    name: 'GPR(%) – tepat 35% (batas minimum TOB)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 1 },
    assertOverride: { GPR: 35 },
    notes: 'Sama dengan TC-F-26. GPR=35% = batas minimum. Sistem harus menerima tanpa warning.',
  },

  {
    id: 'TC-F-29', mode: 'integration',
    name: 'GPR(%) – di bawah 35% (Corp.Price menekan margin)',
    input: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE,
             Corporate_Price: 1, Discount_1: 5, Quantity: 10 },
    notes: '⚠ GPR harus negatif. KONFIRMASI: apakah sistem warn atau hard-block saat GPR<35%?',
  },
];

// ── VERIFY ────────────────────────────────────────────────────────────────────
function verify(row, expectedMap) {
  return Object.entries(expectedMap).map(([field, expVal]) => {
    const actual = row[field] ?? null;
    return { field, expected: expVal, actual, pass: approxEq(actual, expVal) };
  });
}

function printAssertions(assertions) {
  for (const a of assertions) {
    const line = `${a.field.padEnd(24)} expected: ${fmt(a.expected).padStart(16)}  actual: ${fmt(a.actual).padStart(16)}`;
    a.pass ? log.pass(line) : log.fail(line);
  }
}

// ── SCENARIO RUNNER ───────────────────────────────────────────────────────────
async function runScenario(scenario) {
  const subject = `${scenario.id} - ${scenario.name} - UAT`;
  log.head(`[${scenario.id}] ${scenario.name}`);
  log.info(`Mode: ${scenario.mode}`);
  log.info(`Subject: "${subject}"`);
  log.sep();

  const result = {
    id: scenario.id, name: scenario.name, mode: scenario.mode,
    subject, status: 'PENDING', quoteId: null,
    actualCOGS: null, assertions: [], apiCode: null, error: null, notes: scenario.notes,
  };

  try {
    const payload = { ...scenario.input };
    if (scenario.mode === 'direct') {
      delete payload.Kode_Bom;
      log.info('Direct mode: Kode_Bom removed, integration will NOT fire.');
    } else {
      delete payload.COGS;
      log.info(`Integration mode: Kode_Bom="${payload.Kode_Bom}"`);
    }

    log.info('Step 1: Creating Quote...');
    const created = await createQuote(subject, payload);
    result.apiCode = created.apiCode;

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

    let row;
    if (scenario.mode === 'integration') {
      log.info(`Step 2: Polling DAP integration (max ${CONFIG.integrationWaitMs/1000}s)...`);
      row = await pollUntilIntegrated(created.id);
      result.actualCOGS = row.COGS;
      ['COGS', 'MUF', 'KODE_KAIN'].forEach(f => log.info(`  ${f.padEnd(12)} = ${row[f] ?? 'null'}`));
    } else {
      log.info(`Step 2: Waiting ${CONFIG.formulaWaitMs}ms for formula calc...`);
      await sleep(CONFIG.formulaWaitMs);
      const fetched = await getQuote(created.id);
      if (fetched.httpStatus !== 200) {
        result.status = 'ERROR'; result.error = `GET HTTP ${fetched.httpStatus}`; return result;
      }
      row = fetched.subformRow;
    }

    log.info(`Fields: ${Object.keys(row).join(', ')}`);

    // Build expected: dynamic from COGS (integration) or hardcoded (direct)
    let expectedMap;
    if (scenario.mode === 'integration') {
      expectedMap = computeDynamicExpected(row, scenario.input);
      // Override specific fields if scenario specifies assertOverride
      if (scenario.assertOverride) Object.assign(expectedMap, scenario.assertOverride);
      log.info(`Expected from actual COGS=${fmt(row.COGS)}:`);
      Object.entries(expectedMap).forEach(([k, v]) => log.info(`  ${k.padEnd(22)} → ${fmt(v)}`));
    } else {
      expectedMap = scenario.expected;
    }

    log.info('Asserting...');
    const assertions = verify(row, expectedMap);
    result.assertions = assertions;
    printAssertions(assertions);
    result.status = assertions.every(a => a.pass) ? 'PASS' : 'FAIL';
    if (scenario.notes) log.warn(`Note: ${scenario.notes}`);

  } catch (err) {
    log.fail(`Exception: ${err.message}`);
    result.status = 'ERROR'; result.error = err.message;
  }
  return result;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(72));
  console.log(`${C.bold}  DAP UAT – TC-F-11 → TC-F-29  (Final Price / COGS / GPR)${C.reset}`);
  console.log(`  Mode: ${C.cyan}${CLI_MODE}${C.reset}  |  BOM: ${REAL_BOM}  |  Period: ${REAL_DATE}`);
  console.log('═'.repeat(72));

  CONFIG.token             = await getAccessToken();
  CONFIG.placeholderProduct = await discoverPlaceholder();

  const toRun = SCENARIOS.filter(s => {
    if (CLI_MODE === 'all')    return true;
    if (CLI_MODE === 'direct') return s.mode === 'direct';
    return s.mode === 'integration';
  });

  const results = [];
  let passed = 0, failed = 0, errors = 0;
  for (const s of toRun) {
    const r = await runScenario(s);
    results.push(r);
    if (r.status === 'PASS') passed++;
    else if (r.status === 'FAIL') failed++;
    else errors++;
    await sleep(CONFIG.delayMs);
  }

  console.log('\n' + '═'.repeat(72));
  console.log(`${C.bold}  HASIL UAT${C.reset}`);
  console.log('═'.repeat(72));
  for (const r of results) {
    const icon = r.status==='PASS' ? `${C.green}LULUS${C.reset}` :
                 r.status==='FAIL' ? `${C.red}GAGAL${C.reset}` : `${C.yellow}ERROR${C.reset}`;
    const tag  = r.mode==='integration' ? `${C.blue}[INT]${C.reset} ` : `${C.grey}[DIR]${C.reset} `;
    const cogs = r.actualCOGS != null ? ` COGS=${fmt(r.actualCOGS)}` : '';
    const qid  = r.quoteId ? ` [ID:${r.quoteId}]` : '';
    console.log(`  ${icon}  ${tag}${r.id.padEnd(10)} ${r.name.padEnd(44)}${C.grey}${cogs}${qid}${C.reset}`);
  }
  console.log(`\n  Total:${toRun.length}  ${C.green}Lulus:${passed}${C.reset}  ${C.red}Gagal:${failed}${C.reset}  ${C.yellow}Error:${errors}${C.reset}\n`);

  await fs.writeFile(CONFIG.logFile, JSON.stringify({
    runAt: new Date().toISOString(), cliMode: CLI_MODE, bom: REAL_BOM, period: REAL_DATE,
    summary: { total: toRun.length, passed, failed, errors }, results,
  }, null, 2));
  console.log(`  Log: ${CONFIG.logFile}\n`);
  process.exit(failed > 0 || errors > 0 ? 1 : 0);
}
main().catch(err => { console.error(`\n${C.red}Fatal: ${err.message}${C.reset}`); process.exit(1); });