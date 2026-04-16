'use strict';

/**
 * Poll the quote record until the DAP API has written COGS and MUF,
 * or CONFIG.integrationWaitMs is exceeded.
 * Returns the populated subform row.
 */
async function pollUntilIntegrated(quoteId, CONFIG, api, log, C) {
  const deadline = Date.now() + CONFIG.integrationWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    await new Promise(r => setTimeout(r, CONFIG.integrationPollMs));
    const { httpStatus, subformRow } = await api.getQuote(quoteId);
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

module.exports = { pollUntilIntegrated };
