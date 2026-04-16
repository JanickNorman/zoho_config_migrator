'use strict';

const { round2 } = require('../lib/logger');

/**
 * Compute expected subform row formula values from actual COGS (written by DAP API).
 *
 * Called AFTER integration polling so COGS is real. This validates that Zoho's
 * formulas correctly used the integration COGS — not that COGS itself is correct.
 *
 * Confirmed Zoho formula definitions (v2, from NEED_CONFIRM_QUOTE_v2__DAP_.xlsx):
 *   Price            = COGS / Set_GPR
 *                      Set_GPR = manual input by sales (e.g. 0.65 for 35% margin,
 *                      0.60 for 40% margin). NOT hardcoded to 0.65.
 *   Price_Quote      = if Corp.Price filled → Corp.Price, else → Price
 *   Final_Price      = Price_Quote × (1-D1%) × (1-D2%) × (1-D3%)  [cascade]
 *   Total_COGS       = COGS × Qty
 *                      Row-level Shipping_Cost_per_Product has been REMOVED.
 *                      All shipping is handled in the global Additional Fee section.
 *   Total_Price      = Final_Price × Qty
 *   Net_Income       = Total_Price − Total_COGS
 *   GPR(%)           = if Total_Price≠0 → (Net_Income/Total_Price)×100, else 0
 *
 * @param {object} actualRow  - subform row after integration (contains COGS)
 * @param {object} input      - scenario input (Discount_1/2/3, Corporate_Price, Qty, Set_GPR)
 * @param {object} overrides  - optional overrides (e.g. Corp.Price in two-step)
 */
function computeDynamicExpected(actualRow, input, overrides = {}) {
  const merged = { ...input, ...overrides };

  const cogs      = Number(actualRow.COGS)                  || 0;
  // Set_GPR defaults to 0.65 if not provided (35% margin target is common)
  // but scenarios should pass it explicitly when testing non-standard margins.
  const setGpr    = merged.Set_GPR != null                   ? Number(merged.Set_GPR) : 0.65;
  const corpPrice = merged.Corporate_Price != null            ? Number(merged.Corporate_Price) : null;
  const d1        = merged.Discount_1 != null                 ? Number(merged.Discount_1) / 100 : 0;
  const d2        = merged.Discount_2 != null                 ? Number(merged.Discount_2) / 100 : 0;
  const d3        = merged.Discount_3 != null                 ? Number(merged.Discount_3) / 100 : 0;
  const qty       = Number(merged.Quantity)                   || 1;

  const price      = round2(cogs / setGpr);
  const priceQuote = corpPrice !== null ? corpPrice : price;
  const finalPrice = round2(priceQuote * (1 - d1) * (1 - d2) * (1 - d3));
  // Total_COGS = COGS × Qty only (no row-level shipping in v2)
  const totalCOGS  = round2(cogs * qty);
  const totalPrice = round2(finalPrice * qty);
  const netIncome  = round2(totalPrice - totalCOGS);
  const gpr        = totalPrice !== 0 ? round2((netIncome / totalPrice) * 100) : 0;

  return {
    Price:            price,
    Price_Quote:      priceQuote,
    Final_Price:      finalPrice,
    Total_COGS:       totalCOGS,
    Total_Price:      totalPrice,
    Total_Net_Income: netIncome,
    GPR:              gpr,
  };
}

module.exports = { computeDynamicExpected };