/**
 * ============================================================================
 * MODULE: utils/accounting.ts — Double-Entry Bookkeeping Engine
 * ----------------------------------------------------------------------------
 * The financial "brain" of the platform. Everything here is pure calculation
 * (no UI), so it is easy to test and reuse. Responsibilities:
 *   - DEFAULT_ACCOUNTS: the standard Chart of Accounts (assets, liabilities,
 *     equity, revenue, expenses) with GAAP-style numeric codes.
 *   - getAccountBalanceDirection() / calculateAccountBalance() /
 *     getAccountsWithBalances(): derive live balances from journal entries
 *     while respecting normal debit/credit direction per account type.
 *   - Journal-entry generators (sales, purchases, payroll, payments, capital,
 *     etc.): translate real business events into balanced debit/credit lines.
 *   - Financial statement builders: generateIncomeStatement (P&L),
 *     generateBalanceSheet, and generateTrialBalance — each accepts a custom
 *     chart of accounts and can be fed period-filtered entries for reporting.
 *   - MOCK_* seed data: realistic starter records used on first launch.
 * ============================================================================
 */
import { Account, AccountType, JournalEntry, Sale, PurchaseOrder, Product, Customer, Supplier, TransactionLine, Payrun } from '../types';
import { balanceEntry, isEntryBalanced, roundMoney, sumMoney } from './money';

/** Account codes referenced by the posting rules. Centralised to avoid typos. */
export const ACCOUNT_CODES = {
  CASH: '1010',
  BANK: '1020',
  RECEIVABLE: '1100',
  INVENTORY: '1200',
  EQUIPMENT: '1300',
  PAYABLE: '2010',
  SALES_TAX_PAYABLE: '2200',
  PAYROLL_TAX_PAYABLE: '2210',
  OWNER_CAPITAL: '3100',
  RETAINED_EARNINGS: '3200',
  SALES_REVENUE: '4010',
  OTHER_INCOME: '4020',
  COGS: '5010',
  CASH_OVER_SHORT: '6060'
} as const;

// Standard Chart of Accounts
export const DEFAULT_ACCOUNTS: Account[] = [
  // ASSETS (1000 - 1999)
  { code: '1010', name: 'Cash Drawer', type: 'ASSET', balance: 0, description: 'Physical cash in POS drawer', isSystem: true },
  { code: '1020', name: 'Bank Account (Card Clearing)', type: 'ASSET', balance: 0, description: 'Bank current account and card receipts', isSystem: true },
  { code: '1100', name: 'Accounts Receivable (A/R)', type: 'ASSET', balance: 0, description: 'Amounts owed by credit customers', isSystem: true },
  { code: '1200', name: 'Inventory Asset', type: 'ASSET', balance: 0, description: 'Value of products held for sale', isSystem: true },
  { code: '1300', name: 'Store Equipment', type: 'ASSET', balance: 0, description: 'POS terminals, scanners, shelving, furniture', isSystem: true },
  
  // LIABILITIES (2000 - 2999)
  { code: '2010', name: 'Accounts Payable (A/P)', type: 'LIABILITY', balance: 0, description: 'Amounts owed to stock suppliers', isSystem: true },
  { code: '2200', name: 'Sales Tax Payable', type: 'LIABILITY', balance: 0, description: 'GST/HST/VAT tax collected from sales', isSystem: true },
  // Payroll withholding is a separate statutory liability from sales tax and
  // must never be netted against it (they are remitted to different authorities).
  { code: '2210', name: 'Payroll Tax Payable', type: 'LIABILITY', balance: 0, description: 'Employee income tax withheld and owed to the revenue authority', isSystem: true },
  
  // EQUITY (3000 - 3999)
  { code: '3100', name: 'Owner’s Capital', type: 'EQUITY', balance: 0, description: 'Initial cash or asset investments by owner', isSystem: true },
  { code: '3200', name: 'Retained Earnings', type: 'EQUITY', balance: 0, description: 'Cumulative profits retained in the business', isSystem: true },
  
  // REVENUES (4000 - 4999)
  { code: '4010', name: 'Sales Revenue', type: 'REVENUE', balance: 0, description: 'Revenue from retail product sales', isSystem: true },
  { code: '4020', name: 'Other Income', type: 'REVENUE', balance: 0, description: 'Revenue from services or non-retail items', isSystem: true },
  
  // EXPENSES (5000 - 6999)
  { code: '5010', name: 'Cost of Goods Sold (COGS)', type: 'EXPENSE', balance: 0, description: 'Purchase cost of products sold', isSystem: true },
  { code: '6010', name: 'Rent Expense', type: 'EXPENSE', balance: 0, description: 'Store rental payments', isSystem: true },
  { code: '6020', name: 'Wages & Salaries', type: 'EXPENSE', balance: 0, description: 'Employee payments', isSystem: true },
  { code: '6030', name: 'Utilities & Internet', type: 'EXPENSE', balance: 0, description: 'Power, water, phone, internet services', isSystem: true },
  { code: '6040', name: 'Marketing Expense', type: 'EXPENSE', balance: 0, description: 'Advertising and promotional costs', isSystem: true },
  { code: '6050', name: 'Bank & Transaction Fees', type: 'EXPENSE', balance: 0, description: 'Credit card swipe fees & bank charges', isSystem: true },
  { code: '6060', name: 'Cash Over / Short', type: 'EXPENSE', balance: 0, description: 'Till reconciliation variances discovered during cash up', isSystem: true }
];

// Helper to determine debit vs credit direction for accounts
export function getAccountBalanceDirection(type: AccountType): 'DEBIT' | 'CREDIT' {
  if (type === 'ASSET' || type === 'EXPENSE') return 'DEBIT';
  return 'CREDIT';
}

// Compute standard balance from debits and credits
export function calculateAccountBalance(
  code: string,
  entries: JournalEntry[],
  initialBalance = 0,
  baseAccounts: Account[] = DEFAULT_ACCOUNTS
): number {
  const account = baseAccounts.find(a => a.code === code);
  if (!account) return 0;
  
  let debits = 0;
  let credits = 0;
  
  entries.forEach(entry => {
    entry.lines.forEach(line => {
      if (line.accountCode === code) {
        if (line.type === 'DEBIT') debits += line.amount;
        if (line.type === 'CREDIT') credits += line.amount;
      }
    });
  });

  const direction = getAccountBalanceDirection(account.type);
  if (direction === 'DEBIT') {
    return initialBalance + debits - credits;
  } else {
    return initialBalance + credits - debits;
  }
}

// Generate complete updated Accounts array based on transactions
export function getAccountsWithBalances(entries: JournalEntry[], baseAccounts: Account[] = DEFAULT_ACCOUNTS): Account[] {
  return baseAccounts.map(acc => {
    // We can define custom starting balances (e.g. Owner Capital of $25,000, Store Equipment $5,000)
    let startBal = 0;
    // Handled purely via initial journal entries for consistency!
    return {
      ...acc,
      balance: calculateAccountBalance(acc.code, entries, startBal, baseAccounts)
    };
  });
}

// ----------------------------------------------------------------
// AUTOMATIC DOUBLE-ENTRY JOURNAL GENERATION HELPERS
// ----------------------------------------------------------------

/**
 * 1. SALE JOURNAL ENTRY
 * Debits: Cash (1010) OR Bank (1020) OR Accounts Receivable (1100) for Full Sale Total
 * Credits: Sales Revenue (4010) for Subtotal (pre-tax)
 * Credits: Sales Tax Payable (2200) for Tax Amount
 * 
 * AND Inventory COGS Adjustment:
 * Debit: Cost of Goods Sold (5010) for Cost of Goods
 * Credit: Inventory Asset (1200) for Cost of Goods
 */
export function createJournalEntryForSale(sale: Sale): JournalEntry {
  const lines: TransactionLine[] = [];

  // Payment account selection
  let paymentAccount: string = ACCOUNT_CODES.CASH;
  if (sale.paymentMethod === 'CARD') {
    paymentAccount = ACCOUNT_CODES.BANK;
  } else if (sale.paymentMethod === 'CUSTOMER_CREDIT') {
    paymentAccount = ACCOUNT_CODES.RECEIVABLE;
  }

  // The till collected `sale.total`. That single amount must be split into net
  // revenue plus tax without losing or inventing a cent, so the split is
  // apportioned from the already-rounded total rather than rounded separately.
  const total = roundMoney(sale.total);
  const tax = sale.taxAmount > 0 ? roundMoney(sale.taxAmount) : 0;
  const netRevenue = roundMoney(total - tax);

  lines.push({ accountCode: paymentAccount, type: 'DEBIT', amount: total });
  lines.push({ accountCode: ACCOUNT_CODES.SALES_REVENUE, type: 'CREDIT', amount: netRevenue });
  if (tax > 0) {
    lines.push({ accountCode: ACCOUNT_CODES.SALES_TAX_PAYABLE, type: 'CREDIT', amount: tax });
  }

  // COGS relief: cost per line, apportioned so the inventory credit matches.
  const totalCost = sumMoney(
    sale.items.map(item => roundMoney(item.costPrice * item.quantity))
  );

  if (totalCost > 0) {
    lines.push({ accountCode: ACCOUNT_CODES.COGS, type: 'DEBIT', amount: totalCost });
    lines.push({ accountCode: ACCOUNT_CODES.INVENTORY, type: 'CREDIT', amount: totalCost });
  }

  return {
    id: `JE-SALE-${sale.id}`,
    date: sale.date,
    description: `Sales Invoice POS: ${sale.invoiceNo}${sale.customerId ? ' (Cust Credit)' : ''}`,
    reference: sale.id,
    lines: balanceEntry(lines, ACCOUNT_CODES.SALES_REVENUE)
  };
}

/**
 * 2. PURCHASE ORDER JOURNAL ENTRY
 * Debits: Inventory Asset (1200) for Total Cost
 * Credits: Accounts Payable (2010) [credit] OR Cash (1010)/Bank (1020) [cash payment]
 */
export function createJournalEntryForPurchase(po: PurchaseOrder): JournalEntry {
  const lines: TransactionLine[] = [];
  const total = roundMoney(po.total);

  // 1. Debit Inventory Asset
  lines.push({ accountCode: ACCOUNT_CODES.INVENTORY, type: 'DEBIT', amount: total });

  // 2. Credit funding source
  let creditAccount: string = ACCOUNT_CODES.PAYABLE;
  if (po.paymentMethod === 'CASH') {
    creditAccount = ACCOUNT_CODES.CASH;
  } else if (po.paymentMethod === 'CARD') {
    creditAccount = ACCOUNT_CODES.BANK;
  }

  lines.push({ accountCode: creditAccount, type: 'CREDIT', amount: total });

  return {
    id: `JE-PO-${po.id}`,
    date: po.date,
    description: `Inventory Stock Purchase Order: ${po.poNo}`,
    reference: po.id,
    lines
  };
}

/**
 * 3. SUPPLIER PAYMENT (PAYING AP DEBT)
 * Debits: Accounts Payable (2010) (reduces liability)
 * Credits: Cash (1010) or Bank (1020) (reduces asset)
 */
export function createJournalEntryForSupplierPayment(
  paymentId: string,
  date: string,
  supplierName: string,
  amount: number,
  method: 'CASH' | 'CARD'
): JournalEntry {
  return {
    id: `JE-PAY-SUP-${paymentId}`,
    date,
    description: `Payment to Supplier: ${supplierName}`,
    reference: paymentId,
    lines: [
      {
        accountCode: '2010', // Accounts Payable
        type: 'DEBIT',
        amount: parseFloat(amount.toFixed(2))
      },
      {
        accountCode: method === 'CASH' ? '1010' : '1020', // Cash / Bank
        type: 'CREDIT',
        amount: parseFloat(amount.toFixed(2))
      }
    ]
  };
}

/**
 * 4. CUSTOMER PAYMENT RECEIPT (RECEIVING AR CASH)
 * Debits: Cash (1010) or Bank (1020) (increases asset)
 * Credits: Accounts Receivable (1100) (reduces asset)
 */
export function createJournalEntryForCustomerPayment(
  receiptId: string,
  date: string,
  customerName: string,
  amount: number,
  method: 'CASH' | 'CARD'
): JournalEntry {
  return {
    id: `JE-REC-CUST-${receiptId}`,
    date,
    description: `Payment Received from Customer: ${customerName}`,
    reference: receiptId,
    lines: [
      {
        accountCode: method === 'CASH' ? '1010' : '1020', // Cash / Bank
        type: 'DEBIT',
        amount: parseFloat(amount.toFixed(2))
      },
      {
        accountCode: '1100', // Accounts Receivable
        type: 'CREDIT',
        amount: parseFloat(amount.toFixed(2))
      }
    ]
  };
}

/**
 * 5. MANUAL GENERAL EXPENSE RECORDING
 * Debits: Expense Account (6010 - 6050)
 * Credits: Cash (1010) or Bank (1020)
 */
export function createJournalEntryForExpense(
  expenseId: string,
  date: string,
  accountCode: string,
  description: string,
  amount: number,
  paymentMethod: 'CASH' | 'CARD'
): JournalEntry {
  return {
    id: `JE-EXP-${expenseId}`,
    date,
    description: `Expense Payment: ${description}`,
    reference: expenseId,
    lines: [
      {
        accountCode, // Rent, wages, utilities, marketing etc.
        type: 'DEBIT',
        amount: parseFloat(amount.toFixed(2))
      },
      {
        accountCode: paymentMethod === 'CASH' ? '1010' : '1020',
        type: 'CREDIT',
        amount: parseFloat(amount.toFixed(2))
      }
    ]
  };
}

/**
 * 6. CAPITAL INJECTION
 * Debits: Cash (1010) or Bank (1020)
 * Credits: Owner's Capital (3100)
 */
export function createJournalEntryForCapital(
  id: string,
  date: string,
  description: string,
  amount: number,
  bankCode: '1010' | '1020'
): JournalEntry {
  return {
    id: `JE-CAP-${id}`,
    date,
    description,
    reference: id,
    lines: [
      {
        accountCode: bankCode,
        type: 'DEBIT',
        amount: parseFloat(amount.toFixed(2))
      },
      {
        accountCode: '3100', // Owner's Capital
        type: 'CREDIT',
        amount: parseFloat(amount.toFixed(2))
      }
    ]
  };
}

/**
 * 7. PAYROLL DISBURSEMENT JOURNAL ENTRY
 * Debits: Wages & Salaries Expense (6010 / 6020) for Total Gross
 * Credits: Sales Tax Payable (2200) for Income Tax Withheld
 * Credits: Cash Drawer (1010) or Bank (1020) for Total Net distributed
 */
export function createJournalEntryForPayroll(payrun: Payrun, paymentMethod: 'CASH' | 'CARD'): JournalEntry {
  const lines: TransactionLine[] = [];

  // Payroll is posted from the aggregated run totals so that the entry always
  // balances: gross expense = net disbursed + tax withheld. Withholding is
  // credited to its own liability account (2210) so it is never commingled
  // with sales tax collected from customers (2200).
  const gross = roundMoney(payrun.totalGross);
  const tax = roundMoney(payrun.totalTax);
  const net = roundMoney(gross - tax);

  lines.push({ accountCode: '6020', type: 'DEBIT', amount: gross });
  if (tax > 0) {
    lines.push({ accountCode: ACCOUNT_CODES.PAYROLL_TAX_PAYABLE, type: 'CREDIT', amount: tax });
  }
  lines.push({
    accountCode: paymentMethod === 'CASH' ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK,
    type: 'CREDIT',
    amount: net
  });

  return {
    id: `JE-PAYROLL-${payrun.id}`,
    date: payrun.paymentDate,
    description: `Payroll Run Disbursed: Payrun #${payrun.payrunNo}`,
    reference: payrun.id,
    lines: balanceEntry(lines, '6020')
  };
}

/**
 * 8. OPENING STOCK (INITIAL CATALOGUE LOAD)
 * Debits: Inventory Asset (1200) for the cost of the stock
 * Credits: Owner's Capital (3100) as the opening equity contribution
 *
 * Without this entry the first sale credits Inventory (1200) for goods that
 * were never debited into it, driving the asset to a negative balance.
 */
export function createJournalEntryForOpeningStock(
  batchId: string,
  date: string,
  items: { name: string; quantity: number; costPrice: number }[]
): JournalEntry | null {
  const totalCost = sumMoney(items.map(item => roundMoney(item.costPrice * item.quantity)));
  if (totalCost <= 0) return null;

  const lines: TransactionLine[] = [
    { accountCode: ACCOUNT_CODES.INVENTORY, type: 'DEBIT', amount: totalCost },
    { accountCode: ACCOUNT_CODES.OWNER_CAPITAL, type: 'CREDIT', amount: totalCost }
  ];

  return {
    id: `JE-OPENING-${batchId}`,
    date,
    description: `Opening stock loaded into inventory (${items.length} item${items.length === 1 ? '' : 's'})`,
    reference: batchId,
    lines
  };
}

/**
 * 9. PAYROLL TAX REMITTANCE
 * Debits: Payroll Tax Payable (2210)
 * Credits: Cash (1010) or Bank (1020)
 */
export function createJournalEntryForPayrollTaxRemittance(
  remittanceId: string,
  date: string,
  amount: number,
  method: 'CASH' | 'CARD',
  quarter: string
): JournalEntry {
  const value = roundMoney(amount);
  return {
    id: `JE-PAYROLL-REMIT-${remittanceId}`,
    date,
    description: `Payroll tax remitted to revenue authority: ${quarter}`,
    reference: remittanceId,
    lines: [
      { accountCode: ACCOUNT_CODES.PAYROLL_TAX_PAYABLE, type: 'DEBIT', amount: value },
      { accountCode: method === 'CASH' ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK, type: 'CREDIT', amount: value }
    ]
  };
}

/**
 * Ledger guard used by every write path before a posting is persisted.
 * Returns a human readable problem, or null when the entry is sound.
 */
export function validateJournalEntry(entry: JournalEntry): string | null {
  if (!entry.id) return 'Journal entry is missing an id.';
  if (!entry.date) return 'Journal entry is missing a posting date.';
  if (!Array.isArray(entry.lines) || entry.lines.length < 2) {
    return 'A journal entry needs at least one debit and one credit line.';
  }
  if (entry.lines.some(line => !Number.isFinite(line.amount) || line.amount <= 0)) {
    return 'Every journal line must carry a positive amount.';
  }
  if (entry.lines.every(line => line.type === 'DEBIT') || entry.lines.every(line => line.type === 'CREDIT')) {
    return 'A journal entry must contain both debit and credit lines.';
  }
  const imbalance = roundMoney(
    entry.lines.filter(l => l.type === 'DEBIT').reduce((sum, l) => sum + l.amount, 0) -
    entry.lines.filter(l => l.type === 'CREDIT').reduce((sum, l) => sum + l.amount, 0)
  );
  if (imbalance !== 0) {
    return `Journal entry is out of balance by ${imbalance.toFixed(2)}.`;
  }
  return null;
}

/** True when every entry in the ledger satisfies double-entry equality. */
export function ledgerIsBalanced(entries: JournalEntry[]): boolean {
  return entries.every(entry => isEntryBalanced(entry));
}

/**
 * ----------------------------------------------------------------------------
 * EMPTY SEED DATA — the database starts at ZERO for a brand-new business.
 * ----------------------------------------------------------------------------
 * Every collection below is intentionally empty. On first launch the app has
 * no products, customers, suppliers, employees, sales, purchase orders, or
 * journal history. Businesses build their own records through normal use.
 * The Chart of Accounts (DEFAULT_ACCOUNTS) and login users are kept elsewhere
 * so the platform remains usable immediately after a reset.
 */
export const MOCK_EMPLOYEES: any[] = [];

export const MOCK_PRODUCTS: Product[] = [];

export const MOCK_CUSTOMERS: Customer[] = [];

export const MOCK_SUPPLIERS: Supplier[] = [];

export const MOCK_JOURNAL_ENTRIES: JournalEntry[] = [];

export const MOCK_SALES: Sale[] = [];

export const MOCK_PURCHASE_ORDERS: PurchaseOrder[] = [];

// Helper to calculate reports:

// 1. Balance Sheet calculation
export interface BalanceSheet {
  assets: { code: string; name: string; balance: number }[];
  totalAssets: number;
  liabilities: { code: string; name: string; balance: number }[];
  totalLiabilities: number;
  equity: { code: string; name: string; balance: number }[];
  totalEquity: number;
  netIncomeAddition: number; // Current period Net Income from Profit & Loss added to equity
}

export function generateBalanceSheet(entries: JournalEntry[], baseAccounts: Account[] = DEFAULT_ACCOUNTS): BalanceSheet {
  const accounts = getAccountsWithBalances(entries, baseAccounts);
  
  const assets = accounts.filter(a => a.type === 'ASSET').map(a => ({ code: a.code, name: a.name, balance: a.balance }));
  const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);

  const liabilities = accounts.filter(a => a.type === 'LIABILITY').map(a => ({ code: a.code, name: a.name, balance: a.balance }));
  const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);

  const equity = accounts.filter(a => a.type === 'EQUITY').map(a => ({ code: a.code, name: a.name, balance: a.balance }));
  
  // To keep Balance Sheet perfectly balanced in real-time, 
  // we must pull standard Income Statement (Net Income) and add it to equity
  const inc = generateIncomeStatement(entries, baseAccounts);
  const totalEquityBeforeIncome = equity.reduce((sum, a) => sum + a.balance, 0);
  const totalEquity = totalEquityBeforeIncome + inc.netIncome;

  return {
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquity,
    netIncomeAddition: inc.netIncome
  };
}

// 2. Income Statement calculation
export interface IncomeStatement {
  revenue: { code: string; name: string; balance: number }[];
  totalRevenue: number;
  cogs: number;
  grossProfit: number;
  expenses: { code: string; name: string; balance: number }[];
  totalExpenses: number;
  netIncome: number;
}

export function generateIncomeStatement(entries: JournalEntry[], baseAccounts: Account[] = DEFAULT_ACCOUNTS): IncomeStatement {
  const accounts = getAccountsWithBalances(entries, baseAccounts);
  
  const revenue = accounts.filter(a => a.type === 'REVENUE').map(a => ({ code: a.code, name: a.name, balance: a.balance }));
  const totalRevenue = revenue.reduce((sum, r) => sum + r.balance, 0);

  // COGS is special - 5010
  const cogsAccount = accounts.find(a => a.code === '5010');
  const cogs = cogsAccount ? cogsAccount.balance : 0;

  const grossProfit = totalRevenue - cogs;

  const expenses = accounts.filter(a => a.type === 'EXPENSE' && a.code !== '5010').map(a => ({ code: a.code, name: a.name, balance: a.balance }));
  const totalExpenses = expenses.reduce((sum, e) => sum + e.balance, 0);

  const netIncome = grossProfit - totalExpenses;

  return {
    revenue,
    totalRevenue,
    cogs,
    grossProfit,
    expenses,
    totalExpenses,
    netIncome
  };
}

// 3. Trial Balance Check (Sum of Debits must equal Sum of Credits)
export interface TrialBalance {
  rows: { code: string; name: string; type: AccountType; debit: number; credit: number }[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
}

export function generateTrialBalance(entries: JournalEntry[], baseAccounts: Account[] = DEFAULT_ACCOUNTS): TrialBalance {
  const accounts = getAccountsWithBalances(entries, baseAccounts);
  const rows: { code: string; name: string; type: AccountType; debit: number; credit: number }[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  accounts.forEach(acc => {
    let debit = 0;
    let credit = 0;
    const balance = acc.balance;

    if (getAccountBalanceDirection(acc.type) === 'DEBIT') {
      if (balance >= 0) {
        debit = balance;
      } else {
        credit = Math.abs(balance);
      }
    } else {
      if (balance >= 0) {
        credit = balance;
      } else {
        debit = Math.abs(balance);
      }
    }

    if (debit > 0 || credit > 0) {
      rows.push({
        code: acc.code,
        name: acc.name,
        type: acc.type,
        debit: roundMoney(debit),
        credit: roundMoney(credit)
      });
      totalDebit += debit;
      totalCredit += credit;
    }
  });

  return {
    rows,
    totalDebit: roundMoney(totalDebit),
    totalCredit: roundMoney(totalCredit),
    // A trial balance is only sound when both sides agree to the cent. The
    // previous 0.05 tolerance silently declared a 1-cent error "balanced".
    isBalanced: roundMoney(totalDebit - totalCredit) === 0
  };
}
