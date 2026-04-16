#!/usr/bin/env node
/**
 * DAP UAT Formula Test Runner — Entry Point
 *
 * Usage:
 *   node run.js --scenarios=TC01_TC10
 *   node run.js --scenarios=TC11_TC29  --mode=direct
 *   node run.js --scenarios=TC30_TC52
 *   node run.js --scenarios=TC53_TC56  --mode=direct
 *   node run.js --scenarios=TC_MultiBrand
 *
 * --scenarios  : scenario file to load from ./scenarios/ (default: TC01_TC10)
 * --mode       : integration | direct | all  (default: integration)
 *
 * Before running TC_MultiBrand:
 *   Replace placeholder Kode_Bom values in lib/products.js with real codes
 *   from your Zoho/DAP environment.
 */
'use strict';

require('dotenv').config();

const { CONFIG, REAL_BOM, REAL_DATE } = require('./lib/config');
const { C, log }                      = require('./lib/logger');
const { getAccessToken }              = require('./lib/auth');
const createApi                       = require('./lib/api');
const { runAll }                      = require('./lib/runner');

const AVAILABLE = ['TC01_TC10', 'TC11_TC29', 'TC30_TC52', 'TC53_TC56', 'TC_MultiBrand'];

const scenarioArg  = process.argv.find(x => x.startsWith('--scenarios='));
const scenarioFile = scenarioArg ? scenarioArg.split('=')[1] : 'TC01_TC10';

let SCENARIOS;
try {
  SCENARIOS = require(`./scenarios/${scenarioFile}`);
} catch {
  console.error(`\n${C.red}Cannot load scenarios/${scenarioFile}.js${C.reset}`);
  console.error(`Available: ${AVAILABLE.join(' | ')}\n`);
  process.exit(1);
}

async function main() {
  console.log('\n' + '═'.repeat(72));
  console.log(`${C.bold}  DAP UAT  |  Scenarios: ${scenarioFile}${C.reset}`);
  console.log(`  BOM: ${REAL_BOM}  |  Period: ${REAL_DATE}`);
  console.log('═'.repeat(72));

  CONFIG.token              = await getAccessToken(CONFIG, log);
  const api                 = createApi(CONFIG, log);
  CONFIG.placeholderProduct = await api.discoverPlaceholder();

  log.info(`Subform      : ${CONFIG.subform}`);
  log.info(`Formula wait : ${CONFIG.formulaWaitMs / 1000}s  |  Header wait: ${CONFIG.headerFormulaWaitMs / 1000}s  |  Integration wait: ${CONFIG.integrationWaitMs / 1000}s`);

  await runAll(SCENARIOS, api, {
    logFile: `./uat_results_${scenarioFile}.json`,
    bom:     REAL_BOM,
    period:  REAL_DATE,
  });
}

main().catch(err => {
  console.error(`\n${C.red}Fatal: ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});
