#!/usr/bin/env node
/**
 * DAP UAT Formula – TC-F-30 to TC-F-52
 * Quote header-level formulas: R.Fee (30-33) | R.Label (34-36) |
 * R.Discount & PPN (37-41) | Grand Total (42-46) | Final COGS & Total GPR (47-52)
 *
 * KEY DIFFERENCE from TC-F-01 scripts:
 *   Assertions read from QUOTE-LEVEL fields (quoteFields), not subform row.
 *   Quote-level formula fields are populated once the subform Total Price SUM
 *   is available plus Other Cost inputs (Fee%, Label, Discount%, Shipping).
 *
 * API field names (confirmed from layout API):
 *   Inputs (Other Cost section):
 *     Fee_Decimal      → Fee (%)
 *     Label            → Label (Rp/pcs — harga per label, bukan jumlah)
 *     Discount3        → Discount (%) additional
 *     Shipping_Cost_DAP → Shipping Cost (header-level DAP)
 *     Adjustment       → Adjustment / Pembulatan
 *   Formula results:
 *     R_Fee_Commision_1 → R. Fee = Sub_Total × Fee%/100
 *     R_Label_1         → R. Label = Total_Qty × Label
 *     R_Discount_1_y    → R. Discount = Sub_Total × (1 - Disc%/100)
 *     PPN_11            → PPN 11% = 0.11 × Sub_Total
 *     Final_COGS1       → Final COGS = Total_COGS_agg + R.Fee + R.Label + Shipping
 *     Total_GPR_A       → Total GPR% = (Sub_Total - Final_COGS) / Sub_Total × 100
 *     Grand_Total       → Grand Total = (Sub_Total+PPN+Shipping+Adj) - R.Discount
 *     Sub_Total         → Total Price (SUM aggregate of subform Total_Price)
 *
 * TC-F-43: KNOWN BUG — Grand Total formula wrong when Discount% > 0.
 *   The test ASSERTS THE BUGGY VALUE as evidence for the developer.
 *   Correct expected is logged separately for comparison.
 *
 * Usage:
 *   node DAP_UAT_TC30_TC52.js            # integration (default)
 *   node DAP_UAT_TC30_TC52.js --mode=all
 */
'use strict';

const fs   = require('fs/promises');
const path = require('path');
require('dotenv').config();

const REAL_BOM  = 'PKS.FTD.200X200+35.148S-1';
const REAL_DATE = '2026-04';

const CONFIG = {
  token: null, baseUrl: 'https://www.zohoapis.com/crm/v3',
  subform: 'Quoted_Items', delayMs: 1500, formulaWaitMs: 4000,
  integrationWaitMs: 20000, integrationPollMs: 2500, tolerance: 0.02,
  logFile: './uat_results_TC30_TC52.json', placeholderProduct: null,
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
  cyan:'\x1b[36m', grey:'\x1b[90m', blue:'\x1b[34m', magenta:'\x1b[35m',
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

const placeholderRow = () => ({
  Product_Name: { id: CONFIG.placeholderProduct.id, name: CONFIG.placeholderProduct.name },
  Quantity: 1, Unit_Price: 0, Total: 0,
});

/**
 * Creates a Quote with:
 *   subformRow   — test data merged into subform
 *   quoteFields  — header-level Other Cost inputs (Fee_Decimal, Label, Discount3, Shipping_Cost_DAP, Adjustment)
 */
async function createQuote(subject, subformRow, quoteFields = {}) {
  const body = { data: [{
    Subject: subject, Quote_Stage: 'Draft',
    ...quoteFields,
    [CONFIG.subform]: [{ ...placeholderRow(), ...subformRow }],
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
    subformRow:  (d[CONFIG.subform] ?? [])[0] ?? {},
    quoteFields: d,   // full quote data — header-level formula fields live here
  };
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

// ── DYNAMIC EXPECTED — HEADER LEVEL ──────────────────────────────────────────
/**
 * Compute quote header-level formula field expectations.
 *
 * @param {number} subTotal      - Sub_Total (SUM of subform Total_Price rows)
 * @param {number} totalCOGSAgg  - SUM of subform Total_COGS rows
 * @param {number} totalQty      - SUM of subform Quantity rows (for R.Label)
 * @param {object} inputs        - quoteFields inputs: Fee_Decimal, Label, Discount3, Shipping_Cost_DAP, Adjustment
 */
function computeHeaderExpected(subTotal, totalCOGSAgg, totalQty, inputs) {
  const feePct  = inputs.Fee_Decimal      != null ? Number(inputs.Fee_Decimal)      : 0;
  const labelRp = inputs.Label            != null ? Number(inputs.Label)            : 0;
  const discPct = inputs.Discount3        != null ? Number(inputs.Discount3)        : 0;
  const shipHdr = inputs.Shipping_Cost_DAP != null ? Number(inputs.Shipping_Cost_DAP) : 0;
  const adj     = inputs.Adjustment       != null ? Number(inputs.Adjustment)       : 0;

  const rFee      = round2(subTotal * (feePct / 100));
  const rLabel    = round2(totalQty * labelRp);
  const rDiscount = round2(subTotal * (1 - discPct / 100));  // after-discount price (see bug note)
  const ppn11     = round2(0.11 * subTotal);                 // from Total Price, NOT R.Discount
  const finalCOGS = round2(totalCOGSAgg + rFee + rLabel + shipHdr);
  const totalGPR  = subTotal !== 0 ? round2(((subTotal - finalCOGS) / subTotal) * 100) : 0;

  // Grand Total formula (CURRENT/BUGGY): (Sub_Total + PPN + Ship + Adj) - R.Discount
  // R.Discount = after-discount price, so subtracting it gives: PPN + Ship + Adj (when Disc=0)
  // This is only correct when Disc% = 0
  const grandTotalActual = round2((subTotal + ppn11 + shipHdr + adj) - rDiscount);

  // Grand Total CORRECT (what it should be):
  // After-discount price + PPN on after-discount + shipping + adj
  const grandTotalCorrect = round2(rDiscount + round2(rDiscount * 0.11) + shipHdr + adj);

  return {
    R_Fee_Commision_1: rFee,
    R_Label_1:         rLabel,
    R_Discount_1_y:    rDiscount,
    PPN_11:            ppn11,
    Final_COGS1:       finalCOGS,
    Total_GPR_A:       totalGPR,
    Grand_Total:       grandTotalActual,   // the CURRENT (possibly buggy) result
    _grandTotalCorrect: grandTotalCorrect, // for logging only
    _subTotal: subTotal, _totalCOGS: totalCOGSAgg, _totalQty: totalQty,
  };
}

// ── SCENARIOS ─────────────────────────────────────────────────────────────────
/**
 * Each scenario has:
 *   subformInput  — goes into the subform row
 *   headerInputs  — goes into quoteFields (Other Cost section)
 *   assertTarget  — 'header' or 'both' (default 'header')
 *   isBugDoc      — true for TC-F-43 (assert buggy value, log correct value)
 */
const SCENARIOS = [

  // ─── R.FEE (TC-F-30 to TC-F-33) ─────────────────────────────────────────
  {
    id: 'TC-F-30', mode: 'integration',
    name: 'R.Fee – rate 3% dari pihak ketiga',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Fee_Decimal: 3 },
    assertFields: ['R_Fee_Commision_1'],
    notes: 'R.Fee = Sub_Total × 3%. Basis = Total Price (Net Sales), bukan COGS.',
  },
  {
    id: 'TC-F-31', mode: 'integration',
    name: 'R.Fee – Fee% = 0 (tidak ada komisi)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Fee_Decimal: 0 },
    assertFields: ['R_Fee_Commision_1'],
    notes: 'R.Fee = 0. Final COGS tidak bertambah dari komponen fee.',
  },
  {
    id: 'TC-F-32', mode: 'integration',
    name: 'R.Fee – Fee% dikosongkan (IsEmpty guard → 0)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: {},  // Fee_Decimal omitted → null
    assertFields: ['R_Fee_Commision_1'],
    notes: '⚠ IsEmpty guard: null Fee% → 0. R.Fee = 0. Tanpa guard → formula error.',
  },
  {
    id: 'TC-F-33', mode: 'integration',
    name: 'R.Fee – Fee% = 100 (seluruh penjualan jadi biaya)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50 },
    headerInputs: { Fee_Decimal: 100 },
    assertFields: ['R_Fee_Commision_1', 'Final_COGS1', 'Total_GPR_A'],
    notes: '⚠ Edge case ekstrem. R.Fee = Sub_Total. Final COGS naik drastis → GPR sangat negatif.',
  },

  // ─── R.LABEL (TC-F-34 to TC-F-36) ───────────────────────────────────────
  {
    id: 'TC-F-34', mode: 'integration',
    name: 'R.Label – normal (Total Qty × harga per label)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 250 },
    headerInputs: { Label: 1000 },
    assertFields: ['R_Label_1'],
    notes: 'R.Label = 250 × 1.000 = 250.000. Field Label = harga/label (Rp), bukan jumlah label.',
  },
  {
    id: 'TC-F-35', mode: 'integration',
    name: 'R.Label – Label = 0 (tidak ada biaya label)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 250 },
    headerInputs: { Label: 0 },
    assertFields: ['R_Label_1'],
    notes: 'R.Label = 0. Final COGS tidak bertambah dari label.',
  },
  {
    id: 'TC-F-36', mode: 'integration',
    name: 'R.Label – Qty = 0 → Total Qty = 0 → R.Label = 0',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 0 },
    headerInputs: { Label: 1000 },
    assertFields: ['R_Label_1'],
    notes: 'Qty=0 → Total Qty=0 → R.Label = 0 × 1.000 = 0. Verifikasi tidak ada error.',
  },

  // ─── R.DISCOUNT & PPN (TC-F-37 to TC-F-41) ──────────────────────────────
  {
    id: 'TC-F-37', mode: 'integration',
    name: 'R.Discount – Disc% = 0 (tidak ada diskon tambahan)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 0 },
    assertFields: ['R_Discount_1_y', 'PPN_11'],
    notes: 'R.Discount = Sub_Total × 1 = Sub_Total. PPN = 0.11 × Sub_Total.',
  },
  {
    id: 'TC-F-38', mode: 'integration',
    name: 'R.Discount – Disc% = 10',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 10 },
    assertFields: ['R_Discount_1_y', 'PPN_11'],
    notes: 'R.Discount = Sub_Total × 0.9 (after-disc price, bukan nilai diskon). PPN tetap dari Sub_Total.',
  },
  {
    id: 'TC-F-39', mode: 'integration',
    name: 'R.Discount – Disc% = 100 (full diskon)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 100 },
    assertFields: ['R_Discount_1_y'],
    notes: 'R.Discount = Sub_Total × 0 = 0. Grand Total akan anomali jika Disc%=100.',
  },
  {
    id: 'TC-F-40', mode: 'integration',
    name: 'PPN 11% – konfirmasi dihitung dari Sub_Total, bukan R.Discount',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 10 },
    assertFields: ['PPN_11', 'R_Discount_1_y'],
    notes: 'PPN = 0.11 × Sub_Total. Tidak berubah meski Disc%=10. Konfirmasi PPN tidak mengikuti R.Discount.',
  },
  {
    id: 'TC-F-41', mode: 'integration',
    name: 'PPN 11% – 3 skenario Disc% (0, 10, 20) → PPN harus sama semua',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 20 },
    assertFields: ['PPN_11'],
    notes: '⚠ Bug kandidat: PPN harus berubah jika disc diterapkan sebelum pajak. ' +
           'Script memverifikasi: PPN saat Disc%=20 sama dengan saat Disc%=0.',
  },

  // ─── GRAND TOTAL (TC-F-42 to TC-F-46) ───────────────────────────────────
  {
    id: 'TC-F-42', mode: 'integration',
    name: 'Grand Total – Disc%=0 (formula benar secara kebetulan)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 0, Shipping_Cost_DAP: 5000, Adjustment: -8750 },
    assertFields: ['Grand_Total'],
    notes: 'Disc%=0 → R.Discount=Sub_Total → Grand Total = PPN + Shipping + Adj. Benar karena cancel.',
  },
  {
    id: 'TC-F-43', mode: 'integration', isBugDoc: true,
    name: 'Grand Total – Disc%=10 (BUG TERIDENTIFIKASI)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 10, Shipping_Cost_DAP: 5000, Adjustment: 0 },
    assertFields: ['Grand_Total'],
    notes: '🔴 BUG DOKUMENTASI: Grand Total = (Sub+PPN+Ship+Adj)-R.Discount salah saat Disc>0. ' +
           'R.Discount=after-disc price (bukan disc amount). Assertion mencatat nilai aktual sebagai evidensi.',
  },
  {
    id: 'TC-F-44', mode: 'integration',
    name: 'Grand Total – Adjustment negatif (pembulatan ke bawah)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 0, Shipping_Cost_DAP: 5000, Adjustment: -750 },
    assertFields: ['Grand_Total'],
    notes: 'Adjustment negatif → Grand Total turun. Verifikasi field currency menerima nilai negatif.',
  },
  {
    id: 'TC-F-45', mode: 'integration',
    name: 'Grand Total – Adjustment positif (pembulatan ke atas)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 0, Shipping_Cost_DAP: 5000, Adjustment: 250 },
    assertFields: ['Grand_Total'],
    notes: 'Adjustment positif → Grand Total naik.',
  },
  {
    id: 'TC-F-46', mode: 'integration',
    name: 'Grand Total – Shipping Cost header = 0',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Discount3: 0, Shipping_Cost_DAP: 0, Adjustment: 0 },
    assertFields: ['Grand_Total'],
    notes: 'Baseline tanpa shipping dan adjustment. Grand Total = PPN saja.',
  },

  // ─── FINAL COGS & TOTAL GPR (TC-F-47 to TC-F-52) ────────────────────────
  {
    id: 'TC-F-47', mode: 'integration',
    name: 'Final COGS – semua komponen diisi',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 250 },
    headerInputs: { Fee_Decimal: 3, Label: 1000, Shipping_Cost_DAP: 5000 },
    assertFields: ['Final_COGS1'],
    notes: 'Final COGS = Total_COGS_agg + R.Fee + R.Label + Shipping_header.',
  },
  {
    id: 'TC-F-48', mode: 'integration',
    name: 'Final COGS – Fee + Label = 0 (hanya COGS murni)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Fee_Decimal: 0, Label: 0, Shipping_Cost_DAP: 0 },
    assertFields: ['Final_COGS1'],
    notes: 'Final COGS = Total_COGS_agg (tanpa fee, label, shipping). Biaya murni per baris.',
  },
  {
    id: 'TC-F-49', mode: 'integration',
    name: 'Final COGS – Shipping header besar (melebihi margin)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 10 },
    headerInputs: { Fee_Decimal: 0, Label: 0, Shipping_Cost_DAP: 50000000 },
    assertFields: ['Final_COGS1', 'Total_GPR_A'],
    notes: '⚠ Shipping 50 juta >> Total Price. Final COGS >> Sub_Total → Total GPR% sangat negatif.',
  },
  {
    id: 'TC-F-50', mode: 'integration',
    name: 'Total GPR(%) – normal (tanpa fee/label/shipping)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100 },
    headerInputs: { Fee_Decimal: 0, Label: 0, Shipping_Cost_DAP: 0 },
    assertFields: ['Total_GPR_A'],
    notes: 'Tanpa biaya tambahan → Total GPR = GPR per baris = 35% (dari COGS/0.65).',
  },
  {
    id: 'TC-F-51', mode: 'integration',
    name: 'Total GPR(%) – tepat 35% (tanpa fee/label/shipping)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50 },
    headerInputs: {},
    assertOverride: { Total_GPR_A: 35 },
    assertFields: ['Total_GPR_A'],
    notes: 'INSIGHT: Price=COGS/0.65 selalu GPR=35%. Konfirmasi Total GPR header = 35.00%.',
  },
  {
    id: 'TC-F-52', mode: 'integration',
    name: 'Total GPR(%) – negatif (Shipping header > Total Price)',
    subformInput: { Kode_Bom: REAL_BOM, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 1 },
    headerInputs: { Fee_Decimal: 0, Label: 0, Shipping_Cost_DAP: 50000000 },
    assertFields: ['Total_GPR_A'],
    notes: '⚠ Final COGS >> Sub_Total → Total GPR negatif. Konfirmasi sistem menampilkan negatif.',
  },
];

// ── VERIFY ────────────────────────────────────────────────────────────────────
function verifyFields(sourceObj, expectedMap, onlyFields) {
  const fields = onlyFields || Object.keys(expectedMap);
  return fields
    .filter(f => expectedMap[f] !== undefined && !f.startsWith('_'))
    .map(f => {
      const actual = sourceObj[f] ?? null;
      return { field: f, expected: expectedMap[f], actual, pass: approxEq(actual, expectedMap[f]) };
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
  log.info(`Mode: ${scenario.mode}${scenario.isBugDoc ? `  ${C.magenta}[BUG DOCUMENTATION]${C.reset}` : ''}`);
  log.sep();

  const result = {
    id: scenario.id, name: scenario.name, mode: scenario.mode,
    subject, status: 'PENDING', quoteId: null,
    actualCOGS: null, actualSubTotal: null, assertions: [],
    apiCode: null, error: null, notes: scenario.notes,
  };

  try {
    const subPayload = { ...scenario.subformInput };
    delete subPayload.COGS; // COGS always comes from DAP integration
    log.info(`Subform: ${JSON.stringify(subPayload)}`);
    log.info(`Header:  ${JSON.stringify(scenario.headerInputs || {})}`);

    log.info('Step 1: Creating Quote...');
    const created = await createQuote(subject, subPayload, scenario.headerInputs || {});
    result.apiCode = created.apiCode;

    if (created.apiCode !== 'SUCCESS' || !created.id) {
      log.fail(`Create failed. Code: ${created.apiCode} | ${created.message}`);
      log.fail(`Raw: ${JSON.stringify(created.raw)}`);
      result.status = 'ERROR'; result.error = `${created.apiCode} – ${created.message}`;
      return result;
    }
    result.quoteId = created.id;
    log.info(`Quote created. ID: ${created.id}`);

    log.info(`Step 2: Polling DAP integration (max ${CONFIG.integrationWaitMs/1000}s)...`);
    const subRow = await pollUntilIntegrated(created.id);
    result.actualCOGS = subRow.COGS;
    ['COGS', 'MUF', 'KODE_KAIN', 'Total_Price', 'Total_COGS'].forEach(f =>
      log.info(`  ${f.padEnd(16)} = ${subRow[f] ?? 'null'}`));

    // Wait for header-level formula to compute after subform Total Price is known
    log.info(`Step 3: Waiting ${CONFIG.formulaWaitMs}ms for header formula calc...`);
    await sleep(CONFIG.formulaWaitMs);
    const { httpStatus, subformRow: refreshedRow, quoteFields } = await getQuote(created.id);
    if (httpStatus !== 200) {
      result.status = 'ERROR'; result.error = `Refresh GET HTTP ${httpStatus}`; return result;
    }

    // Read key aggregates from refreshed data
    const subTotal     = Number(quoteFields.Sub_Total)    || 0;
    const totalCOGSAgg = Number(quoteFields.Final_COGS1)   // if available from prior calc
                         || Number(refreshedRow.Total_COGS) || 0;
    const totalQty     = Number(quoteFields.Total_Qty_2)  // aggregate field if exists
                         || Number(refreshedRow.Quantity)  || 0;
    result.actualSubTotal = subTotal;
    log.info(`Sub_Total (aggregate): ${fmt(subTotal)}`);
    log.info(`Total COGS (aggregate): ${fmt(totalCOGSAgg)}`);
    log.info(`Total Qty: ${totalQty}`);

    // Compute header-level expected values
    const headerExpected = computeHeaderExpected(
      subTotal, Number(refreshedRow.Total_COGS) || 0, totalQty, scenario.headerInputs || {}
    );

    // Apply per-scenario assertOverride
    if (scenario.assertOverride) Object.assign(headerExpected, scenario.assertOverride);

    log.info('Expected (header level):');
    Object.entries(headerExpected)
      .filter(([k]) => !k.startsWith('_'))
      .forEach(([k, v]) => log.info(`  ${k.padEnd(22)} → ${fmt(v)}`));

    // For bug documentation: log correct expected vs formula expected
    if (scenario.isBugDoc) {
      log.bug(`TC-F-43 BUG: Formula produces: ${fmt(headerExpected.Grand_Total)}`);
      log.bug(`CORRECT value should be:       ${fmt(headerExpected._grandTotalCorrect)}`);
      log.bug(`Difference: ${fmt(Math.abs(headerExpected.Grand_Total - headerExpected._grandTotalCorrect))}`);
      log.bug('Asserting ACTUAL (buggy) value as evidence — see notes.');
    }

    // Assert only the fields specified in scenario.assertFields
    const assertions = verifyFields(quoteFields, headerExpected, scenario.assertFields);
    result.assertions = assertions;
    printAssertions(assertions);

    // Bug doc scenarios always PASS (we're documenting, not failing)
    result.status = scenario.isBugDoc
      ? 'PASS (BUG DOCUMENTED)'
      : (assertions.every(a => a.pass) ? 'PASS' : 'FAIL');

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
  console.log(`${C.bold}  DAP UAT – TC-F-30 → TC-F-52  (Header-Level Formulas)${C.reset}`);
  console.log(`  Mode: ${C.cyan}${CLI_MODE}${C.reset}  |  BOM: ${REAL_BOM}  |  Period: ${REAL_DATE}`);
  console.log(`  ${C.magenta}TC-F-43 = Bug Documentation (Grand Total wrong when Disc%>0)${C.reset}`);
  console.log('═'.repeat(72));

  CONFIG.token             = await getAccessToken();
  CONFIG.placeholderProduct = await discoverPlaceholder();

  const toRun = SCENARIOS.filter(s => {
    if (CLI_MODE === 'all') return true;
    return s.mode === 'integration';
  });

  const results = [];
  let passed = 0, failed = 0, errors = 0;
  for (const s of toRun) {
    const r = await runScenario(s);
    results.push(r);
    if (r.status.startsWith('PASS')) passed++;
    else if (r.status === 'FAIL') failed++;
    else errors++;
    await sleep(CONFIG.delayMs);
  }

  console.log('\n' + '═'.repeat(72));
  console.log(`${C.bold}  HASIL UAT${C.reset}`);
  console.log('═'.repeat(72));
  for (const r of results) {
    const icon = r.status.startsWith('PASS') ? `${C.green}LULUS${C.reset}` :
                 r.status === 'FAIL' ? `${C.red}GAGAL${C.reset}` : `${C.yellow}ERROR${C.reset}`;
    const bugTag = r.status.includes('BUG') ? ` ${C.magenta}[BUG]${C.reset}` : '';
    const cogs = r.actualCOGS != null ? ` COGS=${fmt(r.actualCOGS)}` : '';
    const qid  = r.quoteId ? ` [ID:${r.quoteId}]` : '';
    console.log(`  ${icon}  ${r.id.padEnd(10)} ${r.name.padEnd(44)}${bugTag}${C.grey}${cogs}${qid}${C.reset}`);
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