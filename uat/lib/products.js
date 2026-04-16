'use strict';

/**
 * Product catalog — Kode BOM for UAT across 3 brands.
 *
 * REPLACE each string value with the actual Kode_Bom from your Zoho/DAP environment.
 * The keys are descriptive aliases used only inside test scenarios.
 *
 * Product hierarchy:
 *   BEDDING / BED LINEN
 *     → Duvet Cover, Flat Sheet, Bolster Case, Pillow Case, Pillow Protector
 *   BEDDING / BEDDING ACCESSORIES
 *     → Duvet Insert, Mattress Protector, Pillow Protector (Accessories)
 *   MATRAS
 *     → Divan, Headboard
 *
 * Subform mapping (one subform per brand per quote):
 *   Quoted_Items    → King Koil
 *   Quoted_Items_2  → Serta
 *   Quoted_Items_3  → Florence
 */

const PRODUCTS = {

  // ── KING KOIL ─────────────────────────────────────────────────────────────
  KING_KOIL: {
    // BEDDING - BED LINEN
    DUVET_COVER:      'PKS.DCF.180X230.145',     // ← replace with actual Kode_Bom
    FLAT_SHEET:       'PKS.DCF.180X230.145',     // ← replace
    BOLSTER_CASE:     'PKS.DCF.180X230.145',     // ← replace
    PILLOW_CASE:      'PKS.DCF.180X230.145',     // ← replace
    PILLOW_PROTECTOR: 'PKS.DCF.180X230.145',     // ← replace

    // BEDDING - BEDDING ACCESSORIES
    DUVET_INSERT:          'PKS.DCF.180X230.145',  // ← replace
    MATTRESS_PROTECTOR:    'PKS.DCF.180X230.145',  // ← replace
    PILLOW_PROTECTOR_ACC:  'PKS.DCF.180X230.145',  // ← replace (accessories variant)
  },

  // ── SERTA ─────────────────────────────────────────────────────────────────
  SERTA: {
    // BEDDING - BED LINEN
    DUVET_COVER:      'PSS.PCS.62X92.463-1 ',     // ← replace
    FLAT_SHEET:       'PSS.PCS.62X92.463-1 ',     // ← replace
    BOLSTER_CASE:     'PSS.PCS.62X92.463-1 ',     // ← replace
    PILLOW_CASE:      'PSS.PCS.62X92.463-1 ',     // ← replace
    PILLOW_PROTECTOR: 'PSS.PCS.62X92.463-1 ',     // ← replace

    // BEDDING - BEDDING ACCESSORIES
    DUVET_INSERT:          'PSS.PCS.62X92.463-1 ',  // ← replace
    MATTRESS_PROTECTOR:    'PSS.PCS.62X92.463-1 ',  // ← replace
    PILLOW_PROTECTOR_ACC:  'PSS.PCS.62X92.463-1 ',  // ← replace
  },

  // ── FLORENCE ──────────────────────────────────────────────────────────────
  FLORENCE: {
    // BEDDING - BED LINEN
    DUVET_COVER:      'PSS.PCS.62X92.463-1 ',     // ← replace
    FLAT_SHEET:       'PSS.PCS.62X92.463-1 ',     // ← replace
    BOLSTER_CASE:     'PSS.PCS.62X92.463-1 ',     // ← replace
    PILLOW_CASE:      'PSS.PCS.62X92.463-1 ',     // ← replace
    PILLOW_PROTECTOR: 'PSS.PCS.62X92.463-1 ',     // ← replace

    // BEDDING - BEDDING ACCESSORIES
    DUVET_INSERT:          'PSS.PCS.62X92.463-1 ',  // ← replace
    MATTRESS_PROTECTOR:    'PSS.PCS.62X92.463-1 ',  // ← replace
    PILLOW_PROTECTOR_ACC:  'PSS.PCS.62X92.463-1 ',  // ← replace

    // MATRAS
    DIVAN:      'PSS.PCS.62X92.463-1 ',   // ← replace
    HEADBOARD:  'PSS.PCS.62X92.463-1 ',   // ← replace
  },
};

// Subform ↔ Brand mapping (matches layout API subform names)
const BRAND_SUBFORM = {
  QUOTED_ITEMS_1: 'Quoted_Items',
  QUOTED_ITEMS_2: 'Quoted_Items_2',
  QUOTED_ITEMS_3: 'Quoted_Items_3',
};

// Human-readable brand labels (used in Quote Subject and logs)
const BRAND_LABEL = {
  KING_KOIL: 'King Koil',
  SERTA:     'Serta',
  FLORENCE:  'Florence',
};

module.exports = { PRODUCTS, BRAND_SUBFORM, BRAND_LABEL };