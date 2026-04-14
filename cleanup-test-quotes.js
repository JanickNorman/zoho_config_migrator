#!/usr/bin/env node
/**
 * DAP Zoho CRM – Test Quote Cleanup
 *
 * Deletes all Quote records where the subject line starts with "TC-F".
 * This is intended to clean up records created by the UAT test runner.
 */
'use strict';

const fs   = require('fs/promises');
const path = require('path');
require('dotenv').config();

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  token:   null,
  baseUrl: 'https://www.zohoapis.com/crm/v3',
  deleteBatchSize: 100, // Max IDs per delete call is 100
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  green:'\x1b[32m', red:'\x1b[31m', yellow:'\x1b[33m',
  cyan:'\x1b[36m', grey:'\x1b[90m',
};
const log = {
  ok:   m => console.log(`  ${C.green}✓ OK${C.reset}     ${m}`),
  info: m => console.log(`  ${C.grey}ℹ INFO${C.reset}   ${m}`),
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

/**
 * Searches for quotes with subjects starting with "TC-F" and returns their IDs.
 * Handles pagination to retrieve all matching records.
 */
async function findTestQuotes() {
  const allQuotes = [];
  let page = 1;
  let hasMore = true;

  log.info('Searching for quotes with Subject starting with "TC-F"...');

  while (hasMore) {
    const url = `${CONFIG.baseUrl}/Quotes/search?criteria=(Subject:starts_with:TC-F)&fields=id,Subject&page=${page}`;
    const res = await fetch(url, { headers: apiH() });
    const json = await res.json();

    if (!res.ok) {
      throw new Error(`API Error searching quotes: ${JSON.stringify(json)}`);
    }

    const data = json.data || [];
    allQuotes.push(...data);

    hasMore = json.info?.more_records ?? false;
    page++;
  }

  return allQuotes;
}

/**
 * Deletes quotes in batches of up to 100.
 */
async function deleteQuotes(quoteIds) {
  if (!quoteIds.length) {
    log.ok('No test quotes found to delete.');
    return;
  }

  log.info(`Found ${quoteIds.length} quotes to delete. Proceeding in batches...`);

  for (let i = 0; i < quoteIds.length; i += CONFIG.deleteBatchSize) {
    const batch = quoteIds.slice(i, i + CONFIG.deleteBatchSize);
    const idsParam = batch.join(',');
    const url = `${CONFIG.baseUrl}/Quotes?ids=${idsParam}`;

    log.info(`Deleting batch of ${batch.length} quotes...`);
    const res = await fetch(url, { method: 'DELETE', headers: apiH() });
    const json = await res.json();

    if (!res.ok) {
        log.warn(`API Error deleting batch: ${JSON.stringify(json)}`);
    } else {
        // Assuming the response for bulk delete indicates success for each item
        const successCount = (json.data || []).filter(d => d.code === 'SUCCESS').length;
        log.ok(`Successfully deleted ${successCount} quotes in this batch.`);
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(72));
  console.log(`${C.bold}  DAP UAT – Test Quote Cleanup Utility${C.reset}`);
  console.log('═'.repeat(72));

  CONFIG.token = await getAccessToken();
  log.info(`Token: ${CONFIG.token.slice(0,12)}...`);
  log.sep();

  const quotesToDelete = await findTestQuotes();
  const quoteIds = quotesToDelete.map(q => q.id);

  if (quoteIds.length > 0) {
    quotesToDelete.forEach(q => log.info(`  - Found: "${q.Subject}" (ID: ${q.id})`));
    log.sep();
    await deleteQuotes(quoteIds);
  } else {
    log.ok('No quotes with subject "TC-F" found.');
  }

  log.sep();
  log.ok('Cleanup process finished.');
  console.log('\n' + '═'.repeat(72) + '\n');
}

main().catch(err => {
  console.error(`\n${C.red}Fatal: ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});
