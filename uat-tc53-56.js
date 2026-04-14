#!/usr/bin/env node
/**
 * DAP UAT Formula – TC-F-53 to TC-F-56
 * Multi-row subform aggregate tests.
 *
 * WHY DIRECT MODE:
 *   Multi-row integration would require each row to have its own Kode_Bom
 *   and the DAP API to respond for ALL rows before assertions can run.
 *   That's complex polling logic with unclear success criteria.
 *   Instead we use direct mode (inject COGS, no Kode_Bom) so we have exact
 *   control over COGS per row — making aggregate math deterministic.
 *   What's being tested here is: does Zoho's SUM aggregate work correctly
 *   across rows? Not whether the integration fired correctly.
 *
 * AGGREGATE FIELDS ASSERTED (quote-level SUM):
 *   Sub_Total — SUM of Total_Price across all subform rows
 *   (Total Qty and Total COGS aggregates depend on custom field setup;
 *    script reads them from quoteFields and logs for manual verification)
 *
 * Usage:
 *   node DAP_UAT_TC53_TC56.js
 */
'use strict';

const fs   = require('fs/promises');
const path = require('path');
require('dotenv').config();

const REAL_DATE = '2026-04';

const CONFIG = {
  token: null, baseUrl: 'https://www.zohoapis.com/crm/v3',
  subform: 'Quoted_Items', delayMs: 1500, formulaWaitMs: 5000,
  tolerance: 0.02, logFile: './uat_results_TC53_TC56.json', placeholderProduct: null,
};

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const round2 = n  => Math.round(n * 100) / 100;
const approxEq = (a, e, tol = CONFIG.tolerance) => {
  if (e === null || e === undefined) return a === null || a === undefined;
  return Math.abs(Number(a) - Number(e)) <= tol;
};
const fmt = n => n == null ? 'null'
  : Number(n).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m', red:'\x1b[31m',
  yellow:'\x1b[33m', cyan:'\x1b[36m', grey:'\x1b[90m', blue:'\x1b[34m',
};
const log = {
  pass: m => console.log(`  ${C.green}✓ LULUS${C.reset}  ${m}`),
  fail: m => console.log(`  ${C.red}✗ GAGAL${C.reset}  ${m}`),
  warn: m => console.log(`  ${C.yellow}⚠ WARN ${C.reset}  ${m}`),
  info: m => console.log(`  ${C.grey}ℹ${C.reset}       ${m}`),
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
  const updated = { ...creds, access_token: data.access_token,
    expiry_time: Date.now() + data.expires_in * 1000,
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

const makeRow = (customFields) => ({
  Product_Name: { id: CONFIG.placeholderProduct.id, name: CONFIG.placeholderProduct.name },
  Quantity: 1, Unit_Price: 0, Total: 0,
  ...customFields,
});

/**
 * Create a Quote with MULTIPLE subform rows.
 * rowsData: array of custom field objects — each becomes one subform row.
 */
async function createMultiRowQuote(subject, rowsData, quoteFields = {}) {
  const rows = rowsData.map(r => makeRow(r));
  const body = { data: [{
    Subject: subject, Quote_Stage: 'Draft',
    ...quoteFields,
    [CONFIG.subform]: rows,
  }]};
  const j = await (await fetch(`${CONFIG.baseUrl}/Quotes`, { method: 'POST', headers: apiH(), body: JSON.stringify(body) })).json();
  const item = j?.data?.[0] ?? {};
  return { id: item?.details?.id ?? null, apiCode: item?.code ?? 'UNKNOWN', message: item?.message ?? '', raw: item };
}

async function getQuote(id) {
  const r   = await fetch(`${CONFIG.baseUrl}/Quotes/${id}`, { headers: apiH() });
  const d   = (await r.json())?.data?.[0] ?? {};
  return {
    httpStatus:  r.status,
    subformRows: d[CONFIG.subform] ?? [],
    quoteFields: d,
  };
}

async function deleteQuote(id) {
  await fetch(`${CONFIG.baseUrl}/Quotes?ids=${id}`, { method: 'DELETE', headers: apiH() });
}

// ── EXPECTED COMPUTATION ──────────────────────────────────────────────────────
/**
 * Compute expected aggregate values from injected row data.
 * Since we're in direct mode, COGS is known and deterministic.
 * Kode_Bom is excluded → integration does NOT fire.
 *
 * @param {Array} rows - array of {COGS, Quantity, Discount_1, Corporate_Price, Shipping_Cost_per_Product, ...}
 */
function computeMultiRowExpected(rows) {
  let totalPrice    = 0;
  let totalCOGS     = 0;
  let totalQty      = 0;
  const rowDetails  = [];

  for (const row of rows) {
    const cogs      = Number(row.COGS) || 0;
    const corpPrice = row.Corporate_Price != null ? Number(row.Corporate_Price) : null;
    const d1        = row.Discount_1 != null ? Number(row.Discount_1) / 100 : 0;
    const d2        = row.Discount_2 != null ? Number(row.Discount_2) / 100 : 0;
    const d3        = row.Discount_3 != null ? Number(row.Discount_3) / 100 : 0;
    const qty       = Number(row.Quantity) || 0;
    const ship      = Number(row.Shipping_Cost_per_Product) || 0;

    const price      = round2(cogs / 0.65);
    const priceQuote = corpPrice !== null ? corpPrice : price;
    const finalPrice = round2(priceQuote * (1 - d1) * (1 - d2) * (1 - d3));
    const rowTotalCOGS  = round2((cogs * qty) + (ship * qty));
    const rowTotalPrice = round2(finalPrice * qty);

    totalPrice += rowTotalPrice;
    totalCOGS  += rowTotalCOGS;
    totalQty   += qty;
    rowDetails.push({ cogs, price, priceQuote, finalPrice, qty, rowTotalPrice, rowTotalCOGS });
  }

  return {
    Sub_Total:  round2(totalPrice),
    _totalCOGS: round2(totalCOGS),
    _totalQty:  totalQty,
    _rows:      rowDetails,
  };
}

// ── SCENARIOS ─────────────────────────────────────────────────────────────────
// All multi-row scenarios use direct mode (COGS injected, no Kode_Bom).
// We test Zoho's SUM aggregate, not the integration.

const SCENARIOS = [
  {
    id: 'TC-F-53', name: 'Multi-baris: SUM Total Price dari 3 baris berbeda',
    rows: [
      { COGS: 15435, Quantity: 100, Tahun_Bulan_yyyy_mm: REAL_DATE },   // no discount
      { COGS: 22686, Quantity: 150, Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 50000, Quantity: 50,  Corporate_Price: 90000, Tahun_Bulan_yyyy_mm: REAL_DATE },
    ],
    assertAgg: ['Sub_Total'],
    notes: 'SUM harus sama dengan manual sum dari 3 Total_Price baris. ' +
           'Real-time update: tambah/ubah/hapus baris harus langsung memperbarui SUM.',
  },
  {
    id: 'TC-F-54', name: 'Multi-baris: 1 harga sangat tinggi + 1 sangat rendah',
    rows: [
      { COGS: 500000, Quantity: 1, Tahun_Bulan_yyyy_mm: REAL_DATE },    // mahal
      { COGS: 1000,   Quantity: 1, Tahun_Bulan_yyyy_mm: REAL_DATE },    // murah
    ],
    assertAgg: ['Sub_Total'],
    notes: 'INSIGHT: Price = COGS/0.65 → GPR selalu 35% per baris terlepas dari COGS. ' +
           'Verifikasi SUM tidak ada floating-point error dengan nilai yang jauh berbeda.',
  },
  {
    id: 'TC-F-55', name: 'Multi-baris: Qty = 0 di salah satu baris (tidak kontribusi)',
    rows: [
      { COGS: 15435, Quantity: 100, Tahun_Bulan_yyyy_mm: REAL_DATE },   // normal
      { COGS: 22686, Quantity: 0,   Tahun_Bulan_yyyy_mm: REAL_DATE },   // qty nol
    ],
    assertAgg: ['Sub_Total'],
    notes: 'Baris dengan Qty=0 → Total_Price=0 → tidak berkontribusi ke SUM. ' +
           'Tidak ada error formula dari baris nol.',
  },
  {
    id: 'TC-F-56', name: 'Multi-baris: diskon berbeda-beda per baris (independent)',
    rows: [
      { COGS: 15435, Quantity: 100, Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 22686, Quantity: 150, Discount_1: 5, Discount_2: 2, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 50000, Quantity: 50,  Tahun_Bulan_yyyy_mm: REAL_DATE },   // no discount
    ],
    assertAgg: ['Sub_Total'],
    notes: 'Diskon diterapkan INDEPENDEN per baris. ' +
           'Diskon baris 1 tidak mempengaruhi baris 2/3. SUM = sum individual Total_Price.',
  },
];

// ── SCENARIO RUNNER ───────────────────────────────────────────────────────────
async function runScenario(scenario) {
  const subject = `${scenario.id} - ${scenario.name} - UAT`;
  log.head(`[${scenario.id}] ${scenario.name}`);
  log.info(`Mode: direct (${scenario.rows.length} baris)`);
  log.sep();

  const result = {
    id: scenario.id, name: scenario.name, mode: 'direct',
    subject, status: 'PENDING', quoteId: null,
    assertions: [], apiCode: null, error: null, notes: scenario.notes,
  };

  try {
    // Strip Kode_Bom from each row — direct mode, no integration
    const cleanRows = scenario.rows.map(r => {
      const row = { ...r }; delete row.Kode_Bom; return row;
    });

    log.info('Step 1: Creating multi-row Quote...');
    for (let i = 0; i < cleanRows.length; i++) {
      log.info(`  Row ${i+1}: COGS=${fmt(cleanRows[i].COGS)} Qty=${cleanRows[i].Quantity}` +
               (cleanRows[i].Discount_1 ? ` D1=${cleanRows[i].Discount_1}%` : '') +
               (cleanRows[i].Corporate_Price ? ` Corp.Price=${fmt(cleanRows[i].Corporate_Price)}` : ''));
    }

    const created = await createMultiRowQuote(subject, cleanRows);
    result.apiCode = created.apiCode;

    if (created.apiCode !== 'SUCCESS' || !created.id) {
      log.fail(`Create failed. Code: ${created.apiCode} | ${created.message}`);
      log.fail(`Raw: ${JSON.stringify(created.raw)}`);
      result.status = 'ERROR'; result.error = `${created.apiCode} – ${created.message}`;
      return result;
    }
    result.quoteId = created.id;
    log.info(`Quote created. ID: ${created.id}  (${scenario.rows.length} subform rows)`);

    log.info(`Step 2: Waiting ${CONFIG.formulaWaitMs}ms for Zoho formula + aggregate calc...`);
    await sleep(CONFIG.formulaWaitMs);

    const { httpStatus, subformRows, quoteFields } = await getQuote(created.id);
    if (httpStatus !== 200) {
      result.status = 'ERROR'; result.error = `GET HTTP ${httpStatus}`; return result;
    }

    log.info(`Subform rows returned: ${subformRows.length}`);
    subformRows.forEach((row, i) => {
      log.info(`  Row ${i+1}: Price=${fmt(row.Price)} FinalPrice=${fmt(row.Final_Price)} ` +
               `TotalPrice=${fmt(row.Total_Price)} TotalCOGS=${fmt(row.Total_COGS)}`);
    });

    // Read aggregate from quote-level
    const subTotal = Number(quoteFields.Sub_Total) || 0;
    log.info(`Aggregate Sub_Total (from quoteFields): ${fmt(subTotal)}`);

    // Log other aggregates if they exist
    ['Total_Qty_2', 'Total_COGS_2'].forEach(f => {
      if (quoteFields[f] != null) log.info(`  ${f}: ${fmt(quoteFields[f])}`);
    });

    // Compute expected from injected COGS values
    const expected = computeMultiRowExpected(cleanRows);
    log.info(`Expected Sub_Total (computed): ${fmt(expected.Sub_Total)}`);

    // Cross-check: SUM of returned Total_Price values should match expected
    const actualSumFromRows = round2(subformRows.reduce((acc, r) => acc + (Number(r.Total_Price) || 0), 0));
    log.info(`Sum of row Total_Price (from subformRows): ${fmt(actualSumFromRows)}`);

    // Primary assertion: quoteFields.Sub_Total = expected
    const assertions = [];
    const subTotalMatch = approxEq(subTotal, expected.Sub_Total);
    assertions.push({ field: 'Sub_Total (quote aggregate)', expected: expected.Sub_Total, actual: subTotal, pass: subTotalMatch });
    subTotalMatch ? log.pass(`Sub_Total aggregate: expected=${fmt(expected.Sub_Total)} actual=${fmt(subTotal)}`)
                  : log.fail(`Sub_Total aggregate: expected=${fmt(expected.Sub_Total)} actual=${fmt(subTotal)}`);

    // Secondary assertion: aggregate matches manual sum of rows
    const rowSumMatch = approxEq(subTotal, actualSumFromRows);
    assertions.push({ field: 'Sub_Total == SUM(row.Total_Price)', expected: actualSumFromRows, actual: subTotal, pass: rowSumMatch });
    rowSumMatch ? log.pass(`Sub_Total == Σ row.Total_Price: ${fmt(actualSumFromRows)}`)
                : log.fail(`Sub_Total ≠ Σ row.Total_Price: expected=${fmt(actualSumFromRows)} actual=${fmt(subTotal)}`);

    result.assertions = assertions;
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
  console.log(`${C.bold}  DAP UAT – TC-F-53 → TC-F-56  (Multi-Row Aggregates)${C.reset}`);
  console.log(`  Mode: ${C.cyan}direct${C.reset} (COGS injected, no integration)  |  Period: ${REAL_DATE}`);
  console.log('═'.repeat(72));

  CONFIG.token             = await getAccessToken();
  CONFIG.placeholderProduct = await discoverPlaceholder();

  const results = [];
  let passed = 0, failed = 0, errors = 0;
  for (const s of SCENARIOS) {
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
    const qid  = r.quoteId ? ` [ID:${r.quoteId}]` : '';
    console.log(`  ${icon}  ${r.id.padEnd(10)} ${r.name.padEnd(50)}${C.grey}${qid}${C.reset}`);
  }
  console.log(`\n  Total:${SCENARIOS.length}  ${C.green}Lulus:${passed}${C.reset}  ${C.red}Gagal:${failed}${C.reset}  ${C.yellow}Error:${errors}${C.reset}\n`);

  await fs.writeFile(CONFIG.logFile, JSON.stringify({
    runAt: new Date().toISOString(), mode: 'direct', period: REAL_DATE,
    summary: { total: SCENARIOS.length, passed, failed, errors }, results,
  }, null, 2));
  console.log(`  Log: ${CONFIG.logFile}\n`);
  process.exit(failed > 0 || errors > 0 ? 1 : 0);
}
main().catch(err => { console.error(`\n${C.red}Fatal: ${err.message}${C.reset}`); process.exit(1); });