'use strict';

/**
 * TC-F-11 to TC-F-29 — Final_Price edge cases, Total_COGS, Total_Price, Net_Income, GPR
 *
 * Formula reminder (v2):
 *   Total_COGS  = COGS × Qty  (no row-level shipping)
 *   Total_Price = Final_Price × Qty
 *   Net_Income  = Total_Price - Total_COGS
 *   GPR(%)      = if Total_Price≠0 → (Net_Income/Total_Price)×100, else 0
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

  // ── FINAL_PRICE EDGE CASES ────────────────────────────────────────────────

  // Spec:  Single discount only; Disc 2 & 3 null = 0%
  {
    id: 'TC-F-11',
    name: 'Final_Price – hanya Disc 1=5%, Disc 2 & 3 null diperlakukan 0%',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 80,  Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50,  Set_GPR: 0.65, Discount_1: 5 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Final_Price', 'Total_Price'],
    notes: 'KK: Final_Price = Price×0.95. Disc null ≠ error, diperlakukan 0%.',
  },

  // Spec:  No discounts → Final_Price = Price_Quote exactly
  {
    id: 'TC-F-12',
    name: 'Final_Price – semua diskon kosong → Final_Price = Price (3 flat sheet sizes)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 200, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 60,  Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price', 'Final_Price'],
    notes: 'Tanpa diskon: Final_Price = Price = COGS/0.65 tepat. Referensi baseline.',
  },

  // Spec:  D1=50 D2=50 D3=50 cascade → 12.5% of Price (not negative from 150% sum)
  {
    id: 'TC-F-13',
    name: 'Final_Price – D1=50 D2=50 D3=50 (cascade 12.5%, tidak negatif)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 10, Set_GPR: 0.65, Discount_1: 50, Discount_2: 50, Discount_3: 50 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 10, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Final_Price', 'GPR_1', 'GPR'],
    notes: 'KK: Final_Price = Price×0.5×0.5×0.5 = Price×0.125 (GPR_1). Serta: GPR normal. Cascade tidak pernah menghasilkan harga negatif.',
  },

  // Spec:  Decimal discount 2.5% accepted correctly
  {
    id: 'TC-F-14',
    name: 'Final_Price – diskon desimal 2.5% (KK) dan 3.5% (Serta)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 2.5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 2.5 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 3.5 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 3.5 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Final_Price', 'Total_Price'],
    notes: 'KK: ×0.975. Serta: ×0.965. Sistem menerima desimal. Periksa konsistensi separator koma/titik.',
  },

  // Spec:  Corp.Price + cascade discount: discount applies to Corp.Price, not COGS/Set_GPR
  {
    id: 'TC-F-15',
    name: 'Final_Price – Corp.Price + Disc 1=5% (diskon dari Corp.Price, bukan Price)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Corporate_Price: 175000, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 80,  Set_GPR: 0.65, Corporate_Price: 210000, Discount_1: 5 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price', 'Price_Quote', 'Final_Price'],
    notes: 'KK: Final_Price = Corp.Price×0.95. Serta: Final_Price = Price×0.95. Basis diskon mengikuti Price_Quote.',
  },

  // Spec:  Negative discount rejected by Zoho
  {
    id: 'TC-F-16', type: 'direct', expectError: true,
    name: 'Final_Price – Disc 1 negatif (Zoho harus menolak)',
    input:    { COGS: 50000, Quantity: 1, Set_GPR: 0.65, Discount_1: -5, Tahun_Bulan_yyyy_mm: REAL_DATE },
    expected: {},
    notes: 'Diskon negatif tidak valid. Jika Zoho menerima → Final_Price naik (anomali) → BUG.',
  },

  // Spec:  Corp.Price below COGS → GPR negative; adjacent brand rows unaffected
  {
    id: 'TC-F-17',
    name: 'Final_Price – Corp.Price << COGS → GPR negatif (jual rugi), Serta normal',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Corporate_Price: 1 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price_Quote', 'Final_Price', 'Total_Net_Income', 'GPR_1', 'GPR'],
    notes: '⚠ KK: GPR_1 sangat negatif (QUOTED_ITEMS). Serta: GPR normal (QUOTED_ITEMS_2). Catat apakah sistem memperingatkan baris KK.',
  },

  // Spec:  Different discount levels per brand in same quote — no cross-contamination
  {
    id: 'TC-F-18',
    name: 'Final_Price – diskon berbeda per brand, independen antar baris',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 3, Discount_2: 2 },
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 3, Discount_2: 2 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Final_Price', 'GPR_1', 'GPR'],
    notes: 'KK: ×0.95 (GPR_1 di QUOTED_ITEMS). Serta: ×0.97×0.98 (GPR di QUOTED_ITEMS_2). Diskon satu brand tidak mempengaruhi baris brand lain.',
  },

  // ── TOTAL_COGS: COGS × Qty ────────────────────────────────────────────────

  // Spec:  Total_COGS = COGS × Qty (no row-level shipping in v2)
  {
    id: 'TC-F-19',
    name: 'Total_COGS = COGS × Qty – verifikasi formula sederhana (tanpa shipping per baris)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Total_COGS', 'Total_Price'],
    notes: 'Total_COGS = COGS×Qty per baris. Shipping dihapus dari row-level di v2.',
  },

  // Spec:  Qty=1 — verifikasi no double-rounding on single unit
  {
    id: 'TC-F-20',
    name: 'Total_COGS – Qty=1 (single unit, no rounding accumulation)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 1, Set_GPR: 0.65 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 1, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Total_COGS', 'Total_Price'],
    notes: 'Qty=1 → Total_COGS = COGS persis. Verifikasi tidak ada rounding error.',
  },

  // Spec:  Large Qty (1000) — hotel-scale order
  {
    id: 'TC-F-21',
    name: 'Total_COGS – Qty=1000 (order hotel skala penuh)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 1000, Set_GPR: 0.65 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET,      Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 1000, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Total_COGS', 'Total_Price'],
    notes: 'Uji nilai besar untuk properti hotel 500+ kamar. Total_COGS = COGS×1000.',
  },

  // ── TOTAL_PRICE & NET_INCOME ──────────────────────────────────────────────

  // Spec:  Total_Price precision with decimal discounts
  {
    id: 'TC-F-22',
    name: 'Total_Price – presisi pembulatan dengan diskon desimal 2.5%+2%',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 2.5, Discount_2: 2 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 80,  Set_GPR: 0.65, Discount_1: 2.5, Discount_2: 2 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 3.5 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Final_Price', 'Total_Price'],
    notes: 'Verifikasi tidak ada rounding error akumulatif saat Final_Price memiliki banyak desimal.',
  },

  // Spec:  Net_Income always positive when no Corp.Price and no discount (GPR = Set_GPR margin)
  {
    id: 'TC-F-23',
    name: 'Total_Net_Income – positif (margin normal, tanpa Corp.Price override)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.DUVET_COVER,        Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Total_Net_Income', 'GPR_1', 'GPR'],
    notes: 'Net_Income positif di semua baris. GPR_1 di QUOTED_ITEMS, GPR di QUOTED_ITEMS_2 (35% jika Set_GPR=0.65).',
  },

  // Spec:  Net_Income negative when Corp.Price < COGS; other brand unaffected
  {
    id: 'TC-F-24',
    name: 'Total_Net_Income – negatif (Corp.Price < COGS, jual rugi)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_INSERT, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65, Corporate_Price: 1 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Total_Net_Income', 'GPR_1', 'GPR'],
    notes: '⚠ KK: Net_Income < 0, GPR_1 << 0 (QUOTED_ITEMS). Serta: GPR normal. Catat warning sistem untuk baris KK.',
  },

  // ── GPR EDGE CASES ────────────────────────────────────────────────────────

  // Spec:  GPR = 0 (jual modal, Set_GPR=1.0)
  {
    id: 'TC-F-25',
    name: 'GPR(%) = 0% – Set_GPR=1.0 (Price=COGS, tidak ada margin)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50, Set_GPR: 1.0 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['GPR_1', 'GPR', 'Total_Net_Income'],
    notes: 'KK Set_GPR=1.0 → Price=COGS → GPR_1=0% (QUOTED_ITEMS), Net_Income=0. Serta: GPR=35% (QUOTED_ITEMS_2).',
  },

  // Spec:  GPR div-by-zero guard when Disc=100% → Total_Price=0
  {
    id: 'TC-F-26',
    name: 'GPR(%) – Disc=100% → Total_Price=0 → div-by-zero guard → GPR=0',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 30, Set_GPR: 0.65, Discount_1: 100 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET,     Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 30, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Final_Price', 'Total_Price', 'GPR_1', 'GPR'],
    notes: 'KK: guard aktif → GPR_1=0 (QUOTED_ITEMS, tidak error). Serta: GPR=35% (QUOTED_ITEMS_2, normal).',
  },

  // Spec:  GPR below 35% due to discount — system response (warn vs block?)
  {
    id: 'TC-F-27',
    name: 'GPR(%) – di bawah 35% karena diskon (sistem harus merespons)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50, Set_GPR: 0.65, Discount_1: 50 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['GPR_1', 'GPR'],
    notes: '⚠ KK D1=50% → GPR_1 jauh < 35% (QUOTED_ITEMS). Serta: GPR normal (QUOTED_ITEMS_2). KONFIRMASI: warn atau hard-block?',
  },

  // ── REALISTIC FULL HOTEL SETS ─────────────────────────────────────────────

  // Spec:  Full KK bed linen set (all 3 Duvet Cover sizes + all 3 Flat Sheet sizes)
  {
    id: 'TC-F-28',
    name: 'Full KK bed linen set – semua ukuran Duvet Cover + Flat Sheet (realistic hotel)',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 60,  Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 40,  Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 60,  Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 40,  Set_GPR: 0.65, Discount_1: 5 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price', 'Final_Price', 'Total_COGS', 'Total_Price', 'GPR_1'],
    notes: 'Full hotel bed set KK saja (QUOTED_ITEMS → GPR_1). 6 baris, Disc=5%. Verifikasi semua rows terisi COGS dari integrasi.',
  },

  // Spec:  KK + Serta full package realistic order (Cityloog-scale quantities)
  {
    id: 'TC-F-29',
    name: 'KK + Serta full package – kuantitas realistis hotel 131 kamar',
    setup: {
      [QUOTED_ITEMS]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
      ],
      [QUOTED_ITEMS_2]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:  LABELS,
    assertFields: ['Price', 'Final_Price', 'Total_COGS', 'Total_Price', 'Total_Net_Income', 'GPR_1', 'GPR'],
    notes: 'Skenario hotel 131 kamar. KK Disc=5% (GPR_1 di QUOTED_ITEMS), Serta tanpa diskon (GPR di QUOTED_ITEMS_2). 8 baris total.',
  },
];

module.exports = SCENARIOS;