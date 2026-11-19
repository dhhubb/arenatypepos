/**
 * ============================================================================
 * MODULE: components/CashUpView.tsx — Daily Shift Close & Cash Reconciliation
 * ----------------------------------------------------------------------------
 * The end-of-day / end-of-shift tool. Responsibilities:
 *   - DAILY SALES SUMMARY: totals for a chosen date split by cash, card, and
 *     customer-credit tenders, plus tax collected.
 *   - CASH COUNT: enter physical note/coin denominations (or a manual total)
 *     to compare counted cash against the expected ledger balance.
 *   - DISCREPANCY HANDLING: computes over/short variance and posts the
 *     reconciling journal automatically.
 *   - BANKING: record how much counted cash is deposited to the bank vs. kept
 *     as the till float, posting the corresponding transfer entry.
 *   - EXPORT: print the shift report as PDF and share it via WhatsApp.
 * ============================================================================
 */
import React, { useState } from 'react';
import { Sale, JournalEntry, Account, DailyCashUp, BusinessProfile, User } from '../types';
import { formatCurrency } from '../utils/currency';
import {
  ACCOUNT_CODES,
  getAccountsWithBalances
} from '../utils/accounting';
import { 
  Calculator, 
  CheckCircle, 
  AlertTriangle, 
  Coins, 
  Building
} from 'lucide-react';

interface CashUpViewProps {
  sales: Sale[];
  journalEntries: JournalEntry[];
  businessProfile: BusinessProfile;
  accounts: Account[];
  onAddManualJournalEntry: (entry: JournalEntry) => void;
  dailyCashUps: DailyCashUp[];
  onAddDailyCashUp: (cashUp: DailyCashUp) => void;
  currentUser: User | null;
}

export default function CashUpView({
  sales,
  journalEntries,
  businessProfile,
  accounts,
  onAddManualJournalEntry,
  dailyCashUps,
  onAddDailyCashUp,
  currentUser
}: CashUpViewProps) {
  // Filters State
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [cashUpSuccess, setCashUpSuccess] = useState(false);
  const [cashUpError, setCashUpError] = useState('');

  // Physical Denomination states (default ZAR/general denominations)
  const [denominations, setDenominations] = useState<{ [denom: number]: string }>({
    200: '',
    100: '',
    50: '',
    20: '',
    10: '',
    5: '',
    2: '',
    1: ''
  });

  // Manual cash count overrides
  const [manualCount, setManualCount] = useState<string>('');
  const [isManualOverride, setIsManualOverride] = useState(false);

  // Bank Deposit State
  const [bankDepositAmount, setBankDepositAmount] = useState<string>('');

  // --- CORE COMPUTATIONS & ANALYTICS ---

  /**
   * Filters sales records matching the chosen batch date.
   */
  const dailySales = sales.filter(s => s.date === selectedDate);

  /**
   * Summarizes cash retail receipts.
   */
  const totalCashSales = dailySales.filter(s => s.paymentMethod === 'CASH').reduce((sum, s) => sum + s.total, 0);

  /**
   * Summarizes electronic card transactions.
   */
  const totalCardSales = dailySales.filter(s => s.paymentMethod === 'CARD').reduce((sum, s) => sum + s.total, 0);

  /**
   * Summarizes credit tab purchases (AR).
   */
  const totalCreditSales = dailySales.filter(s => s.paymentMethod === 'CUSTOMER_CREDIT').reduce((sum, s) => sum + s.total, 0);

  /**
   * Summarizes VAT collections inside POS batch.
   */
  const totalTaxCollected = dailySales.reduce((sum, s) => sum + s.taxAmount, 0);

  /**
   * Calculates total operational revenue for the selected day.
   */
  const totalBatchRevenue = totalCashSales + totalCardSales + totalCreditSales;

  /**
   * Hydrates stateful ledger balances to retrieve current cash-in-drawer assets.
   */
  const liveAccounts = getAccountsWithBalances(journalEntries, accounts);

  /**
   * Pulls the real-time balance from cash drawer general ledger account 1010.
   */
  const currentCashDrawerBalance = liveAccounts.find(a => a.code === '1010')?.balance ?? 0;

  /**
   * Multiplies and sums physical coin/bill counts typed by the cashier.
   */
  const computedCountedCash = Object.keys(denominations).reduce((sum, key) => {
    const value = parseFloat(key);
    const count = parseInt(denominations[value as any]) || 0;
    return sum + (value * count);
  }, 0);

  /**
   * Determines the final counted cash value, checking for manual total overrides.
   */
  const finalCountedCash = isManualOverride ? (parseFloat(manualCount) || 0) : computedCountedCash;

  /**
   * Computes discrepancy variance comparing counted cash vs. ledger assets.
   */
  const discrepancy = finalCountedCash - currentCashDrawerBalance;

  // --- ACTIONS & HANDLERS ---

  /**
   * Modifies quantities inside the denominations map.
   */
  const handleDenominationChange = (value: number, countStr: string) => {
    setDenominations(prev => ({
      ...prev,
      [value]: countStr
    }));
  };

  /**
   * Generates a pre-formatted shift summary text and loads WhatsApp Web sharing.
   * Enforces strict PDF transmission: alerts the user, prompts the PDF download, and redirects to WhatsApp Web.
   */
  const handleShareShiftWhatsApp = () => {
    // Strict PDF audit warning
    alert(`SECURE SHIFT DISPATCH PROTOCOL:\nAll shift reconciliation logs must be shared in PDF format for ${businessProfile.name}.\n\nClick OK to save the report as PDF, then attach it in WhatsApp.`);

    // Trigger PDF generation instantly
    window.print();

    // Construct companion text details instructing attachment of PDF
    let companionText = `*${businessProfile.name} Daily Close Statement*\n`;
    companionText += `[Awaiting PDF Attachment: Afritecx_Badboy_Shift_Close_${selectedDate}.pdf]\n\n`;
    companionText += `Expected till balances, actual cash counts, coin audit summaries, discrepancies, and safe bank deposits are detailed inside the secure attached PDF.`;

    const url = `https://wa.me/?text=${encodeURIComponent(companionText)}`;
    window.open(url, '_blank');
  };

  /**
   * Triggers the printer query, adapting the cashup sheets layout to save as a PDF.
   */
  const handlePrintShiftReport = () => {
    window.print();
  };

  /**
   * Commits the daily shift closures, posting appropriate overage/shortage journals.
   */
  const handleSubmitCashUp = (e: React.FormEvent) => {
    e.preventDefault();
    setCashUpError('');
    setCashUpSuccess(false);

    if (currentUser?.userType === 'AUDIT') {
      setCashUpError('Security Warning: Reconciling drawers and finalizing shift closures are locked under Read-Only Audit sessions.');
      return;
    }

    if (finalCountedCash <= 0 && !isManualOverride) {
      setCashUpError('Please enter counted till cash values to reconcile.');
      return;
    }

    const depositVal = parseFloat(bankDepositAmount) || 0;
    if (depositVal > finalCountedCash) {
      setCashUpError('Deposit transfer amount cannot exceed total physical counted cash.');
      return;
    }

    const floatRetained = finalCountedCash - depositVal;

    // Create journal entries to reconcile cash discrepancy and perform bank transfers
    const paymentDate = new Date().toISOString().split('T')[0];

    // A. Post Discrepancy (if any)
    if (Math.abs(discrepancy) > 0.01) {
      const isOver = discrepancy > 0;
      const discrepancyJE: JournalEntry = {
        id: `JE-CASHUP-DISC-${Date.now()}`,
        date: paymentDate,
        description: `Daily Till Reconciliation Over/Shortage: ${isOver ? 'Surplus' : 'Deficit'}`,
        reference: `RECON-${selectedDate}`,
        lines: [
          {
            accountCode: ACCOUNT_CODES.CASH,
            type: isOver ? 'DEBIT' : 'CREDIT',
            amount: parseFloat(Math.abs(discrepancy).toFixed(2))
          },
          {
            // A surplus is other income; a shortfall is its own expense line.
            // Booking shortfalls to Bank & Transaction Fees (6050) would bury
            // till losses inside card charges, so use the dedicated 6060.
            accountCode: isOver ? ACCOUNT_CODES.OTHER_INCOME : ACCOUNT_CODES.CASH_OVER_SHORT,
            type: isOver ? 'CREDIT' : 'DEBIT',
            amount: parseFloat(Math.abs(discrepancy).toFixed(2))
          }
        ]
      };
      onAddManualJournalEntry(discrepancyJE);
    }

    // B. Post Bank Transfer (if requested)
    if (depositVal > 0) {
      const transferJE: JournalEntry = {
        id: `JE-CASHUP-DEP-${Date.now()}`,
        date: paymentDate,
        description: `Daily Cash Up Deposit to Bank clearing`,
        reference: `DEP-${selectedDate}`,
        lines: [
          {
            accountCode: '1020', // Bank account
            type: 'DEBIT',
            amount: parseFloat(depositVal.toFixed(2))
          },
          {
            accountCode: '1010', // Cash Drawer
            type: 'CREDIT',
            amount: parseFloat(depositVal.toFixed(2))
          }
        ]
      };
      onAddManualJournalEntry(transferJE);
    }

    // C. Record historical cash up report
    const cashUpRecord: DailyCashUp = {
      id: `CUP-${Date.now()}`,
      date: selectedDate,
      closedBy: 'Alexandra Admin',
      expectedCash: parseFloat(currentCashDrawerBalance.toFixed(2)),
      actualCash: parseFloat(finalCountedCash.toFixed(2)),
      discrepancy: parseFloat(discrepancy.toFixed(2)),
      amountDeposited: parseFloat(depositVal.toFixed(2)),
      floatRetained: parseFloat(floatRetained.toFixed(2))
    };

    onAddDailyCashUp(cashUpRecord);
    setCashUpSuccess(true);
    setDenominations({ 200: '', 100: '', 50: '', 20: '', 10: '', 5: '', 2: '', 1: '' });
    setManualCount('');
    setBankDepositAmount('');

    setTimeout(() => {
      setCashUpSuccess(false);
    }, 2000);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
      
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Coins size={18} className="text-teal-600" /> Daily Shift Closing & Cash Up
          </h2>
          <p className="text-xs text-gray-400 mt-0.5 font-medium">Reconcile expected till cash balances, log currency shortages, and deposit funds to the Bank</p>
        </div>

        {/* Date Selector */}
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl py-1 px-3 self-start">
          <span className="text-[10px] font-bold text-gray-500 uppercase">Batch Date:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-xs font-semibold focus:outline-none font-mono"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-5xl mx-auto">
          
          {/* LEFT: TODAY'S SALES SUMMARY & CONVERSIONS */}
          <div className="lg:col-span-4 space-y-4">
            
            {/* Sales Summary Metrics */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-teal-600 border-b border-gray-200 pb-2 flex items-center gap-1.5">
                <Building size={14} className="text-teal-600" /> Daily Sales Summary
              </h3>

              <div className="space-y-3.5 text-xs">
                <div className="flex justify-between font-semibold text-gray-700">
                  <span>Cash Collections (Tenders)</span>
                  <span className="font-mono">{formatCurrency(totalCashSales, businessProfile.currency)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-700">
                  <span>Card Swipe Settlements</span>
                  <span className="font-mono">{formatCurrency(totalCardSales, businessProfile.currency)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-700">
                  <span>Store Credit Purchases</span>
                  <span className="font-mono">{formatCurrency(totalCreditSales, businessProfile.currency)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-700">
                  <span>VAT/GST Collected</span>
                  <span className="font-mono">{formatCurrency(totalTaxCollected, businessProfile.currency)}</span>
                </div>

                <div className="border-t border-gray-200 pt-2.5 flex justify-between font-black text-gray-900 bg-white p-2 rounded-lg text-sm">
                  <span>BATCH TOTAL REVENUE:</span>
                  <span className="font-mono text-teal-600">{formatCurrency(totalBatchRevenue, businessProfile.currency)}</span>
                </div>
              </div>

              {/* PDF & WHATSAPP EXPORTS FOR SHIFTS CLOSURES */}
              <div className="grid grid-cols-2 gap-2 mt-4 print:hidden">
                <button
                  type="button"
                  onClick={handlePrintShiftReport}
                  className="bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold py-2 px-2.5 rounded-xl text-xs flex items-center justify-center gap-1 transition-all cursor-pointer"
                >
                  Print PDF
                </button>
                <button
                  type="button"
                  onClick={handleShareShiftWhatsApp}
                  className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-2.5 rounded-xl text-xs flex items-center justify-center gap-1 transition-all cursor-pointer"
                >
                  WhatsApp
                </button>
              </div>
            </div>

            {/* List of Sales Included in Batch */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Included Batch Invoices ({dailySales.length})</h4>
              
              <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                {dailySales.length === 0 ? (
                  <p className="text-xs text-gray-400 italic py-4 text-center">No sales transactions processed on this day.</p>
                ) : (
                  dailySales.map(sale => (
                    <div key={sale.id} className="flex justify-between items-center text-xs border-b border-gray-50 pb-1.5">
                      <div>
                        <p className="font-bold text-gray-700">{sale.invoiceNo}</p>
                        <p className="text-[9px] text-gray-400 uppercase font-semibold font-mono">{sale.paymentMethod.replace('_', ' ')}</p>
                      </div>
                      <span className="font-mono font-bold text-teal-600">{formatCurrency(sale.total, businessProfile.currency)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* MIDDLE: RECONCILER & DENOMINATIONS */}
          <div className="lg:col-span-8 space-y-6">
            
            <form onSubmit={handleSubmitCashUp} className="bg-white border border-gray-150 rounded-3xl p-6 space-y-6 shadow-sm">
              <div className="border-b border-gray-100 pb-3">
                <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                  <Calculator size={18} className="text-teal-600 animate-pulse" /> Cash Drawer Audit & Bank Depositor
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">Physically count your coin and bill drawers. Shortages are booked as operating discrepancies automatically.</p>
              </div>

              {/* Dynamic Ledger expected cash info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 border border-gray-100 p-4 rounded-2xl text-center">
                  <span className="text-[9px] text-gray-400 font-bold block uppercase">Expected Ledger Cash (Drawer 1010)</span>
                  <span className="text-base font-black text-gray-800 font-mono mt-0.5 block">
                    {formatCurrency(currentCashDrawerBalance, businessProfile.currency)}
                  </span>
                </div>
                <div className="bg-teal-50/50 border border-teal-100 p-4 rounded-2xl text-center">
                  <span className="text-[9px] text-teal-800 font-bold block uppercase">Physical Counted Cash</span>
                  <span className="text-base font-black text-teal-700 font-mono mt-0.5 block">
                    {formatCurrency(finalCountedCash, businessProfile.currency)}
                  </span>
                </div>
              </div>

              {/* Reconciliation discrepancy panel */}
              {finalCountedCash > 0 && (
                <div className={`p-4 rounded-2xl border flex items-center justify-between text-xs ${
                  Math.abs(discrepancy) < 0.05
                    ? 'bg-teal-100/50 border-teal-200 text-teal-800'
                    : discrepancy > 0
                      ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                      : 'bg-rose-50 border-rose-100 text-rose-800'
                }`}>
                  <div className="flex items-center gap-2">
                    {Math.abs(discrepancy) < 0.05 ? (
                      <>
                        <CheckCircle size={16} className="text-teal-600 shrink-0" />
                        <span className="font-bold">Drawer Balanced perfectly! Expected cash matches counted cash.</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold block">Cash drawer mismatch detected ({discrepancy > 0 ? 'Surplus' : 'Deficit'}):</span>
                          <span className="text-[11px] mt-0.5 block opacity-90">
                            Counted cash is {discrepancy > 0 ? 'higher' : 'lower'} than expectations by <span className="font-mono font-black">{formatCurrency(Math.abs(discrepancy), businessProfile.currency)}</span>. This discrepancy will be booked automatically.
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Denomination Counter Selection */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Till Denominations Count</span>
                  <button
                    type="button"
                    onClick={() => setIsManualOverride(!isManualOverride)}
                    className="text-xs font-semibold text-teal-600 hover:text-teal-700 flex items-center gap-1"
                  >
                    {isManualOverride ? 'Use Denomination Counter' : 'Override with Direct Total'}
                  </button>
                </div>

                {isManualOverride ? (
                  <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4.5">
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Direct Counted Cash Drawer Total</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold font-mono">
                        {businessProfile.currency === 'ZAR' ? 'R' : businessProfile.currency === 'USD' ? 'US$' : businessProfile.currency === 'BWP' ? 'P' : '€'}
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={manualCount}
                        onChange={(e) => setManualCount(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-xl py-2 pl-12 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono font-bold"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 border border-gray-100 p-4 rounded-3xl">
                    {Object.keys(denominations)
                      .map(k => parseFloat(k))
                      .sort((a, b) => b - a)
                      .map((val) => (
                        <div key={val} className="bg-white border border-gray-150 p-2.5 rounded-xl flex flex-col justify-between items-start gap-1">
                          <span className="text-[10px] font-black text-gray-400 block uppercase font-mono">{businessProfile.currency === 'ZAR' ? 'R' : businessProfile.currency === 'USD' ? 'US$' : businessProfile.currency === 'BWP' ? 'P' : '€'}{val}</span>
                          <input
                            type="number"
                            placeholder="Qty"
                            min="0"
                            value={denominations[val]}
                            onChange={(e) => handleDenominationChange(val, e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg py-1 px-2 text-xs font-mono font-bold text-center focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Bank Deposit tool */}
              <div className="bg-teal-50/20 border border-teal-100 p-5 rounded-2xl space-y-4">
                <div className="flex items-start gap-2.5">
                  <Coins className="text-teal-600 shrink-0 mt-0.5" size={16} />
                  <div>
                    <h4 className="text-xs font-bold text-teal-800">Clear Drawer Cash to Bank</h4>
                    <p className="text-[11px] text-teal-700/80 mt-0.5 leading-relaxed">Deposit cash into the safe or bank account (EFT). The deposited portion will debit Bank (1020) and credit Cash Drawer (1010). Retained remainder cash is left as starting float.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">EFT Cash Deposit Value</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold font-mono">
                        {businessProfile.currency === 'ZAR' ? 'R' : businessProfile.currency === 'USD' ? 'US$' : businessProfile.currency === 'BWP' ? 'P' : '€'}
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={bankDepositAmount}
                        onChange={(e) => setBankDepositAmount(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-xl py-1.5 pl-10 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-mono font-bold"
                      />
                    </div>
                  </div>

                  <div className="bg-white/80 border border-gray-150 p-2.5 rounded-xl flex flex-col justify-center">
                    <span className="text-[8px] text-gray-400 font-black block uppercase">Retained Till Drawer Float</span>
                    <span className="text-xs font-black text-gray-700 font-mono mt-0.5">
                      {formatCurrency(Math.max(0, finalCountedCash - (parseFloat(bankDepositAmount) || 0)), businessProfile.currency)}
                    </span>
                  </div>
                </div>
              </div>

              {cashUpError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-xl font-bold flex items-center gap-1.5">
                  <AlertTriangle size={15} /> {cashUpError}
                </p>
              )}

              {cashUpSuccess && (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-3 rounded-xl font-bold flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle size={15} /> Shift Closures verified! Cash Drawer reconciled to ledger offsets, and government bank deposits logged.
                </p>
              )}

              {/* Action buttons */}
              <div className="border-t border-gray-200 pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDenominations({ 200: '', 100: '', 50: '', 20: '', 10: '', 5: '', 2: '', 1: '' });
                    setManualCount('');
                    setBankDepositAmount('');
                  }}
                  className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 rounded-xl text-xs cursor-pointer"
                >
                  Clear Fields
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-xl text-xs shadow cursor-pointer transition-colors"
                >
                  Submit & Reconcile Till
                </button>
              </div>
            </form>

            {/* Shift close audits ledger log */}
            <div className="bg-white border border-gray-150 rounded-3xl p-5 space-y-4 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-wider text-teal-600 border-b border-gray-150 pb-2">Shift Reconciliation History Logs</h3>
              
              <div className="overflow-hidden border border-gray-100 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                      <th className="py-2 px-3">Closing Date</th>
                      <th className="py-2 px-3 text-right">Expected Drawer</th>
                      <th className="py-2 px-3 text-right">Physical counted</th>
                      <th className="py-2 px-3 text-right">Cash Over/Short</th>
                      <th className="py-2 px-3 text-right">EFT Deposit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dailyCashUps.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-400 italic">No historical cash reconciliation sheets saved in memory.</td>
                      </tr>
                    ) : (
                      dailyCashUps.map(cu => (
                        <tr key={cu.id}>
                          <td className="py-2.5 px-3 font-mono text-gray-500">{cu.date}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-medium text-gray-700">{formatCurrency(cu.expectedCash, businessProfile.currency)}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-medium text-gray-700">{formatCurrency(cu.actualCash, businessProfile.currency)}</td>
                          <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                            cu.discrepancy === 0 ? 'text-gray-500' : cu.discrepancy > 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}>
                            {cu.discrepancy > 0 ? '+' : ''}{formatCurrency(cu.discrepancy, businessProfile.currency)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-teal-600">{formatCurrency(cu.amountDeposited, businessProfile.currency)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

        </div>
      </div>

    </div>
  );
}
