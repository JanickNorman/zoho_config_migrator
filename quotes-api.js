"use strict";

const fs = require('fs/promises');
const path = require('path');


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


module.exports = (CONFIG, log) => {
  const apiH = () => ({
    'Authorization': `Zoho-oauthtoken ${CONFIG.token}`,
    'Content-Type': 'application/json',
  });

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
      [CONFIG.subform]: [{ ...placeholderRow(), ...customRow }],
    }] };
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
    const body = { data: [{ id: quoteId, [CONFIG.subform]: [{ id: rowId, ...updates }] }] };
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

  return { getAccessToken, discoverPlaceholder, placeholderRow, createQuote, getQuote, patchSubformRow, deleteQuote, pollUntilIntegrated };
};
