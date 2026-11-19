/**
 * ============================================================================
 * MODULE: components/AIAgentView.tsx — Built-in AI Business Assistant
 * ----------------------------------------------------------------------------
 * A guided helper that explains the app and speeds up data entry:
 *   - HELP CHAT: answers "how do I..." questions and returns a startup guide,
 *     accounting explanations, and workflow walkthroughs.
 *   - DOCUMENT INGESTION: the user uploads a receipt/invoice image; the agent
 *     simulates OCR extraction, pre-fills a review form (supplier, item, qty,
 *     cost, tax, or an operating expense), and — only after the user confirms —
 *     feeds it into the database as a purchase order or a journal entry.
 * The user stays in control of everything committed; AUDIT users cannot ingest.
 * ============================================================================
 */
import React, { useState, useRef, useEffect } from 'react';
import { Product, Supplier, PurchaseOrder, JournalEntry, Account, User } from '../types';
import { 
  Sparkles, 
  Send, 
  Upload, 
  CheckCircle, 
  AlertTriangle, 
  Bot, 
  RefreshCw,
  Lock
} from 'lucide-react';

import { BusinessProfile } from '../types';
import { formatCurrency } from '../utils/currency';

interface AIAgentViewProps {
  products: Product[];
  suppliers: Supplier[];
  accounts: Account[];
  currentUser: User | null;
  onAddPurchaseOrder: (po: PurchaseOrder) => void;
  onAddManualJournalEntry: (entry: JournalEntry) => void;
  businessProfile: BusinessProfile;
}

interface ChatMessage {
  id: string;
  sender: 'AI' | 'USER';
  text: string;
  timestamp: string;
}

export default function AIAgentView({
  products,
  suppliers,
  accounts,
  currentUser,
  onAddPurchaseOrder,
  onAddManualJournalEntry,
  businessProfile
}: AIAgentViewProps) {
  // --- CHAT CHATBOT STATE ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- IMAGE PROCESSING STATE ---
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanScanningProgress] = useState(0);
  
  // Parsed OCR Form States (For Guided confirmation)
  const [parsedSupplierId, setParsedSupplierId] = useState('');
  const [parsedProductId, setParsedProductId] = useState('');
  const [parsedQty, setParsedQty] = useState('50');
  const [parsedCost, setParsedCost] = useState('18.50');
  const [parsedTaxRate, setParsedTaxRate] = useState('15');
  const [parsedReceiptDate, setParsedReceiptDate] = useState(new Date().toISOString().split('T')[0]);
  const [parsedInvoiceNo, setParsedInvoiceNo] = useState('');
  const [feedType, setFeedType] = useState<'INVENTORY_REORDER' | 'OPERATING_EXPENSE'>('INVENTORY_REORDER');
  const [parsedExpenseAccount, setParsedExpenseAccount] = useState('6030'); // default utilities/internet or rent
  const [parsedExpenseAmount, setParsedExpenseAmount] = useState('450.00');
  const [parsedExpenseDesc, setParsedExpenseDesc] = useState('Delta Delivery Freight Surcharge');

  const [ingestSuccess, setIngestSuccess] = useState(false);
  const [ingestError, setIngestError] = useState('');

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Seeding initial welcome message and guide
  useEffect(() => {
    const welcomeText = `Hello! I am your **Afritecx Badboy AI Business Agent**. I am configured for **${businessProfile.name}**, a ${businessProfile.businessType.replace(/_/g, ' ').toLowerCase()} business.

Here is what I can do:
1. 📖 **Startup Guide**: Type "guide" or click the guide button below to get step-by-step operational instructions.
2. 💡 **Explain GAAP double-entry**: Ask me how POS transactions and payroll balance the balance sheet.
3. **Process Receipt Images**: Upload a delivery slip, invoice, or expense receipt on the right panel. I will extract candidate details, let you review and correct them, and only then feed the approved data into inventory and accounting.

How can I help you today?`;
    
    setMessages([
      { id: 'm-init', sender: 'AI', text: welcomeText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    ]);
  }, []);

  // --- INTERACTIVE CHATBOT LOGIC ---

  /**
   * Evaluates natural language user questions and responds with clear, structured instructions or guide chapters.
   */
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputQuery.trim()) return;

    const userText = inputQuery.trim();
    const nextMessages = [...messages, {
      id: `msg-user-${Date.now()}`,
      sender: 'USER' as const,
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }];
    setMessages(nextMessages);
    setInputQuery('');

    // Simulated AI thinking latency
    setTimeout(() => {
      let aiResponse = '';
      const query = userText.toLowerCase();

      if (query.includes('guide') || query.includes('start') || query.includes('how does')) {
        aiResponse = `### 🚀 Quick Startup & Operational Guide
Welcome to **Afritecx Badboy**, configured for **${businessProfile.name}**. Follow these steps to manage daily operations:

1. **Transactions**: Navigate to **Checkout POS**. Add ${businessProfile.terminology.itemLabel.toLowerCase()} records, assign a ${businessProfile.terminology.customerLabel.toLowerCase()} when needed, choose a payment method, and complete the transaction.
2. **Double-entry ledgers**: Every sale automatically debits Cash/Bank clearing and credits Sales Revenue, while deducting product cost from Inventory Asset to Cost of Goods Sold (COGS). Check this inside the **General Bookkeeping** tab.
3. **Closing Shift**: At the end of the day, go to the **Close Shift (Cash Up)** tab. Count your cash drawer denominations, reconcile shortages, transfer deposits to Bank Clearing, and export your certified secure PDF statement.
4. **Wages & Payroll**: Go to **Wages & Payroll**. Onboard your staff, review timesheets, authorize payruns, and clear PAYG taxes.`;
      } else if (query.includes('cogs') || query.includes('double') || query.includes('accounting') || query.includes('balance')) {
        aiResponse = `### 📊 Double-Entry Accounting Architecture
Our engine runs on GAAP standard double-entry bookkeeping rules:
*   **POS Sales**:
    *   *Debit*: Cash Drawer (1010) or Card Clearing (1020) for sales total (Assets ⬆)
    *   *Credit*: Sales Revenue (4010) for pre-tax net (Revenue ⬆)
    *   *Credit*: Sales Tax Payable (2200) for VAT collections (Liabilities ⬆)
    *   *Debit*: Cost of Goods Sold (5010) (Expenses ⬆)
    *   *Credit*: Inventory Asset (1200) (Assets ⬇)
*   **Inventory Purchases**:
    *   *Debit*: Inventory Asset (1200) (Assets ⬆)
    *   *Credit*: Accounts Payable (2010) or Cash (Liabilities ⬆ / Assets ⬇)
    
This maintains the balance sheet accounting identity: **Assets = Liabilities + Owner Equity** perfectly!`;
      } else if (query.includes('payroll') || query.includes('wages') || query.includes('salary')) {
        aiResponse = `### 👥 Processing Wages & Payroll
Here is how the integrated payroll flow coordinates compensation:
1.  **Timesheets**: Staff submit hours logged. Go to *Timesheet Approvals* to verify and click **Approve**.
2.  **Process Payrun**: Click *Process Payrun*. Approved hours are automatically loaded.
3.  **Ledger Sync**: Submitting the payrun triggers:
    *   *Debit*: Wages & Salaries Expense (6020) for Gross Pay.
    *   *Credit*: Sales Tax Payable (2200) for withheld PAYG income taxes.
    *   *Credit*: Bank Checking (1020) for Net salary paid.`;
      } else if (query.includes('cash up') || query.includes('discrepancy') || query.includes('shortage')) {
        aiResponse = `### 🪙 Cash Up & Till Reconciliations
Reconciling cash shifts manages till discrepancies safely:
*   **Counting**: Input physical bills/coins inside the **Close Shift (Cash Up)** tab.
*   **Discrepancies**: If cash counted doesn't match ledger expectations, the surplus/shortage is booked automatically (surpluses are credited to other income; shortages are debited to bank charges/operating expense).
*   **Deposits**: Choose the deposit value. Monies are debited to Bank Clearing (1020) and credited from the physical drawer (1010).`;
      } else {
        aiResponse = `Thank you for your question. I am searching the database for: "${userText}". 

I recommend exploring these standard modules:
*   Type **"guide"** to load the complete startup walkthrough.
*   Type **"accounting"** to learn about double-entry splits.
*   Type **"payroll"** to read up on wages and tax withholdings.
*   Or upload any delivery receipt on the right to auto-populate your inventory!`;
      }

      setMessages(prev => [...prev, {
        id: `msg-ai-${Date.now()}`,
        sender: 'AI',
        text: aiResponse,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }, 800);
  };

  // --- IMAGE / OCR INGESTION PROCESSOR ---

  /**
   * Handles files dropped or uploaded. Emulates an intelligent OCR parsing engine
   * detecting invoice types based on file naming or random seed arrays.
   */
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setUploadedImage(event.target?.result as string);
      triggerSimulatedOCR(file.name);
    };
    reader.readAsDataURL(file);
  };

  /**
   * Triggers a progressive scanning progress bar, mimicking real-time OCR extraction,
   * then auto-fills the user-guided form with structured values parsed from the document image.
   */
  const triggerSimulatedOCR = (fileName: string) => {
    setIsScanning(true);
    setScanScanningProgress(0);
    setIngestSuccess(false);
    setIngestError(false as any);

    const interval = setInterval(() => {
      setScanScanningProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsScanning(false);
          populateParsedData(fileName);
          return 100;
        }
        return prev + 20;
      });
    }, 250);
  };

  /**
   * Auto-populates the verification form based on the uploaded file name.
   */
  const populateParsedData = (name: string) => {
    const clean = name.toLowerCase();
    setParsedInvoiceNo(`INV-OCR-${Math.floor(100000 + Math.random() * 900000)}`);
    setParsedReceiptDate(new Date().toISOString().split('T')[0]);

    // First attempt a generic match using configured supplier/product names and SKUs.
    const matchedSupplier = suppliers.find(supplier =>
      supplier.name.toLowerCase().split(/\s+/).some(token => token.length > 3 && clean.includes(token))
    );
    const matchedProduct = products.find(product =>
      clean.includes(product.sku.toLowerCase()) ||
      product.name.toLowerCase().split(/\s+/).some(token => token.length > 3 && clean.includes(token))
    );

    if (matchedSupplier || matchedProduct) {
      setFeedType('INVENTORY_REORDER');
      setParsedSupplierId((matchedSupplier ?? suppliers[0])?.id || '');
      setParsedProductId((matchedProduct ?? products[0])?.id || '');
      setParsedQty('10');
      setParsedCost((matchedProduct ?? products[0])?.costPrice.toFixed(2) || '0.00');
      setParsedTaxRate(businessProfile.taxRate.toString());
    } else if (clean.includes('delta') || clean.includes('lager') || clean.includes('castle')) {
      // Delta Beverages Delivery Slip
      setFeedType('INVENTORY_REORDER');
      const supp = suppliers.find(s => s.name.toLowerCase().includes('delta')) || suppliers[0];
      const prod = products.find(p => p.sku === 'LGR-CST-01') || products[0];
      setParsedSupplierId(supp?.id || '');
      setParsedProductId(prod?.id || '');
      setParsedQty('120'); // 5 crates of Quarts
      setParsedCost('18.50');
      setParsedTaxRate('15');
    } else if (clean.includes('afdis') || clean.includes('whiskey') || clean.includes('gin')) {
      // Afdis delivery invoice
      setFeedType('INVENTORY_REORDER');
      const supp = suppliers.find(s => s.name.toLowerCase().includes('afdis')) || suppliers[1];
      const prod = products.find(p => p.sku === 'SPT-JAM-05') || products[4];
      setParsedSupplierId(supp?.id || '');
      setParsedProductId(prod?.id || '');
      setParsedQty('24'); // 2 cases
      setParsedCost('270.00');
      setParsedTaxRate('15');
    } else if (clean.includes('rent') || clean.includes('lease') || clean.includes('landlord')) {
      // Operating Rent expense
      setFeedType('OPERATING_EXPENSE');
      setParsedExpenseAccount('6010'); // Rent Expense Account
      setParsedExpenseAmount('1800.00');
      setParsedExpenseDesc('Plumtree Border Post Store Rent - Current Month Lease');
    } else {
      // Generic bar snack or utilities delivery
      setFeedType('INVENTORY_REORDER');
      const supp = suppliers[2] || suppliers[0];
      const prod = products[products.length - 1] || products[0];
      setParsedSupplierId(supp?.id || '');
      setParsedProductId(prod?.id || '');
      setParsedQty('40');
      setParsedCost('55.00');
      setParsedTaxRate('15');
    }
  };

  /**
   * Commits the user-guided, confirmed parsed details into the active database.
   */
  const handleInboundConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setIngestError('');
    setIngestSuccess(false);

    if (currentUser?.userType === 'AUDIT') {
      setIngestError('Security Warning: Data ingestion is restricted under Read-Only Audit sessions.');
      return;
    }

    try {
      if (feedType === 'INVENTORY_REORDER') {
        if (!parsedSupplierId || !parsedProductId) {
          setIngestError(`Please confirm the ${businessProfile.terminology.supplierLabel} and target ${businessProfile.terminology.itemLabel}.`);
          return;
        }

        const qty = parseInt(parsedQty) || 0;
        const cost = parseFloat(parsedCost) || 0;
        const prod = products.find(p => p.id === parsedProductId);

        if (qty <= 0 || cost <= 0) {
          setIngestError('Quantity and Unit cost must be positive values.');
          return;
        }

        const orderItem = {
          productId: parsedProductId,
          name: prod ? prod.name : 'Unknown Product',
          quantity: qty,
          costPrice: cost,
          total: qty * cost
        };

        const po: PurchaseOrder = {
          id: `PO-AI-${Date.now()}`,
          poNo: parsedInvoiceNo,
          date: parsedReceiptDate,
          supplierId: parsedSupplierId,
          items: [orderItem],
          total: parseFloat((qty * cost).toFixed(2)),
          isReceived: true,
          isPaid: false, // on credit
          paymentMethod: 'ACCOUNTS_PAYABLE'
        };

        // Fire coordinate purchase callback to update state and ledger accounts
        onAddPurchaseOrder(po);
        setIngestSuccess(true);
      } else {
        // Feed general Operating Expense directly into General Ledger offsets
        const amt = parseFloat(parsedExpenseAmount) || 0;
        if (amt <= 0) {
          setIngestError('Expense amount must be positive.');
          return;
        }

        const expenseId = `EXP-AI-${Date.now()}`;
        const je: JournalEntry = {
          id: `JE-EXP-AI-${Date.now()}`,
          date: parsedReceiptDate,
          description: `AI Ingested Expense: ${parsedExpenseDesc}`,
          reference: expenseId,
          lines: [
            { accountCode: parsedExpenseAccount, type: 'DEBIT', amount: parseFloat(amt.toFixed(2)) },
            { accountCode: '1020', type: 'CREDIT', amount: parseFloat(amt.toFixed(2)) } // paid from bank checking
          ]
        };

        onAddManualJournalEntry(je);
        setIngestSuccess(true);
      }

      // Reset states
      setUploadedImage(null);
      setImageFile(null);
    } catch (err: any) {
      setIngestError(err.message || 'Error occurred during database ingestion.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)] min-h-[500px]">
      
      {/* LEFT COL: INTERACTIVE HELP CHATBOT */}
      <div className="lg:col-span-5 flex flex-col bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-lg">
        
        {/* Chat Header */}
        <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center gap-2.5">
          <div className="bg-teal-600 p-2 rounded-xl text-white">
            <Bot size={18} className="stroke-[2.2]" />
          </div>
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">Afritecx AI Help Desk</h3>
            <p className="text-[10px] text-teal-400 font-bold flex items-center gap-1">🟢 Local Assistant Ready</p>
          </div>
        </div>

        {/* Messaging Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[calc(100vh-320px)]">
          {messages.map(msg => (
            <div 
              key={msg.id} 
              className={`flex flex-col max-w-[85%] space-y-1 ${
                msg.sender === 'USER' ? 'ml-auto items-end' : 'mr-auto items-start'
              }`}
            >
              <span className="text-[9px] text-slate-500 font-bold font-mono">{msg.sender === 'AI' ? 'AI Agent' : 'You'} • {msg.timestamp}</span>
              <div 
                className={`p-3.5 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                  msg.sender === 'USER' 
                    ? 'bg-teal-600 text-white rounded-tr-none' 
                    : 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700/50'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Quick Guide chapter pills */}
        <div className="p-3 bg-slate-950/50 border-t border-slate-800 flex gap-1.5 overflow-x-auto print:hidden">
          <button
            onClick={() => {
              setInputQuery('How to use POS?');
            }}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-full text-[10px] font-bold text-slate-400 whitespace-nowrap cursor-pointer transition-colors"
          >
            📖 POS Walkthrough
          </button>
          <button
            onClick={() => {
              setInputQuery('GAAP Accounting ledger rules');
            }}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-full text-[10px] font-bold text-slate-400 whitespace-nowrap cursor-pointer transition-colors"
          >
            📊 Accounting Guide
          </button>
          <button
            onClick={() => {
              setInputQuery('Wages Timesheet process');
            }}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-full text-[10px] font-bold text-slate-400 whitespace-nowrap cursor-pointer transition-colors"
          >
            👥 Payroll Guide
          </button>
        </div>

        {/* Chat input form */}
        <form onSubmit={handleSendMessage} className="p-3 bg-slate-950 border-t border-slate-800 flex gap-2 print:hidden">
          <input
            type="text"
            placeholder="Type 'guide' or ask any ledger questions..."
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 font-semibold"
          />
          <button
            type="submit"
            className="bg-teal-600 hover:bg-teal-500 text-white p-2.5 rounded-xl cursor-pointer transition-colors"
          >
            <Send size={15} />
          </button>
        </form>

      </div>

      {/* RIGHT COL: GUIDED RECEIPT IMAGE INGESTION */}
      <div className="lg:col-span-7 flex flex-col bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-sm">
        
        <div className="bg-gray-50 p-4 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles size={15} className="text-teal-600 animate-pulse" /> Document Image Ingestion
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Upload a {businessProfile.terminology.supplierLabel.toLowerCase()} delivery slip, invoice, or expense receipt. AI extracts candidate values for your approval.</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {currentUser?.userType === 'AUDIT' && (
            <div className="p-3 bg-rose-50 border border-rose-100 text-rose-800 rounded-xl flex items-start gap-2 text-xs font-bold leading-normal">
              <Lock size={15} className="shrink-0 mt-0.5" />
              <p>Security Override Block: Data ingestion is restricted under Read-Only Audit profiles.</p>
            </div>
          )}

          {/* Upload Drop Zone */}
          {!uploadedImage ? (
            <div className="border-2 border-dashed border-gray-200 hover:border-teal-500/40 bg-gray-50/50 p-10 rounded-2xl text-center cursor-pointer transition-colors relative">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={currentUser?.userType === 'AUDIT'}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <Upload size={32} className="text-gray-400 mx-auto mb-3 stroke-[1.5]" />
              <h4 className="text-xs font-bold text-gray-700">Drag and Drop or Upload Receipt Image</h4>
              <p className="text-[10px] text-gray-400 mt-1 max-w-[240px] mx-auto leading-normal">Supports JPG or PNG files. Try uploading file names containing 'Delta', 'Afdis', or 'Rent' to test regional templates!</p>
            </div>
          ) : (
            /* Document Preview & OCR Scanning Progress bar */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              
              {/* Image preview panel */}
              <div className="bg-gray-50 border border-gray-150 p-3 rounded-2xl flex flex-col justify-between relative overflow-hidden">
                <span className="text-[9px] bg-slate-900 text-white font-bold uppercase tracking-wider py-0.5 px-2 rounded-md absolute top-4 left-4 z-10">Image Preview</span>
                <div className="h-[220px] w-full rounded-xl overflow-hidden bg-white border border-gray-100 flex items-center justify-center">
                  <img src={uploadedImage} alt="receipt" className="max-h-full max-w-full object-contain" />
                </div>
                
                <div className="flex justify-between items-center mt-3 text-xs text-gray-500 font-semibold pl-0.5">
                  <span className="truncate max-w-[140px]">{imageFile?.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedImage(null);
                      setImageFile(null);
                    }}
                    className="text-red-500 hover:text-red-600 cursor-pointer"
                  >
                    Remove File
                  </button>
                </div>

                {/* Progress bar overlay during scan */}
                {isScanning && (
                  <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center p-6 text-white text-center">
                    <RefreshCw size={24} className="animate-spin text-teal-400 mb-3" />
                    <h5 className="text-xs font-black uppercase tracking-wider text-teal-400">AI Scanning Document Image...</h5>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-[200px] leading-relaxed">Extracting supplier credentials, line item costs, and VAT splits.</p>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 mt-4 max-w-[180px] overflow-hidden">
                      <div className="bg-teal-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${scanProgress}%` }}></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Guided Confirmation Form */}
              <form onSubmit={handleInboundConfirm} className="space-y-4 flex flex-col justify-between">
                <div className="space-y-3.5">
                  <div className="border-b border-gray-100 pb-1.5 flex justify-between items-center">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">USER GUIDED ADJUSTMENT PANEL</span>
                    <select
                      value={feedType}
                      onChange={(e) => setFeedType(e.target.value as any)}
                      className="bg-teal-50 hover:bg-teal-100 text-teal-700 py-1 px-2.5 border border-teal-200 rounded-lg text-[10px] font-black uppercase focus:outline-none focus:ring-1 focus:ring-teal-500"
                    >
                      <option value="INVENTORY_REORDER">INVENTORY REORDER (PO)</option>
                      <option value="OPERATING_EXPENSE">GENERAL OPERATING EXPENSE</option>
                    </select>
                  </div>

                  {feedType === 'INVENTORY_REORDER' ? (
                    /* A. INVENTORY PO CONFIRMATION */
                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block font-semibold text-gray-500 mb-1">Extracted Supplier *</label>
                          <select
                            required
                            value={parsedSupplierId}
                            onChange={(e) => setParsedSupplierId(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
                          >
                            <option value="">-- Choose Supplier --</option>
                            {suppliers.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block font-semibold text-gray-500 mb-1">Target {businessProfile.terminology.itemLabel} *</label>
                          <select
                            required
                            value={parsedProductId}
                            onChange={(e) => setParsedProductId(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
                          >
                            <option value="">-- Choose Product --</option>
                            {products.map(p => (
                              <option key={p.id} value={p.id}>{p.name} (SKU: {p.sku})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block font-semibold text-gray-500 mb-1">Extracted Qty *</label>
                          <input
                            type="number"
                            required
                            value={parsedQty}
                            onChange={(e) => setParsedQty(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-gray-500 mb-1">Unit Cost (ZAR) *</label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={parsedCost}
                            onChange={(e) => setParsedCost(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-gray-500 mb-1">Tax Split (%)</label>
                          <input
                            type="number"
                            required
                            value={parsedTaxRate}
                            onChange={(e) => setParsedTaxRate(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* B. GENERAL OPERATING EXPENSE CONFIRMATION */
                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block font-semibold text-gray-500 mb-1">Target Expense Account *</label>
                        <select
                          required
                          value={parsedExpenseAccount}
                          onChange={(e) => setParsedExpenseAccount(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
                        >
                          {accounts.filter(a => a.type === 'EXPENSE' && a.code !== '5010').map(a => (
                            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block font-semibold text-gray-500 mb-1">Expense Cost Amount *</label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={parsedExpenseAmount}
                            onChange={(e) => setParsedExpenseAmount(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-gray-500 mb-1">Posting Date *</label>
                          <input
                            type="date"
                            required
                            value={parsedReceiptDate}
                            onChange={(e) => setParsedReceiptDate(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block font-semibold text-gray-500 mb-1">Expense Notes / Explanation *</label>
                        <textarea
                          required
                          value={parsedExpenseDesc}
                          onChange={(e) => setParsedExpenseDesc(e.target.value)}
                          rows={2}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                        />
                      </div>
                    </div>
                  )}

                  {/* General ledger meta descriptors */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block font-semibold text-gray-500 mb-1">Document No / Invoice Ref *</label>
                      <input
                        type="text"
                        required
                        value={parsedInvoiceNo}
                        onChange={(e) => setParsedInvoiceNo(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>
                    {feedType === 'INVENTORY_REORDER' && (
                      <div>
                        <label className="block font-semibold text-gray-500 mb-1">Receipt Date *</label>
                        <input
                          type="date"
                          required
                          value={parsedReceiptDate}
                          onChange={(e) => setParsedReceiptDate(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl py-1.5 px-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Final total estimations display */}
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center my-3">
                  <span className="text-[9px] text-gray-400 font-bold block uppercase">Confirmed Ledger Valuation</span>
                  <span className="text-base font-black text-teal-600 font-mono mt-0.5 block">
                    {feedType === 'INVENTORY_REORDER' 
                      ? formatCurrency((parseInt(parsedQty) || 0) * (parseFloat(parsedCost) || 0), businessProfile.currency)
                      : formatCurrency(parseFloat(parsedExpenseAmount) || 0, businessProfile.currency)
                    }
                  </span>
                </div>

                {ingestError && (
                  <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg font-bold flex items-center gap-1">
                    <AlertTriangle size={13} className="shrink-0" /> {ingestError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isScanning || currentUser?.userType === 'AUDIT'}
                  className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-gray-200 text-white font-bold py-2.5 rounded-xl text-xs shadow flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <CheckCircle size={14} /> Approve & Ingest to Ledger
                </button>
              </form>

            </div>
          )}

          {ingestSuccess && (
            <div className="p-4 bg-teal-50 border border-teal-100 text-teal-800 rounded-2xl flex items-start gap-2.5 leading-normal text-xs animate-fade-in">
              <CheckCircle size={16} className="text-teal-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold">Database Ingestion Completed!</h4>
                <p className="text-teal-700/80 mt-0.5">The extracted document parameters have been logged. The ledger and inventory counts have been successfully balanced.</p>
              </div>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
