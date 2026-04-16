'use strict';

/**
 * createMultiApi(CONFIG, log, api) → multi-brand polling and logging helpers.
 *
 * Receives CONFIG, log, and api as dependencies (dependency injection pattern).
 * Uses api.getQuote for all reads so no raw fetch calls are needed here.
 */
function createMultiApi(CONFIG, log, api) {
  const { C, sleep, fmt } = require('./logger');

  // ── Per-subform polling ───────────────────────────────────────────────────

  /**
   * Poll the Quote until the DAP integration has written COGS + MUF for ALL
   * rows across ALL specified subforms, or CONFIG.integrationWaitMs is exceeded.
   *
   * Each row that has Kode_Bom + Tahun_Bulan triggers an independent DAP API call.
   * Polling ends only when every single row in every subform has non-null, non-zero
   * values for all CONFIG.integrationSignalFields.
   *
   * @param {string}   quoteId       - Zoho Quote record ID
   * @param {string[]} subformNames  - subform API names to check
   *                                   e.g. ['Quoted_Items', 'Quoted_Items_2', 'Quoted_Items_3']
   * @returns {object} map of subformName → array of populated rows
   * @throws  {Error}  if timeout reached before all rows are populated
   */
  async function pollAllSubformsIntegrated(quoteId, subformNames) {
    const deadline = Date.now() + CONFIG.integrationWaitMs;
    let attempt    = 0;

    while (Date.now() < deadline) {
      attempt++;
      await sleep(CONFIG.integrationPollMs);

      // api.getQuote returns quoteFields which contains ALL subforms
      const { httpStatus, quoteFields } = await api.getQuote(quoteId);
      if (httpStatus !== 200) throw new Error(`Poll GET failed HTTP ${httpStatus}`);

      const allPending    = [];
      const rowsBySubform = {};

      for (const sfName of subformNames) {
        const rows = quoteFields[sfName] ?? [];
        rowsBySubform[sfName] = rows;
        rows.forEach((row, idx) => {
          CONFIG.integrationSignalFields.forEach(field => {
            if (row[field] == null || row[field] === 0) {
              allPending.push(`${sfName}[${idx}].${field}`);
            }
          });
        });
      }

      const elapsed = ((Date.now() - deadline + CONFIG.integrationWaitMs) / 1000).toFixed(1);

      if (allPending.length === 0) {
        log.poll(`Attempt ${attempt} (${elapsed}s) — ${C.green}All subforms integrated!${C.reset}`);
        return rowsBySubform;
      }

      // Compact per-subform summary (e.g. "Quoted_Items: ✓ | Quoted_Items_2: 3 pending")
      const summary = subformNames.map(sfName => {
        const n = allPending.filter(p => p.startsWith(sfName)).length;
        return n > 0 ? `${sfName}: ${n} pending` : `${sfName}: ✓`;
      }).join(' | ');

      log.poll(`Attempt ${attempt} (${elapsed}s) — ${summary}`);
    }

    throw new Error(
      `Multi-subform integration timeout after ${CONFIG.integrationWaitMs / 1000}s. ` +
      `Not all rows received [${CONFIG.integrationSignalFields.join(', ')}]. ` +
      `Check: (1) All Kode_Bom valid? (2) DAP API reachable? (3) Workflows active for all brands?`
    );
  }

  // ── Post-integration logging ──────────────────────────────────────────────

  /**
   * Print a summary of DAP-written values per subform after polling completes.
   * @param {object} rowsBySubform - map of subformName → rows (from pollAllSubformsIntegrated)
   * @param {object} brandLabels   - map of subformName → human-readable brand name (optional)
   */
  function logIntegrationValues(rowsBySubform, brandLabels = {}) {
    const sfNames = Object.keys(rowsBySubform);
    for (const [sfIdx, sfName] of sfNames.entries()) {
      const rows  = rowsBySubform[sfName];
      const label = `Subform ${sfIdx + 1}`;
      log.info(`${label} (${sfName}) — ${rows.length} row(s):`);
      rows.forEach((row, i) => {
        const fields = ['COGS', 'MUF', 'KODE_KAIN']
          .map(f => `${f}=${row[f] ?? 'null'}`)
          .join('  ');
        log.info(`  Row ${i + 1}: ${fields}`);
      });
    }
  }

  // ── Header formula re-fetch ───────────────────────────────────────────────

  /**
   * Wait for header-level formulas to settle, then re-fetch the full quote data.
   * Called after pollAllSubformsIntegrated for scenarios that also assert header fields.
   *
   * @param {string} quoteId - Quote record ID
   * @param {number} waitMs  - time to wait before fetching (default: CONFIG.headerFormulaWaitMs)
   * @returns {object} full quote data (quoteFields)
   */
  async function refetchAfterWait(quoteId, waitMs = CONFIG.headerFormulaWaitMs) {
    log.info(`Waiting ${waitMs}ms for header formula recalculation...`);
    await sleep(waitMs);
    const { httpStatus, quoteFields } = await api.getQuote(quoteId);
    if (httpStatus !== 200) throw new Error(`Refetch GET failed HTTP ${httpStatus}`);
    return quoteFields;
  }

  return { pollAllSubformsIntegrated, logIntegrationValues, refetchAfterWait };
}

module.exports = createMultiApi;
