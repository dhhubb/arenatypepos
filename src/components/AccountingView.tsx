/**
 * ============================================================================
 * MODULE: components/AccountingView.tsx — Accounting & Reporting Console
 * ----------------------------------------------------------------------------
 * The accountant's workspace. It presents the accounting engine's output and
 * lets users drill into detail. Main sub-tabs:
 *   - CHART OF ACCOUNTS: view/add/delete ledger accounts.
 *   - GENERAL LEDGER: per-account transaction history with running balances,
 *     date filters, and CSV export.
 *   - FINANCIAL STATEMENTS: P&L, Balance Sheet, Trial Balance, Tax Summary,
 *     Account Movement, AR/AP Aging, and customer/supplier statements — all
 *     driven by a shared fiscal-period filter (custom dates + presets like
 *     This Month/Quarter/Year), sortable order, and prior-period comparison.
 *   - JOURNAL ENTRIES: browse posted double-entry transactions.
 *   - MANUAL ENTRY: post balanced adjusting journals (blocked for AUDIT).
 * Reports can be exported to PDF and shared via WhatsApp/email.
 * ============================================================================
 */
import React, { useState } from 'react';
import { JournalEntry, BusinessProfile, Account, AccountType } from '../types';
import { 
  generateBalanceSheet, 
  generateIncomeStatement, 
  generateTrialBalance, 
  getAccountsWithBalances, 
  getAccountBalanceDirection,
  validateJournalEntry
} from '../utils/accounting';
import { formatCurrency } from '../utils/currency';
import { 
  FileText, 
  BookOpen, 
  PlusCircle, 
  Layers, 
  Scale, 
  CheckCircle, 
  AlertCircle, 
  Calendar, 
  Tag, 
  Briefcase,
  Grid,
  Filter,
  Download,
  Trash2,
  Lock,
  Plus,
  Printer,
  Send,
  Mail
} from 'lucide-react';

import { Customer, Supplier, User, Sale, PurchaseOrder } from '../types';

interface AccountingViewProps {
  journalEntries: JournalEntry[];
  businessProfile: BusinessProfile;
  onAddManualJournalEntry: (entry: JournalEntry) => void;
  accounts: Account[];
  onAddAccount: (newAcc: Account) => void;
  onDeleteAccount: (code: string) => void;
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  purchaseOrders: PurchaseOrder[];
  currentUser: User | null;
}

type SubTab = 'statements' | 'coa' | 'ledger' | 'entries' | 'manual';
type StatementType = 'p&l' | 'balance_sheet' | 'trial_balance' | 'tax_summary' | 'account_movement' | 'ar_aging' | 'ap_aging' | 'customer_statement' | 'supplier_statement';
type ReportPreset = 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_QUARTER' | 'THIS_YEAR' | 'ALL_TIME';

/** Ageing buckets, in days, used by the A/R and A/P reports. */
const AGING_BUCKETS = [
  { key: 'current', label: '0-30 Days', min: 0, max: 30 },
  { key: 'days30', label: '31-60 Days', min: 31, max: 60 },
  { key: 'days60', label: '61-90 Days', min: 61, max: 90 },
  { key: 'days90', label: '91-120 Days', min: 91, max: 120 },
  { key: 'over90', label: '120+ Days', min: 121, max: Number.POSITIVE_INFINITY }
] as const;

type AgingBucketKey = typeof AGING_BUCKETS[number]['key'];
type AgingRow = { id: string; name: string; total: number } & Record<AgingBucketKey, number>;

/** Whole days between an ISO date and today. */
function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/** Places an amount into the bucket matching its age. */
function bucketFor(ageDays: number): AgingBucketKey {
  const match = AGING_BUCKETS.find(bucket => ageDays >= bucket.min && ageDays <= bucket.max);
  return match ? match.key : 'over90';
}

function emptyAgingRow(id: string, name: string): AgingRow {
  return {
    id, name, total: 0,
    current: 0, days30: 0, days60: 0, days90: 0, over90: 0
  };
}

/**
 * Builds a real receivables ageing schedule.
 *
 * The previous implementation multiplied each customer's balance by hard-coded
 * ratios keyed on demo ids ('c1', 'c4'), so the buckets were fiction. Here each
 * unpaid credit sale is aged from its own posting date, which is the only way
 * the buckets can be reconciled back to the ledger.
 */
function buildReceivablesAging(customers: Customer[], sales: Sale[]): AgingRow[] {
  const rows = new Map<string, AgingRow>();

  for (const sale of sales) {
    if (sale.paymentMethod !== 'CUSTOMER_CREDIT' || !sale.customerId) continue;
    const customer = customers.find(c => c.id === sale.customerId);
    const row = rows.get(sale.customerId) ?? emptyAgingRow(sale.customerId, customer?.name ?? sale.customerId);
    const bucket = bucketFor(daysSince(sale.date));
    row[bucket] += sale.total;
    row.total += sale.total;
    rows.set(sale.customerId, row);
  }

  // Customers carrying a debt but with no matching sale (opening balances or
  // imported data) are shown as current so nothing silently disappears.
  for (const customer of customers) {
    if (customer.storeCredit >= 0 || rows.has(customer.id)) continue;
    const row = emptyAgingRow(customer.id, customer.name);
    row.current = Math.abs(customer.storeCredit);
    row.total = row.current;
    rows.set(customer.id, row);
  }

  return [...rows.values()].filter(row => row.total > 0);
}

/**
 * Builds a payables ageing schedule from received-but-unpaid purchase orders.
 */
function buildPayablesAging(suppliers: Supplier[], purchaseOrders: PurchaseOrder[]): AgingRow[] {
  const rows = new Map<string, AgingRow>();

  for (const po of purchaseOrders) {
    if (!po.supplierId) continue;
    if (po.isPaid) continue;
    if (po.paymentMethod !== 'ACCOUNTS_PAYABLE') continue;
    const supplier = suppliers.find(s => s.id === po.supplierId);
    const row = rows.get(po.supplierId) ?? emptyAgingRow(po.supplierId, supplier?.name ?? po.supplierId);
    const bucket = bucketFor(daysSince(po.date));
    row[bucket] += po.total;
    row.total += po.total;
    rows.set(po.supplierId, row);
  }

  // Fall back to the supplier balance when no PO history exists for it.
  for (const supplier of suppliers) {
    if (supplier.balanceOwed <= 0 || rows.has(supplier.id)) continue;
    const row = emptyAgingRow(supplier.id, supplier.name);
    row.current = supplier.balanceOwed;
    row.total = row.current;
    rows.set(supplier.id, row);
  }

  return [...rows.values()].filter(row => row.total > 0);
}

/** Totals a schedule column-wise for the table footer. */
function totalAging(rows: AgingRow[]): AgingRow {
  const totals = emptyAgingRow('total', 'Portfolio Totals');
  for (const row of rows) {
    totals.current += row.current;
    totals.days30 += row.days30;
    totals.days60 += row.days60;
    totals.days90 += row.days90;
    totals.over90 += row.over90;
    totals.total += row.total;
  }
  return totals;
}

/** Converts a Date object into a local YYYY-MM-DD input value. */
const toDateInput = (date: Date) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().split('T')[0];
};

/** Returns the first date of the current month for the default reporting period. */
const getMonthStart = () => toDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

export default function AccountingView({
  journalEntries,
  businessProfile,
  onAddManualJournalEntry,
  accounts,
  onAddAccount,
  onDeleteAccount,
  customers,
  suppliers,
  sales,
  purchaseOrders,
  currentUser
}: AccountingViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('coa');
  const [statementType, setStatementType] = useState<StatementType>('p&l');
  const [reportStartDate, setReportStartDate] = useState(getMonthStart());
  const [reportEndDate, setReportEndDate] = useState(toDateInput(new Date()));
  const [reportSort, setReportSort] = useState<'ASC' | 'DESC'>('DESC');
  
  // Statement specific focus client/vendor
  const [selectedStatementCustomerId, setSelectedStatementCustomerId] = useState<string>('');
  const [selectedStatementSupplierId, setSelectedStatementSupplierId] = useState<string>('');
  
  // General Ledger Filters State
  const [selectedLedgerAccountCode, setSelectedLedgerAccountCode] = useState<string>('1010'); // Cash Drawer default
  const [ledgerStartDate, setLedgerStartDate] = useState<string>('');
  const [ledgerEndDate, setLedgerEndDate] = useState<string>('');
  const [exportSuccess, setExportSuccess] = useState(false);

  // Chart of Accounts (COA) Editor States
  const [isAddAccOpen, setIsAddAccOpen] = useState(false);
  const [newAccCode, setNewAccCode] = useState('');
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState<AccountType>('EXPENSE');
  const [newAccDesc, setNewAccDesc] = useState('');
  const [coaError, setCoaError] = useState('');
  const [coaSuccess, setCoaSuccess] = useState(false);

  // Manual Journal Entry Form State
  const [jeDate, setJeDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [jeDescription, setJeDescription] = useState<string>('');
  const [jeLines, setJeLines] = useState<{ accountCode: string; type: 'DEBIT' | 'CREDIT'; amount: string }[]>([
    { accountCode: '1010', type: 'DEBIT', amount: '' },
    { accountCode: '4020', type: 'CREDIT', amount: '' }
  ]);
  const [jeError, setJeError] = useState<string>('');
  const [jeSuccess, setJeSuccess] = useState<boolean>(false);

  // Compute live balances on the stateful accounts list
  const accountsWithBalances = getAccountsWithBalances(journalEntries, accounts);

  /** Journal entries occurring inside the selected reporting period. */
  const periodEntries = journalEntries.filter(entry =>
    (!reportStartDate || entry.date >= reportStartDate) &&
    (!reportEndDate || entry.date <= reportEndDate)
  );

  /** Entries accumulated through the selected end date for point-in-time reports. */
  const asOfEntries = journalEntries.filter(entry => !reportEndDate || entry.date <= reportEndDate);

  /** Source activity sorted according to the accountant's selected date order. */
  const sortedPeriodEntries = [...periodEntries].sort((a, b) => {
    const difference = new Date(a.date).getTime() - new Date(b.date).getTime();
    return reportSort === 'ASC' ? difference : -difference;
  });

  // Period reports use in-range activity; point-in-time reports accumulate through end date.
  const pAndL = generateIncomeStatement(periodEntries, accounts);
  const balanceSheet = generateBalanceSheet(asOfEntries, accounts);
  const trialBalance = generateTrialBalance(asOfEntries, accounts);

  // Ageing schedules are derived from transaction dates rather than demo ratios.
  const receivablesAging = buildReceivablesAging(customers, sales);
  const receivablesTotals = totalAging(receivablesAging);
  const payablesAging = buildPayablesAging(suppliers, purchaseOrders);
  const payablesTotals = totalAging(payablesAging);

  /**
   * Journal entries whose own debit/credit lines do not balance. Surfacing these
   * turns the integrity banner into a real diagnostic instead of a rubber stamp.
   */
  const unbalancedEntryIds = journalEntries
    .filter(entry => validateJournalEntry(entry) !== null)
    .map(entry => entry.id);

  /** Currency-aware money formatter bound to the active business profile. */
  const money = (amount: number) => formatCurrency(amount, businessProfile.currency);

  /** Previous equal-length period used for comparative P&L metrics. */
  const reportStart = new Date(`${reportStartDate}T00:00:00`);
  const reportEnd = new Date(`${reportEndDate}T00:00:00`);
  const periodLengthMs = Math.max(86_400_000, reportEnd.getTime() - reportStart.getTime() + 86_400_000);
  const previousEnd = new Date(reportStart.getTime() - 86_400_000);
  const previousStart = new Date(previousEnd.getTime() - periodLengthMs + 86_400_000);
  const previousEntries = journalEntries.filter(entry =>
    entry.date >= toDateInput(previousStart) && entry.date <= toDateInput(previousEnd)
  );
  const previousPAndL = generateIncomeStatement(previousEntries, accounts);

  /** Applies a common accounting period without changing underlying entries. */
  const applyReportPreset = (preset: ReportPreset) => {
    const today = new Date();
    let start = new Date(today.getFullYear(), today.getMonth(), 1);
    let end = today;

    if (preset === 'LAST_MONTH') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (preset === 'THIS_QUARTER') {
      start = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    } else if (preset === 'THIS_YEAR') {
      start = new Date(today.getFullYear(), 0, 1);
    } else if (preset === 'ALL_TIME') {
      const dates = journalEntries.map(entry => entry.date).sort();
      setReportStartDate(dates[0] ?? toDateInput(today));
      setReportEndDate(dates[dates.length - 1] ?? toDateInput(today));
      return;
    }

    setReportStartDate(toDateInput(start));
    setReportEndDate(toDateInput(end));
  };

  /** Detailed movements by account for the selected period. */
  const accountMovementRows = accounts.map(account => {
    let debit = 0;
    let credit = 0;
    periodEntries.forEach(entry => entry.lines.forEach(line => {
      if (line.accountCode === account.code) {
        if (line.type === 'DEBIT') debit += line.amount;
        else credit += line.amount;
      }
    }));
    const endingBalance = getAccountsWithBalances(asOfEntries, accounts).find(item => item.code === account.code)?.balance ?? 0;
    return { ...account, debit, credit, activity: debit + credit, endingBalance };
  }).filter(row => row.activity > 0 || Math.abs(row.endingBalance) > 0.001);

  /** VAT/sales-tax movements in the selected period. */
  const taxRows = sortedPeriodEntries.flatMap(entry =>
    entry.lines
      .filter(line => line.accountCode === '2200')
      .map(line => ({ ...line, date: entry.date, reference: entry.reference, description: entry.description }))
  );
  const taxCollected = taxRows.filter(row => row.type === 'CREDIT').reduce((sum, row) => sum + row.amount, 0);
  const taxPaid = taxRows.filter(row => row.type === 'DEBIT').reduce((sum, row) => sum + row.amount, 0);

  // Drills down from Chart of Accounts straight into dedicated ledger sheets
  const handleDrilldownToLedger = (code: string) => {
    setSelectedLedgerAccountCode(code);
    setActiveSubTab('ledger');
  };

  // General Ledger Calculations (including date filters & starting/ending balances)
  const getGeneralLedgerForAccount = (code: string) => {
    const account = accounts.find(a => a.code === code);
    if (!account) return { transactions: [], openingBalance: 0, totalDebits: 0, totalCredits: 0, endingBalance: 0 };

    const direction = getAccountBalanceDirection(account.type);
    let cumulativeBal = 0;
    let openingBalance = 0;
    let totalDebits = 0;
    let totalCredits = 0;

    // Sort entries chronologically to compute running bounds accurately
    const sortedEntries = [...journalEntries]
      .filter(entry => entry.lines.some(line => line.accountCode === code))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const filteredTransactions: { date: string; description: string; reference: string; type: 'DEBIT' | 'CREDIT'; amount: number; runningBalance: number }[] = [];

    sortedEntries.forEach(entry => {
      entry.lines.forEach(line => {
        if (line.accountCode === code) {
          const entryDateStr = entry.date;
          const isBeforeStart = ledgerStartDate && new Date(entryDateStr) < new Date(ledgerStartDate);
          const isAfterEnd = ledgerEndDate && new Date(entryDateStr) > new Date(ledgerEndDate);

          // Update general running values
          if (line.type === 'DEBIT') {
            cumulativeBal += direction === 'DEBIT' ? line.amount : -line.amount;
          } else {
            cumulativeBal += direction === 'CREDIT' ? line.amount : -line.amount;
          }

          if (isBeforeStart) {
            openingBalance = cumulativeBal;
          } else if (!isAfterEnd) {
            if (line.type === 'DEBIT') totalDebits += line.amount;
            if (line.type === 'CREDIT') totalCredits += line.amount;

            filteredTransactions.push({
              date: entry.date,
              description: entry.description,
              reference: entry.reference,
              type: line.type,
              amount: line.amount,
              runningBalance: parseFloat(cumulativeBal.toFixed(2))
            });
          }
        }
      });
    });

    return {
      transactions: filteredTransactions,
      openingBalance: parseFloat(openingBalance.toFixed(2)),
      totalDebits: parseFloat(totalDebits.toFixed(2)),
      totalCredits: parseFloat(totalCredits.toFixed(2)),
      endingBalance: parseFloat(cumulativeBal.toFixed(2))
    };
  };

  const ledgerData = getGeneralLedgerForAccount(selectedLedgerAccountCode);
  const selectedLedgerAccount = accounts.find(a => a.code === selectedLedgerAccountCode);

  // Simulated CSV Export triggers text download
  const handleExportCSV = () => {
    if (!selectedLedgerAccount) return;
    setExportSuccess(true);
    
    // Construct mock CSV text
    let csvContent = `Date,Description,Reference,Debit,Credit,Running Balance\n`;
    csvContent += `Opening Balance,,,,${ledgerData.openingBalance}\n`;
    ledgerData.transactions.forEach(t => {
      csvContent += `"${t.date}","${t.description}","${t.reference}",${t.type === 'DEBIT' ? t.amount : ''},${t.type === 'CREDIT' ? t.amount : ''},${t.runningBalance}\n`;
    });
    csvContent += `Closing Balance,,,,${ledgerData.endingBalance}\n`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `General_Ledger_${selectedLedgerAccount.code}_${selectedLedgerAccount.name.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => setExportSuccess(false), 2000);
  };

  // Chart of accounts Custom Account Insertion
  const handleAddAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCoaError('');
    setCoaSuccess(false);

    if (currentUser?.userType === 'AUDIT') {
      setCoaError('Security Warning: Accounts cannot be created under a Read-Only Audit session.');
      return;
    }

    if (!newAccCode.trim() || !newAccName.trim()) {
      setCoaError('Please complete all fields.');
      return;
    }

    const codeNum = parseInt(newAccCode);
    if (isNaN(codeNum) || codeNum < 1000 || codeNum > 9999) {
      setCoaError('Account codes must be 4-digit numbers (1000 - 9999).');
      return;
    }

    if (accounts.some(a => a.code === newAccCode.trim())) {
      setCoaError('An account with this ledger code already exists.');
      return;
    }

    const newAcc: Account = {
      code: newAccCode.trim(),
      name: newAccName.trim(),
      type: newAccType,
      balance: 0,
      description: newAccDesc.trim() || undefined,
      isSystem: false
    };

    onAddAccount(newAcc);
    setCoaSuccess(true);
    
    // reset form
    setNewAccCode('');
    setNewAccName('');
    setNewAccDesc('');
    setTimeout(() => {
      setIsAddAccOpen(false);
      setCoaSuccess(false);
    }, 1200);
  };

  const handleDeleteAccountClick = (code: string) => {
    const target = accounts.find(a => a.code === code);
    if (!target) return;

    if (currentUser?.userType === 'AUDIT') {
      alert('Security Warning: Deleting accounts is blocked under Read-Only Audit sessions.');
      return;
    }

    if (target.isSystem) {
      alert('System critical accounts cannot be deleted to protect ledger integrations.');
      return;
    }

    const linkedJEs = journalEntries.some(je => je.lines.some(l => l.accountCode === code));
    if (linkedJEs) {
      alert('Cannot delete this account because it has active historical transactions posted in the ledger database. Zero out entries first.');
      return;
    }

    const confirmDel = window.confirm(`Are you sure you want to delete account: "${target.code} - ${target.name}"?`);
    if (confirmDel) {
      onDeleteAccount(code);
    }
  };

  // Manual Journal Entry Form Helpers
  const addJeLine = () => {
    setJeLines([...jeLines, { accountCode: '1010', type: 'DEBIT', amount: '' }]);
  };

  const removeJeLine = (index: number) => {
    if (jeLines.length <= 2) {
      alert('A journal entry requires at least two lines.');
      return;
    }
    setJeLines(jeLines.filter((_, i) => i !== index));
  };

  const updateJeLine = (index: number, field: 'accountCode' | 'type' | 'amount', value: string) => {
    setJeLines(prevLines => {
      return prevLines.map((line, i) => {
        if (i === index) {
          return { ...line, [field]: value };
        }
        return line;
      });
    });
  };

  const submitManualJournalEntry = (e: React.FormEvent) => {
    e.preventDefault();
    setJeError('');
    setJeSuccess(false);

    if (currentUser?.userType === 'AUDIT') {
      setJeError('Security Warning: Posting manual adjusting general journals is locked under Read-Only Audit sessions.');
      return;
    }

    if (!jeDescription.trim()) {
      setJeError('Description is required.');
      return;
    }

    let totalDebits = 0;
    let totalCredits = 0;
    const formattedLines = [];

    for (const line of jeLines) {
      const amountNum = parseFloat(line.amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        setJeError('All debit and credit amounts must be positive numbers greater than zero.');
        return;
      }

      if (line.type === 'DEBIT') totalDebits += amountNum;
      if (line.type === 'CREDIT') totalCredits += amountNum;

      formattedLines.push({
        accountCode: line.accountCode,
        type: line.type,
        amount: parseFloat(amountNum.toFixed(2))
      });
    }

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      setJeError(`Unbalanced Journal Entry! Total Debits ($${totalDebits.toFixed(2)}) must equal Total Credits ($${totalCredits.toFixed(2)}). Difference is $${Math.abs(totalDebits - totalCredits).toFixed(2)}.`);
      return;
    }

    const newJE: JournalEntry = {
      id: `JE-MAN-${Date.now()}`,
      date: jeDate,
      description: jeDescription,
      reference: `MAN-JOURNAL-${Math.floor(100 + Math.random() * 900)}`,
      lines: formattedLines,
      createdBy: 'System Accountant'
    };

    onAddManualJournalEntry(newJE);
    setJeSuccess(true);
    
    // Reset Form
    setJeDescription('');
    setJeLines([
      { accountCode: '1010', type: 'DEBIT', amount: '' },
      { accountCode: '1020', type: 'CREDIT', amount: '' }
    ]);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
      
      {/* Navigation sub-tabs header */}
      <div className="bg-gray-50 border-b border-gray-100 px-6 py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Briefcase size={18} className="text-teal-600" /> GAAP General Ledger Console
          </h2>
          <p className="text-xs text-gray-400 mt-0.5 font-medium">Configure corporate charts, view audit trials, and balance trial summaries</p>
        </div>

        {/* Action Pills */}
        <div className="flex bg-white border border-gray-200 rounded-xl p-1 gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('coa')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'coa'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Grid size={14} /> Chart of Accounts
          </button>
          <button
            onClick={() => setActiveSubTab('ledger')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'ledger'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <BookOpen size={14} /> General Ledger sheets
          </button>
          <button
            onClick={() => setActiveSubTab('statements')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'statements'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <FileText size={14} /> Financial Statements
          </button>
          <button
            onClick={() => setActiveSubTab('entries')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'entries'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Layers size={14} /> Journal Entries
          </button>
          <button
            onClick={() => setActiveSubTab('manual')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'manual'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <PlusCircle size={14} /> Adjusting Posts
          </button>
        </div>
      </div>

      {/* Primary tab views content wrapper */}
      <div className="flex-1 overflow-y-auto p-6">
        
        {/* ================= TAB 1: CHART OF ACCOUNTS (NEW) ================= */}
        {activeSubTab === 'coa' && (
          <div className="space-y-6 animate-fade-in">
            
            {/* Header filters & Add account trigger */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Dynamic Chart of Accounts</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Seeded assets, liabilities, and operating resources. Select an account to scan its Ledger book.</p>
              </div>
              <button
                onClick={() => setIsAddAccOpen(true)}
                className="w-full sm:w-auto bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow"
              >
                <Plus size={14} /> Create Account
              </button>
            </div>

            {/* Categorized Acc Lists */}
            {(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as AccountType[]).map((type) => {
              const typedAccounts = accountsWithBalances.filter(a => a.type === type);
              return (
                <div key={type} className="space-y-2">
                  <h4 className={`text-[10px] font-black uppercase tracking-widest px-1 py-0.5 rounded border-b w-fit ${
                    type === 'ASSET' ? 'text-teal-700 border-teal-200 bg-teal-50' :
                    type === 'LIABILITY' ? 'text-amber-700 border-amber-200 bg-amber-50' :
                    type === 'EQUITY' ? 'text-blue-700 border-blue-200 bg-blue-50' :
                    type === 'REVENUE' ? 'text-emerald-700 border-emerald-200 bg-emerald-50' :
                    'text-purple-700 border-purple-200 bg-purple-50'
                  }`}>
                    {type} Accounts ({type === 'ASSET' || type === 'EXPENSE' ? 'Debit Dr' : 'Credit Cr'})
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {typedAccounts.map((acc) => (
                      <div 
                        key={acc.code} 
                        className="bg-gray-50/50 border border-gray-100 hover:border-gray-200 rounded-2xl p-4 flex flex-col justify-between gap-3 shadow-xs transition-all relative overflow-hidden group"
                      >
                        <div>
                          <div className="flex justify-between items-start">
                            <span className="font-mono text-xs font-bold text-gray-400">#{acc.code}</span>
                            {acc.isSystem && (
                              <span className="text-[8px] bg-gray-200 text-gray-600 py-0.5 px-1.5 rounded font-black uppercase tracking-wider flex items-center gap-1">
                                <Lock size={8} /> Core System
                              </span>
                            )}
                          </div>
                          
                          <h5 className="text-xs font-black text-gray-800 mt-1">{acc.name}</h5>
                          {acc.description && (
                            <p className="text-[10px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">{acc.description}</p>
                          )}
                        </div>

                        <div className="flex justify-between items-center pt-2.5 border-t border-gray-100/60">
                          <div>
                            <span className="text-[8px] text-gray-400 uppercase font-black block">LEDGER BALANCE</span>
                            <span className="text-sm font-black text-teal-700 font-mono">
                              {businessProfile.currency}{acc.balance.toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {!acc.isSystem && (
                              <button
                                onClick={() => handleDeleteAccountClick(acc.code)}
                                className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                                title="Delete account configuration"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDrilldownToLedger(acc.code)}
                              className="text-[10px] font-bold text-teal-600 bg-white group-hover:bg-teal-600 border border-gray-100 group-hover:border-teal-600 group-hover:text-white py-1.5 px-3 rounded-xl transition-all cursor-pointer"
                            >
                              Ledger Sheet →
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

          </div>
        )}

        {/* ================= TAB 2: GENERAL LEDGER SHEET (ENHANCED) ================= */}
        {activeSubTab === 'ledger' && (
          <div className="space-y-6 animate-fade-in">
            
            {/* Header controls & Filters */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-gray-50 border border-gray-100 rounded-2xl p-4.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Target Account *</label>
                  <select
                    value={selectedLedgerAccountCode}
                    onChange={(e) => setSelectedLedgerAccountCode(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    {accounts.map(a => (
                      <option key={a.code} value={a.code}>
                        {a.code} — {a.name} ({a.type})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                    <Filter size={11} /> Filter Start Date
                  </label>
                  <input
                    type="date"
                    value={ledgerStartDate}
                    onChange={(e) => setLedgerStartDate(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl py-1.5 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                    <Filter size={11} /> Filter End Date
                  </label>
                  <input
                    type="date"
                    value={ledgerEndDate}
                    onChange={(e) => setLedgerEndDate(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl py-1.5 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
              </div>

              {/* Action utilities */}
              <div className="flex gap-2 w-full md:w-auto">
                <button
                  onClick={() => {
                    setLedgerStartDate('');
                    setLedgerEndDate('');
                  }}
                  className="flex-1 bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-semibold py-2 px-3.5 rounded-xl text-xs whitespace-nowrap"
                >
                  Reset Filters
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Download size={13} /> Export GL (.csv)
                </button>
              </div>
            </div>

            {/* General Ledger analytical metrics summary */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 text-center">
                <span className="text-[9px] text-gray-400 font-bold block uppercase">Opening Balance</span>
                <span className="text-sm font-black text-gray-800 font-mono mt-0.5 block">
                  {businessProfile.currency}{ledgerData.openingBalance.toFixed(2)}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 text-center">
                <span className="text-[9px] text-teal-600 font-bold block uppercase">Range Dr Charges</span>
                <span className="text-sm font-black text-teal-700 font-mono mt-0.5 block">
                  +{businessProfile.currency}{ledgerData.totalDebits.toFixed(2)}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 text-center">
                <span className="text-[9px] text-amber-600 font-bold block uppercase">Range Cr Offsets</span>
                <span className="text-sm font-black text-amber-700 font-mono mt-0.5 block">
                  -{businessProfile.currency}{ledgerData.totalCredits.toFixed(2)}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 text-center">
                <span className="text-[9px] text-gray-400 font-bold block uppercase">Net Change</span>
                <span className="text-sm font-black text-gray-800 font-mono mt-0.5 block">
                  {ledgerData.totalDebits - ledgerData.totalCredits >= 0 ? '+' : ''}
                  {businessProfile.currency}{(ledgerData.totalDebits - ledgerData.totalCredits).toFixed(2)}
                </span>
              </div>
              <div className="bg-teal-50 border border-teal-100 rounded-2xl p-3 text-center col-span-2 sm:col-span-1">
                <span className="text-[9px] text-teal-800 font-bold block uppercase">Closing Balance</span>
                <span className="text-base font-black text-teal-700 font-mono mt-0.5 block">
                  {businessProfile.currency}{ledgerData.endingBalance.toFixed(2)}
                </span>
              </div>
            </div>

            {exportSuccess && (
              <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-2 rounded-lg font-bold flex items-center justify-center gap-1 animate-fade-in">
                <CheckCircle size={14} /> Audit Ledger CSV compiled and downloaded!
              </p>
            )}

            {/* General Ledger Table Sheet */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider font-bold border-b border-gray-100">
                      <th className="py-3 px-4 w-28">Post Date</th>
                      <th className="py-3 px-4">Transaction Details / Journal Title</th>
                      <th className="py-3 px-4 w-32">Reference #</th>
                      <th className="py-3 px-4 text-right w-28">Debit (Dr)</th>
                      <th className="py-3 px-4 text-right w-28">Credit (Cr)</th>
                      <th className="py-3 px-4 text-right w-36">Ledger Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr className="bg-gray-50/20 italic font-medium text-gray-400">
                      <td className="py-2.5 px-4 font-mono">{ledgerStartDate || '—'}</td>
                      <td className="py-2.5 px-4" colSpan={4}>[Opening Balance Brought Forward]</td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-gray-500">
                        {businessProfile.currency}{ledgerData.openingBalance.toFixed(2)}
                      </td>
                    </tr>

                    {ledgerData.transactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-gray-400 italic">
                          No transactions posted within the selected filter bounds.
                        </td>
                      </tr>
                    ) : (
                      ledgerData.transactions.map((line, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4 text-gray-500 font-mono">{line.date}</td>
                          <td className="py-3 px-4 font-semibold text-gray-800">{line.description}</td>
                          <td className="py-3 px-4 font-mono text-gray-400 uppercase text-[10px]">{line.reference}</td>
                          <td className="py-3 px-4 text-right font-mono text-gray-700">
                            {line.type === 'DEBIT' ? `${businessProfile.currency}${line.amount.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-gray-700">
                            {line.type === 'CREDIT' ? `${businessProfile.currency}${line.amount.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-teal-600 bg-teal-50/10">
                            {businessProfile.currency}{line.runningBalance.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 3: FINANCIAL STATEMENTS ================= */}
        {activeSubTab === 'statements' && (
          <div className="space-y-6 animate-fade-in">
            
            <div className="flex border-b border-gray-100 pb-3 gap-5 overflow-x-auto">
              <button
                onClick={() => setStatementType('p&l')}
                className={`pb-2 text-xs font-bold whitespace-nowrap transition-all relative cursor-pointer ${
                  statementType === 'p&l' ? 'text-teal-600 font-extrabold' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Profit & Loss
                {statementType === 'p&l' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
              </button>
              <button
                onClick={() => setStatementType('balance_sheet')}
                className={`pb-2 text-xs font-bold whitespace-nowrap transition-all relative cursor-pointer ${
                  statementType === 'balance_sheet' ? 'text-teal-600 font-extrabold' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Balance Sheet
                {statementType === 'balance_sheet' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
              </button>
              <button
                onClick={() => setStatementType('trial_balance')}
                className={`pb-2 text-xs font-bold whitespace-nowrap transition-all relative cursor-pointer ${
                  statementType === 'trial_balance' ? 'text-teal-600 font-extrabold' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Trial Balance
                {statementType === 'trial_balance' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
              </button>
              <button
                onClick={() => setStatementType('tax_summary')}
                className={`pb-2 text-xs font-bold whitespace-nowrap transition-all relative cursor-pointer ${
                  statementType === 'tax_summary' ? 'text-teal-600 font-extrabold' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Tax Summary
                {statementType === 'tax_summary' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
              </button>
              <button
                onClick={() => setStatementType('account_movement')}
                className={`pb-2 text-xs font-bold whitespace-nowrap transition-all relative cursor-pointer ${
                  statementType === 'account_movement' ? 'text-teal-600 font-extrabold' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Account Movement
                {statementType === 'account_movement' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
              </button>
              <button
                onClick={() => setStatementType('ar_aging')}
                className={`pb-2 text-xs font-bold whitespace-nowrap transition-all relative cursor-pointer ${
                  statementType === 'ar_aging' ? 'text-teal-600 font-extrabold' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                A/R Aging
                {statementType === 'ar_aging' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
              </button>
              <button
                onClick={() => setStatementType('ap_aging')}
                className={`pb-2 text-xs font-bold whitespace-nowrap transition-all relative cursor-pointer ${
                  statementType === 'ap_aging' ? 'text-teal-600 font-extrabold' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                A/P Aging
                {statementType === 'ap_aging' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
              </button>
              <button
                onClick={() => {
                  setStatementType('customer_statement');
                  if (customers.length > 0 && !selectedStatementCustomerId) {
                    setSelectedStatementCustomerId(customers[0].id);
                  }
                }}
                className={`pb-2 text-xs font-bold whitespace-nowrap transition-all relative cursor-pointer ${
                  statementType === 'customer_statement' ? 'text-teal-600 font-extrabold' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Customer Statement
                {statementType === 'customer_statement' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
              </button>
              <button
                onClick={() => {
                  setStatementType('supplier_statement');
                  if (suppliers.length > 0 && !selectedStatementSupplierId) {
                    setSelectedStatementSupplierId(suppliers[0].id);
                  }
                }}
                className={`pb-2 text-xs font-bold whitespace-nowrap transition-all relative cursor-pointer ${
                  statementType === 'supplier_statement' ? 'text-teal-600 font-extrabold' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Supplier Statement
                {statementType === 'supplier_statement' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
              </button>
            </div>

            {/* Global fiscal period and sort controls affect all open reports. */}
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 print:hidden">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">Period start</label>
                    <input type="date" value={reportStartDate} max={reportEndDate} onChange={(e) => setReportStartDate(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-mono" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">Period end / as of</label>
                    <input type="date" value={reportEndDate} min={reportStartDate} onChange={(e) => setReportEndDate(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-mono" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">Transaction order</label>
                    <select value={reportSort} onChange={(e) => setReportSort(e.target.value as 'ASC' | 'DESC')} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold">
                      <option value="DESC">Newest first</option>
                      <option value="ASC">Oldest first</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ['THIS_MONTH', 'This Month'],
                    ['LAST_MONTH', 'Last Month'],
                    ['THIS_QUARTER', 'This Quarter'],
                    ['THIS_YEAR', 'This Year'],
                    ['ALL_TIME', 'All Time']
                  ] as [ReportPreset, string][]).map(([preset, label]) => (
                    <button key={preset} type="button" onClick={() => applyReportPreset(preset)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[10px] font-bold text-gray-600 hover:border-teal-300 hover:text-teal-700">
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 border-t border-gray-200 pt-3 text-[10px] font-semibold text-gray-500">
                <span>Period journals: <b className="text-gray-800">{periodEntries.length}</b></span>
                <span>Source lines: <b className="text-gray-800">{periodEntries.reduce((sum, entry) => sum + entry.lines.length, 0)}</b></span>
                <span>Previous comparison: <b className="text-gray-800">{toDateInput(previousStart)} to {toDateInput(previousEnd)}</b></span>
              </div>
            </div>

            <div className="max-w-5xl mx-auto bg-gray-50 border border-gray-100 rounded-2xl p-6 sm:p-8 shadow-xs">
              
              <div className="text-center mb-8 border-b border-gray-200 pb-5">
                <span className="text-[10px] bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">GAAP Standard compliant</span>
                <h3 className="text-lg font-black text-gray-800 uppercase mt-2">{businessProfile.name}</h3>
                <h4 className="text-sm font-bold text-gray-600">
                  {statementType === 'p&l' && 'Statement of Profit and Loss (Income Statement)'}
                  {statementType === 'balance_sheet' && 'Real-time Statement of Financial Position (Balance Sheet)'}
                  {statementType === 'trial_balance' && 'Adjusted Trial Balance'}
                  {statementType === 'tax_summary' && 'Sales Tax / VAT Collection and Remittance Report'}
                  {statementType === 'account_movement' && 'Detailed Account Movement and Closing Balance Schedule'}
                  {statementType === 'ar_aging' && 'Accounts Receivable (A/R) Aging Analysis'}
                  {statementType === 'ap_aging' && 'Accounts Payable (A/P) Aging Analysis'}
                  {statementType === 'customer_statement' && 'Customer Account Statement'}
                  {statementType === 'supplier_statement' && 'Supplier Account Statement'}
                </h4>
                <p className="text-[11px] text-gray-400 mt-1 pb-4">
                  Period: <span className="font-mono">{reportStartDate}</span> to <span className="font-mono">{reportEndDate}</span> | Currency: {businessProfile.currency}
                </p>

                {/* SHARED DISPATCH ACTIONS PANEL FOR FINANCIAL REPORTS */}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-gray-150 print:hidden">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold py-1.5 px-3 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Printer size={13} /> Export PDF
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      const todayStr = reportEndDate;
                      // Strict PDF audit warning
                      alert(`SECURE REPORT PROTOCOL:\nAll financial reports for ${businessProfile.name} must be shared in PDF format.\n\nClick OK to save the "${statementType}" report as PDF, then attach it in WhatsApp.`);

                      // Trigger PDF generation instantly
                      window.print();

                      // Construct companion text details instructing attachment of PDF
                      let companionText = `*${businessProfile.name} Financial Report Statement*\n`;
                      companionText += `Report Type: ${statementType.toUpperCase().replace(/_/g, ' ')}\n`;
                      companionText += `Reporting Period: ${reportStartDate} to ${reportEndDate}\n`;
                      companionText += `[Awaiting PDF Attachment: Afritecx_Badboy_${statementType}_${todayStr}.pdf]\n\n`;
                      companionText += `Expected balances, transaction logs, and ledger offsets are detailed inside the secure attached PDF.`;

                      const url = `https://wa.me/?text=${encodeURIComponent(companionText)}`;
                      window.open(url, '_blank');
                    }}
                    className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Send size={13} /> Share WhatsApp
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const subject = `${businessProfile.name} - Financial Statement (${statementType}) - ${reportStartDate} to ${reportEndDate}`;
                      let body = `Dear Board,\n\nPlease find the compiled report for ${reportStartDate} to ${reportEndDate}:\n\n`;

                      if (statementType === 'p&l') {
                        body += `Total Revenue: ${formatCurrency(pAndL.totalRevenue, businessProfile.currency)}\n`;
                        body += `COGS Cost: ${formatCurrency(pAndL.cogs, businessProfile.currency)}\n`;
                        body += `Gross Profit Margin: ${formatCurrency(pAndL.grossProfit, businessProfile.currency)}\n`;
                        body += `Operating Expenses: ${formatCurrency(pAndL.totalExpenses, businessProfile.currency)}\n`;
                        body += `Net Income: ${formatCurrency(pAndL.netIncome, businessProfile.currency)}\n`;
                      } else if (statementType === 'balance_sheet') {
                        body += `Total Assets: ${formatCurrency(balanceSheet.totalAssets, businessProfile.currency)}\n`;
                        body += `Total Liabilities: ${formatCurrency(balanceSheet.totalLiabilities, businessProfile.currency)}\n`;
                        body += `Total Equity: ${formatCurrency(balanceSheet.totalEquity, businessProfile.currency)}\n`;
                      } else {
                        body += `Report code classification: ${statementType}\n`;
                      }

                      body += `\nBest regards,\nAccounting Auditor Team`;

                      const mailUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                      window.location.href = mailUrl;
                    }}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold py-1.5 px-3 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Mail size={13} /> Email Statement
                  </button>
                </div>
              </div>

              {/* P&L */}
              {statementType === 'p&l' && (
                <div className="space-y-6">
                  {/* Current-period versus previous equal-length period comparison. */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Revenue', pAndL.totalRevenue, previousPAndL.totalRevenue],
                      ['Gross Profit', pAndL.grossProfit, previousPAndL.grossProfit],
                      ['Operating Costs', pAndL.totalExpenses, previousPAndL.totalExpenses],
                      ['Net Income', pAndL.netIncome, previousPAndL.netIncome]
                    ].map(([label, current, previous]) => {
                      const currentValue = current as number;
                      const previousValue = previous as number;
                      const change = Math.abs(previousValue) > 0.001
                        ? ((currentValue - previousValue) / Math.abs(previousValue)) * 100
                        : currentValue === 0 ? 0 : 100;
                      return (
                        <div key={label as string} className="rounded-xl border border-gray-100 bg-white p-3">
                          <span className="block text-[9px] font-black uppercase text-gray-400">{label}</span>
                          <span className="mt-1 block text-sm font-black text-gray-800">{formatCurrency(currentValue, businessProfile.currency)}</span>
                          <span className={`mt-1 block text-[9px] font-bold ${change >= 0 ? 'text-teal-600' : 'text-red-600'}`}>
                            {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs previous period
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200 pb-1.5 mb-2 flex justify-between">
                      <span>1. REVENUE</span>
                      <span className="text-gray-400">Codes 4000-4999</span>
                    </h5>
                    <div className="space-y-1.5">
                      {pAndL.revenue.map((r, i) => (
                        <div key={i} className="flex justify-between text-sm text-gray-700 pl-4">
                          <span className="font-medium">{r.code} - {r.name}</span>
                          <span className="font-mono">{businessProfile.currency}{r.balance.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm font-bold text-gray-900 border-t border-gray-200 pt-1.5 mt-2 pl-2">
                        <span>Total Sales Revenue</span>
                        <span className="font-mono">{businessProfile.currency}{pAndL.totalRevenue.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl p-4 border border-gray-100">
                    <div className="flex justify-between text-sm text-gray-700 border-b border-gray-100 pb-2">
                      <span className="font-bold">5010 - Cost of Goods Sold (COGS)</span>
                      <span className="font-mono font-semibold text-red-600">-{businessProfile.currency}{pAndL.cogs.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-base font-black text-teal-800 pt-2">
                      <span>GROSS PROFIT:</span>
                      <span className="font-mono">{businessProfile.currency}{pAndL.grossProfit.toFixed(2)}</span>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200 pb-1.5 mb-2 flex justify-between">
                      <span>2. OPERATING EXPENSES</span>
                      <span className="text-gray-400">Codes 6000-6999</span>
                    </h5>
                    <div className="space-y-1.5">
                      {pAndL.expenses.length === 0 ? (
                        <p className="text-xs text-gray-400 italic pl-4 py-2">No operating expenses recorded yet.</p>
                      ) : (
                        pAndL.expenses.map((e, i) => (
                          <div key={i} className="flex justify-between text-sm text-gray-700 pl-4">
                            <span className="font-medium">{e.code} - {e.name}</span>
                            <span className="font-mono text-gray-600">{businessProfile.currency}{e.balance.toFixed(2)}</span>
                          </div>
                        ))
                      )}
                      <div className="flex justify-between text-sm font-bold text-gray-900 border-t border-gray-200 pt-1.5 mt-2 pl-2">
                        <span>Total Operating Expenses</span>
                        <span className="font-mono text-red-600">{businessProfile.currency}{pAndL.totalExpenses.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className={`p-5 rounded-xl border flex flex-col sm:flex-row justify-between items-center ${
                    pAndL.netIncome >= 0 
                      ? 'bg-teal-50 border-teal-100 text-teal-900' 
                      : 'bg-red-50 border-red-100 text-red-900'
                  }`}>
                    <div className="text-center sm:text-left mb-2 sm:mb-0">
                      <h4 className="text-sm font-black uppercase tracking-wide">Net Business Performance</h4>
                      <p className="text-xs text-gray-500 mt-0.5">Bottom line Profit / Loss after cost margins & expenses</p>
                    </div>
                    <div className="text-center sm:text-right">
                      <span className="text-xs text-gray-400 block font-semibold uppercase">NET INCOME:</span>
                      <span className={`text-2xl font-black font-mono ${pAndL.netIncome >= 0 ? 'text-teal-600' : 'text-red-600'}`}>
                        {pAndL.netIncome < 0 ? '-' : ''}{businessProfile.currency}{Math.abs(pAndL.netIncome).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sales tax / VAT collections and payments for the selected period. */}
              {statementType === 'tax_summary' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-center">
                      <span className="block text-[9px] font-black uppercase text-teal-800">Tax collected</span>
                      <span className="mt-1 block text-lg font-black text-teal-700">{formatCurrency(taxCollected, businessProfile.currency)}</span>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-center">
                      <span className="block text-[9px] font-black uppercase text-amber-800">Tax paid / remitted</span>
                      <span className="mt-1 block text-lg font-black text-amber-700">{formatCurrency(taxPaid, businessProfile.currency)}</span>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
                      <span className="block text-[9px] font-black uppercase text-gray-500">Net period liability movement</span>
                      <span className="mt-1 block text-lg font-black text-gray-800">{formatCurrency(taxCollected - taxPaid, businessProfile.currency)}</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-100 text-[10px] uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-2">Date</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Collected</th><th className="px-3 py-2 text-right">Paid</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {taxRows.length === 0 ? (
                          <tr><td colSpan={5} className="px-3 py-8 text-center italic text-gray-400">No sales tax activity in this period.</td></tr>
                        ) : taxRows.map((row, index) => (
                          <tr key={`${row.reference}-${index}`}>
                            <td className="px-3 py-2 font-mono text-gray-500">{row.date}</td>
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-500">{row.reference}</td>
                            <td className="px-3 py-2 font-semibold text-gray-700">{row.description}</td>
                            <td className="px-3 py-2 text-right font-mono text-teal-700">{row.type === 'CREDIT' ? formatCurrency(row.amount, businessProfile.currency) : '—'}</td>
                            <td className="px-3 py-2 text-right font-mono text-amber-700">{row.type === 'DEBIT' ? formatCurrency(row.amount, businessProfile.currency) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Debit/credit turnover and closing balances by account. */}
              {statementType === 'account_movement' && (
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-100 text-[10px] uppercase text-gray-500">
                      <tr>
                        <th className="px-3 py-2">Code</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Class</th><th className="px-3 py-2 text-right">Period debits</th><th className="px-3 py-2 text-right">Period credits</th><th className="px-3 py-2 text-right">Turnover</th><th className="px-3 py-2 text-right">Closing balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {accountMovementRows.map(row => (
                        <tr key={row.code} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono text-gray-500">{row.code}</td>
                          <td className="px-3 py-2 font-bold text-gray-800">{row.name}</td>
                          <td className="px-3 py-2 text-[10px] font-bold text-gray-500">{row.type}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(row.debit, businessProfile.currency)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(row.credit, businessProfile.currency)}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">{formatCurrency(row.activity, businessProfile.currency)}</td>
                          <td className="px-3 py-2 text-right font-mono font-black text-teal-700">{formatCurrency(row.endingBalance, businessProfile.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Balance Sheet */}
              {statementType === 'balance_sheet' && (
                <div className="space-y-6">
                  <div>
                    <h5 className="text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200 pb-1.5 mb-2 flex justify-between">
                      <span>ASSETS (DEBITS)</span>
                      <span className="text-teal-600 font-bold">1000 - 1999</span>
                    </h5>
                    <div className="space-y-1.5 pl-4">
                      {balanceSheet.assets.map((a, i) => (
                        <div key={i} className="flex justify-between text-sm text-gray-700">
                          <span className="font-medium">{a.code} - {a.name}</span>
                          <span className="font-mono">{businessProfile.currency}{a.balance.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm font-black text-gray-900 border-t border-gray-200 pt-1.5 mt-2 pl-2 bg-gray-100/50 p-2 rounded-lg">
                        <span>TOTAL ASSETS:</span>
                        <span className="font-mono">{businessProfile.currency}{balanceSheet.totalAssets.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200 pb-1.5 mb-2 flex justify-between">
                      <span>LIABILITIES (CREDITS)</span>
                      <span className="text-amber-600 font-bold">2000 - 2999</span>
                    </h5>
                    <div className="space-y-1.5 pl-4">
                      {balanceSheet.liabilities.map((l, i) => (
                        <div key={i} className="flex justify-between text-sm text-gray-700">
                          <span className="font-medium">{l.code} - {l.name}</span>
                          <span className="font-mono">{businessProfile.currency}{l.balance.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm font-black text-gray-900 border-t border-gray-200 pt-1.5 mt-2 pl-2 bg-gray-100/50 p-2 rounded-lg">
                        <span>TOTAL LIABILITIES:</span>
                        <span className="font-mono">{businessProfile.currency}{balanceSheet.totalLiabilities.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200 pb-1.5 mb-2 flex justify-between">
                      <span>EQUITY (CREDITS)</span>
                      <span className="text-blue-600 font-bold">3000 - 3999</span>
                    </h5>
                    <div className="space-y-1.5 pl-4">
                      {balanceSheet.equity.map((eq, i) => (
                        <div key={i} className="flex justify-between text-sm text-gray-700">
                          <span className="font-medium">{eq.code} - {eq.name}</span>
                          <span className="font-mono">{businessProfile.currency}{eq.balance.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm text-teal-700 italic font-medium pl-0.5 border-b border-dotted border-gray-200 pb-1.5 mb-1.5">
                        <span>[Linked] Retained Earnings (Current Net Income)</span>
                        <span className="font-mono">{businessProfile.currency}{balanceSheet.netIncomeAddition.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-black text-gray-900 border-t border-gray-200 pt-1.5 mt-2 pl-2 bg-gray-100/50 p-2 rounded-lg">
                        <span>TOTAL OWNER EQUITY:</span>
                        <span className="font-mono">{businessProfile.currency}{balanceSheet.totalEquity.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t-2 border-double border-gray-300 pt-4 flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row justify-between text-sm font-bold text-gray-900 px-2 bg-teal-50/50 p-3 rounded-xl border border-teal-100">
                      <span>TOTAL LIABILITIES & EQUITY:</span>
                      <span className="font-mono font-extrabold">
                        {businessProfile.currency}{(balanceSheet.totalLiabilities + balanceSheet.totalEquity).toFixed(2)}
                      </span>
                    </div>

                    {Math.abs(balanceSheet.totalAssets - (balanceSheet.totalLiabilities + balanceSheet.totalEquity)) < 0.05 ? (
                      <div className="flex items-center gap-2 text-xs text-teal-700 font-semibold bg-teal-100/50 py-2 px-3.5 rounded-xl border border-teal-200 w-full justify-center">
                        <CheckCircle size={15} /> Balance Sheet Verified: Assets = Liabilities + Equity (Balanced perfectly!)
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-red-700 font-semibold bg-red-100/50 py-2 px-3.5 rounded-xl border border-red-200 w-full justify-center">
                        <AlertCircle size={15} /> Warning: Out of Balance by {businessProfile.currency}{Math.abs(balanceSheet.totalAssets - (balanceSheet.totalLiabilities + balanceSheet.totalEquity)).toFixed(2)}. Double check manual postings!
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Trial Balance */}
              {statementType === 'trial_balance' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-gray-300 text-gray-500 uppercase tracking-wider font-bold">
                          <th className="py-2.5">Code</th>
                          <th className="py-2.5">Account Name</th>
                          <th className="py-2.5">Type</th>
                          <th className="py-2.5 text-right">Debit Balance</th>
                          <th className="py-2.5 text-right">Credit Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {trialBalance.rows.map((row, i) => (
                          <tr key={i} className="hover:bg-white/40 transition-colors">
                            <td className="py-2 font-mono text-gray-600">{row.code}</td>
                            <td className="py-2 font-semibold text-gray-800">{row.name}</td>
                            <td className="py-2"><span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-md font-bold">{row.type}</span></td>
                            <td className="py-2 text-right font-mono font-medium text-gray-700">{row.debit > 0 ? `${businessProfile.currency}${row.debit.toFixed(2)}` : '—'}</td>
                            <td className="py-2 text-right font-mono font-medium text-gray-700">{row.credit > 0 ? `${businessProfile.currency}${row.credit.toFixed(2)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-double border-gray-400 font-black text-gray-900 bg-gray-100">
                          <td colSpan={3} className="py-3 pl-2 text-right uppercase">Adjusted Totals:</td>
                          <td className="py-3 text-right font-mono">{businessProfile.currency}{trialBalance.totalDebit.toFixed(2)}</td>
                          <td className="py-3 text-right font-mono">{businessProfile.currency}{trialBalance.totalCredit.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/*
                    This banner states only what has actually been checked. It used
                    to read "System Integrity Verified" on the strength of the trial
                    balance alone, which said nothing about individual postings.
                  */}
                  {trialBalance.isBalanced && unbalancedEntryIds.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs text-teal-700 font-semibold bg-teal-100/50 py-2.5 px-4 rounded-xl border border-teal-200 w-full justify-center mt-3">
                      <Scale size={15} /> Debits equal credits ({money(trialBalance.totalDebit)}) across {journalEntries.length} journal entries, and every entry balances individually.
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-xs text-red-700 font-semibold bg-red-100/50 py-2.5 px-4 rounded-xl border border-red-200 w-full justify-center mt-3">
                      <span className="flex items-center gap-2">
                        <AlertCircle size={15} /> Trial balance is out by {money(Math.abs(trialBalance.totalDebit - trialBalance.totalCredit))}.
                      </span>
                      {unbalancedEntryIds.length > 0 && (
                        <span className="text-[10px] font-normal">
                          {unbalancedEntryIds.length} journal entr{unbalancedEntryIds.length === 1 ? 'y is' : 'ies are'} individually unbalanced: {unbalancedEntryIds.slice(0, 5).join(', ')}
                          {unbalancedEntryIds.length > 5 ? '…' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* D. ACCOUNTS RECEIVABLE AGING ANALYSIS */}
              {statementType === 'ar_aging' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-gray-300 text-gray-500 uppercase tracking-wider font-bold">
                          <th className="py-2 px-1">Customer Account</th>
                          {AGING_BUCKETS.map(bucket => (
                            <th key={bucket.key} className="py-2 text-right">{bucket.label}</th>
                          ))}
                          <th className="py-2 text-right">Total Outstanding</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {receivablesAging.length === 0 && (
                          <tr>
                            <td colSpan={AGING_BUCKETS.length + 2} className="py-6 text-center text-gray-400 italic">
                              No outstanding credit sales. Every invoice is settled.
                            </td>
                          </tr>
                        )}
                        {receivablesAging.map(row => (
                          <tr key={row.id} className="hover:bg-white/40">
                            <td className="py-2 px-1 font-bold text-gray-800">{row.name}</td>
                            {AGING_BUCKETS.map(bucket => (
                              <td key={bucket.key} className="py-2 text-right font-mono text-gray-600">
                                {money(row[bucket.key])}
                              </td>
                            ))}
                            <td className="py-2 text-right font-mono font-black text-rose-600">
                              {money(row.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-double border-gray-400 font-black text-gray-900 bg-gray-100">
                          <td className="py-2 px-1 uppercase">Portfolio Totals:</td>
                          {AGING_BUCKETS.map(bucket => (
                            <td key={bucket.key} className="py-2 text-right font-mono">
                              {money(receivablesTotals[bucket.key])}
                            </td>
                          ))}
                          <td className="py-2 text-right font-mono text-rose-600">
                            {money(receivablesTotals.total)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="text-[10px] text-gray-400 italic">
                    Each bucket is aged from the posting date of the individual credit sale, so the schedule
                    reconciles back to account 1100 Accounts Receivable.
                  </p>
                </div>
              )}

              {statementType === 'ap_aging' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-gray-300 text-gray-500 uppercase tracking-wider font-bold">
                          <th className="py-2 px-1">Supplier Account</th>
                          {AGING_BUCKETS.map(bucket => (
                            <th key={bucket.key} className="py-2 text-right">{bucket.label}</th>
                          ))}
                          <th className="py-2 text-right">Total Outstanding</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {payablesAging.length === 0 && (
                          <tr>
                            <td colSpan={AGING_BUCKETS.length + 2} className="py-6 text-center text-gray-400 italic">
                              No outstanding supplier invoices. Every purchase order is settled.
                            </td>
                          </tr>
                        )}
                        {payablesAging.map(row => (
                          <tr key={row.id} className="hover:bg-white/40">
                            <td className="py-2 px-1 font-bold text-gray-800">{row.name}</td>
                            {AGING_BUCKETS.map(bucket => (
                              <td key={bucket.key} className="py-2 text-right font-mono text-gray-600">
                                {money(row[bucket.key])}
                              </td>
                            ))}
                            <td className="py-2 text-right font-mono font-black text-amber-600">
                              {money(row.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-double border-gray-400 font-black text-gray-900 bg-gray-100">
                          <td className="py-2 px-1 uppercase">Portfolio Totals:</td>
                          {AGING_BUCKETS.map(bucket => (
                            <td key={bucket.key} className="py-2 text-right font-mono">
                              {money(payablesTotals[bucket.key])}
                            </td>
                          ))}
                          <td className="py-2 text-right font-mono text-amber-600">
                            {money(payablesTotals.total)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="text-[10px] text-gray-400 italic">
                    Each bucket is aged from the purchase order date of unpaid supplier invoices, so the
                    schedule reconciles back to account 2010 Accounts Payable.
                  </p>
                </div>
              )}

              {/* F. INTERACTIVE CUSTOMER ACCOUNT STATEMENT LEDGER */}
              {statementType === 'customer_statement' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 bg-white p-3 border border-gray-150 rounded-xl">
                    <span className="text-xs font-bold text-gray-500 uppercase">Focus Client:</span>
                    <select
                      value={selectedStatementCustomerId}
                      onChange={(e) => setSelectedStatementCustomerId(e.target.value)}
                      className="bg-gray-50 border border-gray-200 rounded-lg py-1 px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
                    >
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>{c.name} (Credit: {businessProfile.currency}{c.storeCredit.toFixed(2)})</option>
                      ))}
                    </select>
                    <button 
                      onClick={() => window.print()}
                      className="ml-auto text-xs bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-700 py-1.5 px-3 rounded-lg font-bold flex items-center gap-1 cursor-pointer"
                    >
                      Print Statement
                    </button>
                  </div>

                  {(() => {
                    const client = customers.find(c => c.id === selectedStatementCustomerId);
                    if (!client) return <p className="text-xs text-gray-400 italic py-4 text-center">No customer selected.</p>;

                    // Filter JEs posted to A/R (1100) referencing this customer
                    const matchingJEs = periodEntries
                      .filter(je => je.lines.some(l => l.accountCode === '1100') && 
                                    je.description.toLowerCase().includes(client.name.toLowerCase()))
                      .sort((a, b) => {
                        const difference = new Date(a.date).getTime() - new Date(b.date).getTime();
                        return reportSort === 'ASC' ? difference : -difference;
                      });

                    let runningArBal = 0;

                    return (
                      <div className="space-y-4">
                        <div className="border border-gray-200 rounded-xl overflow-hidden">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                                <th className="py-2 px-3">Date</th>
                                <th className="py-2 px-3">Transaction Details</th>
                                <th className="py-2 px-3">Doc Ref</th>
                                <th className="py-2 px-3 text-right">Debit (Charge)</th>
                                <th className="py-2 px-3 text-right">Credit (Receipt)</th>
                                <th className="py-2 px-3 text-right">Outstanding Tab</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                              {matchingJEs.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="py-8 text-center text-gray-400 italic">No historical A/R activities found for this customer profile.</td>
                                </tr>
                              ) : (
                                matchingJEs.map((je, idx) => {
                                  const arLine = je.lines.find(l => l.accountCode === '1100');
                                  if (!arLine) return null;

                                  const isDebit = arLine.type === 'DEBIT';
                                  runningArBal += isDebit ? arLine.amount : -arLine.amount;

                                  return (
                                    <tr key={idx} className="hover:bg-gray-50/50">
                                      <td className="py-2.5 px-3 font-mono text-gray-500">{je.date}</td>
                                      <td className="py-2.5 px-3 font-medium text-gray-800">{je.description}</td>
                                      <td className="py-2.5 px-3 font-mono text-[10px] text-gray-400 uppercase">{je.reference}</td>
                                      <td className="py-2.5 px-3 text-right text-rose-600 font-mono">
                                        {isDebit ? `${businessProfile.currency}${arLine.amount.toFixed(2)}` : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-right text-teal-600 font-mono">
                                        {!isDebit ? `${businessProfile.currency}${arLine.amount.toFixed(2)}` : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-black font-mono text-gray-700">
                                        {businessProfile.currency}{runningArBal.toFixed(2)}
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>

                        <div className="flex justify-between items-center p-3 bg-teal-50 border border-teal-100 rounded-xl">
                          <span className="text-xs font-bold text-teal-800">Final Ledger Accounts Receivable (A/R) Status:</span>
                          <span className="text-sm font-black text-teal-700 font-mono">
                            {client.storeCredit < 0 
                              ? `Customer owes us: ${businessProfile.currency}${Math.abs(client.storeCredit).toFixed(2)}` 
                              : `Advance Credit Balance: ${businessProfile.currency}${client.storeCredit.toFixed(2)}`
                            }
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* G. INTERACTIVE SUPPLIER ACCOUNT STATEMENT LEDGER */}
              {statementType === 'supplier_statement' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 bg-white p-3 border border-gray-150 rounded-xl">
                    <span className="text-xs font-bold text-gray-500 uppercase">Focus Vendor:</span>
                    <select
                      value={selectedStatementSupplierId}
                      onChange={(e) => setSelectedStatementSupplierId(e.target.value)}
                      className="bg-gray-50 border border-gray-200 rounded-lg py-1 px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
                    >
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name} (Debt: {businessProfile.currency}{s.balanceOwed.toFixed(2)})</option>
                      ))}
                    </select>
                    <button 
                      onClick={() => window.print()}
                      className="ml-auto text-xs bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-700 py-1.5 px-3 rounded-lg font-bold flex items-center gap-1 cursor-pointer"
                    >
                      Print Statement
                    </button>
                  </div>

                  {(() => {
                    const vendor = suppliers.find(s => s.id === selectedStatementSupplierId);
                    if (!vendor) return <p className="text-xs text-gray-400 italic py-4 text-center">No supplier selected.</p>;

                    // Filter JEs posted to A/P (2010) referencing this supplier
                    const matchingJEs = periodEntries
                      .filter(je => je.lines.some(l => l.accountCode === '2010') && 
                                    je.description.toLowerCase().includes(vendor.name.toLowerCase()))
                      .sort((a, b) => {
                        const difference = new Date(a.date).getTime() - new Date(b.date).getTime();
                        return reportSort === 'ASC' ? difference : -difference;
                      });

                    let runningApBal = 0;

                    return (
                      <div className="space-y-4">
                        <div className="border border-gray-200 rounded-xl overflow-hidden">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                                <th className="py-2 px-3">Date</th>
                                <th className="py-2 px-3">Transaction Details</th>
                                <th className="py-2 px-3">PO Ref</th>
                                <th className="py-2 px-3 text-right">Debit (Payment)</th>
                                <th className="py-2 px-3 text-right">Credit (Credit Purchase)</th>
                                <th className="py-2 px-3 text-right">Outstanding Tab</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                              {matchingJEs.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="py-8 text-center text-gray-400 italic">No historical A/P activities found for this vendor profile.</td>
                                </tr>
                              ) : (
                                matchingJEs.map((je, idx) => {
                                  const apLine = je.lines.find(l => l.accountCode === '2010');
                                  if (!apLine) return null;

                                  const isDebit = apLine.type === 'DEBIT'; // Debit reduces AP, Credit increases AP
                                  runningApBal += isDebit ? -apLine.amount : apLine.amount;

                                  return (
                                    <tr key={idx} className="hover:bg-gray-50/50">
                                      <td className="py-2.5 px-3 font-mono text-gray-500">{je.date}</td>
                                      <td className="py-2.5 px-3 font-medium text-gray-800">{je.description}</td>
                                      <td className="py-2.5 px-3 font-mono text-[10px] text-gray-400 uppercase">{je.reference}</td>
                                      <td className="py-2.5 px-3 text-right text-teal-600 font-mono">
                                        {isDebit ? `${businessProfile.currency}${apLine.amount.toFixed(2)}` : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-right text-rose-600 font-mono">
                                        {!isDebit ? `${businessProfile.currency}${apLine.amount.toFixed(2)}` : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-black font-mono text-gray-700">
                                        {businessProfile.currency}{runningApBal.toFixed(2)}
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>

                        <div className="flex justify-between items-center p-3 bg-amber-50 border border-amber-100 rounded-xl">
                          <span className="text-xs font-bold text-amber-800">Final Ledger Accounts Payable (A/P) Status:</span>
                          <span className="text-sm font-black text-amber-700 font-mono">
                            We owe supplier: {businessProfile.currency}{vendor.balanceOwed.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Detailed source schedule makes each report auditable to its journal entries. */}
              <div className="mt-8 space-y-3 border-t border-gray-200 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h5 className="text-xs font-black uppercase tracking-wider text-gray-700">Detailed Period Source Journal</h5>
                    <p className="text-[10px] text-gray-400">Supporting entries sorted {reportSort === 'ASC' ? 'oldest first' : 'newest first'}.</p>
                  </div>
                  <span className="rounded bg-gray-200 px-2 py-1 text-[9px] font-black text-gray-600">{sortedPeriodEntries.length} entries</span>
                </div>
                <div className="max-h-[360px] overflow-auto rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-gray-100 text-[10px] uppercase text-gray-500">
                      <tr>
                        <th className="px-3 py-2">Date</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Debits</th><th className="px-3 py-2 text-right">Credits</th><th className="px-3 py-2 text-center">Lines</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedPeriodEntries.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center italic text-gray-400">No journal activity in the selected period.</td></tr>
                      ) : sortedPeriodEntries.map(entry => {
                        const debits = entry.lines.filter(line => line.type === 'DEBIT').reduce((sum, line) => sum + line.amount, 0);
                        const credits = entry.lines.filter(line => line.type === 'CREDIT').reduce((sum, line) => sum + line.amount, 0);
                        return (
                          <tr key={entry.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-gray-500">{entry.date}</td>
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-500">{entry.reference}</td>
                            <td className="px-3 py-2 font-semibold text-gray-700">{entry.description}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(debits, businessProfile.currency)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(credits, businessProfile.currency)}</td>
                            <td className="px-3 py-2 text-center font-bold text-gray-500">{entry.lines.length}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ================= TAB 4: JOURNAL ENTRIES REGISTER ================= */}
        {activeSubTab === 'entries' && (
          <div className="space-y-4 animate-fade-in">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Historical Bookkeeping Ledger Roll</h4>
            
            <div className="space-y-3">
              {journalEntries.length === 0 ? (
                <div className="bg-gray-50 rounded-xl p-8 text-center text-gray-400 italic">
                  No journal entries registered.
                </div>
              ) : (
                [...journalEntries]
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // newest first
                  .map((je) => {
                    const deb = je.lines.filter(l => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0);

                    return (
                      <div key={je.id} className="border border-gray-100 hover:border-gray-200 bg-white rounded-xl shadow-xs overflow-hidden transition-all">
                        <div className="p-4 bg-gray-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-gray-100">
                          <div className="space-y-1">
                            <span className="text-[9px] bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide font-mono mr-1.5">{je.id.split('-')[1] || 'POST'}</span>
                            <span className="text-xs text-gray-400 font-mono font-bold">{je.date}</span>
                            <h4 className="text-xs font-extrabold text-gray-800 mt-1">{je.description}</h4>
                          </div>
                          
                          <div className="text-right">
                            <p className="text-[10px] text-gray-400">Ref: <span className="font-mono uppercase font-bold">{je.reference}</span></p>
                            <p className="text-xs font-bold text-gray-700 font-mono">Offset: {businessProfile.currency}{deb.toFixed(2)}</p>
                          </div>
                        </div>

                        <div className="p-3 bg-white">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Debits Side */}
                            <div className="space-y-1.5 bg-gray-50/30 p-2.5 rounded-lg border border-dashed border-gray-100">
                              <span className="text-[10px] text-teal-600 font-black block uppercase tracking-wide">Debits (Debit Charges)</span>
                              {je.lines.filter(l => l.type === 'DEBIT').map((line, lIdx) => {
                                const accName = accounts.find(a => a.code === line.accountCode)?.name || line.accountCode;
                                return (
                                  <div key={lIdx} className="flex justify-between items-center text-xs text-gray-700 pl-1">
                                    <span className="font-medium text-[11px]"><span className="font-mono text-gray-400 font-bold mr-1">{line.accountCode}</span> {accName}</span>
                                    <span className="font-mono font-semibold text-gray-900">{businessProfile.currency}{line.amount.toFixed(2)}</span>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Credits Side */}
                            <div className="space-y-1.5 bg-gray-50/30 p-2.5 rounded-lg border border-dashed border-gray-100">
                              <span className="text-[10px] text-amber-600 font-black block uppercase tracking-wide">Credits (Credit Offsets)</span>
                              {je.lines.filter(l => l.type === 'CREDIT').map((line, lIdx) => {
                                const accName = accounts.find(a => a.code === line.accountCode)?.name || line.accountCode;
                                return (
                                  <div key={lIdx} className="flex justify-between items-center text-xs text-gray-700 pl-1">
                                    <span className="font-medium text-[11px]"><span className="font-mono text-gray-400 font-bold mr-1">{line.accountCode}</span> {accName}</span>
                                    <span className="font-mono font-semibold text-gray-900">{businessProfile.currency}{line.amount.toFixed(2)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          
                          {je.createdBy && (
                            <div className="text-[9px] text-gray-400 italic text-right mt-2 mr-1">
                              Posted by: {je.createdBy}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        )}

        {/* ================= TAB 5: ADJUSTING POSTS (MANUAL) ================= */}
        {activeSubTab === 'manual' && (
          <div className="max-w-2xl mx-auto animate-fade-in">
            
            <form onSubmit={submitManualJournalEntry} className="bg-gray-50 border border-gray-100 shadow-sm rounded-2xl p-6 space-y-5">
              <div className="border-b border-gray-200 pb-3">
                <h3 className="text-sm font-bold text-gray-800">Post New Double-Entry Journal Adjustments</h3>
                <p className="text-xs text-gray-400 mt-0.5">Note: Your total Debits and Credits must balance perfectly to satisfy GAAP criteria.</p>
              </div>

              {/* Date & Description */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                    <Calendar size={13} /> Posting Date
                  </label>
                  <input
                    type="date"
                    required
                    value={jeDate}
                    onChange={(e) => setJeDate(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-lg py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
                
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                    <Tag size={13} /> Description / Explanation
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Capital Injection / Monthly Rent Payment Adjustment / Custom Wage Voucher"
                    value={jeDescription}
                    onChange={(e) => setJeDescription(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-lg py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Ledger Lines */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Double Entry Ledger Breakdown</span>
                  <button
                    type="button"
                    onClick={addJeLine}
                    className="text-xs font-semibold text-teal-600 hover:text-teal-700 flex items-center gap-1"
                  >
                    + Add Ledger Line
                  </button>
                </div>

                <div className="space-y-2">
                  {jeLines.map((line, idx) => (
                    <div key={idx} className="flex gap-2 items-center bg-white p-2.5 border border-gray-150 rounded-xl relative">
                      <div className="flex-1">
                        <select
                          value={line.accountCode}
                          onChange={(e) => updateJeLine(idx, 'accountCode', e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg py-1.5 px-2 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
                        >
                          {accounts.map(a => (
                            <option key={a.code} value={a.code}>
                              {a.code} — {a.name} ({a.type})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-24">
                        <select
                          value={line.type}
                          onChange={(e) => updateJeLine(idx, 'type', e.target.value as 'DEBIT' | 'CREDIT')}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg py-1.5 px-2 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
                        >
                          <option value="DEBIT">DEBIT (Dr)</option>
                          <option value="CREDIT">CREDIT (Cr)</option>
                        </select>
                      </div>

                      <div className="w-28 relative">
                        <span className="absolute inset-y-0 left-2.5 flex items-center text-gray-400 font-bold text-[10px]">{businessProfile.currency}</span>
                        <input
                          type="number"
                          step="0.01"
                          required
                          placeholder="0.00"
                          value={line.amount}
                          onChange={(e) => updateJeLine(idx, 'amount', e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg py-1.5 pl-6 pr-2 text-xs font-mono text-gray-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => removeJeLine(idx)}
                        className="text-gray-400 hover:text-red-500 p-1 font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Balances summary */}
              <div className="p-3 bg-white border border-gray-200 rounded-xl flex justify-between items-center text-xs text-gray-500">
                <div>
                  Total Debits: <span className="font-mono font-bold text-teal-700">{businessProfile.currency}
                    {jeLines.filter(l => l.type === 'DEBIT').reduce((s, l) => s + (parseFloat(l.amount) || 0), 0).toFixed(2)}
                  </span>
                </div>
                <div>
                  Total Credits: <span className="font-mono font-bold text-amber-700">{businessProfile.currency}
                    {jeLines.filter(l => l.type === 'CREDIT').reduce((s, l) => s + (parseFloat(l.amount) || 0), 0).toFixed(2)}
                  </span>
                </div>
              </div>

              {jeError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-xl font-bold flex items-center gap-1.5">
                  <AlertCircle size={15} /> {jeError}
                </p>
              )}

              {jeSuccess && (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-3 rounded-xl font-bold flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle size={15} /> Journal entry posted to ledger database successfully!
                </p>
              )}

              <div className="border-t border-gray-200 pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setJeDescription('');
                    setJeLines([
                      { accountCode: '1010', type: 'DEBIT', amount: '' },
                      { accountCode: '4020', type: 'CREDIT', amount: '' }
                    ]);
                    setJeError('');
                    setJeSuccess(false);
                  }}
                  className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2 rounded-xl text-xs"
                >
                  Reset Form
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 rounded-xl text-xs shadow"
                >
                  Post Journal Entry
                </button>
              </div>
            </form>

          </div>
        )}

      </div>

      {/* ================= MODAL: CREATE CUSTOM ACCOUNT ================= */}
      {isAddAccOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAddAccountSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-100 bg-teal-50/50">
              <h3 className="text-base font-bold text-gray-800">Add Custom Ledger Account</h3>
              <p className="text-xs text-gray-400 mt-0.5">Configure codes according to GAAP structures</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Account Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 6060"
                    maxLength={4}
                    value={newAccCode}
                    onChange={(e) => setNewAccCode(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                  <span className="text-[9px] text-gray-400 mt-0.5 block">Assets: 1000s | Liab: 2000s | Equity: 3000s | Rev: 4000s | Exp: 6000s</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Financial Class *</label>
                  <select
                    value={newAccType}
                    onChange={(e) => setNewAccType(e.target.value as AccountType)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="ASSET">ASSET (Increases with Debit)</option>
                    <option value="LIABILITY">LIABILITY (Increases with Credit)</option>
                    <option value="EQUITY">EQUITY (Increases with Credit)</option>
                    <option value="REVENUE">REVENUE (Increases with Credit)</option>
                    <option value="EXPENSE">EXPENSE (Increases with Debit)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Account Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Freight & Delivery"
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Short Description</label>
                <textarea
                  value={newAccDesc}
                  onChange={(e) => setNewAccDesc(e.target.value)}
                  rows={2}
                  placeholder="Describe purpose of account posts..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                />
              </div>

              {coaError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg font-bold flex items-center gap-1.5">
                  <AlertCircle size={14} /> {coaError}
                </p>
              )}

              {coaSuccess && (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-2.5 rounded-lg font-bold flex items-center gap-1.5">
                  <CheckCircle size={14} /> Account added! Refreshing Chart lists...
                </p>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setIsAddAccOpen(false)}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 px-4 rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow"
              >
                Save Account
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
