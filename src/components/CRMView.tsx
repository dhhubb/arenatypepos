/**
 * ============================================================================
 * MODULE: components/CRMView.tsx — Customer & Supplier Relationship Manager
 * ----------------------------------------------------------------------------
 * Manages the two credit relationships of the business:
 *   - CUSTOMERS (Accounts Receivable): shows who owes the business, their
 *     credit limits, and lets staff record incoming payments against tabs.
 *   - SUPPLIERS (Accounts Payable): shows who the business owes and lets staff
 *     record payouts that clear supplier balances.
 * Each recorded payment/payout flows back to App.tsx to update balances and
 * post the correct double-entry journal. Terminology adapts to the business
 * type, and AUDIT users are prevented from recording money movements.
 * ============================================================================
 */
import React, { useState } from 'react';
import { Customer, Supplier, BusinessProfile, User as SystemUser } from '../types';
import { 
  Users, 
  User, 
  Briefcase, 
  Phone, 
  Mail, 
  ArrowDownLeft, 
  ArrowUpRight, 
  CheckCircle
} from 'lucide-react';

interface CRMViewProps {
  customers: Customer[];
  suppliers: Supplier[];
  businessProfile: BusinessProfile;
  onReceiveCustomerPayment: (customerId: string, amount: number, method: 'CASH' | 'CARD') => void;
  onPaySupplier: (supplierId: string, amount: number, method: 'CASH' | 'CARD') => void;
  currentUser: SystemUser | null;
}

export default function CRMView({
  customers,
  suppliers,
  businessProfile,
  onReceiveCustomerPayment,
  onPaySupplier,
  currentUser
}: CRMViewProps) {
  const [activeTab, setActiveTab] = useState<'customers' | 'suppliers'>('customers');

  // Active Customer Payment Modal
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [custPaymentAmount, setCustPaymentAmount] = useState('');
  const [custPaymentMethod, setCustPaymentMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [custPaymentSuccess, setCustPaymentSuccess] = useState(false);

  // Active Supplier Payment Modal
  const [payoutSupplier, setPayoutSupplier] = useState<Supplier | null>(null);
  const [suppPaymentAmount, setSuppPaymentAmount] = useState('');
  const [suppPaymentMethod, setSuppPaymentMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [suppPaymentSuccess, setSuppPaymentSuccess] = useState(false);

  /**
   * Processes the customer's payment against their outstanding credit tab.
   * Decrements Accounts Receivable (1100) and increases physical Cash Drawer (1010) or Bank (1020).
   * Blocks execution and alerts the user if the logged in profile belongs to the 'AUDIT' role.
   */
  const handleCustomerPaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentCustomer) return;

    // Security Gate check
    if (currentUser?.userType === 'AUDIT') {
      alert('Security Warning: This is a Read-Only Audit session. Ledger modifications and customer payout adjustments are locked.');
      return;
    }

    const amt = parseFloat(custPaymentAmount) || 0;
    if (amt <= 0) {
      alert('Please enter a valid payment amount.');
      return;
    }

    // Fire the double entry updater
    onReceiveCustomerPayment(paymentCustomer.id, amt, custPaymentMethod);
    setCustPaymentSuccess(true);
    setCustPaymentAmount('');

    setTimeout(() => {
      setPaymentCustomer(null);
      setCustPaymentSuccess(false);
    }, 1500);
  };

  /**
   * Processes the supplier payment to pay off procurement debts.
   * Decrements Accounts Payable (2010) and decreases physical Cash Drawer (1010) or Bank (1020).
   * Blocks execution if logged in user is in 'AUDIT' mode.
   */
  const handleSupplierPaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutSupplier) return;

    // Security Gate check
    if (currentUser?.userType === 'AUDIT') {
      alert('Security Warning: This is a Read-Only Audit session. Ledger modifications and supplier payouts are locked.');
      return;
    }

    const amt = parseFloat(suppPaymentAmount) || 0;
    if (amt <= 0) {
      alert('Please enter a valid payment amount.');
      return;
    }

    // Fire the double entry updater
    onPaySupplier(payoutSupplier.id, amt, suppPaymentMethod);
    setSuppPaymentSuccess(true);
    setSuppPaymentAmount('');

    setTimeout(() => {
      setPayoutSupplier(null);
      setSuppPaymentSuccess(false);
    }, 1500);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
      
      {/* Navigation Header */}
      <div className="bg-gray-50 border-b border-gray-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Users size={18} className="text-teal-600" /> Commercial Directory & Ledger
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Manage {businessProfile.terminology.customerLabel.toLowerCase()} receivables and {businessProfile.terminology.supplierLabel.toLowerCase()} payables</p>
        </div>

        {/* Tab switchers */}
        <div className="flex bg-white border border-gray-200 rounded-xl p-1 gap-1 self-start">
          <button
            onClick={() => setActiveTab('customers')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'customers'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <User size={14} /> {businessProfile.terminology.customerLabel} Accounts
          </button>
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'suppliers'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Briefcase size={14} /> {businessProfile.terminology.supplierLabel} Accounts
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        
        {/* ================= TAB 1: CUSTOMERS CRM (ACCOUNTS RECEIVABLE) ================= */}
        {activeTab === 'customers' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center bg-teal-50/50 border border-teal-100 rounded-2xl p-4 text-xs">
              <div>
                  <h4 className="font-bold text-teal-800">Accounts Receivable (A/R) Overview</h4>
                  <p className="text-teal-700/80 mt-0.5">{businessProfile.terminology.customerLabel} accounts can transact on credit up to their configured limits.</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-gray-400 font-bold block uppercase">Cumulative AR Assets</span>
                <span className="text-base font-black text-teal-700 font-mono">
                  {businessProfile.currency}
                  {customers.reduce((sum, c) => sum + (c.storeCredit < 0 ? Math.abs(c.storeCredit) : 0), 0).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Customers Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {customers.map(cust => {
                const isDebtor = cust.storeCredit < 0;
                const outstandingDebt = isDebtor ? Math.abs(cust.storeCredit) : 0;
                
                return (
                  <div key={cust.id} className="border border-gray-100 rounded-2xl p-4 bg-gray-50/30 hover:border-gray-200 shadow-xs flex flex-col justify-between gap-4 transition-all">
                    
                    {/* Customer Info header */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-start">
                        <h4 className="text-sm font-bold text-gray-800">{cust.name}</h4>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${
                          cust.storeCredit > 0
                            ? 'bg-emerald-100 text-emerald-800'
                            : isDebtor
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-gray-100 text-gray-600'
                        }`}>
                          {cust.storeCredit > 0 
                            ? `Advance Credit: ${businessProfile.currency}${cust.storeCredit.toFixed(2)}` 
                            : isDebtor
                              ? `Owes Debt: ${businessProfile.currency}${outstandingDebt.toFixed(2)}`
                              : 'Account Balanced'
                          }
                        </span>
                      </div>
                      
                      {/* Contact items */}
                      <div className="space-y-1 text-xs text-gray-500">
                        <p className="flex items-center gap-1.5"><Phone size={13} className="text-gray-400" /> {cust.phone || 'N/A'}</p>
                        <p className="flex items-center gap-1.5"><Mail size={13} className="text-gray-400" /> {cust.email || 'N/A'}</p>
                      </div>
                    </div>

                    {/* Credit stats & Action payment buttons */}
                    <div className="border-t border-gray-150 pt-3 flex items-center justify-between mt-auto">
                      <div className="text-[11px] text-gray-400">
                        Credit Limit: <span className="font-mono font-bold text-gray-700">{businessProfile.currency}{cust.creditLimit.toFixed(2)}</span>
                        {isDebtor && (
                          <span className="block text-[10px] text-rose-600 font-semibold">Available Credit: {businessProfile.currency}{(cust.creditLimit - outstandingDebt).toFixed(2)}</span>
                        )}
                      </div>

                      {/* Payment trigger */}
                      {isDebtor && (
                        <button
                          onClick={() => setPaymentCustomer(cust)}
                          className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-1.5 px-3 rounded-xl text-xs flex items-center gap-1 shadow cursor-pointer transition-colors"
                        >
                          <ArrowDownLeft size={13} /> Pay Tab
                        </button>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= TAB 2: SUPPLIERS CRM (ACCOUNTS PAYABLE) ================= */}
        {activeTab === 'suppliers' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center bg-amber-50 border border-amber-100 rounded-2xl p-4 text-xs">
              <div>
                  <h4 className="font-bold text-amber-800">Accounts Payable (A/P) Overview</h4>
                  <p className="text-amber-700/80 mt-0.5">Credit purchases increase Accounts Payable. Record payments here to clear {businessProfile.terminology.supplierLabel.toLowerCase()} balances.</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-gray-400 font-bold block uppercase">Cumulative AP Liabilities</span>
                <span className="text-base font-black text-amber-700 font-mono">
                  {businessProfile.currency}
                  {suppliers.reduce((sum, s) => sum + s.balanceOwed, 0).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Suppliers Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suppliers.map(supp => {
                const hasBalance = supp.balanceOwed > 0;
                
                return (
                  <div key={supp.id} className="border border-gray-100 rounded-2xl p-4 bg-gray-50/30 hover:border-gray-200 shadow-xs flex flex-col justify-between gap-4 transition-all">
                    
                    {/* Supplier Info header */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-start">
                        <h4 className="text-sm font-bold text-gray-800">{supp.name}</h4>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${
                          hasBalance 
                            ? 'bg-amber-100 text-amber-800' 
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {hasBalance 
                            ? `AP Debt: ${businessProfile.currency}${supp.balanceOwed.toFixed(2)}` 
                            : 'Balanced Supplier Account'
                          }
                        </span>
                      </div>
                      
                      {/* Contact items */}
                      <div className="space-y-1 text-xs text-gray-500">
                        <p className="flex items-center gap-1.5"><Phone size={13} className="text-gray-400" /> {supp.phone || 'N/A'}</p>
                        <p className="flex items-center gap-1.5"><Mail size={13} className="text-gray-400" /> {supp.email || 'N/A'}</p>
                      </div>
                    </div>

                    {/* Action payout buttons */}
                    {hasBalance && (
                      <div className="border-t border-gray-150 pt-3 flex items-center justify-end mt-auto">
                        <button
                          onClick={() => setPayoutSupplier(supp)}
                          className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-1.5 px-3 rounded-xl text-xs flex items-center gap-1 shadow cursor-pointer transition-colors"
                        >
                          <ArrowUpRight size={13} /> Record Payout
                        </button>
                      </div>
                    )}

                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* ================= MODAL: CUSTOMER PAY OUTSTANDING TAB ================= */}
      {paymentCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleCustomerPaymentSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-scale-up">
            <div className="p-5 border-b border-gray-100 bg-teal-50/50">
              <h3 className="text-sm font-bold text-gray-800">Receive Payment on Customer Tab</h3>
              <p className="text-xs text-gray-400 mt-0.5">Record incoming debt settlement for {paymentCustomer.name}</p>
            </div>

            <div className="p-6 space-y-4">
              
              <div className="p-3 bg-teal-50/50 border border-teal-100 rounded-xl space-y-1 text-xs text-teal-800">
                <p>Outstanding Debt Balance: <span className="font-mono font-bold">{businessProfile.currency}{Math.abs(paymentCustomer.storeCredit).toFixed(2)}</span></p>
                <p>Max Allowed Limit: <span className="font-mono font-bold">{businessProfile.currency}{paymentCustomer.creditLimit.toFixed(2)}</span></p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Receipt Amount ({businessProfile.currency}) *</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold">{businessProfile.currency}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    max={Math.abs(paymentCustomer.storeCredit)}
                    placeholder="0.00"
                    value={custPaymentAmount}
                    onChange={(e) => setCustPaymentAmount(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Accept custom amounts up to the total outstanding debt.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Tender Payment Method *</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="custMethod"
                      checked={custPaymentMethod === 'CASH'}
                      onChange={() => setCustPaymentMethod('CASH')}
                      className="accent-teal-600"
                    /> Cash Box (1010)
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="custMethod"
                      checked={custPaymentMethod === 'CARD'}
                      onChange={() => setCustPaymentMethod('CARD')}
                      className="accent-teal-600"
                    /> Card Clearing / Bank (1020)
                  </label>
                </div>
              </div>

              {custPaymentSuccess && (
                <div className="flex items-center gap-1.5 text-xs text-teal-700 bg-teal-100/50 p-3 rounded-lg border border-teal-200">
                  <CheckCircle size={15} /> Tab payment received! Journal posted to cash & accounts receivable registers.
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setPaymentCustomer(null)}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-xl text-xs shadow cursor-pointer"
              >
                Receive Cash Receipt
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL: SUPPLIER REPAY LIABILITY TAB ================= */}
      {payoutSupplier && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSupplierPaymentSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-scale-up">
            <div className="p-5 border-b border-gray-100 bg-amber-50/50">
              <h3 className="text-sm font-bold text-gray-800">Record Payout to Wholesale Supplier</h3>
              <p className="text-xs text-gray-400 mt-0.5">Debit outstanding Accounts Payable liability for {payoutSupplier.name}</p>
            </div>

            <div className="p-6 space-y-4">
              
              <div className="p-3 bg-amber-50/50 border border-amber-100 rounded-xl space-y-1 text-xs text-amber-800">
                <p>Outstanding Accounts Payable Debt: <span className="font-mono font-bold">{businessProfile.currency}{payoutSupplier.balanceOwed.toFixed(2)}</span></p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Payout Amount ({businessProfile.currency}) *</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold">{businessProfile.currency}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    max={payoutSupplier.balanceOwed}
                    placeholder="0.00"
                    value={suppPaymentAmount}
                    onChange={(e) => setSuppPaymentAmount(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Accept custom amounts up to the total Accounts Payable debt.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Disbursing Payment Source *</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="suppMethod"
                      checked={suppPaymentMethod === 'CASH'}
                      onChange={() => setSuppPaymentMethod('CASH')}
                      className="accent-amber-600"
                    /> Cash Drawer Box (1010)
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="suppMethod"
                      checked={suppPaymentMethod === 'CARD'}
                      onChange={() => setSuppPaymentMethod('CARD')}
                      className="accent-amber-600"
                    /> Card clearing / Bank (1020)
                  </label>
                </div>
              </div>

              {suppPaymentSuccess && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-100/50 p-3 rounded-lg border border-amber-200">
                  <CheckCircle size={15} /> Payout processed! Journal posted to Accounts Payable & Cash offsets.
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setPayoutSupplier(null)}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 rounded-xl text-xs shadow cursor-pointer"
              >
                Disburse Payout
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
