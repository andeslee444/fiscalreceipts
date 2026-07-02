export const SITE_NAME = "GovBudget";
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://govbudget-placeholder.example";

/**
 * Human-readable fiscal-year pair for the active trajectory columns
 * (fy2526_* in fct_budget_trajectory).  Update this constant — and the
 * mart column names — when the data rolls forward to a new year pair.
 *
 * Used in receipt-moment, home page section heading, explorer preset label,
 * and any other place that previously hardcoded "FY25→26".
 */
export const TRAJECTORY_FY_LABEL = "FY25→26"; // tied to fct_budget_trajectory fy2526_* columns — update when the mart rolls forward

/**
 * Fiscal year of the receipt-moment figure (the largest FY-actuals amount
 * with a jbook_pdf citation — see getReceiptMomentFact() in lib/data.ts).
 * Tied to the J-book "PriorYear" scenario of the FY2026 justification books —
 * update alongside TRAJECTORY_FY_LABEL when the data rolls forward.
 */
export const RECEIPT_MOMENT_FY_LABEL = "FY2024";
