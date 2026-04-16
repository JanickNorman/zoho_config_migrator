const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { getDAPAccessToken } = require('./auth');

const DAP_API_URL = 'https://api.dap.id/api/v1';
const DAP_API_KEY = '5y0tOKEUErpnXjdmJF5rd1cXPuIIIY7n7WUe3h35';
const DAP_DOMAIN = 'zohocorp';

const SUBFORM_NAMES = [
  'Quoted_Items',
  'Quoted_Items_2',
  'Quoted_Items_3',
  'Quoted_Items_4',
  'Quoted_Items_5',
];

// ─── Zoho helpers ────────────────────────────────────────────────────────────

async function getZohoAccessToken() {
  const credentialsPath = path.join(process.cwd(), 'self_client.json');
  const credentials = JSON.parse(await fs.readFile(credentialsPath, 'utf-8'));

  if (credentials.access_token && credentials.expiry_time && Date.now() < credentials.expiry_time) {
    return credentials.access_token;
  }

  console.log('Refreshing Zoho access token...');
  const params = new URLSearchParams({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    grant_type: 'refresh_token',
    refresh_token: credentials.refresh_token,
  });

  const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', params);
  const { access_token, expires_in } = response.data;
  if (!access_token) throw new Error('Failed to obtain Zoho access token.');

  const updated = { ...credentials, access_token, expiry_time: Date.now() + expires_in * 1000 };
  await fs.writeFile(credentialsPath, JSON.stringify(updated, null, 2));
  return access_token;
}

async function updateQuoteStatus(zohoToken, recordId, statusFields) {
  await axios.put(
    `https://www.zohoapis.com/crm/v2.1/Quotes/${recordId}`,
    { data: [statusFields] },
    { headers: { Authorization: `Zoho-oauthtoken ${zohoToken}` } }
  );
}

async function fetchQuoteRecord(zohoToken, recordId) {
  const fields = SUBFORM_NAMES.join(',');
  const response = await axios.get(
    `https://www.zohoapis.com/crm/v2.1/Quotes/${recordId}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${zohoToken}` },
      params: { fields },
    }
  );
  const data = response.data?.data;
  if (!data || data.length === 0) return null;
  return data[0];
}

// ─── DAP helpers ─────────────────────────────────────────────────────────────

function buildDAPHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'X-API-KEY': DAP_API_KEY,
    domain: DAP_DOMAIN,
    'Content-Type': 'application/json',
  };
}

async function lookupByBom(bomCode, headers) {
  try {
    const response = await axios.post(
      `${DAP_API_URL}/bom/list`,
      { bom_code: bomCode },
      { headers }
    );
    console.log(`  BOM lookup [${bomCode}]:`, response.data?.status);
    if (response.data?.status === 'success') {
      return response.data.data || [];
    }
  } catch (e) {
    console.error(`  BOM lookup error [${bomCode}]:`, e.response?.data || e.message);
  }
  return [];
}

async function fetchBomDetail(detailId, codeYear, codeMonth, headers) {
  try {
    const response = await axios.post(
      `${DAP_API_URL}/bom/detail/${detailId}`,
      { code_year: codeYear, code_month: codeMonth },
      { headers }
    );
    console.log(`  BOM detail [${detailId}]:`, response.data?.status);
    if (response.data?.status === 'success') {
      return response.data.data || null;
    }
  } catch (e) {
    console.error(`  BOM detail error [${detailId}]:`, e.response?.data || e.message);
  }
  return null;
}

// ─── Row processing ───────────────────────────────────────────────────────────

function parsePeriod(codePeriod) {
  if (codePeriod && codePeriod.includes('-')) {
    const parts = codePeriod.split('-');
    if (parts.length === 2) {
      return { codeYear: parts[0], codeMonth: parts[1].padStart(2, '0') };
    }
  }
  const today = new Date();
  return {
    codeYear: String(today.getFullYear()),
    codeMonth: String(today.getMonth() + 1).padStart(2, '0'),
  };
}

async function processRow(row, dapHeaders) {
  const rowMap = { id: row.id };

  const kodeBom = (row.Kode_Bom || '').toString().trim();
  if (!kodeBom) {
    // No Kode_Bom — nothing to look up, skip this row
    return { rowMap, foundData: false };
  }

  const { codeYear, codeMonth } = parsePeriod((row.Code_Period || '').toString().trim());
  console.log(`  Row ${row.id} — Kode_Bom: ${kodeBom} | Period: ${codeYear}-${codeMonth}`);

  // 1) BOM list lookup to get detail_id
  const bomResults = await lookupByBom(kodeBom, dapHeaders);
  if (!bomResults.length) {
    console.warn(`  No BOM results for ${kodeBom}`);
    return { rowMap, foundData: false };
  }

  const detailId = (bomResults[0].detail_id || '').toString();
  if (!detailId) {
    console.warn(`  No detail_id for BOM ${kodeBom}`);
    return { rowMap, foundData: false };
  }

  // 2) BOM detail to get COGS, MUF, Kode Kain
  const data = await fetchBomDetail(detailId, codeYear, codeMonth, dapHeaders);
  if (!data) {
    console.warn(`  No detail data for detail_id ${detailId}`);
    return { rowMap, foundData: false };
  }

  const calcMap = data.calculate || {};
  const detailArr = data.detail || [];

  // COGS from calculate.costing (integer — no decimal places allowed)
  if (calcMap.costing != null) {
    rowMap.COGS = Math.round(parseFloat(calcMap.costing));
    console.log(`    COGS: ${rowMap.COGS}`);
  }

  if (detailArr.length > 0) {
    const firstDetail = detailArr[0];

    // MUF from detail[0].jumlah
    if (firstDetail.jumlah != null) {
      rowMap.MUF = parseFloat(firstDetail.jumlah);
      console.log(`    MUF: ${rowMap.MUF}`);
    }

    // Kode Kain from detail[0].item_code
    const kodeKain = (firstDetail.item_code || '').toString().trim();
    if (kodeKain) {
      rowMap.KODE_KAIN = kodeKain;
      console.log(`    KODE_KAIN: ${kodeKain}`);
    }
  }

  return { rowMap, foundData: true };
}

// ─── Main function ────────────────────────────────────────────────────────────

async function processQuoteDAP(recordId, { log = true } = {}) {
  if (log) {
    console.log('=== FUNCTION START ===');
    console.log('RECORD ID:', recordId);
  }

  const zohoToken = await getZohoAccessToken();

  // Mark as Processing
  await updateQuoteStatus(zohoToken, recordId, {
    Integration_Status: 'Processing',
    Refresh_Flag: false,
  });

  // Fetch quote record
  const record = await fetchQuoteRecord(zohoToken, recordId);
  if (!record) {
    console.error('QUOTE NOT FOUND');
    await updateQuoteStatus(zohoToken, recordId, { Integration_Status: 'Failed', Refresh_Flag: true });
    return;
  }

  // Get DAP token
  let dapToken;
  try {
    dapToken = await getDAPAccessToken();
  } catch (e) {
    console.error('TOKEN FAILED:', e.message);
    await updateQuoteStatus(zohoToken, recordId, { Integration_Status: 'Failed', Refresh_Flag: true });
    return;
  }

  const dapHeaders = buildDAPHeaders(dapToken);
  const updateMap = {};
  let hasSuccess = false;

  // Process each subform
  for (const subformName of SUBFORM_NAMES) {
    const subformList = record[subformName];
    if (!subformList || subformList.length === 0) continue;

    if (log) {
      console.log(`\nProcessing subform: ${subformName} (${subformList.length} rows)`);
    }
    const updatedItems = [];

    for (const row of subformList) {
      const { rowMap, foundData } = await processRow(row, dapHeaders);
      if (foundData) hasSuccess = true;
      updatedItems.push(rowMap);
    }

    updateMap[subformName] = updatedItems;
  }

  // Push updates back to Zoho
  if (log) {
    console.log('\nFINAL UPDATE BODY:', JSON.stringify({ data: [updateMap] }, null, 2));
  }
  const updateResponse = await axios.put(
    `https://www.zohoapis.com/crm/v2.1/Quotes/${recordId}`,
    { data: [updateMap] },
    { headers: { Authorization: `Zoho-oauthtoken ${zohoToken}`, 'Content-Type': 'application/json' } }
  );
  if (log) {
    console.log('UPDATE RESPONSE:', JSON.stringify(updateResponse.data, null, 2));
  }

  // Check update response for success
  const firstResp = updateResponse.data?.data?.[0];
  if (firstResp?.status?.toLowerCase() === 'success') hasSuccess = true;

  // Final status
  await updateQuoteStatus(zohoToken, recordId, {
    Integration_Status: hasSuccess ? 'Success' : 'Failed',
    Refresh_Flag: true,
  });

  if (log) {
    console.log('=== FUNCTION END ===');
  }
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

async function main() {
  const recordId = process.argv[2];
  if (!recordId) {
    console.error('Usage: node dap/processQuote.js <recordId>');
    process.exit(1);
  }

  const log = !process.argv.includes('--no-log');
  try {
    await processQuoteDAP(recordId, { log });
  } catch (e) {
    console.error('ERROR:', e.message);
    if (e.response) console.error('Response:', JSON.stringify(e.response.data, null, 2));
    process.exit(1);
  }
}

// main();

module.exports = { processQuoteDAP };
