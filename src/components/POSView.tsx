/**
 * ============================================================================
 * MODULE: components/POSView.tsx — Point of Sale (Checkout) Terminal
 * ----------------------------------------------------------------------------
 * The cashier-facing selling screen. Responsibilities:
 *   - PRODUCT CATALOG: searchable/filterable grid; click, type-SKU, or scan
 *     (device camera via html5-qrcode) to add items to the cart.
 *   - CART & PRICING: quantity controls, per-line discounts, tax, and totals.
 *   - STOCK MODELS: Model A sells from the secondary location only; Model B
 *     falls back to primary stock — with availability checks before adding.
 *   - CUSTOMERS: assign/register a customer to support credit ("on account")
 *     sales within their credit limit.
 *   - CHECKOUT: handles cash/card/customer-credit tenders, change, then emits
 *     the sale so App.tsx records revenue, COGS, and inventory changes.
 *   - RECEIPT: prints a formatted receipt after each completed transaction.
 * Read-only AUDIT users are blocked from modifying the cart or checking out.
 * ============================================================================
 */
import React, { useState, useRef, useEffect } from 'react';
import { Product, CartItem, Customer, Sale, BusinessProfile, User } from '../types';
import { formatCurrency } from '../utils/currency';
import { Search, ShoppingCart, UserPlus, CreditCard, DollarSign, Percent, Plus, Minus, Trash2, Check, Printer, Barcode, Camera } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface POSViewProps {
  products: Product[];
  customers: Customer[];
  businessProfile: BusinessProfile;
  onAddSale: (sale: Sale) => void;
  onAddCustomer: (customer: Customer) => void;
  onUpdateProductStock: (
    items: { productId: string; quantity: number }[],
    mode: 'SECONDARY_ONLY' | 'AUTO_FALLBACK'
  ) => void;
  onAdjustCustomerCredit: (customerId: string, amountToDeduct: number) => void; // negative decreases store credit (increases debt)
  currentUser: User | null;
  /** Seeds a small starter catalogue so a brand-new database can trade immediately. */
  onSeedStarterCatalogue: () => void;
}

export default function POSView({
  products,
  customers,
  businessProfile,
  onAddSale,
  onAddCustomer,
  onUpdateProductStock,
  onAdjustCustomerCredit,
  currentUser,
  onSeedStarterCatalogue
}: POSViewProps) {
  // State variables
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  
  /**
   * Holds the active input typed by the user inside the search box.
   */
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  /**
   * Stores the committed keyword to filter our products grid when the search button is clicked.
   */
  const [activeSearchTerm, setActiveSearchTerm] = useState<string>('');

  /**
   * Temporary input for simulating manual hardware barcode scans.
   */
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  
  /**
   * Shopping basket rows in the checkout flow.
   */
  const [cart, setCart] = useState<CartItem[]>([]);
  
  /**
   * Target customer profile linked to the invoice.
   */
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

  /**
   * Model A deducts only from the configured available/secondary location.
   * Model B automatically consumes primary-location stock when available stock is short.
   */
  const [stockSaleMode, setStockSaleMode] = useState<'SECONDARY_ONLY' | 'AUTO_FALLBACK'>('AUTO_FALLBACK');

  /**
   * Toggles the live phone camera barcode scanning overlay modal.
   */
  const [isCameraScanning, setIsCameraScanning] = useState<boolean>(false);
  
  // Checkout Modal State
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'CUSTOMER_CREDIT'>('CASH');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [checkoutError, setCheckoutError] = useState<string>('');
  
  // Receipt State
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  
  // Add Customer Drawer State
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustCreditLimit, setNewCustCreditLimit] = useState('300');

  // Scanner autofocus
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  /**
   * Phone Camera Barcode Scanner Lifecycle Hook.
   * Utilizes the low-level Html5Qrcode API directly to bypass setup buttons.
   * Bypasses controls and auto-engages the camera stream for an instant auto-scanning experience.
   */
  useEffect(() => {
    if (!isCameraScanning) return;

    let html5Qrcode: Html5Qrcode | null = null;

    const startInstantScanner = async () => {
      try {
        // Instantiate the core scanner on the #reader element, passing formatsToSupport in constructor options
        html5Qrcode = new Html5Qrcode("reader", {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.QR_CODE
          ]
        });

        // Force-request environment back camera stream and start decoding immediately
        await html5Qrcode.start(
          { facingMode: "environment" },
          {
            fps: 20, // High frame-rate for rapid scans
            qrbox: { width: 220, height: 220 } // Focused scanning region
          },
          (decodedText: string) => {
            // Callback: Found a match
            const product = products.find(p => 
              p.sku.toLowerCase() === decodedText.trim().toLowerCase() ||
              p.barcode === decodedText.trim()
            );

            if (product) {
              addToCart(product);
              alert(`Instant Auto-Scan Match: Added "${product.name}" to cart!`);
            } else {
              alert(`Instant Scan: Read code "${decodedText}" but no matching SKU was found inside the ${businessProfile.name} database.`);
            }

            // Close scanning modal on successful read
            setIsCameraScanning(false);
          },
          (errorMessage: string) => {
            // Frame read debug logs (silent during live loop)
            console.debug("Scan frame error:", errorMessage);
          }
        );
      } catch (err) {
        console.warn("Direct camera initialization failed. Prompting user fallback...", err);
        alert("Camera Warning: Could not engage direct camera feed. Using simulated scanner and keyboard fallback manual inputs so you can enter codes.");
        setIsCameraScanning(false);
      }
    };

    startInstantScanner();

    // Cleanup hook: Stop camera and release feed resources
    return () => {
      if (html5Qrcode && html5Qrcode.isScanning) {
        html5Qrcode.stop().catch(e => console.error("Error stopping camera scan stream:", e));
      }
    };
  }, [isCameraScanning, products]);

  // Categories
  const categories = ['All', ...Array.from(new Set(products.map(p => p.category)))];

  // Filtered products
  /**
   * Evaluates category filters and searches the catalog.
   * Leverages 'activeSearchTerm' (committed via search button) or 'searchQuery' (live typing fallback) to retrieve match states.
   */
  const filteredProducts = products.filter(p => {
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    const keyword = activeSearchTerm || searchQuery;
    const matchesSearch = p.name.toLowerCase().includes(keyword.toLowerCase()) || 
                          p.sku.toLowerCase().includes(keyword.toLowerCase()) ||
                          (p.barcode && p.barcode.includes(keyword));
    return matchesCategory && matchesSearch;
  });

  /** Returns the quantity that can be sold under the selected POS stock model. */
  const getSellableStock = (product: Product) => {
    const secondary = Number.isFinite(product.fridgeStock) ? product.fridgeStock : product.stock;
    const total = Number.isFinite(product.stock)
      ? product.stock
      : (product.storeroomStock || 0) + secondary;
    return stockSaleMode === 'AUTO_FALLBACK' ? total : secondary;
  };

  // Handle SKU Barcode simulation scan
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    
    // Find product matching barcode or SKU (case insensitive)
    const product = products.find(p => 
      p.sku.toLowerCase() === barcodeInput.trim().toLowerCase() || 
      p.barcode === barcodeInput.trim()
    );

    if (product) {
      addToCart(product);
      setBarcodeInput('');
    } else {
      alert(`${businessProfile.terminology.itemLabel} with SKU/Barcode "${barcodeInput}" was not found.`);
    }
  };

  // Add item to cart using the active stock source model.
  const addToCart = (product: Product) => {
    if (currentUser?.userType === 'AUDIT') {
      alert('Security Warning: This is a Read-Only Audit session. Cart modifications and checkout transactions are locked.');
      return;
    }

    // Check available stock, but let the cashier explicitly override so a sale
    // is never silently blocked (stock is clamped at zero when deducting).
    const existing = cart.find(item => item.product.id === product.id);
    const requestedQty = existing ? existing.quantity + 1 : 1;
    const sellableStock = getSellableStock(product);
    if (requestedQty > sellableStock) {
      const proceed = window.confirm(
        `Only ${sellableStock} unit(s) of "${product.name}" are available under Model ${stockSaleMode === 'AUTO_FALLBACK' ? 'B' : 'A'}.\n\nAdd anyway? (Stock will not go below zero.)`
      );
      if (!proceed) return;
    }

    setCart(prevCart => {
      const existingIndex = prevCart.findIndex(item => item.product.id === product.id);
      if (existingIndex > -1) {
        const updated = [...prevCart];
        updated[existingIndex] = {
          ...updated[existingIndex],
          product,
          quantity: updated[existingIndex].quantity + 1
        };
        return updated;
      }
      return [...prevCart, { product, quantity: 1, discount: 0 }];
    });
  };

  // Update item quantity inside checkout basket
  const updateQuantity = (productId: string, delta: number) => {
    // 1. Locate product to check stock thresholds
    const target = products.find(p => p.id === productId);
    if (!target) return;

    setCart(prevCart => {
      const item = prevCart.find(i => i.product.id === productId);
      if (!item) return prevCart;

      const newQty = item.quantity + delta;
      
      // If incrementing, verify available stock under the active model.
      const sellableStock = getSellableStock(target);
      if (delta > 0 && newQty > sellableStock) {
        alert(`Stock Alert: Only ${sellableStock} units of "${target.name}" are available under Model ${stockSaleMode === 'AUTO_FALLBACK' ? 'B' : 'A'}.`);
        return prevCart;
      }

      return prevCart.map(i => {
        if (i.product.id === productId) {
          return newQty > 0 ? { ...i, quantity: newQty } : null;
        }
        return i;
      }).filter(Boolean) as CartItem[];
    });
  };

  // Update discount percentage on cart item
  const updateItemDiscount = (productId: string, discountPct: number) => {
    const clampedDiscount = Math.max(0, Math.min(100, discountPct));
    setCart(prevCart => {
      return prevCart.map(item => {
        if (item.product.id === productId) {
          return { ...item, discount: clampedDiscount };
        }
        return item;
      });
    });
  };

  // Remove item from cart
  const removeFromCart = (productId: string) => {
    setCart(prevCart => prevCart.filter(item => item.product.id !== productId));
  };

  // Calculations
  const cartSubtotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  
  const cartDiscountAmount = cart.reduce((sum, item) => {
    const itemTotal = item.product.price * item.quantity;
    return sum + (itemTotal * (item.discount / 100));
  }, 0);

  const discountedSubtotal = cartSubtotal - cartDiscountAmount;
  // Guard against missing/invalid tax settings so totals never become NaN.
  const safeTaxRate = Number.isFinite(Number(businessProfile.taxRate)) ? Number(businessProfile.taxRate) : 0;
  const cartTaxAmount = discountedSubtotal * (safeTaxRate / 100);
  const cartTotal = parseFloat((discountedSubtotal + cartTaxAmount).toFixed(2));

  // Selected customer info
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // Trigger checkout
  const handleOpenCheckout = () => {
    if (cart.length === 0) {
      setCheckoutError('The cart is empty. Add at least one product before taking payment.');
      return;
    }
    if (!Number.isFinite(cartTotal) || cartTotal < 0) {
      setCheckoutError('The cart total is invalid. Remove and re-add the items, then try again.');
      return;
    }

    // Revalidate every line against current inventory before opening payment.
    const invalidItem = cart.find(item => item.quantity > getSellableStock(
      products.find(product => product.id === item.product.id) ?? item.product
    ));
    if (invalidItem) {
      // Surface the problem to the cashier instead of failing silently.
      setCheckoutError(`Insufficient stock for ${invalidItem.product.name}. Reduce the quantity and try again.`);
      alert(`Cannot take payment: only ${getSellableStock(invalidItem.product)} unit(s) of "${invalidItem.product.name}" are available.`);
      return;
    }
    setCheckoutError('');
    setCashReceived(Math.ceil(cartTotal).toString());
    setIsCheckoutOpen(true);
  };

  // Quick select cash amounts
  const quickCashSelect = (amount: number) => {
    setCashReceived(amount.toString());
  };

  // Create new customer
  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    const newCust: Customer = {
      id: `c-cust-${Date.now()}`,
      name: newCustName,
      phone: newCustPhone,
      email: newCustEmail,
      storeCredit: 0,
      creditLimit: parseFloat(newCustCreditLimit) || 300
    };

    onAddCustomer(newCust);
    setSelectedCustomerId(newCust.id);
    setIsAddCustomerOpen(false);

    // Reset inputs
    setNewCustName('');
    setNewCustPhone('');
    setNewCustEmail('');
    setNewCustCreditLimit('300');
  };

  // Process payment and finalize transaction
  const handleProcessPayment = () => {
    setCheckoutError('');

    if (cart.length === 0) {
      setCheckoutError('The cart is empty. Add a product before completing payment.');
      return;
    }
    if (!Number.isFinite(cartTotal) || cartTotal <= 0) {
      setCheckoutError('The sale total must be greater than zero.');
      return;
    }

    // Check payment method constraints
    if (paymentMethod === 'CUSTOMER_CREDIT') {
      if (!selectedCustomerId) {
        setCheckoutError('Please select a customer to charge Store Credit.');
        return;
      }
      
      const currentCredit = selectedCustomer?.storeCredit || 0; // Negative means debt, positive means advance credit
      const limit = selectedCustomer?.creditLimit || 0;
      const outstandingBalanceAfterSale = currentCredit - cartTotal;

      // Store credit allows going negative up to their creditLimit (as a debt / Accounts Receivable)
      if (outstandingBalanceAfterSale < -limit) {
        setCheckoutError(`Transaction exceeds Credit Limit! Outstanding debt cannot exceed $${limit.toFixed(2)}. (Currently: $${Math.abs(currentCredit).toFixed(2)})`);
        return;
      }
    }

    let cashRecVal = 0;
    let changeVal = 0;

    if (paymentMethod === 'CASH') {
      cashRecVal = parseFloat(cashReceived) || 0;
      if (cashRecVal < cartTotal) {
        setCheckoutError(`Cash received must be at least $${cartTotal.toFixed(2)}`);
        return;
      }
      changeVal = cashRecVal - cartTotal;
    }

    // Prepare Sale object
    const saleId = `SALE-${Date.now()}`;
    const invoiceNo = `INV-${Math.floor(100000 + Math.random() * 900000)}`;

    const saleItems = cart.map(item => {
      const lineSub = item.product.price * item.quantity;
      const lineDisc = lineSub * (item.discount / 100);
      return {
        productId: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        price: item.product.price,
        costPrice: item.product.costPrice,
        discount: item.discount,
        total: lineSub - lineDisc
      };
    });

    const newSale: Sale = {
      id: saleId,
      invoiceNo,
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      customerId: selectedCustomerId || undefined,
      items: saleItems,
      subtotal: parseFloat(cartSubtotal.toFixed(2)),
      discountAmount: parseFloat(cartDiscountAmount.toFixed(2)),
      taxAmount: parseFloat(cartTaxAmount.toFixed(2)),
      total: parseFloat(cartTotal.toFixed(2)),
      paymentMethod,
      cashReceived: paymentMethod === 'CASH' ? parseFloat(cashRecVal.toFixed(2)) : undefined,
      changeGiven: paymentMethod === 'CASH' ? parseFloat(changeVal.toFixed(2)) : undefined
    };

    // Commit changes
    // 1. Add Sale to state (triggers accounting entry creation!)
    onAddSale(newSale);

    // 2. Commit all inventory deductions in one atomic batch.
    onUpdateProductStock(
      cart.map(item => ({ productId: item.product.id, quantity: item.quantity })),
      stockSaleMode
    );

    // 3. Adjust customer credit account if using store credit
    if (paymentMethod === 'CUSTOMER_CREDIT' && selectedCustomerId) {
      onAdjustCustomerCredit(selectedCustomerId, -cartTotal); // charges debt
    }

    // 4. Save completed sale details for Receipt view
    setCompletedSale(newSale);

    // 5. Close the checkout drawer, clear the basket, and reset tender state
    // so the next transaction starts from a clean sheet.
    setIsCheckoutOpen(false);
    setCart([]);
    setCashReceived('');
    setCheckoutError('');
    setPaymentMethod('CASH');
  };

  // Reset receipt screen
  const handleNewTransaction = () => {
    setCompletedSale(null);
    setSelectedCustomerId('');
  };

  return (
    <div className="flex min-h-0 flex-col gap-6 lg:h-[calc(100vh-140px)] lg:min-h-[500px] lg:flex-row">
      
      {completedSale ? (
        /* ================= RECEIPT VIEW ================= */
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 rounded-2xl p-6 border border-gray-100">
          <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md border border-gray-100 text-gray-800 font-mono text-sm leading-relaxed">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold uppercase tracking-wider text-teal-600">{businessProfile.name}</h2>
              <p className="text-xs text-gray-500 mt-1">{businessProfile.address}</p>
              <p className="text-xs text-gray-500">Tel: {businessProfile.phone} | Email: {businessProfile.email}</p>
              <div className="border-b border-dashed border-gray-300 my-4"></div>
              <h3 className="text-base font-semibold uppercase tracking-wide">Sales Receipt</h3>
              <p className="text-xs text-gray-500 mt-0.5">Invoice: {completedSale.invoiceNo}</p>
              <p className="text-xs text-gray-500">Date: {completedSale.date}</p>
            </div>

            {/* Customer Details */}
            {completedSale.customerId && (
              <div className="mb-4 text-xs text-gray-600 border-b border-dashed border-gray-200 pb-2">
                <span className="font-bold">{businessProfile.terminology.customerLabel}:</span> {customers.find(c => c.id === completedSale.customerId)?.name}<br />
                <span className="font-bold">Account:</span> POS Store Credit Ledger
              </div>
            )}

            {/* Items Table */}
            <div className="space-y-3 mb-4">
              <div className="flex justify-between text-xs font-bold border-b border-gray-200 pb-1">
                <span className="w-1/2">Item Description</span>
                <span className="w-1/6 text-right">Qty</span>
                <span className="w-1/3 text-right">Total</span>
              </div>
              {completedSale.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start text-xs text-gray-700">
                  <div className="w-1/2">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-[10px] text-gray-400">@ {formatCurrency(item.price, businessProfile.currency)} {item.discount > 0 && `(Disc ${item.discount}%)`}</p>
                  </div>
                  <span className="w-1/6 text-right text-gray-600">{item.quantity}</span>
                  <span className="w-1/3 text-right font-medium">{formatCurrency(item.total, businessProfile.currency)}</span>
                </div>
              ))}
            </div>

            <div className="border-b border-dashed border-gray-300 my-4"></div>

            {/* Price Calculations */}
            <div className="space-y-1.5 text-xs text-gray-700 mb-4">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatCurrency(completedSale.subtotal, businessProfile.currency)}</span>
              </div>
              {completedSale.discountAmount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Discount:</span>
                  <span>-{formatCurrency(completedSale.discountAmount, businessProfile.currency)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Tax ({businessProfile.taxRate}%):</span>
                <span>{formatCurrency(completedSale.taxAmount, businessProfile.currency)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-gray-900 pt-1 border-t border-gray-100">
                <span>GRAND TOTAL:</span>
                <span>{formatCurrency(completedSale.total, businessProfile.currency)}</span>
              </div>
            </div>

            <div className="border-b border-dashed border-gray-300 my-4"></div>

            {/* Payment Summary */}
            <div className="space-y-1 text-xs text-gray-700 mb-6">
              <div className="flex justify-between">
                <span>Payment Method:</span>
                <span className="font-semibold uppercase">{completedSale.paymentMethod.replace('_', ' ')}</span>
              </div>
              {completedSale.paymentMethod === 'CASH' && (
                <>
                  <div className="flex justify-between">
                    <span>Cash Tendered:</span>
                    <span>{formatCurrency(completedSale.cashReceived ?? 0, businessProfile.currency)}</span>
                  </div>
                  <div className="flex justify-between text-teal-700 font-semibold">
                    <span>Change Returned:</span>
                    <span>{formatCurrency(completedSale.changeGiven ?? 0, businessProfile.currency)}</span>
                  </div>
                </>
              )}
              {completedSale.paymentMethod === 'CUSTOMER_CREDIT' && (
                <div className="text-[10px] text-gray-500 italic mt-1 text-center">
                  Debited to accounts receivable ledger.
                </div>
              )}
            </div>

            {/* Footer with barcode */}
            <div className="text-center mt-6">
              <div className="flex justify-center mb-2">
                <Barcode className="h-8 w-44 text-gray-400 stroke-[1.2]" />
              </div>
              <p className="text-[10px] uppercase tracking-widest text-gray-400">*{completedSale.id}*</p>
              <p className="text-xs font-semibold text-teal-600 mt-4">Thank you for your business!</p>
              <p className="text-[9px] text-gray-400 mt-0.5">Please retain this receipt as proof of purchase.</p>
            </div>
          </div>

          <div className="mt-6 flex gap-4 w-full max-w-md">
            <button
              onClick={() => window.print()}
              className="flex-1 flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-3 px-4 rounded-xl transition duration-150"
            >
              <Printer size={18} /> Print Receipt
            </button>
            <button
              onClick={handleNewTransaction}
              className="flex-1 flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-medium py-3 px-4 rounded-xl shadow transition duration-150"
            >
              <Check size={18} /> New Sale
            </button>
          </div>
        </div>
      ) : (
        /* ================= MAIN POS VIEW ================= */
        <>
          {/* Left: Product Catalog Grid */}
          <div className="flex min-h-[560px] flex-1 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-sm lg:min-h-0">
            
            {/* Search, Category Filters and Barcode Scan */}
            <div className="space-y-3 mb-4">
              <div className="flex flex-col xl:flex-row gap-3">
                {/* Text Search & Committed Button */}
                <div className="flex-1 flex gap-2">
                  <div className="flex-1 relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 pointer-events-none">
                      <Search size={18} />
                    </span>
                    <input
                      type="text"
                      placeholder="Search by name, SKU or barcode..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setActiveSearchTerm(searchQuery);
                        }
                      }}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 pl-10 pr-4 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSearchTerm(searchQuery)}
                    className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    Search
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setActiveSearchTerm('');
                    }}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold py-2.5 px-3 rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  {/* Camera scan button */}
                  <button
                    type="button"
                    onClick={() => setIsCameraScanning(true)}
                    className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Camera size={14} /> Scan via Camera
                  </button>

                  {/* SKU Barcode Simulator Input */}
                  <form onSubmit={handleBarcodeSubmit} className="sm:w-60 relative flex">
                    <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 pointer-events-none">
                      <Barcode size={18} />
                    </span>
                    <input
                      ref={barcodeInputRef}
                      type="text"
                      placeholder="Simulate Hardware Scan (SKU)..."
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 pl-10 pr-4 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-mono"
                    />
                    <button type="submit" className="hidden">Scan</button>
                  </form>
                </div>
              </div>

              {/* POS stock source models retain both legacy operating choices. */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Cart Stock Source</p>
                  <p className="text-[10px] text-gray-400">Choose how checkout draws inventory.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStockSaleMode('SECONDARY_ONLY')}
                    className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition-colors ${
                      stockSaleMode === 'SECONDARY_ONLY'
                        ? 'bg-teal-600 text-white'
                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    Model A: {businessProfile.terminology.secondaryStockLabel} Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockSaleMode('AUTO_FALLBACK')}
                    className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition-colors ${
                      stockSaleMode === 'AUTO_FALLBACK'
                        ? 'bg-teal-600 text-white'
                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    Model B: Auto Fallback
                  </button>
                </div>
              </div>

              {/* Category Filter Pills */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-200">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedCategory === category
                        ? 'bg-teal-600 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            {/* Product Grid Area */}
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {products.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8 text-center">
                  <ShoppingCart size={44} className="mb-3 stroke-[1.5] text-gray-300" />
                  <p className="text-sm font-bold text-gray-700">Your catalogue is empty</p>
                  <p className="mt-1 max-w-sm text-xs text-gray-400">
                    Add your products in <strong>Stocks &amp; Supply</strong>, or load a small starter catalogue to begin selling right away.
                  </p>
                  <button
                    type="button"
                    onClick={onSeedStarterCatalogue}
                    disabled={currentUser?.userType === 'AUDIT'}
                    className="mt-4 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    Load Starter Catalogue
                  </button>
                  <p className="mt-2 text-[10px] text-gray-400">You can edit or delete these samples later.</p>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
                  <ShoppingCart size={40} className="mb-2 stroke-[1.5]" />
                  <p className="text-sm">No matching items found</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filteredProducts.map((prod) => {
                    const isLowStock = prod.stock <= prod.minStock;
                    return (
                      <button
                        key={prod.id}
                        onClick={() => addToCart(prod)}
                        className="group flex flex-col items-start p-3 bg-gray-50 hover:bg-teal-50/40 hover:ring-2 hover:ring-teal-500/20 rounded-xl border border-gray-100 text-left transition-all duration-150 relative overflow-hidden"
                      >
                        {/* Stock Indicator Badge */}
                        <span className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                          prod.fridgeStock <= 0 
                            ? 'bg-red-100 text-red-600' 
                            : isLowStock 
                              ? 'bg-amber-100 text-amber-600' 
                              : 'bg-gray-200 text-gray-600'
                        }`}>
                          {businessProfile.terminology.secondaryStockLabel}: {prod.fridgeStock}
                        </span>

                        {/* Product Icon */}
                        <div className="text-2xl mt-2 mb-3 bg-white w-10 h-10 rounded-lg flex items-center justify-center shadow-sm">
                          {prod.image || '📦'}
                        </div>

                        {/* Description */}
                        <h4 className="text-xs font-bold text-gray-800 line-clamp-2 w-full group-hover:text-teal-700 transition-colors">
                          {prod.name}
                        </h4>
                        
                        <p className="text-[10px] text-gray-400 mt-0.5 font-mono">
                          {prod.sku}
                        </p>
                        
                        <div className="flex items-center justify-between w-full mt-2 pt-1 border-t border-gray-100">
                          <span className="text-sm font-bold text-teal-600">
                            {formatCurrency(prod.price, businessProfile.currency)}
                          </span>
                          <span className="text-[10px] bg-white group-hover:bg-teal-600 group-hover:text-white px-2 py-0.5 border border-gray-100 group-hover:border-teal-600 rounded-md font-semibold text-gray-500 transition-colors">
                            + Add
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Right: Selected Cart / Bill Builder */}
          <div className="flex min-h-[520px] w-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm lg:min-h-0 lg:w-[420px] lg:shrink-0">
            
            {/* Customer assignment header */}
            <div className="p-4 bg-gray-50 border-b border-gray-100 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">Assign {businessProfile.terminology.customerLabel}</span>
                <button
                  onClick={() => setIsAddCustomerOpen(true)}
                  className="text-xs font-semibold text-teal-600 hover:text-teal-700 flex items-center gap-1"
                >
                  <UserPlus size={14} /> New {businessProfile.terminology.customerLabel}
                </button>
              </div>

              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              >
                <option value="">-- Unassigned / Walk-in {businessProfile.terminology.customerLabel} --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.storeCredit < 0 ? `(Owes ${formatCurrency(Math.abs(c.storeCredit), businessProfile.currency)})` : c.storeCredit > 0 ? `(Credit: ${formatCurrency(c.storeCredit, businessProfile.currency)})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Cart Items List */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
                  <ShoppingCart size={32} className="mb-2 stroke-[1.5]" />
                  <p className="text-sm">Your POS cart is empty</p>
                  <p className="text-xs text-gray-400 text-center mt-1 max-w-[200px]">Click products on the left or scan items to begin checkout</p>
                </div>
              ) : (
                cart.map((item) => {
                  const itemSub = item.product.price * item.quantity;
                  const itemDisc = itemSub * (item.discount / 100);
                  const itemFinal = itemSub - itemDisc;

                  return (
                    <div key={item.product.id} className="flex flex-col p-3 bg-gray-50 border border-gray-100 rounded-xl gap-2.5 relative">
                      {/* Close button */}
                      <button 
                        onClick={() => removeFromCart(item.product.id)}
                        className="absolute top-2.5 right-2.5 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>

                      {/* Info and price */}
                      <div className="pr-6">
                        <h5 className="text-xs font-bold text-gray-800 line-clamp-1">{item.product.name}</h5>
                        <p className="text-[10px] text-gray-400 font-mono mt-0.5">{item.product.sku} | {formatCurrency(item.product.price, businessProfile.currency)}</p>
                      </div>

                      {/* Controls and manual discount */}
                      <div className="flex items-center justify-between mt-1">
                        <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                          <button
                            onClick={() => updateQuantity(item.product.id, -1)}
                            className="px-2 py-1 hover:bg-gray-50 text-gray-500 transition-colors"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="px-3 text-xs font-bold text-gray-800">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className="px-2 py-1 hover:bg-gray-50 text-gray-500 transition-colors"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        {/* Discount Field */}
                        <div className="flex items-center gap-1.5">
                          <Percent size={12} className="text-gray-400" />
                          <input
                            type="number"
                            placeholder="Disc %"
                            min="0"
                            max="100"
                            value={item.discount || ''}
                            onChange={(e) => updateItemDiscount(item.product.id, parseInt(e.target.value) || 0)}
                            className="w-14 bg-white border border-gray-200 text-center rounded-lg py-1 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </div>

                        <div className="text-right">
                          <span className="text-xs font-bold text-gray-800">
                            {formatCurrency(itemFinal, businessProfile.currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Calculations Breakdown */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 space-y-2">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Subtotal Items</span>
                <span>{formatCurrency(cartSubtotal, businessProfile.currency)}</span>
              </div>
              
              {cartDiscountAmount > 0 && (
                <div className="flex justify-between text-xs text-red-500 font-semibold">
                  <span>Sales Discount</span>
                  <span>-{formatCurrency(cartDiscountAmount, businessProfile.currency)}</span>
                </div>
              )}
              
              <div className="flex justify-between text-xs text-gray-500">
                <span>Tax Rate ({safeTaxRate}%)</span>
                <span>{formatCurrency(cartTaxAmount, businessProfile.currency)}</span>
              </div>

              <div className="border-t border-gray-200 my-1"></div>

              <div className="flex justify-between items-center pt-1">
                <span className="text-sm font-bold text-gray-800">Total Due</span>
                <span className="text-lg font-black text-teal-600">
                  {formatCurrency(cartTotal, businessProfile.currency)}
                </span>
              </div>
            </div>

            {/* Checkout Action Button */}
            <div className="p-4 bg-white border-t border-gray-100 space-y-2">
              <button
                onClick={handleOpenCheckout}
                disabled={cart.length === 0 || currentUser?.userType === 'AUDIT'}
                className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-xl shadow-md shadow-teal-600/10 active:scale-[0.98] transition-all"
              >
                <CreditCard size={18} /> {currentUser?.userType === 'AUDIT' ? 'Checkout Disabled (Audit)' : 'Proceed to Payment'}
              </button>
              {currentUser?.userType === 'AUDIT' && (
                <p className="text-[10px] text-red-500 font-bold text-center">⚠ Read-Only Audit Profile: Transactions blocked.</p>
              )}
            </div>

          </div>
        </>
      )}

      {/* ================= CHECKOUT DIALOG MODAL ================= */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
            
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-teal-50/50">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <CreditCard size={18} className="text-teal-600" /> Complete Transaction
              </h3>
              <button 
                onClick={() => setIsCheckoutOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 flex-1 overflow-y-auto">
              {/* Receipt Amount Display */}
              <div className="text-center bg-gray-50 border border-gray-100 rounded-xl p-4">
                <span className="text-xs text-gray-500 uppercase font-semibold">Total Amount Owed</span>
                <h4 className="text-3xl font-black text-teal-600 mt-1">
                  {formatCurrency(cartTotal, businessProfile.currency)}
                </h4>
              </div>

              {/* Payment Method Selector */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Select Payment Method</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('CASH')}
                    className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl border-2 transition-all font-semibold ${
                      paymentMethod === 'CASH'
                        ? 'border-teal-600 bg-teal-50/30 text-teal-700'
                        : 'border-gray-100 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <DollarSign size={20} className="mb-1" />
                    <span className="text-xs">Physical Cash</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('CARD')}
                    className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl border-2 transition-all font-semibold ${
                      paymentMethod === 'CARD'
                        ? 'border-teal-600 bg-teal-50/30 text-teal-700'
                        : 'border-gray-100 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <CreditCard size={20} className="mb-1" />
                    <span className="text-xs">Debit/Credit Card</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('CUSTOMER_CREDIT')}
                    className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl border-2 transition-all font-semibold ${
                      paymentMethod === 'CUSTOMER_CREDIT'
                        ? 'border-teal-600 bg-teal-50/30 text-teal-700'
                        : 'border-gray-100 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <UserPlus size={20} className="mb-1" />
                    <span className="text-xs">Store Credit</span>
                  </button>
                </div>
              </div>

              {/* Customer Specific Info & Validation */}
              {paymentMethod === 'CUSTOMER_CREDIT' && (
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  {selectedCustomerId ? (
                    <div className="space-y-1 text-xs text-amber-800">
                      <p className="font-bold">Charging Store Credit for: {selectedCustomer?.name}</p>
                      <p>Current Balance: <span className="font-semibold">{formatCurrency(selectedCustomer?.storeCredit || 0, businessProfile.currency)}</span></p>
                      <p>Allowed Debt Limit: <span className="font-semibold">{formatCurrency(selectedCustomer?.creditLimit || 0, businessProfile.currency)}</span></p>
                      <p className="pt-1.5 border-t border-amber-200/50 mt-1 font-semibold">
                        New Balance will be: {formatCurrency((selectedCustomer?.storeCredit || 0) - cartTotal, businessProfile.currency)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-red-600 font-bold">
                      No {businessProfile.terminology.customerLabel.toLowerCase()} assigned. Select one before using account credit.
                    </p>
                  )}
                </div>
              )}

              {/* Cash Calculator panel */}
              {paymentMethod === 'CASH' && (
                <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Cash Received</label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold">{businessProfile.currency === 'ZAR' ? 'R' : businessProfile.currency === 'USD' ? 'US$' : businessProfile.currency === 'BWP' ? 'P' : '€'}</span>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={cashReceived}
                          onChange={(e) => setCashReceived(e.target.value)}
                          className="w-full bg-white border border-gray-200 rounded-xl py-2 pl-8 pr-3 text-base text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Change Due</label>
                      <div className="bg-white border border-gray-200 rounded-xl py-2 px-3 text-base font-black text-teal-700 font-mono">
                        {formatCurrency(Math.max(0, (parseFloat(cashReceived) || 0) - cartTotal), businessProfile.currency)}
                      </div>
                    </div>
                  </div>

                  {/* Quick Select Buttons */}
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Quick Tender</label>
                    <div className="flex gap-2">
                      {[Math.ceil(cartTotal), 10, 20, 50, 100].map((amt, i) => {
                        // skip duplicate values
                        if (amt < cartTotal && amt !== Math.ceil(cartTotal)) return null;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => quickCashSelect(amt)}
                            className="flex-1 bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-semibold py-1.5 px-1 rounded-lg text-xs"
                          >
                            {formatCurrency(amt, businessProfile.currency)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {checkoutError && (
                <p className="text-xs text-red-600 font-bold bg-red-50 border border-red-100 p-3 rounded-lg">
                  {checkoutError}
                </p>
              )}
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setIsCheckoutOpen(false)}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 px-4 rounded-xl transition duration-150"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProcessPayment}
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl shadow transition duration-150"
              >
                Complete Payment
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ================= REGISTER NEW CUSTOMER DIALOG DRAWER ================= */}
      {isAddCustomerOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleCreateCustomer} className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-100 bg-teal-50/50">
              <h3 className="text-base font-bold text-gray-800">Add New {businessProfile.terminology.customerLabel}</h3>
              <p className="text-xs text-gray-400">Register account details in the database</p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Alexandra Vance"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Phone Number</label>
                  <input
                    type="text"
                    placeholder="555-0100"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Email Address</label>
                  <input
                    type="email"
                    placeholder="alex@vance.com"
                    value={newCustEmail}
                    onChange={(e) => setNewCustEmail(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Store Credit Debt Limit ({businessProfile.currency})</label>
                <input
                  type="number"
                  placeholder="300"
                  min="0"
                  value={newCustCreditLimit}
                  onChange={(e) => setNewCustCreditLimit(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                />
                <p className="text-[10px] text-gray-400 mt-1">Maximum outstanding tab this customer can charge to Store Credit (Accounts Receivable).</p>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setIsAddCustomerOpen(false)}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 px-4 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl shadow"
              >
                Register Account
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL OVERLAY: LIVE CAMERA BARCODE SCANNER ================= */}
      {isCameraScanning && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 text-teal-400">
                <Camera size={16} className="animate-bounce" /> Live Barcode Scanner
              </h3>
              <button
                type="button"
                onClick={() => setIsCameraScanning(false)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-slate-300 font-semibold">Position product code inside scanner viewport</p>
              <p className="text-[10px] text-slate-500">Supports EAN, UPC, and standard 1D/2D code structures.</p>
            </div>

            {/* html5-qrcode active reader viewport container */}
            <div className="bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 p-2 relative">
              <div id="reader" className="w-full"></div>
            </div>

            {/* FALLBACK MANUAL CODE OVERRIDE (Resolves no-camera smartphones issues) */}
            <div className="border-t border-slate-800 pt-3 mt-1">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1.5">No Camera Hardware? Type SKU / Code</span>
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const targetCode = (e.target as any).fallbackCode.value.trim();
                  if (!targetCode) return;

                  const product = products.find(p => 
                    p.sku.toLowerCase() === targetCode.toLowerCase() ||
                    p.barcode === targetCode
                  );

                  if (product) {
                    addToCart(product);
                    alert(`Manual Fallback match: Added "${product.name}" to cart!`);
                    (e.target as any).reset();
                    setIsCameraScanning(false);
                  } else {
                    alert(`Manual Fallback scan: "${targetCode}" matched no products in the bar inventory.`);
                  }
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  name="fallbackCode"
                  placeholder="e.g. LGR-CBL-02"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
                <button
                  type="submit"
                  className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-2 px-3 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Add
                </button>
              </form>
            </div>

            <button
              type="button"
              onClick={() => setIsCameraScanning(false)}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 px-4 rounded-xl text-xs transition-colors"
            >
              Cancel Scanning
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
