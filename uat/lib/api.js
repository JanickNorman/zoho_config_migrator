'use strict';

/**
 * createApi(CONFIG, log) → API methods factory.
 *
 * All Zoho CRM HTTP calls live here. Receives CONFIG and log as dependencies
 * so the module is testable without side-effectful imports.
 */
function createApi(CONFIG, log) {

  const apiH = () => ({
    'Authorization': `Zoho-oauthtoken ${CONFIG.token}`,
    'Content-Type':  'application/json',
  });

  // ── Product discovery ───────────────────────────────────────────────────────

  async function discoverPlaceholder() {
    log.info('Fetching placeholder product (mandatory for Quoted_Items)...');
    const j = await (await fetch(
      `${CONFIG.baseUrl}/Products?fields=id,Product_Name&per_page=1`,
      { headers: apiH() }
    )).json();
    const p = j?.data?.[0];
    if (!p?.id) throw new Error('No active product found. Create at least one product first.');
    log.info(`Placeholder: "${p.Product_Name}" (${p.id})`);
    return { id: p.id, name: p.Product_Name };
  }

  // ── Row builder ─────────────────────────────────────────────────────────────

  /**
   * Minimal Zoho-standard row satisfying the mandatory Quoted_Items constraint.
   * Test fields are merged on top of this.
   */
  const placeholderRow = () => ({
    Product_Name: { id: CONFIG.placeholderProduct.id, name: CONFIG.placeholderProduct.name },
    Quantity:     1,
    Unit_Price:   0,
    Total:        0,
  });

  // ── Quote CRUD ──────────────────────────────────────────────────────────────

  /**
   * Create a Quote with ONE subform row.
   * @param {string} subject
   * @param {object} customRow    - test fields merged into the subform row
   * @param {object} quoteFields  - optional header-level fields (Other Cost, etc.)
   */
  async function createQuote(subject, customRow, quoteFields = {}) {
    const body = {
      data: [{
        Subject:          subject,
        Quote_Stage:      'Draft',
        ...quoteFields,
        [CONFIG.subform]: [{ ...placeholderRow(), ...customRow }],
      }],
      trigger: ['workflow', 'blueprint', 'approval'],
    };
    const j    = await (await fetch(`${CONFIG.baseUrl}/Quotes`,
      { method: 'POST', headers: apiH(), body: JSON.stringify(body) })).json();
    const item = j?.data?.[0] ?? {};
    return {
      id:      item?.details?.id ?? null,
      apiCode: item?.code ?? 'UNKNOWN',
      message: item?.message ?? '',
      raw:     item,
    };
  }

  /**
   * Create a Quote with MULTIPLE rows in ONE subform (direct-multirow tests).
   * @param {string}   subject
   * @param {object[]} rowsData    - array of custom row objects
   * @param {object}   quoteFields - optional header-level fields
   */
  async function createMultiRowQuote(subject, rowsData, quoteFields = {}) {
    const body = {
      data: [{
        Subject:          subject,
        Quote_Stage:      'Draft',
        ...quoteFields,
        [CONFIG.subform]: rowsData.map(r => ({ ...placeholderRow(), ...r })),
      }],
      trigger: ['workflow', 'blueprint', 'approval'],
    };
    const j    = await (await fetch(`${CONFIG.baseUrl}/Quotes`,
      { method: 'POST', headers: apiH(), body: JSON.stringify(body) })).json();
    const item = j?.data?.[0] ?? {};
    return {
      id:      item?.details?.id ?? null,
      apiCode: item?.code ?? 'UNKNOWN',
      message: item?.message ?? '',
      raw:     item,
    };
  }

  /**
   * Create a Quote with rows spread across MULTIPLE subforms simultaneously
   * (multi-brand scenarios: Quoted_Items=KK, Quoted_Items_2=Serta, etc.).
   *
   * Single POST ensures Zoho calculates all formulas from a consistent initial state.
   * Sequential PATCHes risk partial states where formulas run against incomplete data.
   *
   * @param {string} subject
   * @param {object} subformData  - keyed by Zoho subform name:
   *   { 'Quoted_Items': [...rows], 'Quoted_Items_2': [...rows], ... }
   * @param {object} quoteFields  - optional header-level fields
   */
  async function createMultiBrandQuote(subject, subformData, quoteFields = {}) {
    const subforms = { ...subformData };

    // Quoted_Items is mandatory in Zoho — ensure it always has at least one row
    // (relevant when only Serta/Florence subforms are in the scenario)
    if (!subforms.Quoted_Items || subforms.Quoted_Items.length === 0) {
      subforms.Quoted_Items = [{}];
    }

    const body = {
      data: [{
        Subject:     subject,
        Quote_Stage: 'Draft',
        ...quoteFields,
        ...Object.fromEntries(
          Object.entries(subforms).map(([name, rows]) => [
            name,
            rows.map(r => ({ ...placeholderRow(), ...r })),
          ])
        ),
      }],
      trigger: ['workflow', 'blueprint', 'approval'],
    };

    const j    = await (await fetch(`${CONFIG.baseUrl}/Quotes`,
      { method: 'POST', headers: apiH(), body: JSON.stringify(body) })).json();
    const item = j?.data?.[0] ?? {};
    return {
      id:      item?.details?.id ?? null,
      apiCode: item?.code ?? 'UNKNOWN',
      message: item?.message ?? '',
      raw:     item,
    };
  }

  /**
   * Fetch a Quote record.
   * Returns:
   *   subformRow   — first row of CONFIG.subform (convenience for single-row scenarios)
   *   subformRows  — all rows of CONFIG.subform (for multi-row aggregate tests)
   *   quoteFields  — full quote data object (for header-level formula assertions
   *                  and multi-brand polling across all subforms)
   */
  async function getQuote(id) {
    const r    = await fetch(`${CONFIG.baseUrl}/Quotes/${id}`, { headers: apiH() });
    const data = (await r.json())?.data?.[0] ?? {};
    const rows = data[CONFIG.subform] ?? [];
    return {
      httpStatus:  r.status,
      subformRow:  rows[0] ?? {},
      subformRows: rows,
      quoteFields: data,
    };
  }

  /**
   * Update specific fields on a subform row via PUT.
   * Used in the two-step flow (TC-F-09: PATCH Corp.Price = actual Price).
   */
  async function patchSubformRow(quoteId, rowId, updates) {
    const body = {
      data: [{ id: quoteId, [CONFIG.subform]: [{ id: rowId, ...updates }] }],
    };
    const r = await fetch(`${CONFIG.baseUrl}/Quotes`,
      { method: 'PUT', headers: apiH(), body: JSON.stringify(body) });
    return await r.json();
  }

  /** Hard-delete a Quote (cleanup when expectError scenario unexpectedly succeeds). */
  async function deleteQuote(id) {
    await fetch(`${CONFIG.baseUrl}/Quotes?ids=${id}`,
      { method: 'DELETE', headers: apiH() });
  }

  return {
    discoverPlaceholder,
    placeholderRow,
    createQuote,
    createMultiRowQuote,
    createMultiBrandQuote,
    getQuote,
    patchSubformRow,
    deleteQuote,
  };
}

module.exports = createApi;
