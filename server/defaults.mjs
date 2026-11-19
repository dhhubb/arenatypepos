/**
 * ============================================================================
 * server/defaults.mjs — Chart of accounts and seed documents
 * ----------------------------------------------------------------------------
 * Shared by the HTTP server (which seeds an empty database on first boot) and
 * the test-data seeder, so the two can never drift apart.
 * ============================================================================
 */

export const DEFAULT_ACCOUNTS = [
  ['1010', 'Cash Drawer', 'ASSET', 'Physical cash in POS drawer'],
  ['1020', 'Bank Account (Card Clearing)', 'ASSET', 'Bank current account and card receipts'],
  ['1100', 'Accounts Receivable (A/R)', 'ASSET', 'Amounts owed by credit customers'],
  ['1200', 'Inventory Asset', 'ASSET', 'Value of products held for sale'],
  ['1300', 'Store Equipment', 'ASSET', 'POS terminals, scanners, shelving, furniture'],
  ['2010', 'Accounts Payable (A/P)', 'LIABILITY', 'Amounts owed to stock suppliers'],
  ['2200', 'Sales Tax Payable', 'LIABILITY', 'GST/HST/VAT tax collected from sales'],
  ['2210', 'Payroll Tax Payable', 'LIABILITY', 'Employee income tax withheld and owed to the revenue authority'],
  ['3100', "Owner's Capital", 'EQUITY', 'Initial cash or asset investments by owner'],
  ['3200', 'Retained Earnings', 'EQUITY', 'Cumulative profits retained in the business'],
  ['4010', 'Sales Revenue', 'REVENUE', 'Revenue from retail product sales'],
  ['4020', 'Other Income', 'REVENUE', 'Revenue from services or non-retail items'],
  ['5010', 'Cost of Goods Sold (COGS)', 'EXPENSE', 'Purchase cost of products sold'],
  ['6010', 'Rent Expense', 'EXPENSE', 'Store rental payments'],
  ['6020', 'Wages & Salaries', 'EXPENSE', 'Employee payments'],
  ['6030', 'Utilities & Internet', 'EXPENSE', 'Power, water, phone, internet services'],
  ['6040', 'Marketing Expense', 'EXPENSE', 'Advertising and promotional costs'],
  ['6050', 'Bank & Transaction Fees', 'EXPENSE', 'Credit card swipe fees & bank charges'],
  ['6060', 'Cash Over / Short', 'EXPENSE', 'Till reconciliation variances discovered during cash up']
];

/**
 * Demo accounts.
 *
 * These passwords are for local evaluation only. A production deployment must
 * set the SEED_*_PASSWORD variables before the database is first created, and
 * the server refuses to start with defaults when NODE_ENV=production.
 */
export const SEED_USERS = [
  ['u-admin', 'admin', 'Alexandra Admin', 'ADMIN', process.env.SEED_ADMIN_PASSWORD || 'admin123'],
  ['u-cashier', 'cashier', 'Charlie Cashier', 'CASHIER', process.env.SEED_CASHIER_PASSWORD || 'cashier123'],
  ['u-general', 'general', 'Jane General', 'GENERAL', process.env.SEED_GENERAL_PASSWORD || 'general123'],
  ['u-audit', 'audit', 'Arthur Audit', 'AUDIT', process.env.SEED_AUDIT_PASSWORD || 'audit123']
];

export const DEFAULT_PROFILE = {
  name: 'Maboko Dinku Investments',
  address: 'Stand 42, Plumtree Border Post Commercial Centre, Plumtree, Zimbabwe',
  phone: '+263 (19) 456-2342',
  email: 'accounts@mabokodinku.co.zw',
  taxRate: 15,
  currency: 'ZAR',
  businessType: 'BAR_BOTTLESTORE',
  terminology: {
    itemLabel: 'Drink / Item',
    customerLabel: 'Patron',
    supplierLabel: 'Beverage Supplier',
    primaryStockLabel: 'Storeroom',
    secondaryStockLabel: 'Fridges'
  }
};

export const DEFAULT_ADMIN_CONTROL = {
  maintenanceMode: false,
  systemLocked: false,
  disabledModules: [],
  announcement: '',
  forceLogoutToken: 0,
  updatedAt: new Date().toISOString()
};

/** Month-safe date arithmetic (setMonth overflows on the 29th-31st). */
export function addMonths(date, months) {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const daysInTarget = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, daysInTarget));
  return result;
}

export function defaultLicense() {
  return {
    licenseKey: 'AFRITECX-BADBOY-ANNUAL-DEMO',
    licensedTo: DEFAULT_PROFILE.name,
    billingCycle: 'ANNUAL',
    issuedAt: new Date().toISOString(),
    expiresAt: addMonths(new Date(), 12).toISOString(),
    status: 'ACTIVE'
  };
}
