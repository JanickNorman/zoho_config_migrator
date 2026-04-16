'use strict';

const REAL_BOM  = 'PKS.FTD.200X200+35.148S-1';
const REAL_DATE = '2026-04';

const CONFIG = {
  token:                   null,
  baseUrl:                 'https://www.zohoapis.com/crm/v3',
  subform:                 'Quoted_Items',
  delayMs:                 1500,    // pause between scenarios (rate-limit safety)
  formulaWaitMs:           3000,    // wait after POST/PATCH for Zoho formula calc
  headerFormulaWaitMs:     4000,    // extra wait for header-level formulas (TC30-52)
  integrationWaitMs:       20000,   // max wait for DAP API callback
  integrationPollMs:       2500,    // polling interval
  tolerance:               0.02,    // Rp floating-point comparison tolerance
  placeholderProduct:      null,    // { id, name } — filled at startup

  // Polling ends when ALL of these are non-null and non-zero
  integrationSignalFields: ['COGS', 'MUF'],
};

// --mode=integration | direct | all  (default: integration)
const CLI_MODE = (() => {
  const a = process.argv.find(x => x.startsWith('--mode='));
  return a ? a.split('=')[1] : 'integration';
})();

module.exports = { REAL_BOM, REAL_DATE, CONFIG, CLI_MODE };
