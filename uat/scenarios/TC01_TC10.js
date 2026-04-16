'use strict';

/**
 * TC-F-01 to TC-F-10 — Price, Price_Quote, Final_Price
 *
 * Formula spec (what is being tested).
 * Setup (condition = which real products create the integration context).
 *
 * Key formula reminder (v2):
 *   Price       = COGS / Set_GPR   (Set_GPR = sales input, e.g. 0.65 for 35% margin)
 *   Price_Quote = Corp.Price if filled, else Price
 *   Final_Price = Price_Quote × (1-D1%) × (1-D2%) × (1-D3%)  [cascade, not sum]
 */

const { REAL_DATE }                            = require('../lib/config');
const { PRODUCTS, BRAND_SUBFORM, BRAND_LABEL } = require('../lib/products');

const QUOTED_ITEMS = BRAND_SUBFORM.QUOTED_ITEMS_1;
const QUOTED_ITEMS_2 = BRAND_SUBFORM.QUOTED_ITEMS_2;

const LABELS = {
  [QUOTED_ITEMS]: BRAND_LABEL.KING_KOIL,
  [QUOTED_ITEMS_2]: BRAND_LABEL.SERTA,
};

const SCENARIOS = [

  // ── PRICE formula: COGS / Set_GPR ────────────────────────────────────────

  // Spec:  Price = COGS / 0.65  (standard 35% GPR target)
  // Cond:  KK Duvet Cover 180 + Flat Sheet 210; Serta Pillow Case 53
  {
    id: 'TC-F-01',
    name: 'Price = COGS/Set_GPR – Set_GPR=0.65 (target GPR 35%)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE,      Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price', 'Price_Quote', 'Final_Price', 'GPR_1', 'GPR'],
    notes: 'Set_GPR=0.65 → Price=COGS/0.65. GPR_1 di QUOTED_ITEMS, GPR di QUOTED_ITEMS_2. Harus tepat 35%.',
  },

  // Spec:  Price = COGS / 0.60  (40% GPR target — different product line margin)
  // Cond:  KK Mattress Protector + Serta Mattress Protector 152
  {
    id: 'TC-F-02',
    name: 'Price = COGS/Set_GPR – Set_GPR=0.60 (target GPR 40%)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.MATTRESS_PROTECTOR,      Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.60 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.MATTRESS_PROTECTOR,      Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.60 },
      ],
    },
    brandLabels:  LABELS,
    assert: (actual, expected, output) => {
      // Both subforms have the same COGS and Set_GPR=0.60, so spot-check one row from each
      const kkActual = actual[QUOTED_ITEMS][0];
      const kkExp    = expected[QUOTED_ITEMS][0];
      const srActual = actual[QUOTED_ITEMS_2][0];
      const srExp    = expected[QUOTED_ITEMS_2][0];
      console.log(JSON.stringify(actual, null, 2));

      output.assert('KK  Price',  kkActual.Price, kkExp.Price);
      output.assert('KK  GPR_1',  kkActual.GPR_1, kkExp.GPR_1);
      output.assert('Serta Price', srActual.Price, srExp.Price);
      output.assert('Serta GPR',   srActual.GPR,   srExp.GPR);
    },
    notes: 'Set_GPR=0.60 → Price=COGS/0.60. GPR_1 di QUOTED_ITEMS, GPR di QUOTED_ITEMS_2. ~40% per baris.',
  },

  // Spec:  Price = COGS / 1.0  (jual modal — zero margin, GPR=0)
  // Cond:  KK Bolster Case only (single brand)
  {
    id: 'TC-F-03',
    name: 'Price = COGS/Set_GPR – Set_GPR=1.0 (jual modal, GPR=0%)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 1.0 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price', 'Total_Net_Income', 'GPR_1'],
    notes: 'Set_GPR=1.0 → Price=COGS → GPR_1=0% (QUOTED_ITEMS), Net_Income=0. Edge case produk tanpa markup.',
  },

  // Spec:  COGS = 0 → Price = 0 (no division-by-zero since numerator is 0)
  {
    id: 'TC-F-04', type: 'direct',
    name: 'Price – COGS=0 (produk gratis/sample, no div-by-zero)',
    input:    { COGS: 0, Quantity: 10, Set_GPR: 0.65, Tahun_Bulan_yyyy_mm: REAL_DATE },
    expected: { Price: 0, Price_Quote: 0, Final_Price: 0, Total_Price: 0, Total_COGS: 0 },
    notes: '0 / 0.65 = 0. Tidak ada division-by-zero (0 di numerator).',
  },

  // Spec:  Zoho rejects negative COGS
  {
    id: 'TC-F-05', type: 'direct', expectError: true,
    name: 'Price – COGS negatif (Zoho harus menolak input ini)',
    input:    { COGS: -5000, Quantity: 1, Set_GPR: 0.65, Tahun_Bulan_yyyy_mm: REAL_DATE },
    expected: {},
    notes: 'Currency field tidak boleh negatif. Jika Zoho menerima → catat sebagai BUG.',
  },

  // ── PRICE_QUOTE: Corp.Price override ─────────────────────────────────────

  // Spec:  Corp.Price empty → Price_Quote = Price (default path)
  // Cond:  KK full bed set 2 sizes + Serta flat sheet
  {
    id: 'TC-F-06',
    name: 'Price_Quote – Corp.Price kosong → Price_Quote = Price (default)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 60,  Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 200, Set_GPR: 0.65 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET,      Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET,      Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 60,  Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price', 'Price_Quote'],
    notes: 'Path default tanpa Corp.Price. Price_Quote = Price di semua baris.',
  },

  // Spec:  Corp.Price overrides Price_Quote on KK; Serta rows use standard Price
  {
    id: 'TC-F-07',
    name: 'Price_Quote – Corp.Price override pada KK, Serta tetap pakai Price',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Corporate_Price: 175000 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Corporate_Price: 85000  },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Corporate_Price: 45000  },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET,     Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE,     Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price', 'Price_Quote', 'Final_Price'],
    notes: 'KK: Price_Quote = Corp.Price. Serta: Price_Quote = Price (COGS/0.65). Isolasi antar brand.',
  },

  // Spec:  Corp.Price = 0 explicit → Price_Quote = 0 (IsEmpty(0) = FALSE in Zoho)
  {
    id: 'TC-F-08',
    name: 'Price_Quote – Corp.Price=0 eksplisit → Price_Quote=0 (IsEmpty guard)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_INSERT, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 10, Set_GPR: 0.65, Corporate_Price: 0 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 10, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price', 'Price_Quote', 'Final_Price', 'Total_Price'],
    notes: '⚠ IsEmpty(0)=FALSE → Corp.Price=0 digunakan → Price_Quote=0, Total_Price=0. Intended untuk sample?',
  },

  // ── FINAL_PRICE: cascade discount ─────────────────────────────────────────

  // Spec:  Final_Price uses cascade multiplication D1×D2×D3, NOT sum
  // Cond:  KK 3 Duvet Cover sizes + Serta 2 Pillow Case sizes, all with 3-level discount
  {
    id: 'TC-F-09',
    name: 'Final_Price – 3 diskon cascade (bukan dijumlah), 2 brand',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65, Discount_1: 5, Discount_2: 2, Discount_3: 1 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 60,  Set_GPR: 0.65, Discount_1: 5, Discount_2: 2, Discount_3: 1 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 40,  Set_GPR: 0.65, Discount_1: 5, Discount_2: 2, Discount_3: 1 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 200, Set_GPR: 0.65, Discount_1: 3, Discount_2: 2 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65, Discount_1: 3, Discount_2: 2 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price_Quote', 'Final_Price', 'Total_Price'],
    notes: (
      'KK: Final_Price = Price×0.95×0.98×0.99 (cascade 5+2+1%). ' +
      'Serta: Final_Price = Price×0.97×0.98 (cascade 3+2%). ' +
      'BUKAN dijumlah menjadi 8% atau 5%.'
    ),
  },

  // Spec:  Disc 1 = 100% → Final_Price = 0; GPR div-by-zero guard → GPR = 0
  {
    id: 'TC-F-10',
    name: 'Final_Price – Disc 1=100% → Final_Price=0, GPR div-by-zero guard aktif',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50, Set_GPR: 0.65, Discount_1: 100 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Final_Price', 'Total_Price', 'GPR_1', 'GPR'],
    notes: (
      'KK: Final_Price=0, Total_Price=0, GPR_1=0 (QUOTED_ITEMS, guard aktif). ' +
      'Serta: GPR=35% (QUOTED_ITEMS_2, normal). Verifikasi guard tidak error.'
    ),
  },
];

module.exports = SCENARIOS;