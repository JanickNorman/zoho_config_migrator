'use strict';

const { round2 } = require('../lib/logger');

/**
 * Header-level formula computation (v2, from NEED_CONFIRM_QUOTE_v2__DAP_.xlsx)
 *
 * The quote has two aggregate layers:
 *
 * 1. PER-SUBFORM AGGREGATE (computeSubformAggregate)
 *    Runs per brand section (Quoted_Items_1 through _5). All 5 are identical:
 *      Total_Price_N       = SUM(Total_Price per row)
 *      PPN_11_N            = 0.11 × Total_Price_N
 *      Grand_Total_Price_N = Total_Price_N + PPN_11_N   ← simple, no bug
 *      Total_Net_Income_N  = SUM(Net_Income per row)
 *      Total_COGS_N        = SUM(Total_COGS per row)
 *
 * 2. FINAL GRAND TOTAL (computeFinalGrandTotal)
 *    Single quote-level rollup across all 5 brand sections + Additional Fee inputs:
 *      Final_Total_Price        = SUM(Total_Price_1 … Total_Price_5)
 *      Final_PPN_11             = 0.11 × Final_Total_Price
 *      Final_Grand_Total        = Final_Total_Price + Final_PPN_11
 *      Final_Grand_Total_Rounded= ROUNDDOWN(Final_Grand_Total, -3)  [floor to nearest 1000]
 *      R_Fee                    = Fee(%) × Final_Total_Price
 *      R_Discount               = Discount(%) × Final_Total_Price   [discount amount in Rp]
 *      Final_COGS               = SUM(Total_COGS_1…5) + R_Fee + Label + Shipping_Cost
 *      Final_Total_Net_Income   = SUM(Total_Net_Income_1…5)
 *      Total_GPR_Pct            = (Final_Total_Price − Final_COGS) / Final_Total_Price × 100
 *
 * Additional Fee inputs (manual, quote-level):
 *   Fee_Pct       — e.g. 0.025 = 2.5% (stored as decimal in system, not percentage)
 *   Discount_Pct  — e.g. 0.02 = 2% (stored as decimal)
 *   Label         — total label cost in Rp, manual input (already includes qty)
 *   Shipping_Cost — lump sum Rp → enters Final_COGS
 *   Shipping_Cost_Cust — lump sum Rp → PDF customer-facing only, NOT in Final_COGS
 */

// ── Per-subform aggregate ─────────────────────────────────────────────────────

/**
 * Given an array of computed row values for one subform, return the expected
 * aggregate fields for that brand section.
 *
 * @param {Array<{Total_Price, Total_COGS, Net_Income}>} rowResults
 * @returns {{
 *   Total_Price_N, PPN_11_N, Grand_Total_Price_N,
 *   Total_Net_Income_N, Total_COGS_N
 * }}
 */
function computeSubformAggregate(rowResults) {
  const totalPrice   = round2(rowResults.reduce((s, r) => s + (Number(r.Total_Price)   || 0), 0));
  const totalCOGS    = round2(rowResults.reduce((s, r) => s + (Number(r.Total_COGS)    || 0), 0));
  const netIncome    = round2(rowResults.reduce((s, r) => s + (Number(r.Net_Income)    || 0), 0));
  const ppn11        = round2(0.11 * totalPrice);
  const grandTotal   = round2(totalPrice + ppn11);
  return {
    Total_Price_N:        totalPrice,
    PPN_11_N:             ppn11,
    Grand_Total_Price_N:  grandTotal,
    Total_Net_Income_N:   netIncome,
    Total_COGS_N:         totalCOGS,
  };
}

// ── Final grand total ─────────────────────────────────────────────────────────

/**
 * Compute Final Grand Total across all brand sections plus Additional Fee inputs.
 *
 * @param {Array<{Total_Price, Total_COGS, Net_Income}>} allRows
 *   All subform rows from ALL subforms flattened — pass them in sorted order.
 * @param {object} additionalFee - Additional Fee section inputs:
 *   {
 *     Fee_Pct:           number  (e.g. 0.025 for 2.5%)
 *     Discount_Pct:      number  (e.g. 0.02 for 2%)
 *     Label:             number  (total Rp, manual)
 *     Shipping_Cost:     number  (lump sum → Final COGS)
 *     Shipping_Cost_Cust:number  (PDF-only, not to Final COGS)
 *   }
 * @returns {object} all final grand total expected values + internal metadata (_prefixed)
 */
function computeFinalGrandTotal(allRows, additionalFee = {}) {
  const feePct      = Number(additionalFee.Fee_Pct)            || 0;
  const discPct     = Number(additionalFee.Discount_Pct)       || 0;
  const label       = Number(additionalFee.Label)              || 0;
  const shipCost    = Number(additionalFee.Shipping_Cost)      || 0;
  // Shipping_Cost_Cust goes to PDF only — not computed here

  const finalTotalPrice  = round2(allRows.reduce((s, r) => s + (Number(r.Total_Price) || 0), 0));
  const finalTotalCOGS   = round2(allRows.reduce((s, r) => s + (Number(r.Total_COGS)  || 0), 0));
  const finalNetIncome   = round2(allRows.reduce((s, r) => s + (Number(r.Net_Income)  || 0), 0));

  const rFee       = round2(feePct * finalTotalPrice);
  const rDiscount  = round2(discPct * finalTotalPrice);  // discount amount in Rp
  const finalCOGS  = round2(finalTotalCOGS + rFee + label + shipCost);

  const finalPPN   = round2(0.11 * finalTotalPrice);
  const finalGT    = round2(finalTotalPrice + finalPPN);
  // ROUNDDOWN to nearest 1000
  const finalGTRounded = Math.floor(finalGT / 1000) * 1000;

  const totalGPR   = finalTotalPrice !== 0
    ? round2(((finalTotalPrice - finalCOGS) / finalTotalPrice) * 100)
    : 0;

  return {
    Final_Total_Price:          finalTotalPrice,
    Final_PPN_11:               finalPPN,
    Final_Grand_Total:          finalGT,
    Final_Grand_Total_Rounded:  finalGTRounded,
    R_Fee:                      rFee,
    R_Discount:                 rDiscount,
    Final_COGS:                 finalCOGS,
    Final_Total_Net_Income:     finalNetIncome,
    Total_GPR_Pct:              totalGPR,
    // Internal metadata (skipped by assert.js)
    _feePct:         feePct,
    _discPct:        discPct,
    _label:          label,
    _shipCost:       shipCost,
    _finalTotalCOGS: finalTotalCOGS,
  };
}

// ── Direct-multirow helper (unchanged) ───────────────────────────────────────

/**
 * Compute expected aggregate for multi-row direct-mode aggregate tests.
 * Uses Set_GPR from each row (defaults 0.65).
 */
function computeMultiRowExpected(rows) {
  let totalPrice = 0, totalCOGS = 0, totalQty = 0;
  const rowDetails = [];

  for (const row of rows) {
    const cogs      = Number(row.COGS)             || 0;
    const setGpr    = row.Set_GPR != null           ? Number(row.Set_GPR) : 0.65;
    const corpPrice = row.Corporate_Price != null   ? Number(row.Corporate_Price) : null;
    const d1        = row.Discount_1 != null        ? Number(row.Discount_1) / 100 : 0;
    const d2        = row.Discount_2 != null        ? Number(row.Discount_2) / 100 : 0;
    const d3        = row.Discount_3 != null        ? Number(row.Discount_3) / 100 : 0;
    const qty       = Number(row.Quantity)          || 0;

    const price         = round2(cogs / setGpr);
    const priceQuote    = corpPrice !== null ? corpPrice : price;
    const finalPrice    = round2(priceQuote * (1 - d1) * (1 - d2) * (1 - d3));
    const rowTotalCOGS  = round2(cogs * qty);
    const rowTotalPrice = round2(finalPrice * qty);

    totalPrice += rowTotalPrice;
    totalCOGS  += rowTotalCOGS;
    totalQty   += qty;
    rowDetails.push({ cogs, price, priceQuote, finalPrice, qty, rowTotalPrice, rowTotalCOGS });
  }

  return {
    Sub_Total:  round2(totalPrice),
    _totalCOGS: round2(totalCOGS),
    _totalQty:  totalQty,
    _rows:      rowDetails,
  };
}

module.exports = { computeSubformAggregate, computeFinalGrandTotal, computeMultiRowExpected };