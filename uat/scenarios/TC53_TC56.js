'use strict';

/**
 * TC-F-50 to TC-F-56 — Sub_Total SUM aggregate (direct-multirow)
 *
 * type: 'direct-multirow'
 *   COGS injected directly. No Kode_Bom → integration does NOT fire.
 *   Tests that Zoho's SUM aggregate is correct across multiple rows.
 *   Uses Set_GPR to compute expected Price and GPR.
 */

const { REAL_DATE } = require('../lib/config');

const SCENARIOS = [

  // Spec:  Sub_Total = Σ(Total_Price per row), 3 rows with different COGS and Set_GPR
  {
    id: 'TC-F-50', type: 'direct-multirow',
    name: 'Sub_Total SUM – 3 baris, COGS berbeda, Set_GPR berbeda',
    rows: [
      { COGS: 15000, Set_GPR: 0.65, Quantity: 131, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 22000, Set_GPR: 0.65, Quantity: 262, Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 35000, Set_GPR: 0.60, Quantity: 100, Tahun_Bulan_yyyy_mm: REAL_DATE },
    ],
    notes: 'Sub_Total = Σ(Final_Price×Qty per baris). Baris ketiga Set_GPR=0.60 (40% margin target).',
  },

  // Spec:  Sub_Total handles extreme value range without floating-point error
  {
    id: 'TC-F-51', type: 'direct-multirow',
    name: 'Sub_Total SUM – nilai sangat tinggi vs sangat rendah (floating-point safety)',
    rows: [
      { COGS: 500000, Set_GPR: 0.65, Quantity: 131, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 1500,   Set_GPR: 0.65, Quantity: 262, Tahun_Bulan_yyyy_mm: REAL_DATE },
    ],
    notes: 'COGS berbeda 300× lipat. Verifikasi tidak ada floating-point error pada SUM.',
  },

  // Spec:  Row with Qty=0 contributes nothing to Sub_Total
  {
    id: 'TC-F-52', type: 'direct-multirow',
    name: 'Sub_Total SUM – Qty=0 di satu baris (tidak berkontribusi ke aggregate)',
    rows: [
      { COGS: 15000, Set_GPR: 0.65, Quantity: 131, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 22000, Set_GPR: 0.65, Quantity: 0,   Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 35000, Set_GPR: 0.65, Quantity: 50,  Tahun_Bulan_yyyy_mm: REAL_DATE },
    ],
    notes: 'Baris Qty=0 → Total_Price=0 → tidak menambah Sub_Total. Tidak ada error formula.',
  },

  // Spec:  Corp.Price on one row changes only that row's contribution to Sub_Total
  {
    id: 'TC-F-53', type: 'direct-multirow',
    name: 'Sub_Total SUM – Corp.Price pada satu baris, baris lain pakai Price normal',
    rows: [
      { COGS: 15000, Set_GPR: 0.65, Quantity: 131, Corporate_Price: 25000, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 22000, Set_GPR: 0.65, Quantity: 131, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 35000, Set_GPR: 0.65, Quantity: 131, Tahun_Bulan_yyyy_mm: REAL_DATE },
    ],
    notes: 'Baris 1: Price_Quote=25.000 (Corp.Price). Baris 2&3: Price_Quote=COGS/0.65. SUM tetap benar.',
  },

  // Spec:  Different discounts per row — each row's discount applies independently
  {
    id: 'TC-F-54', type: 'direct-multirow',
    name: 'Sub_Total SUM – diskon berbeda per baris (independen, tidak bleeding)',
    rows: [
      { COGS: 15000, Set_GPR: 0.65, Quantity: 131, Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 22000, Set_GPR: 0.65, Quantity: 131, Discount_1: 3, Discount_2: 2, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 35000, Set_GPR: 0.65, Quantity: 131, Tahun_Bulan_yyyy_mm: REAL_DATE },
    ],
    notes: 'Baris 1: ×0.95. Baris 2: ×0.97×0.98. Baris 3: tanpa diskon. SUM = Σ individual.',
  },

  // Spec:  6 rows (max realistic single-brand subform) — all KK sizes
  {
    id: 'TC-F-55', type: 'direct-multirow',
    name: 'Sub_Total SUM – 6 baris realistis (semua ukuran KK bed linen)',
    rows: [
      { COGS: 15000, Set_GPR: 0.65, Quantity: 131, Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 17500, Set_GPR: 0.65, Quantity: 80,  Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 19000, Set_GPR: 0.65, Quantity: 50,  Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 11000, Set_GPR: 0.65, Quantity: 262, Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 12000, Set_GPR: 0.65, Quantity: 262, Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 14000, Set_GPR: 0.65, Quantity: 262, Discount_1: 5, Tahun_Bulan_yyyy_mm: REAL_DATE },
    ],
    notes: 'Simulasi 6 produk KK (3 Flat Sheet + 3 Pillow/Bolster). Sub_Total = Σ 6 baris.',
  },

  // Spec:  Qty=0 on ALL rows → Sub_Total = 0 (edge: empty order)
  {
    id: 'TC-F-56', type: 'direct-multirow',
    name: 'Sub_Total SUM – semua Qty=0 (order kosong, Sub_Total=0)',
    rows: [
      { COGS: 15000, Set_GPR: 0.65, Quantity: 0, Tahun_Bulan_yyyy_mm: REAL_DATE },
      { COGS: 22000, Set_GPR: 0.65, Quantity: 0, Tahun_Bulan_yyyy_mm: REAL_DATE },
    ],
    notes: 'Edge case: semua baris Qty=0 → Sub_Total=0. Tidak ada error formula. Grand_Total=0.',
  },
];

module.exports = SCENARIOS;