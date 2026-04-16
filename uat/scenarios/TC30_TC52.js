'use strict';

/**
 * TC-F-30 to TC-F-49 — Final Grand Total section formulas
 *
 * type: 'integration-final'
 *   setup         → quote fixture (brands/products providing the revenue base)
 *   additionalFee → { Fee_Pct, Discount_Pct, Label, Shipping_Cost, Shipping_Cost_Cust }
 *   assertFields  → which Final Grand Total fields to assert
 *
 * Confirmed formulas (v2):
 *   R_Fee            = Fee_Pct × Final_Total_Price
 *   R_Discount       = Discount_Pct × Final_Total_Price   [amount in Rp, not after-disc price]
 *   Final_COGS       = Σ(Total_COGS rows) + R_Fee + Label + Shipping_Cost
 *   Final_Total_Price= Σ(Total_Price_N all subforms)
 *   Final_PPN_11     = 0.11 × Final_Total_Price
 *   Final_Grand_Total= Final_Total_Price + Final_PPN_11
 *   Final_Grand_Total_Rounded = ROUNDDOWN(Final_Grand_Total, -3)
 *   Total_GPR_Pct    = (Final_Total_Price - Final_COGS) / Final_Total_Price × 100
 */

const { REAL_DATE }                            = require('../lib/config');
const { PRODUCTS, BRAND_SUBFORM, BRAND_LABEL } = require('../lib/products');

const KK = BRAND_SUBFORM.KING_KOIL;
const SE = BRAND_SUBFORM.SERTA;

const LABELS = {
  [KK]: BRAND_LABEL.KING_KOIL,
  [SE]: BRAND_LABEL.SERTA,
};

const SCENARIOS = [

  // ── PER-SUBFORM AGGREGATE ─────────────────────────────────────────────────

  // Spec:  Each subform has its own PPN_11 = 0.11 × Total_Price_N
  {
    id: 'TC-F-30', type: 'integration-final',
    name: 'PPN 11% per subform – KK dan Serta masing-masing independen',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_180, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET_210, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE_53, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: {},
    assertFields:  ['Final_Total_Price', 'Final_PPN_11', 'Final_Grand_Total'],
    notes: 'PPN_11 per subform = 0.11 × Total_Price_N. Final_PPN_11 = 0.11 × Final_Total_Price (global).',
  },

  // Spec:  Grand_Total per subform = Total_Price + PPN_11 (simple, no discount at subform level)
  {
    id: 'TC-F-31', type: 'integration-final',
    name: 'Grand_Total per subform = Total_Price + PPN_11 (formula sederhana v2)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE_50, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE_60, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,   Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: {},
    assertFields:  ['Final_Grand_Total', 'Final_Grand_Total_Rounded'],
    notes: 'Grand_Total = Total_Price + PPN_11. Final_Grand_Total_Rounded = ROUNDDOWN ke satuan ribu.',
  },

  // ── R_FEE ─────────────────────────────────────────────────────────────────

  // Spec:  R_Fee = Fee_Pct × Final_Total_Price (global, not per-brand)
  {
    id: 'TC-F-32', type: 'integration-final',
    name: 'R_Fee = Fee% × Final_Total_Price – Fee=2.5%, basis global semua brand',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_180, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_220, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 80,  Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.DUVET_COVER_190, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET_210,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Fee_Pct: 0.025 },
    assertFields:  ['R_Fee', 'Final_COGS', 'Total_GPR_Pct'],
    notes: 'R_Fee = 2.5% × Final_Total_Price. Masuk ke Final_COGS → menekan Total_GPR_Pct.',
  },

  // Spec:  Fee_Pct = 0 → R_Fee = 0
  {
    id: 'TC-F-33', type: 'integration-final',
    name: 'R_Fee = 0 saat Fee_Pct=0 (tidak ada komisi pihak ketiga)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_INSERT, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Fee_Pct: 0 },
    assertFields:  ['R_Fee', 'Final_COGS'],
    notes: 'R_Fee = 0. Final_COGS = Σ(Total_COGS) saja.',
  },

  // Spec:  Fee_Pct null/omitted → R_Fee = 0 (IsEmpty guard)
  {
    id: 'TC-F-34', type: 'integration-final',
    name: 'R_Fee – Fee_Pct kosong (IsEmpty guard → 0, tidak error)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: {},
    assertFields:  ['R_Fee'],
    notes: '⚠ IsEmpty guard: null Fee_Pct → 0. Tanpa guard → formula crash.',
  },

  // Spec:  Fee_Pct = 1.0 (100%) → R_Fee = Final_Total_Price → Total_GPR very negative
  {
    id: 'TC-F-35', type: 'integration-final',
    name: 'R_Fee – Fee_Pct=100% (edge case ekstrem, Total_GPR sangat negatif)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 50, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Fee_Pct: 1.0 },
    assertFields:  ['R_Fee', 'Final_COGS', 'Total_GPR_Pct'],
    notes: '⚠ R_Fee = 100% × Total → Final_COGS >> Final_Total_Price → Total_GPR_Pct sangat negatif.',
  },

  // ── LABEL ─────────────────────────────────────────────────────────────────

  // Spec:  Label enters Final_COGS directly (total Rp, manual input)
  {
    id: 'TC-F-36', type: 'integration-final',
    name: 'Label masuk ke Final_COGS (Rp total manual, sudah termasuk qty)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_180, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE_50,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Label: 650000 },
    assertFields:  ['Final_COGS', 'Total_GPR_Pct'],
    notes: 'Final_COGS += 650.000 dari Label. Label = total biaya label seluruh order (bukan per pcs × qty).',
  },

  // Spec:  Label = 0 → no impact on Final_COGS
  {
    id: 'TC-F-37', type: 'integration-final',
    name: 'Label = 0 – tidak mempengaruhi Final_COGS',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Label: 0 },
    assertFields:  ['Final_COGS'],
    notes: 'Label=0 → Final_COGS = Σ(Total_COGS) saja.',
  },

  // ── SHIPPING COST ─────────────────────────────────────────────────────────

  // Spec:  Shipping_Cost (lump sum) → enters Final_COGS
  {
    id: 'TC-F-38', type: 'integration-final',
    name: 'Shipping_Cost – lump sum masuk ke Final_COGS (bukan dikali Qty)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_180, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_220, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 80,  Set_GPR: 0.65 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.DUVET_COVER_190, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Shipping_Cost: 1000000 },
    assertFields:  ['Final_COGS', 'Total_GPR_Pct'],
    notes: 'Shipping_Cost = Rp 1.000.000 lump sum. Final_COGS += 1.000.000 (bukan ×Qty).',
  },

  // Spec:  Shipping_Cost_Cust does NOT enter Final_COGS (PDF-only)
  {
    id: 'TC-F-39', type: 'integration-final',
    name: 'Shipping_Cost_Cust – tidak masuk Final_COGS (PDF customer only)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_300, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Shipping_Cost: 0, Shipping_Cost_Cust: 1500000 },
    assertFields:  ['Final_COGS'],
    notes: 'Shipping_Cost_Cust=1.500.000 hanya untuk PDF customer. Final_COGS tidak berubah.',
  },

  // ── R_DISCOUNT ────────────────────────────────────────────────────────────

  // Spec:  R_Discount = Discount_Pct × Final_Total_Price (discount amount in Rp)
  {
    id: 'TC-F-40', type: 'integration-final',
    name: 'R_Discount = Discount% × Final_Total_Price (nilai potongan Rp, bukan after-disc price)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_180, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET_210,     Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR_51, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Discount_Pct: 0.02 },
    assertFields:  ['R_Discount'],
    notes: 'R_Discount = 2% × Final_Total_Price = potongan Rp (bukan harga setelah diskon).',
  },

  // Spec:  Discount_Pct = 0 → R_Discount = 0
  {
    id: 'TC-F-41', type: 'integration-final',
    name: 'R_Discount = 0 saat Discount_Pct=0 (tidak ada diskon tambahan)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_INSERT, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Discount_Pct: 0 },
    assertFields:  ['R_Discount'],
    notes: 'R_Discount = 0.',
  },

  // ── FINAL_COGS & TOTAL_GPR ────────────────────────────────────────────────

  // Spec:  Final_COGS = Σ(COGS rows) + R_Fee + Label + Shipping_Cost
  {
    id: 'TC-F-42', type: 'integration-final',
    name: 'Final_COGS – semua komponen (COGS_agg + R_Fee + Label + Shipping)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_180,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210,   Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE_50,   Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,     Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR_51,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.MATTRESS_PROTECTOR_152, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Fee_Pct: 0.025, Label: 650000, Shipping_Cost: 1000000 },
    assertFields:  ['R_Fee', 'Final_COGS', 'Total_GPR_Pct'],
    notes: 'Final_COGS = Σ(COGS×Qty) + R.Fee + 650.000 + 1.000.000. Semua komponen terjumlah.',
  },

  // Spec:  Final_COGS = Total_COGS only when no additional fees
  {
    id: 'TC-F-43', type: 'integration-final',
    name: 'Final_COGS = Total_COGS murni (tanpa Fee/Label/Shipping)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_220, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 60, Set_GPR: 0.65 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.DUVET_COVER_270, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 60, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: {},
    assertFields:  ['Final_COGS', 'Total_GPR_Pct'],
    notes: 'Baseline tanpa biaya tambahan. Final_COGS = Σ(Total_COGS). Total_GPR_Pct = margin Set_GPR.',
  },

  // Spec:  Total_GPR_Pct drops when fees applied
  {
    id: 'TC-F-44', type: 'integration-final',
    name: 'Total_GPR_Pct – turun karena Fee + Label + Shipping (< margin Set_GPR)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_280, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 80,  Set_GPR: 0.65 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET_210, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.FLAT_SHEET_290, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 80,  Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Fee_Pct: 0.03, Label: 500000, Shipping_Cost: 2000000 },
    assertFields:  ['Final_COGS', 'Total_GPR_Pct'],
    notes: 'Total_GPR_Pct turun < 35% karena Final_COGS naik akibat Fee+Label+Shipping.',
  },

  // Spec:  Total_GPR_Pct negative when Shipping >> Final_Total_Price
  {
    id: 'TC-F-45', type: 'integration-final',
    name: 'Total_GPR_Pct – negatif (Shipping_Cost >> Final_Total_Price)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE_50, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 5, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Shipping_Cost: 50000000 },
    assertFields:  ['Final_COGS', 'Total_GPR_Pct'],
    notes: '⚠ Shipping 50 juta >> Total_Price → Final_COGS >> Total → Total_GPR_Pct sangat negatif.',
  },

  // ── FINAL_GRAND_TOTAL ─────────────────────────────────────────────────────

  // Spec:  Final_Total_Price = SUM all subform Total_Price
  {
    id: 'TC-F-46', type: 'integration-final',
    name: 'Final_Total_Price = Σ Total_Price semua subform (KK + Serta)',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_180, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE_50,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR_51,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR_60,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.MATTRESS_PROTECTOR_106, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: {},
    assertFields:  ['Final_Total_Price', 'Final_PPN_11', 'Final_Grand_Total'],
    notes: '8 baris dari 2 brand. Final_Total_Price = Σ semua Total_Price. KK Disc=5%, Serta tanpa diskon.',
  },

  // Spec:  Final_Grand_Total_Rounded = ROUNDDOWN to nearest 1000
  {
    id: 'TC-F-47', type: 'integration-final',
    name: 'Final_Grand_Total_Rounded = ROUNDDOWN ke satuan ribu',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_240, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_300,  Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: {},
    assertFields:  ['Final_Grand_Total', 'Final_Grand_Total_Rounded'],
    notes: 'Final_Grand_Total_Rounded = ROUNDDOWN(Final_Grand_Total, -3) = floor ke ribuan.',
  },

  // ── REALISTIC FULL HOTEL PACKAGE ─────────────────────────────────────────

  // Spec:  Full hotel package — all real BOMs, all fee inputs, realistic quantities
  {
    id: 'TC-F-48', type: 'integration-final',
    name: 'Full hotel package – KK + Serta semua BOM, semua fee, qty 131 kamar',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_COVER_180,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210,     Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,       Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE_50,     Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.MATTRESS_PROTECTOR, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.DUVET_INSERT,       Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65, Discount_1: 5 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR_51,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 262, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR_60,    Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.MATTRESS_PROTECTOR_152, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.MATTRESS_PROTECTOR_106, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 131, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Fee_Pct: 0.025, Discount_Pct: 0.02, Label: 650000, Shipping_Cost: 1000000, Shipping_Cost_Cust: 1500000 },
    assertFields:  ['Final_Total_Price', 'R_Fee', 'R_Discount', 'Final_COGS', 'Total_GPR_Pct', 'Final_Grand_Total_Rounded'],
    notes: 'Skenario hotel 131 kamar, 10 produk, 2 brand. KK Disc=5%, Serta tanpa diskon. Semua fee input.',
  },

  // Spec:  Large hotel (300 rooms) — test scale
  {
    id: 'TC-F-49', type: 'integration-final',
    name: 'Full hotel package – 300 kamar, semua ukuran Pillow Case + Pillow Protector',
    setup: {
      [KK]: [
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE_50, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 600, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.PILLOW_CASE_60, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 300, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.BOLSTER_CASE,   Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 600, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_210, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 300, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_280, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 200, Set_GPR: 0.65, Discount_1: 5 },
        { Kode_Bom: PRODUCTS.KING_KOIL.FLAT_SHEET_300, Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 100, Set_GPR: 0.65, Discount_1: 5 },
      ],
      [SE]: [
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE_53,        Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 600, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_CASE_62,        Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 300, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR_51,   Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 600, Set_GPR: 0.65 },
        { Kode_Bom: PRODUCTS.SERTA.PILLOW_PROTECTOR_60,   Tahun_Bulan_yyyy_mm: REAL_DATE, Quantity: 300, Set_GPR: 0.65 },
      ],
    },
    brandLabels:   LABELS,
    additionalFee: { Fee_Pct: 0.025, Label: 1200000, Shipping_Cost: 2500000 },
    assertFields:  ['Final_Total_Price', 'Final_COGS', 'Total_GPR_Pct', 'Final_Grand_Total_Rounded'],
    notes: 'Hotel 300 kamar, 10 produk semua pillow/bolster sizes. Uji skala nilai besar.',
  },
];

module.exports = SCENARIOS;