'use strict';

const fs = require('fs/promises');

const { CONFIG, CLI_MODE }         = require('./config');
const { C, log, sleep, fmt }       = require('./logger');
const { pollUntilIntegrated }      = require('./poll');
const { verify, verifyFields,
        printAssertions }          = require('./assert');
const { computeDynamicExpected }   = require('../expected/rowFormulas');
const { computeSubformAggregate,
        computeFinalGrandTotal,
        computeMultiRowExpected }  = require('../expected/headerFormulas');
const createMultiApi               = require('./multiApi');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO SHAPE REFERENCE
//
// INTEGRATION (default, no `type` needed)
// ──────────────────────────────────────
//   The formula being tested is the spec.
//   The brands/subforms in `setup` are the condition (fixture) for that test.
//
//   {
//     id, name,
//     setup: {
//       'Quoted_Items':   [ { Kode_Bom, Tahun_Bulan_yyyy_mm, Quantity,
//                             Corporate_Price?, Discount_1?, Discount_2?, Discount_3?,
//                             Shipping_Cost_per_Product? }, ... ],
//       'Quoted_Items_2': [ ... ],
//       'Quoted_Items_3': [ ... ],
//     },
//     assertFields:   ['Price', 'Final_Price', 'GPR', ...],
//     assertOverride: { GPR: 35 },   // pin specific fields after dynamic computation
//     twoStep:        true,          // after polling: PATCH Corp.Price=actual Price on row[0][0]
//     brandLabels:    { 'Quoted_Items': 'King Koil', ... },  // for log readability
//     notes,
//   }
//
//   Flow:
//     createMultiBrandQuote(setup) → pollAllSubformsIntegrated
//     → for each subform/row: computeDynamicExpected(actualRow, inputRow) → verifyFields
//
// INTEGRATION-HEADER
// ──────────────────
//   Same fixture mechanism as integration, but asserts QUOTE-LEVEL formula fields
//   (R_Fee, R_Label, PPN, Grand_Total, Final_COGS, Total_GPR) after header formulas settle.
//
//   {
//     type: 'integration-header',
//     setup: { 'Quoted_Items': [...] },
//     headerInputs: { Fee_Decimal, Label, Discount3, Shipping_Cost_DAP, Adjustment },
//     assertFields: ['R_Fee_Commision_1', 'PPN_11', 'Grand_Total', ...],
//     assertOverride, isBugDoc, notes,
//   }
//
// DIRECT (edge cases only)
// ────────────────────────
//   Single subform row. COGS injected, no Kode_Bom → integration does NOT fire.
//   Only use when the test requires controlling COGS exactly (COGS=0, COGS negative, etc.)
//
//   {
//     type: 'direct',
//     input:       { COGS, Quantity, Tahun_Bulan_yyyy_mm, ... },
//     expected:    { Price, Price_Quote, ... },   // hardcoded
//     expectError: true,   // optional: expect Zoho to reject the POST
//     notes,
//   }
//
// DIRECT-MULTIROW
// ───────────────
//   Multiple rows, COGS injected. Tests Sub_Total SUM aggregate.
//
//   {
//     type: 'direct-multirow',
//     rows: [ { COGS, Quantity, Discount_1?, ... }, ... ],
//     notes,
//   }
// ─────────────────────────────────────────────────────────────────────────────

async function runScenario(scenario, api, multiApi) {
  const {
    createQuote, createMultiRowQuote, createMultiBrandQuote,
    getQuote, patchSubformRow, deleteQuote,
  } = api;

  const type    = scenario.type ?? 'integration';
  const subject = `${scenario.id} - ${scenario.name} - UAT`;

  log.head(`[${scenario.id}] ${scenario.name}`);
  log.info(`Type: ${type}${scenario.twoStep ? ' [two-step]' : ''}${scenario.isBugDoc ? `  ${C.magenta}[BUG DOC]${C.reset}` : ''}`);
  log.sep();

  const result = {
    id:         scenario.id,
    name:       scenario.name,
    type,
    subject,
    status:     'PENDING',
    quoteId:    null,
    actualCOGS: null,
    assertions: [],
    apiCode:    null,
    error:      null,
    notes:      scenario.notes,
  };

  try {

    // ════════════════════════════════════════════════════════════════════════
    // DIRECT
    // ════════════════════════════════════════════════════════════════════════
    if (type === 'direct') {
      const payload = { ...scenario.input };
      delete payload.Kode_Bom;
      log.info('Direct mode: Kode_Bom removed — integration will NOT fire.');

      log.info('Step 1: Creating Quote...');
      const created = await createQuote(subject, payload);
      result.apiCode = created.apiCode;

      if (scenario.expectError) {
        if (created.apiCode !== 'SUCCESS') {
          log.pass(`API correctly rejected. Code: ${created.apiCode} | ${created.message}`);
          result.status = 'PASS';
        } else {
          log.fail(`Should have rejected but record created (ID: ${created.id}).`);
          result.status  = 'FAIL';
          result.error   = 'Expected rejection — record was created';
          result.quoteId = created.id;
          if (created.id) await deleteQuote(created.id);
        }
        return result;
      }

      if (created.apiCode !== 'SUCCESS' || !created.id) {
        log.fail(`Create failed. ${created.apiCode} | ${created.message}`);
        log.fail(`Raw: ${JSON.stringify(created.raw)}`);
        result.status = 'ERROR'; result.error = `${created.apiCode} – ${created.message}`;
        return result;
      }
      result.quoteId = created.id;

      log.info(`Step 2: Waiting ${CONFIG.formulaWaitMs}ms for Zoho formula calc...`);
      await sleep(CONFIG.formulaWaitMs);
      const { httpStatus, subformRow } = await getQuote(created.id);
      if (httpStatus !== 200) { result.status = 'ERROR'; result.error = `GET HTTP ${httpStatus}`; return result; }

      log.info('Asserting...');
      const assertions = scenario.assertFields
        ? verifyFields(subformRow, scenario.expected, scenario.assertFields)
        : verify(subformRow, scenario.expected);
      result.assertions = assertions;
      printAssertions(assertions);
      result.status = assertions.every(a => a.pass) ? 'PASS' : 'FAIL';
      if (scenario.notes) log.warn(`Note: ${scenario.notes}`);
      return result;
    }

    // ════════════════════════════════════════════════════════════════════════
    // DIRECT-MULTIROW
    // ════════════════════════════════════════════════════════════════════════
    if (type === 'direct-multirow') {
      const cleanRows = scenario.rows.map(r => { const c = { ...r }; delete c.Kode_Bom; return c; });
      log.info(`Creating multi-row Quote (${cleanRows.length} rows)...`);
      cleanRows.forEach((r, i) =>
        log.info(`  Row ${i+1}: COGS=${fmt(r.COGS)} Qty=${r.Quantity}${r.Discount_1 ? ` D1=${r.Discount_1}%` : ''}`));

      const created = await createMultiRowQuote(subject, cleanRows);
      result.apiCode = created.apiCode;
      if (created.apiCode !== 'SUCCESS' || !created.id) {
        log.fail(`Create failed. ${created.apiCode} | ${created.message}`);
        result.status = 'ERROR'; result.error = `${created.apiCode} – ${created.message}`;
        return result;
      }
      result.quoteId = created.id;

      log.info(`Waiting ${CONFIG.formulaWaitMs}ms for aggregate calc...`);
      await sleep(CONFIG.formulaWaitMs);

      const { httpStatus, subformRows, quoteFields } = await getQuote(created.id);
      if (httpStatus !== 200) { result.status = 'ERROR'; result.error = `GET HTTP ${httpStatus}`; return result; }

      const subTotal      = Number(quoteFields.Sub_Total) || 0;
      const expected      = computeMultiRowExpected(cleanRows);
      const actualRowsSum = Math.round(
        subformRows.reduce((s, r) => s + (Number(r.Total_Price) || 0), 0) * 100
      ) / 100;

      log.info(`Rows returned: ${subformRows.length}`);
      subformRows.forEach((r, i) =>
        log.info(`  Row ${i+1}: FinalPrice=${fmt(r.Final_Price)}  TotalPrice=${fmt(r.Total_Price)}`));
      log.info(`Sub_Total (quoteFields): ${fmt(subTotal)}`);
      log.info(`Expected  (computed):    ${fmt(expected.Sub_Total)}`);
      log.info(`Σ row.Total_Price:       ${fmt(actualRowsSum)}`);

      const assertions = [
        { field: 'Sub_Total (quote aggregate)',    expected: expected.Sub_Total, actual: subTotal, pass: Math.abs(subTotal - expected.Sub_Total) <= CONFIG.tolerance },
        { field: 'Sub_Total == Σ row.Total_Price', expected: actualRowsSum,      actual: subTotal, pass: Math.abs(subTotal - actualRowsSum)       <= CONFIG.tolerance },
      ];
      result.assertions = assertions;
      printAssertions(assertions);
      result.status = assertions.every(a => a.pass) ? 'PASS' : 'FAIL';
      if (scenario.notes) log.warn(`Note: ${scenario.notes}`);
      return result;
    }

    // ════════════════════════════════════════════════════════════════════════
    // INTEGRATION + INTEGRATION-HEADER
    // Default path. setup dict defines the quote fixture (condition).
    // Formula assertions are the test spec.
    // ════════════════════════════════════════════════════════════════════════

    const setup        = scenario.setup;
    const headerInputs = scenario.headerInputs || {};
    const subformNames = Object.keys(setup);
    const brandLabels  = scenario.brandLabels || {};

    // Log the fixture (condition for this formula test)
    log.info('Condition (quote fixture):');
    subformNames.forEach(sfName => {
      const label = brandLabels[sfName] || sfName;
      log.info(`  ${label}: ${setup[sfName].length} row(s)`);
      setup[sfName].forEach((r, i) =>
        log.info(`    Row ${i+1}: Kode_Bom=${r.Kode_Bom}  Qty=${r.Quantity}`
          + (r.Corporate_Price != null ? `  Corp.Price=${fmt(r.Corporate_Price)}` : '')
          + (r.Discount_1      != null ? `  D1=${r.Discount_1}%`                 : '')
          + (r.Discount_2      != null ? `  D2=${r.Discount_2}%`                 : '')
          + (r.Discount_3      != null ? `  D3=${r.Discount_3}%`                 : '')));
    });

    // ── Step 1: Create ─────────────────────────────────────────────────────
    log.info('Step 1: Creating Quote (all subforms in one POST)...');
    const created = await createMultiBrandQuote(subject, setup, headerInputs);
    result.apiCode = created.apiCode;

    if (created.apiCode !== 'SUCCESS' || !created.id) {
      log.fail(`Create failed. ${created.apiCode} | ${created.message}`);
      log.fail(`Raw: ${JSON.stringify(created.raw)}`);
      result.status = 'ERROR'; result.error = `${created.apiCode} – ${created.message}`;
      return result;
    }
    result.quoteId = created.id;
    log.info(`Quote created. ID: ${created.id}`);

    // ── Step 2: Poll until all subform rows have COGS + MUF ───────────────
    log.info(`Step 2: Polling all subforms (max ${CONFIG.integrationWaitMs/1000}s)...`);
    const rowsBySubform = await multiApi.pollAllSubformsIntegrated(created.id, subformNames);
    multiApi.logIntegrationValues(rowsBySubform, brandLabels);

    // ── Step 3 (twoStep flag): PATCH Corp.Price = actual Price on first row ─
    let twoStepOverrides = {};
    if (scenario.twoStep) {
      const sfName    = subformNames[0];
      const actualRow = (rowsBySubform[sfName] ?? [])[0];
      if (!actualRow?.id) {
        result.status = 'ERROR'; result.error = 'Row id missing for two-step PATCH'; return result;
      }
      const actualPrice = Math.round((Number(actualRow.COGS) / 0.65) * 100) / 100;
      log.info(`Step 3 (two-step): PATCHing ${sfName}[0].Corporate_Price = ${fmt(actualPrice)}...`);
      await patchSubformRow(created.id, actualRow.id, { Corporate_Price: actualPrice });
      await sleep(CONFIG.formulaWaitMs);

      const refetched = await getQuote(created.id);
      if (refetched.httpStatus !== 200) { result.status = 'ERROR'; result.error = `Re-fetch HTTP ${refetched.httpStatus}`; return result; }
      rowsBySubform[sfName] = refetched.quoteFields[sfName] ?? rowsBySubform[sfName];
      twoStepOverrides = { [sfName]: { 0: { Corporate_Price: actualPrice } } };
      log.info(`Corp.Price patched → ${fmt(actualPrice)}. Re-fetched.`);
    }

    // ── Step 4 (integration-final): wait for Final Grand Total formulas ────
    let quoteFieldsForFinal = null;
    if (type === 'integration-final') {
      log.info(`Step 4 (final): Waiting ${CONFIG.headerFormulaWaitMs}ms for Final Grand Total...`);
      await sleep(CONFIG.headerFormulaWaitMs);
      const refetched = await getQuote(created.id);
      if (refetched.httpStatus !== 200) { result.status = 'ERROR'; result.error = `Final re-fetch HTTP ${refetched.httpStatus}`; return result; }
      quoteFieldsForFinal = refetched.quoteFields;
      log.info(`Final_Total_Price: ${fmt(quoteFieldsForFinal.Final_Total_Price)}`);
    }

    // ── Step 5: Assert ─────────────────────────────────────────────────────
    log.info('Asserting formula fields...');
    const allAssertions = [];

    if (type === 'integration-final') {
      // Assert Final Grand Total section fields (global across all brand sections)
      // Collect all row computed values from all subforms
      const allRowResults = [];
      for (const sfName of subformNames) {
        (rowsBySubform[sfName] ?? []).forEach((actualRow, idx) => {
          const inputRow = setup[sfName][idx] ?? {};
          const merged   = { ...inputRow, ...twoStepOverrides[sfName]?.[idx] ?? {} };
          const cogs     = Number(actualRow.COGS) || 0;
          const setGpr   = merged.Set_GPR != null ? Number(merged.Set_GPR) : 0.65;
          const corpP    = merged.Corporate_Price != null ? Number(merged.Corporate_Price) : null;
          const d1       = merged.Discount_1 != null ? Number(merged.Discount_1)/100 : 0;
          const d2       = merged.Discount_2 != null ? Number(merged.Discount_2)/100 : 0;
          const d3       = merged.Discount_3 != null ? Number(merged.Discount_3)/100 : 0;
          const qty      = Number(merged.Quantity) || 1;
          const price    = Math.round(cogs/setGpr*100)/100;
          const pq       = corpP !== null ? corpP : price;
          const fp       = Math.round(pq*(1-d1)*(1-d2)*(1-d3)*100)/100;
          const tc       = Math.round(cogs*qty*100)/100;
          const tp       = Math.round(fp*qty*100)/100;
          allRowResults.push({ Total_Price: tp, Total_COGS: tc, Net_Income: Math.round((tp-tc)*100)/100 });
        });
      }

      const addFee    = scenario.additionalFee || {};
      let expectedMap = computeFinalGrandTotal(allRowResults, addFee);
      if (scenario.assertOverride) Object.assign(expectedMap, scenario.assertOverride);

      log.info('Expected (Final Grand Total):');
      Object.entries(expectedMap).filter(([k]) => !k.startsWith('_'))
        .forEach(([k, v]) => log.info(`  ${k.padEnd(28)} → ${fmt(v)}`));

      const assertions = scenario.assertFields
        ? verifyFields(quoteFieldsForFinal, expectedMap, scenario.assertFields)
        : verify(quoteFieldsForFinal, expectedMap);
      allAssertions.push(...assertions);
      printAssertions(assertions);

    } else {
      // Assert row-level formula fields per subform per row
      for (const sfName of subformNames) {
        const sfRows   = rowsBySubform[sfName] ?? [];
        const sfInputs = setup[sfName] ?? [];
        const label    = brandLabels[sfName] || sfName;
        log.info(`\n  ${label}:`);

        sfRows.forEach((actualRow, idx) => {
          const inputRow  = sfInputs[idx] ?? {};
          const override  = twoStepOverrides[sfName]?.[idx] ?? {};
          let expected    = computeDynamicExpected(actualRow, inputRow, override);
          if (scenario.assertOverride) Object.assign(expected, scenario.assertOverride);

          const assertable = scenario.assertFields
            || Object.keys(expected).filter(k => !k.startsWith('_'));
          const assertions = verifyFields(actualRow, expected, assertable);

          log.info(`    Row ${idx+1} (COGS=${fmt(actualRow.COGS)}):`);
          assertions.forEach(a => {
            const line = `      ${a.field.padEnd(22)} expected: ${fmt(a.expected).padStart(14)}  actual: ${fmt(a.actual).padStart(14)}`;
            a.pass ? log.pass(line) : log.fail(line);
          });
          allAssertions.push(...assertions.map(a => ({ ...a, subform: sfName, row: idx + 1 })));
        });
      }
    }

    // Collect COGS values for summary log
    result.actualCOGS = Object.fromEntries(
      subformNames.map(sf => [sf, (rowsBySubform[sf] ?? []).map(r => r.COGS)])
    );
    result.assertions = allAssertions;
    result.status     = scenario.isBugDoc
      ? 'PASS (BUG DOCUMENTED)'
      : (allAssertions.every(a => a.pass) ? 'PASS' : 'FAIL');

    if (scenario.notes) log.warn(`Note: ${scenario.notes}`);

  } catch (err) {
    log.fail(`Exception: ${err.message}`);
    result.status = 'ERROR';
    result.error  = err.message;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// runAll
// ─────────────────────────────────────────────────────────────────────────────
async function runAll(scenarios, api, { logFile, bom, period }) {
  const multiApi = createMultiApi(CONFIG, log, api);

  const toRun = scenarios.filter(s => {
    const t = s.type ?? 'integration';
    if (CLI_MODE === 'all')    return true;
    if (CLI_MODE === 'direct') return t === 'direct' || t === 'direct-multirow';
    return t !== 'direct' && t !== 'direct-multirow';  // integration, integration-final
  });

  if (!toRun.length) { console.log(`\n  No scenarios match mode "${CLI_MODE}"\n`); return; }
  log.info(`Running ${toRun.length} scenario(s)  [mode: ${CLI_MODE}]\n`);

  const results = [];
  let passed = 0, failed = 0, errors = 0;

  for (const scenario of toRun) {
    const result = await runScenario(scenario, api, multiApi);
    results.push(result);
    if (result.status.startsWith('PASS')) passed++;
    else if (result.status === 'FAIL')    failed++;
    else                                  errors++;
    await sleep(CONFIG.delayMs);
  }

  console.log('\n' + '═'.repeat(72));
  console.log(`${C.bold}  HASIL UAT${C.reset}`);
  console.log('═'.repeat(72));
  for (const r of results) {
    const icon   = r.status.startsWith('PASS') ? `${C.green}LULUS${C.reset}` :
                   r.status === 'FAIL'         ? `${C.red}GAGAL${C.reset}`   :
                                                 `${C.yellow}ERROR${C.reset}`;
    const bugTag = r.status.includes('BUG')    ? ` ${C.magenta}[BUG]${C.reset}` : '';
    const qid    = r.quoteId != null ? ` [ID: ${r.quoteId}]` : '';
    console.log(`  ${icon}  ${r.id.padEnd(12)} ${r.name.padEnd(50)}${bugTag}${C.grey}${qid}${C.reset}`);
  }
  console.log('\n' + '─'.repeat(72));
  console.log(`  Total: ${toRun.length}  |  ${C.green}Lulus: ${passed}${C.reset}  |  ${C.red}Gagal: ${failed}${C.reset}  |  ${C.yellow}Error: ${errors}${C.reset}`);
  console.log('─'.repeat(72) + '\n');

  await fs.writeFile(logFile, JSON.stringify({
    runAt: new Date().toISOString(), cliMode: CLI_MODE, bom, period,
    summary: { total: toRun.length, passed, failed, errors }, results,
  }, null, 2));
  console.log(`  Log: ${logFile}\n`);
  process.exit(failed > 0 || errors > 0 ? 1 : 0);
}

module.exports = { runAll, runScenario };