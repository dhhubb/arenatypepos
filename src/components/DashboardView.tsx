/**
 * ============================================================================
 * MODULE: components/DashboardView.tsx — Home / Analytics Overview
 * ----------------------------------------------------------------------------
 * The landing screen after login. Gives an at-a-glance business snapshot:
 *   - KPI CARDS: revenue, gross profit, net income, cash position, and
 *     receivable/payable balances derived from the accounting engine.
 *   - STOCK-ON-HAND: a read-only monitor of current inventory levels.
 *   - LIVE NOTIFICATIONS: pop-up alerts for low stock and high customer debt.
 *   - REMINDERS: managers can add/complete/delete task reminders (persisted).
 *   - REPORT DISPATCH: quick "print PDF" and "share via WhatsApp" summaries.
 * Purely presentational/aggregation — it reads data passed from App.tsx and
 * computes summaries; it does not own the primary data itself.
 * ============================================================================
 */
import React, { useState, useEffect } from 'react';
import { Sale, JournalEntry, Product, Customer, Supplier, BusinessProfile, Reminder, User } from '../types';
import { 
  generateIncomeStatement, 
  generateTrialBalance, 
  getAccountsWithBalances 
} from '../utils/accounting';
import { formatCurrency } from '../utils/currency';
import { 
  TrendingUp, 
  DollarSign, 
  ShieldCheck, 
  AlertTriangle, 
  Wallet, 
  ShoppingBag, 
  ArrowRight, 
  ArrowUpRight, 
  ArrowDownLeft, 
  CheckCircle,
  Percent,
  Bell,
  Calendar,
  Plus,
  Send,
  Printer,
  Trash2
} from 'lucide-react';

interface DashboardViewProps {
  sales: Sale[];
  journalEntries: JournalEntry[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  businessProfile: BusinessProfile;
  onNavigate: (tab: 'pos' | 'inventory' | 'accounting' | 'crm' | 'settings' | 'cashup' | 'payroll') => void;
  currentUser: User | null;
}

export default function DashboardView({
  sales,
  journalEntries,
  products,
  customers,
  suppliers,
  businessProfile,
  onNavigate,
  currentUser
}: DashboardViewProps) {
  // --- STATE HOOKS ---
  /**
   * Holds the list of manager tasks and regulatory reminders.
   */
  const [reminders, setReminders] = useState<Reminder[]>([]);
  
  /**
   * Form binding state for scheduling custom reminder titles.
   */
  const [newRemTitle, setNewRemTitle] = useState('');
  
  /**
   * Form binding state for scheduling optional reminder explanations.
   */
  const [newRemNotes, setNewRemNotes] = useState('');
  
  /**
   * Form binding state for calendar due dates.
   */
  const [newRemDate, setNewRemDate] = useState(new Date().toISOString().split('T')[0]);
  
  /**
   * Form binding state for categorizing reminders (STOCK, TAX, PAYROLL, OTHER).
   */
  const [newRemCategory, setNewRemCategory] = useState<'STOCK' | 'TAX' | 'PAYROLL' | 'OTHER'>('STOCK');
  
  /**
   * Real-time toast notifications system to alert operators on low stock levels.
   */
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'WARN' | 'INFO' }[]>([]);

  // --- CORE FINANCIAL CALCULATIONS ---
  
  /**
   * Generates P&L numbers (Revenue, COGS, expenses, net profit) from the stateful double-entry entries list.
   */
  const pAndL = generateIncomeStatement(journalEntries);
  
  /**
   * Generates a balanced trial balance checking debits vs credits.
   */
  const trialBal = generateTrialBalance(journalEntries);
  
  /**
   * Resolves running ledger accounts.
   */
  const accounts = getAccountsWithBalances(journalEntries);

  /**
   * Combines Cash Drawer 1010 and Card Clearing Bank 1020 balances.
   */
  const cashDrawer = accounts.find(a => a.code === '1010')?.balance ?? 0;
  const bankAccount = accounts.find(a => a.code === '1020')?.balance ?? 0;
  const totalCashLiquid = cashDrawer + bankAccount;

  /**
   * Accounts Receivable (1100) and Accounts Payable (2010) real-time totals.
   */
  const accountsReceivable = accounts.find(a => a.code === '1100')?.balance ?? 0;
  const accountsPayable = accounts.find(a => a.code === '2010')?.balance ?? 0;

  // --- POPUP NOTIFICATIONS ENGINE ---

  /**
   * Analyzes stock buffers and shifts to push helpful warning toasts onto the user's dashboard view.
   */
  useEffect(() => {
    const alerts: { id: string; message: string; type: 'WARN' | 'INFO' }[] = [];

    // A. Check for items that are low or out of stock
    products.forEach(p => {
      if (p.stock <= 0) {
        alerts.push({
          id: `toast-out-${p.id}`,
          message: `🚨 Critical Stockout: "${p.name}" has completely run out! Restock soon.`,
          type: 'WARN'
        });
      } else if (p.stock <= p.minStock) {
        alerts.push({
          id: `toast-low-${p.id}`,
          message: `⚠ Low Stock alert: "${p.name}" has only ${p.stock} units remaining (Buffer: ${p.minStock}).`,
          type: 'WARN'
        });
      }
    });

    // B. Check for debtors exceeding limit warnings
    customers.forEach(c => {
      if (c.storeCredit < 0 && Math.abs(c.storeCredit) >= c.creditLimit * 0.8) {
        alerts.push({
          id: `toast-debt-${c.id}`,
          message: `💳 High Credit Risk: ${c.name} has reached 80%+ of their allowed debt limit ($${c.creditLimit}).`,
          type: 'WARN'
        });
      }
    });

    // C. Reconciled Trial balance confirmation toast
    if (trialBal.isBalanced) {
      alerts.push({
        id: 'toast-integrity',
        message: `🛡 Double-Entry Integrity: Trial balance checks out perfectly (${formatCurrency(trialBal.totalDebit, businessProfile.currency)}).`,
        type: 'INFO'
      });
    }

    setToasts(alerts.slice(0, 4)); // cap at 4 toasts to keep layout neat
  }, [products, customers, trialBal.isBalanced]);

  // --- REMINDERS CRUD MANAGEMENT ---

  /**
   * Loads custom reminders from local storage on mount.
   */
  useEffect(() => {
    const stored = localStorage.getItem('pos_reminders');
    if (stored) {
      setReminders(JSON.parse(stored));
    } else {
      // Default seeds
      const defaultReminders: Reminder[] = [
        { id: 'rem-1', title: 'Submit Belgravia restock order to Afdis', notes: 'Belgium gin levels are low', targetDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], isCompleted: false, category: 'STOCK' },
        { id: 'rem-2', title: 'Remit Q1 PAYG Withholding taxes', notes: 'Prepare general ledger and file tax check', targetDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], isCompleted: false, category: 'TAX' }
      ];
      setReminders(defaultReminders);
      localStorage.setItem('pos_reminders', JSON.stringify(defaultReminders));
    }
  }, []);

  /**
   * Persists the active reminders array in LocalStorage.
   */
  const saveReminders = (newRems: Reminder[]) => {
    setReminders(newRems);
    localStorage.setItem('pos_reminders', JSON.stringify(newRems));
  };

  /**
   * Adds a new custom reminder.
   */
  const handleAddReminder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRemTitle.trim()) return;

    if (currentUser?.userType === 'AUDIT') {
      alert('Security Warning: Scheduling new reminders is locked under Read-Only Audit sessions.');
      return;
    }

    const newRem: Reminder = {
      id: `rem-${Date.now()}`,
      title: newRemTitle.trim(),
      notes: newRemNotes.trim() || undefined,
      targetDate: newRemDate,
      isCompleted: false,
      category: newRemCategory
    };

    const next = [...reminders, newRem];
    saveReminders(next);

    // reset inputs
    setNewRemTitle('');
    setNewRemNotes('');
  };

  /**
   * Toggles the completion status of a target reminder.
   */
  const handleToggleReminder = (id: string) => {
    const next = reminders.map(r => r.id === id ? { ...r, isCompleted: !r.isCompleted } : r);
    saveReminders(next);
  };

  /**
   * Deletes a specific reminder.
   */
  const handleDeleteReminder = (id: string) => {
    const next = reminders.filter(r => r.id !== id);
    saveReminders(next);
  };

  // --- REPORT SHIFT DISPATCH (PDF & WHATSAPP) ---

  /**
   * Opens the print dialog, utilizing CSS print queries to save a beautifully formatted, focused Daily Performance Statement as a PDF.
   */
  const handlePrintDailyReport = () => {
    window.print();
  };

  /**
   * Generates a pre-formatted, URL-safe markdown report of daily metrics and opens WhatsApp Web to share directly with the owner or supervisor.
   */
  const handleShareReportWhatsApp = () => {
    const profitMargin = pAndL.totalRevenue > 0 ? ((pAndL.netIncome / pAndL.totalRevenue) * 100).toFixed(1) : '0.0';
    
    // Sum POS transaction count from sales array
    const todayDateStr = new Date().toISOString().split('T')[0];
    const todaysSalesCount = sales.filter(s => s.date === todayDateStr).length;

    // Construct pre-formatted text message
    let message = `*Daily Sales & Shift Report: ${businessProfile.name}*\n`;
    message += `Date: ${todayDateStr}\n`;
    message += `Total POS Receipts Generated: ${todaysSalesCount}\n\n`;
    message += `*Financial Metrics:*\n`;
    message += `• Sales Revenue: ${formatCurrency(pAndL.totalRevenue, businessProfile.currency)}\n`;
    message += `• Cost of Goods (COGS): ${formatCurrency(pAndL.cogs, businessProfile.currency)}\n`;
    message += `• Operating Expenses: ${formatCurrency(pAndL.totalExpenses, businessProfile.currency)}\n`;
    message += `• *Net Profit:* ${formatCurrency(pAndL.netIncome, businessProfile.currency)} (${profitMargin}% Margin)\n\n`;
    message += `*Liquid Balance Sheet Status:*\n`;
    message += `• Cash on Hand: ${formatCurrency(totalCashLiquid, businessProfile.currency)}\n`;
    message += `• Accounts Receivable: ${formatCurrency(accountsReceivable, businessProfile.currency)}\n`;
    message += `• Accounts Payable: ${formatCurrency(accountsPayable, businessProfile.currency)}\n\n`;
    
    const lowStocks = products.filter(p => p.stock <= p.minStock);
    if (lowStocks.length > 0) {
      message += `*Critical Stock alerts:*\n`;
      lowStocks.forEach(p => {
        message += `• ${p.name} - Only ${p.stock} left!\n`;
      });
    } else {
      message += `*Inventory health:* All stocks safe.`;
    }

    // Strict PDF Share Warning and Automatic PDF compiler trigger
    alert("🔐 SECURE SHIFT DISPATCH PROTOCOL:\nAll financial report shares are strictly restricted to PDF format to prevent data tampering. \n\nClick OK to: \n1. Automatically compile and save the report as a PDF.\n2. Open WhatsApp Web to attach and dispatch your downloaded PDF file.");
    
    // Trigger PDF generation instantly
    window.print();

    // Construct companion text details instructing attachment of PDF
    let companionText = `*${businessProfile.name} Shift Summary Report*\n`;
    companionText += `[Awaiting PDF Attachment: Afritecx_Badboy_Report_${todayDateStr}.pdf]\n\n`;
    companionText += `Please inspect the attached secure PDF document for sales tallies, bank drops, cogs cost, and double-entry general ledger offsets posted for ${todayDateStr}.`;

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(companionText)}`;
    window.open(whatsappUrl, '_blank');
  };

  const lowStockCount = products.filter(p => p.stock <= p.minStock).length;
  const profitMarginPercent = pAndL.totalRevenue > 0 ? ((pAndL.netIncome / pAndL.totalRevenue) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6 overflow-y-auto h-[calc(100vh-140px)] pr-1 print:p-0 print:h-auto">
      
      {/* SECTION 1: EXEC METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:grid-cols-4">
        
        {/* Sales Revenue */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition-all">
          <div className="p-3.5 rounded-xl bg-teal-50 text-teal-600">
            <ShoppingBag size={20} className="stroke-[2.2]" />
          </div>
          <div>
            <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider block">Sales Revenue</span>
            <span className="text-xl font-black text-gray-800 font-mono">
              {formatCurrency(pAndL.totalRevenue, businessProfile.currency)}
            </span>
            <span className="text-[9px] text-teal-600 font-bold flex items-center gap-0.5 mt-0.5">
              <TrendingUp size={12} /> {profitMarginPercent}% Net Margin
            </span>
          </div>
        </div>

        {/* Gross profit */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition-all">
          <div className="p-3.5 rounded-xl bg-indigo-50 text-indigo-600">
            <Percent size={20} className="stroke-[2.2]" />
          </div>
          <div>
            <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider block">Gross Profit (Margin)</span>
            <span className="text-xl font-black text-gray-800 font-mono">
              {formatCurrency(pAndL.grossProfit, businessProfile.currency)}
            </span>
            <span className="text-[9px] text-gray-400 block mt-0.5">
              COGS cost: {formatCurrency(pAndL.cogs, businessProfile.currency)}
            </span>
          </div>
        </div>

        {/* Liquid cash */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition-all">
          <div className="p-3.5 rounded-xl bg-sky-50 text-sky-600">
            <Wallet size={20} className="stroke-[2.2]" />
          </div>
          <div>
            <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider block">Liquid Cash Holdings</span>
            <span className="text-xl font-black text-gray-800 font-mono">
              {formatCurrency(totalCashLiquid, businessProfile.currency)}
            </span>
            <span className="text-[9px] text-gray-500 block mt-0.5 font-medium">
              Drawer: {formatCurrency(cashDrawer, businessProfile.currency)} | Bank: {formatCurrency(bankAccount, businessProfile.currency)}
            </span>
          </div>
        </div>

        {/* Net Income */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition-all">
          <div className={`p-3.5 rounded-xl ${
            pAndL.netIncome >= 0 ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-600'
          }`}>
            <DollarSign size={20} className="stroke-[2.2]" />
          </div>
          <div>
            <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider block">Net Income</span>
            <span className={`text-xl font-black font-mono ${pAndL.netIncome >= 0 ? 'text-teal-700' : 'text-red-700'}`}>
              {formatCurrency(pAndL.netIncome, businessProfile.currency)}
            </span>
            <span className="text-[9px] text-gray-400 block mt-0.5">
              Operating expenses: {formatCurrency(pAndL.totalExpenses, businessProfile.currency)}
            </span>
          </div>
        </div>

      </div>

      {/* NEW SECTION: POP-UP NOTIFICATIONS HUB & DISPATCH EXPORTS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:hidden">
        
        {/* Left: Popup Notifications Toasts */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-gray-100 p-5.5 shadow-sm flex flex-col gap-4">
          <div className="flex justify-between items-center border-b border-gray-50 pb-3">
            <div>
              <h3 className="text-sm font-black text-gray-800 uppercase tracking-wide flex items-center gap-1.5">
                <Bell size={16} className="text-teal-600 animate-bounce" /> Live Warning Notifications
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">System-generated alerts for low-stock buffers and credit accounts</p>
            </div>
          </div>

          <div className="space-y-2.5 flex-1 max-h-[220px] overflow-y-auto pr-1">
            {toasts.length === 0 ? (
              <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-4 rounded-xl font-bold flex items-center gap-1.5 justify-center py-8">
                <CheckCircle size={15} /> All systems operational. Zero active warnings.
              </p>
            ) : (
              toasts.map(toast => (
                <div 
                  key={toast.id} 
                  className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs font-semibold ${
                    toast.type === 'WARN' 
                      ? 'bg-rose-50 border-rose-100 text-rose-800 animate-pulse' 
                      : 'bg-teal-50 border-teal-100 text-teal-800'
                  }`}
                >
                  <AlertTriangle size={15} className={`shrink-0 mt-0.5 ${toast.type === 'WARN' ? 'text-rose-500' : 'text-teal-600'}`} />
                  <p>{toast.message}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Dispatch / Export Daily Performance Reports */}
        <div className="lg:col-span-6 bg-slate-900 rounded-2xl border border-slate-800 p-5.5 text-white flex flex-col justify-between gap-5 shadow-lg relative overflow-hidden">
          <div className="absolute top-[-20%] right-[-10%] w-[180px] h-[180px] rounded-full bg-teal-500/10 blur-[40px] pointer-events-none"></div>
          
          <div className="space-y-1.5">
            <span className="text-[10px] bg-teal-500/15 text-teal-400 py-0.5 px-2 rounded-full font-bold uppercase tracking-wider">Report Desk</span>
            <h3 className="text-sm font-black uppercase tracking-wide">Publish Shift Summary</h3>
            <p className="text-xs text-slate-400 leading-relaxed">Save daily revenue totals, bank drops, and margin audits as a local PDF or dispatch formatted summaries to the business supervisor's WhatsApp instantly.</p>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-2">
            <button
              onClick={handlePrintDailyReport}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Printer size={15} /> Save Report (PDF)
            </button>
            <button
              onClick={handleShareReportWhatsApp}
              className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow shadow-teal-600/10 cursor-pointer"
            >
              <Send size={14} /> Send WhatsApp
            </button>
          </div>
        </div>

      </div>

      {/* SECTION 2: READ-ONLY STOCK ON HAND PANEL (LOCKED) */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5.5 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center border-b border-gray-50 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wide">Real-time {businessProfile.terminology.itemLabel} Stock-On-Hand</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">Read-only monitor for {businessProfile.name}. View current counts and safety benchmarks across the configured {businessProfile.businessType.replace(/_/g, ' ').toLowerCase()} catalog.</p>
          </div>
          <span className="text-[10px] font-bold text-teal-600 bg-teal-100/50 py-1.5 px-3 rounded-full uppercase tracking-wider print:hidden">Audit Safe Monitoring</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4.5 max-h-[350px] overflow-y-auto pr-1 print:grid-cols-3 print:max-h-none print:overflow-visible">
          {products.map((p) => {
            const isLow = p.stock <= p.minStock;
            const stockPercent = Math.min(100, (p.stock / Math.max(100, p.stock * 1.5)) * 100);

            return (
              <div key={p.id} className="bg-gray-50/50 border border-gray-100 rounded-xl p-3.5 flex items-center justify-between gap-3 shadow-xs">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{p.image || '📦'}</span>
                    <div>
                      <h4 className="text-xs font-bold text-gray-800 line-clamp-1">{p.name}</h4>
                      <span className="text-[9px] text-gray-400 font-mono block">SKU: {p.sku} | Cat: {p.category}</span>
                    </div>
                  </div>

                  {/* Stock Progress Bar */}
                  <div className="space-y-1">
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          p.stock <= 0 ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-teal-600'
                        }`} 
                        style={{ width: `${stockPercent}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[8px] text-gray-400 font-bold uppercase">
                      <span>Available: {p.stock} units</span>
                      <span>Min Safe: {p.minStock} units</span>
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className={`inline-block text-[9px] font-black px-2 py-0.5 rounded ${
                    p.stock <= 0
                      ? 'bg-red-100 text-red-700'
                      : isLow
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-teal-100 text-teal-800'
                  }`}>
                    {p.stock <= 0 ? 'Stockout' : isLow ? 'Low Stock' : 'Healthy'}
                  </span>
                  <span className="block text-xs font-mono font-bold text-gray-400 mt-1">
                    Value: {formatCurrency(p.stock * p.costPrice, businessProfile.currency)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* NEW SECTION: REMINDERS SCHEDULER BOARD */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:hidden">
        
        {/* Left: Add custom Reminder Form */}
        <div className="lg:col-span-5 bg-gray-50 border border-gray-100 rounded-2xl p-5.5 shadow-sm">
          <div className="border-b border-gray-200 pb-2 mb-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-teal-600 flex items-center gap-1.5">
              <Calendar size={14} /> Schedule New Reminder
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Post-it reminders for stock, tax deadlines, or administrative checks</p>
          </div>

          <form onSubmit={handleAddReminder} className="space-y-3.5 text-xs">
            <div>
              <label className="block font-bold text-gray-500 uppercase mb-1">Reminder Heading *</label>
              <input
                type="text"
                required
                placeholder="e.g. Audit Delta Beverage Quarts Delivery"
                value={newRemTitle}
                onChange={(e) => setNewRemTitle(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div>
              <label className="block font-bold text-gray-500 uppercase mb-1">Target Date / Deadline *</label>
              <input
                type="date"
                required
                value={newRemDate}
                onChange={(e) => setNewRemDate(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-gray-500 uppercase mb-1">Task Category *</label>
                <select
                  value={newRemCategory}
                  onChange={(e) => setNewRemCategory(e.target.value as any)}
                  className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-3 font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="STOCK">STOCK (Inventory)</option>
                  <option value="TAX">TAX (Clearing)</option>
                  <option value="PAYROLL">PAYROLL (Wages)</option>
                  <option value="OTHER">OTHER (General)</option>
                </select>
              </div>

              <div className="flex flex-col justify-end">
                <button
                  type="submit"
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-xl shadow flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus size={14} /> Add Reminder
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Right: Reminders audit list */}
        <div className="lg:col-span-7 bg-white border border-gray-100 rounded-2xl p-5.5 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-wider text-teal-600 border-b border-gray-150 pb-2 mb-3">Active Manager Reminders</h3>
          
          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
            {reminders.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-8 text-center">No scheduled reminders. Add items on the left panel to begin.</p>
            ) : (
              reminders.map(rem => (
                <div 
                  key={rem.id} 
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                    rem.isCompleted 
                      ? 'bg-gray-50 border-gray-100 opacity-60' 
                      : 'bg-white border-gray-100 hover:border-gray-150 shadow-xs'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={rem.isCompleted}
                      onChange={() => handleToggleReminder(rem.id)}
                      className="accent-teal-600 cursor-pointer h-4 w-4"
                    />
                    <div>
                      <h4 className={`text-xs font-bold ${rem.isCompleted ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {rem.title}
                      </h4>
                      <span className="text-[9px] text-gray-400 font-mono">
                        Due: {rem.targetDate} | Class: <span className="font-bold text-teal-600">{rem.category}</span>
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteReminder(rem.id)}
                    className="p-1 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-all cursor-pointer shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* SECTION 3: BOTTOM ALERTS, DEBTS AND RECENT AUDIT LIST */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Col: Safety Checks and Stock Alerts */}
        <div className="space-y-4">
          
          {/* Double entry Balance status */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4.5 shadow-sm flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-teal-50 text-teal-600 shrink-0">
              <ShieldCheck size={20} className="stroke-[2.2]" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-gray-800">Double-Entry Ledger Integrity</h4>
              <p className="text-[11px] text-gray-400 mt-0.5">Verifying Debit vs Credit trial balance check sum</p>
              
              {trialBal.isBalanced ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-lg py-0.5 px-2.5 mt-2.5">
                  <CheckCircle size={12} /> Books balanced perfectly: ({formatCurrency(trialBal.totalDebit, businessProfile.currency)})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg py-0.5 px-2.5 mt-2.5">
                  <AlertTriangle size={12} /> Out of Balance! Check journal edits.
                </span>
              )}
            </div>
          </div>

          {/* Low Stock Alerts */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4.5 shadow-sm flex items-start gap-3.5">
            <div className={`p-2.5 rounded-xl shrink-0 ${
              lowStockCount > 0 ? 'bg-amber-50 text-amber-600 animate-pulse' : 'bg-teal-50 text-teal-600'
            }`}>
              <AlertTriangle size={20} className="stroke-[2.2]" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-gray-800">Inventory Safeguard Warnings</h4>
              <p className="text-[11px] text-gray-400 mt-0.5">Tracks items approaching minimum stock capacity</p>
              
              {lowStockCount > 0 ? (
                <button
                  onClick={() => onNavigate('inventory')}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg py-0.5 px-2.5 mt-2.5 hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  ⚠ {lowStockCount} items below safety limits! RESTOCK NOW
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-lg py-0.5 px-2.5 mt-2.5">
                  <CheckCircle size={12} /> All stock levels healthy
                </span>
              )}
            </div>
          </div>

        </div>

        {/* Middle Col: AR (Store Credit) vs AP (Supplier credit) ledger */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex flex-col gap-4">
          <div className="border-b border-gray-50 pb-2.5">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wide">Credit Portfolio Ledger</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">{businessProfile.terminology.customerLabel} receivables vs {businessProfile.terminology.supplierLabel} liabilities</p>
          </div>

          <div className="flex-1 flex flex-col justify-center gap-3">
            {/* Accounts Receivable (Customers owe us) */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-teal-50/40 border border-teal-50">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-teal-100/50 text-teal-700">
                  <ArrowDownLeft size={16} />
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase block">Accounts Receivable (1100)</span>
                  <span className="text-xs text-gray-500 font-medium">{customers.filter(c => c.storeCredit < 0).length} active {businessProfile.terminology.customerLabel.toLowerCase()} accounts</span>
                </div>
              </div>
              <span className="text-sm font-black text-teal-700 font-mono">
                {formatCurrency(accountsReceivable, businessProfile.currency)}
              </span>
            </div>

            {/* Accounts Payable (We owe suppliers) */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50/40 border border-amber-50">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-amber-100/50 text-amber-700">
                  <ArrowUpRight size={16} />
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase block">Accounts Payable (2010)</span>
                  <span className="text-xs text-gray-500 font-medium">{suppliers.filter(s => s.balanceOwed > 0).length} {businessProfile.terminology.supplierLabel.toLowerCase()} liabilities</span>
                </div>
              </div>
              <span className="text-sm font-black text-amber-700 font-mono">
                {formatCurrency(accountsPayable, businessProfile.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Right Col: Recent general ledger activities list */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex flex-col gap-4">
          <div className="flex justify-between items-center border-b border-gray-50 pb-2.5">
            <div>
              <h3 className="text-xs font-black text-gray-800 uppercase tracking-wide">Journal Posting Stream</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">Chronological double-entry offsets</p>
            </div>
            <button onClick={() => onNavigate('accounting')} className="text-[10px] text-teal-600 hover:text-teal-700 font-bold flex items-center gap-0.5">
              Full Ledger <ArrowRight size={12} />
            </button>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[160px] pr-1">
            {journalEntries
              .slice(-4)
              .reverse()
              .map((je, idx) => {
                const totalDeb = je.lines.filter(l => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0);
                return (
                  <div key={idx} className="flex justify-between items-start text-[11px] hover:bg-gray-50/40 p-1.5 rounded-lg transition-colors">
                    <div className="space-y-0.5 max-w-[150px]">
                      <h4 className="font-bold text-gray-700 truncate">{je.description}</h4>
                      <p className="text-[9px] text-gray-400 font-mono uppercase">{je.id.substring(3, 11)} | {je.date}</p>
                    </div>
                    <span className="font-mono font-bold text-teal-600 shrink-0">
                      {formatCurrency(totalDeb, businessProfile.currency)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>

      </div>

    </div>
  );
}
