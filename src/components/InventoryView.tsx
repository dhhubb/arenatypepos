/**
 * ============================================================================
 * MODULE: components/InventoryView.tsx — Stock & Supply Chain Manager
 * ----------------------------------------------------------------------------
 * Where products and stock are managed. Responsibilities:
 *   - STOCK REGISTRY: list/search products with cost, price, reorder levels,
 *     and split quantities across a primary and secondary location.
 *   - PRODUCT EDITING: add new products and edit existing product details.
 *   - PURCHASE ORDERS (PO): order stock from suppliers; receiving a PO raises
 *     inventory in the primary location and posts the matching journal entry.
 *   - STOCK TRANSFER: move quantities from the primary location (e.g. store-
 *     room/warehouse) into the secondary location (e.g. shelf/fridge) so they
 *     become sellable at the POS.
 * Terminology adapts to the configured business type; AUDIT users are read-only.
 * ============================================================================
 */
import React, { useState } from 'react';
import { Product, Supplier, PurchaseOrder, BusinessProfile, User } from '../types';
import { 
  Package, 
  Plus, 
  AlertTriangle, 
  Search, 
  Check, 
  Truck
} from 'lucide-react';

interface InventoryViewProps {
  products: Product[];
  suppliers: Supplier[];
  businessProfile: BusinessProfile;
  onAddProduct: (product: Product) => void;
  onUpdateProduct: (product: Product) => void;
  onAddPurchaseOrder: (po: PurchaseOrder) => void;
  currentUser: User | null;
  onTransferStock: (productId: string, quantityToTransfer: number) => void;
}

export default function InventoryView({
  products,
  suppliers,
  businessProfile,
  onAddProduct,
  onUpdateProduct,
  onAddPurchaseOrder,
  currentUser,
  onTransferStock
}: InventoryViewProps) {
  const [activeTab, setActiveTab] = useState<'stock' | 'po' | 'transfer'>('stock');
  
  // Stock Search / Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // New Product Form State
  const [isAddProdOpen, setIsAddProdOpen] = useState(false);
  const [pName, setPName] = useState('');
  const [pSku, setPSku] = useState('');
  const [pCategory, setPCategory] = useState('Food');
  const [pPrice, setPPrice] = useState('');
  const [pCost, setPCost] = useState('');
  const [pStock, setPStock] = useState('');
  const [pMinStock, setPMinStock] = useState('10');
  const [pBarcode, setPBarcode] = useState('');
  const [pEmoji, setPEmoji] = useState('📦');

  // Edit Product Modal State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // --- COLD STORAGE TRANSFER FORM STATES ---
  /**
   * Tracks the product selected by the manager to transfer.
   */
  const [transferProductId, setTransferProductId] = useState<string>(products[0]?.id || '');
  
  /**
   * Form binding state for the amount of crates/cases to move into the fridges.
   */
  const [transferQty, setTransferQty] = useState<string>('');
  
  /**
   * Status indicators for success or discrepancy warnings.
   */
  const [transferSuccess, setTransferSuccess] = useState<boolean>(false);
  const [transferError, setTransferError] = useState<string>('');

  // Purchase Order Form State
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [poPaymentMethod, setPoPaymentMethod] = useState<'CASH' | 'CARD' | 'ACCOUNTS_PAYABLE'>('ACCOUNTS_PAYABLE');
  const [poItems, setPoItems] = useState<{ productId: string; quantity: number; costPrice: number }[]>([]);
  const [poError, setPoError] = useState('');
  const [poSuccess, setPoSuccess] = useState(false);

  const categories = ['All', ...Array.from(new Set(products.map(p => p.category)))];

  // Filtering products
  const filteredProducts = products.filter(p => {
    const matchesCat = selectedCategory === 'All' || p.category === selectedCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const lowStockProducts = products.filter(p => p.stock <= p.minStock);

  // Handle New Product Submit
  const handleAddProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (currentUser?.userType === 'AUDIT') {
      alert('Security Warning: This is a Read-Only Audit session. Product registry additions are locked.');
      return;
    }

    if (!pName.trim() || !pSku.trim()) return;

    // Check SKU unique
    if (products.some(p => p.sku.toLowerCase() === pSku.trim().toLowerCase())) {
      alert('A product with this SKU already exists!');
      return;
    }

    const initialStock = parseInt(pStock) || 0;
    const newProd: Product = {
      id: `p-prod-${Date.now()}`,
      name: pName,
      sku: pSku.toUpperCase(),
      category: pCategory,
      price: parseFloat(pPrice) || 0,
      costPrice: parseFloat(pCost) || 0,
      storeroomStock: initialStock, // Load bulk restocks to Storeroom first
      fridgeStock: 0,               // Default fridge cold stock to zero
      stock: initialStock,          // Sum stock
      minStock: parseInt(pMinStock) || 0,
      barcode: pBarcode.trim() || undefined,
      image: pEmoji
    };

    onAddProduct(newProd);
    setIsAddProdOpen(false);
    
    // Clear fields
    setPName('');
    setPSku('');
    setPPrice('');
    setPCost('');
    setPStock('');
    setPBarcode('');
  };

  // Handle Edit Product Submit
  const handleEditProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    if (currentUser?.userType === 'AUDIT') {
      alert('Security Warning: This is a Read-Only Audit session. Product edits are locked.');
      return;
    }

    // Selling below cost is not an error the app should block — clearance and
    // loss-leader pricing are real — but it must be a deliberate choice, not a
    // typo that quietly books a loss on every unit sold.
    if (editingProduct.costPrice > editingProduct.price) {
      const proceed = window.confirm(
        `Supplier cost (${businessProfile.currency}${editingProduct.costPrice.toFixed(2)}) is higher than the selling price ` +
        `(${businessProfile.currency}${editingProduct.price.toFixed(2)}). Every sale of this item will record a loss. Continue?`
      );
      if (!proceed) return;
    }

    onUpdateProduct(editingProduct);
    setEditingProduct(null);
  };

  // PO Items Helpers
  const addPoItemLine = () => {
    if (products.length === 0) return;
    const defaultProduct = products[0];
    setPoItems([...poItems, { productId: defaultProduct.id, quantity: 10, costPrice: defaultProduct.costPrice }]);
  };

  const removePoItemLine = (index: number) => {
    setPoItems(poItems.filter((_, i) => i !== index));
  };

  const updatePoItemLine = (index: number, field: 'productId' | 'quantity' | 'costPrice', value: string) => {
    setPoItems(prev => prev.map((item, i) => {
      if (i === index) {
        if (field === 'productId') {
          const selectedProd = products.find(p => p.id === value);
          return {
            productId: value,
            quantity: item.quantity,
            costPrice: selectedProd ? selectedProd.costPrice : item.costPrice
          };
        } else if (field === 'costPrice') {
          return { ...item, costPrice: parseFloat(value) || 0 };
        } else {
          return { ...item, quantity: parseInt(value) || 0 };
        }
      }
      return item;
    }));
  };

  // Submit Purchase Order (Updates Stock & Accounting)
  const handleSubmitPurchaseOrder = (e: React.FormEvent) => {
    e.preventDefault();
    setPoError('');
    setPoSuccess(false);

    if (currentUser?.userType === 'AUDIT') {
      setPoError('Security Warning: Submitting Purchase Orders and receiving stock are locked under Read-Only Audit sessions.');
      return;
    }

    if (!selectedSupplierId) {
      setPoError('Please select a supplier.');
      return;
    }

    if (poItems.length === 0) {
      setPoError('Please add at least one item to purchase.');
      return;
    }

    // Prepare line details
    const finalItems = poItems.map(item => {
      const prod = products.find(p => p.id === item.productId);
      return {
        productId: item.productId,
        name: prod ? prod.name : 'Unknown Product',
        quantity: item.quantity,
        costPrice: item.costPrice,
        total: item.quantity * item.costPrice
      };
    });

    const poTotal = finalItems.reduce((sum, item) => sum + item.total, 0);

    const poId = `PO-${Date.now()}`;
    const poNo = `PO-${Math.floor(1000 + Math.random() * 9000)}`;

    const newPO: PurchaseOrder = {
      id: poId,
      poNo,
      date: new Date().toISOString().split('T')[0],
      supplierId: selectedSupplierId,
      items: finalItems,
      total: parseFloat(poTotal.toFixed(2)),
      isReceived: true, // Automatically received & stocked in this retail flow
      isPaid: poPaymentMethod !== 'ACCOUNTS_PAYABLE', // If CASH or CARD, it is paid instantly
      paymentMethod: poPaymentMethod
    };

    onAddPurchaseOrder(newPO);
    setPoSuccess(true);
    setPoItems([]);
    setSelectedSupplierId('');
    
    // Close modal after delay
    setTimeout(() => {
      setPoSuccess(false);
    }, 1500);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
      
      {/* View Navigation Header */}
      <div className="bg-gray-50 border-b border-gray-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Package size={18} className="text-teal-600" /> Stock & Supply Chain Manager
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Track {businessProfile.terminology.itemLabel.toLowerCase()} records, reorder thresholds, locations, and purchase orders</p>
        </div>

        {/* Tab switchers */}
        <div className="flex bg-white border border-gray-200 rounded-xl p-1 gap-1 self-start overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('stock')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'stock'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Package size={14} /> Stock Registry
          </button>
          <button
            onClick={() => {
              setActiveTab('po');
              setPoItems([]);
              setPoError('');
            }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'po'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Truck size={14} /> Order Stock (PO)
          </button>
          <button
            onClick={() => setActiveTab('transfer')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'transfer'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Plus size={14} /> Move Stock (Transfer)
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        
        {/* ================= TAB 1: STOCK REGISTRY ================= */}
        {activeTab === 'stock' && (
          <div className="space-y-6">
            
            {/* Low stock Alerts Banner */}
            {lowStockProducts.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3 text-amber-800">
                <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
                <div className="text-xs">
                  <h4 className="font-bold">Low Stock Warning! ({lowStockProducts.length} items)</h4>
                  <p className="text-amber-700/80 mt-0.5">The following items are at or below their set minimum stock safety buffers. Restock soon to prevent retail stockout:</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {lowStockProducts.map(p => (
                      <span key={p.id} className="bg-white/80 border border-amber-200 rounded-md py-0.5 px-2 font-mono font-bold text-[10px]">
                        {p.name} ({p.stock} left)
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Search and Category filters */}
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto flex-1">
                {/* Search text */}
                <div className="relative flex-1 max-w-sm">
                  <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 pointer-events-none">
                    <Search size={15} />
                  </span>
                  <input
                    type="text"
                    placeholder="Search stock..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-9 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                {/* Categories */}
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                >
                  {categories.map(c => (
                    <option key={c} value={c}>{c === 'All' ? 'All Categories' : c}</option>
                  ))}
                </select>
              </div>

              {/* Add Product Button */}
              <button
                onClick={() => setIsAddProdOpen(true)}
                className="w-full md:w-auto bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow"
              >
                <Plus size={15} /> Add New {businessProfile.terminology.itemLabel}
              </button>
            </div>

            {/* Stock Table */}
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-100">
                      <th className="py-3 px-4 w-12">Item</th>
                      <th className="py-3 px-4">{businessProfile.terminology.itemLabel} Name</th>
                      <th className="py-3 px-4">SKU / Code</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4 text-right">Cost Price</th>
                      <th className="py-3 px-4 text-right">Selling Price</th>
                      <th className="py-3 px-4 text-center">{businessProfile.terminology.primaryStockLabel}</th>
                      <th className="py-3 px-4 text-center">{businessProfile.terminology.secondaryStockLabel}</th>
                      <th className="py-3 px-4 text-center">Total Stock</th>
                      <th className="py-3 px-4 text-right w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-12 text-center text-gray-400 italic">No products found in database.</td>
                      </tr>
                    ) : (
                      filteredProducts.map(p => {
                        const isLow = p.stock <= p.minStock;
                        return (
                          <tr key={p.id} className="hover:bg-gray-50/40 transition-colors">
                            <td className="py-3 px-4 text-xl">{p.image || '📦'}</td>
                            <td className="py-3 px-4 font-semibold text-gray-800">{p.name}</td>
                            <td className="py-3 px-4 font-mono text-gray-400 text-[10px]">{p.sku}</td>
                            <td className="py-3 px-4"><span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold">{p.category}</span></td>
                            <td className="py-3 px-4 text-right font-mono text-gray-600">{businessProfile.currency}{p.costPrice.toFixed(2)}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-teal-600">{businessProfile.currency}{p.price.toFixed(2)}</td>
                            <td className="py-3 px-4 text-center font-mono font-bold text-gray-600">{p.storeroomStock}</td>
                            <td className="py-3 px-4 text-center font-mono font-bold text-teal-700">{p.fridgeStock}</td>
                            <td className="py-3 px-4 text-center font-bold">
                              <span className={`inline-block px-2.5 py-0.5 rounded-full font-mono text-[11px] ${
                                p.stock <= 0
                                  ? 'bg-red-100 text-red-600'
                                  : isLow
                                    ? 'bg-amber-100 text-amber-600'
                                    : 'bg-teal-100 text-teal-800'
                              }`}>
                                {p.stock} <span className="text-[9px] font-medium text-gray-400">/ min {p.minStock}</span>
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => setEditingProduct({ ...p })}
                                className="text-teal-600 hover:text-teal-700 font-semibold cursor-pointer"
                              >
                                Edit Settings
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ================= TAB 2: PURCHASE ORDER Restock Creator ================= */}
        {activeTab === 'po' && (
          <div className="max-w-2xl mx-auto space-y-6">
            
            <form onSubmit={handleSubmitPurchaseOrder} className="bg-gray-50 border border-gray-100 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="border-b border-gray-200 pb-3">
                <h3 className="text-sm font-bold text-gray-800">Draft New Double-Entry Purchase Order</h3>
                <p className="text-xs text-gray-400 mt-0.5">Purchasing stock updates item counts and posts the respective inventory asset value to your double-entry books.</p>
              </div>

              {/* Supplier & Payment Method */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Select Active Wholesaler *</label>
                  <select
                    required
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">-- Choose Supplier --</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.balanceOwed > 0 ? `(We owe ${businessProfile.currency}${s.balanceOwed.toFixed(2)})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Payment Channel *</label>
                  <select
                    value={poPaymentMethod}
                    onChange={(e) => setPoPaymentMethod(e.target.value as any)}
                    className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="ACCOUNTS_PAYABLE">On Supplier Credit (Accounts Payable)</option>
                    <option value="CASH">Instantly Paid (Physical Cash drawer)</option>
                    <option value="CARD">Instantly Paid (Bank Account)</option>
                  </select>
                </div>
              </div>

              {/* Items Selector */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Supply Items to Order</span>
                  <button
                    type="button"
                    onClick={addPoItemLine}
                    className="text-xs font-semibold text-teal-600 hover:text-teal-700 flex items-center gap-1"
                  >
                    + Add Product Line
                  </button>
                </div>

                {poItems.length === 0 ? (
                  <div className="bg-white border border-dashed border-gray-200 p-8 rounded-xl text-center text-xs text-gray-400">
                    No items added. Click "+ Add Product Line" above to select products for purchase order.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {poItems.map((item, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row gap-2 items-center bg-white p-3 border border-gray-100 rounded-xl relative">
                        {/* Product */}
                        <div className="flex-1 w-full">
                          <select
                            value={item.productId}
                            onChange={(e) => updatePoItemLine(idx, 'productId', e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg py-1.5 px-2 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500"
                          >
                            {products.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} (SKU: {p.sku} | Cost: {businessProfile.currency}{p.costPrice.toFixed(2)})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Quantity */}
                        <div className="w-24 flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-400 font-bold">Qty:</span>
                          <input
                            type="number"
                            min="1"
                            required
                            value={item.quantity}
                            onChange={(e) => updatePoItemLine(idx, 'quantity', e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg py-1.5 text-center text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </div>

                        {/* Cost Price */}
                        <div className="w-28 flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-400 font-bold">Cost:</span>
                          <div className="relative w-full">
                            <span className="absolute inset-y-0 left-2 flex items-center text-gray-400 font-bold text-[10px]">{businessProfile.currency}</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              required
                              value={item.costPrice}
                              onChange={(e) => updatePoItemLine(idx, 'costPrice', e.target.value)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-lg py-1.5 pl-5 text-left text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                            />
                          </div>
                        </div>

                        {/* Delete line */}
                        <button
                          type="button"
                          onClick={() => removePoItemLine(idx)}
                          className="text-gray-400 hover:text-red-500 font-bold self-end sm:self-center"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Total Due */}
              <div className="bg-white border border-gray-100 p-4 rounded-xl flex justify-between items-center">
                <span className="text-xs font-bold text-gray-500 uppercase">Calculated PO Valuation</span>
                <span className="text-base font-black text-teal-600 font-mono">
                  {businessProfile.currency}
                  {poItems.reduce((sum, item) => sum + (item.quantity * item.costPrice), 0).toFixed(2)}
                </span>
              </div>

              {poError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-xl font-bold flex items-center gap-1.5">
                  <AlertTriangle size={15} /> {poError}
                </p>
              )}

              {poSuccess && (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-3 rounded-xl font-bold flex items-center gap-1.5">
                  <Check size={15} /> Purchase Order Processed! Added stock to registry and posted double-entry journal logs.
                </p>
              )}

              {/* Controls */}
              <div className="border-t border-gray-200 pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setPoItems([])}
                  className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 rounded-xl text-xs"
                >
                  Clear Fields
                </button>
                <button
                  type="submit"
                  disabled={poItems.length === 0}
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed font-bold py-2.5 rounded-xl text-xs shadow"
                >
                  Confirm & Receive Stock
                </button>
              </div>
            </form>

          </div>
        )}

        {/* ================= TAB 3: LOAD FRIDGE (STOCK TRANSFER) (NEW) ================= */}
        {activeTab === 'transfer' && (
          <div className="max-w-xl mx-auto space-y-6 animate-fade-in">
            
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                setTransferError('');
                setTransferSuccess(false);

                // Security Gate Check for AUDIT roles
                if (currentUser?.userType === 'AUDIT') {
                  setTransferError('Security Warning: This is a Read-Only Audit session. Stock movements are locked.');
                  return;
                }

                const targetProd = products.find(p => p.id === transferProductId);
                if (!targetProd) {
                  setTransferError('Please select a valid product.');
                  return;
                }

                const qtyVal = parseInt(transferQty) || 0;
                if (qtyVal <= 0) {
                  setTransferError('Please enter a valid positive transfer quantity.');
                  return;
                }

                // Check sufficient storeroom stock
                if (qtyVal > targetProd.storeroomStock) {
                  setTransferError(`Insufficient ${businessProfile.terminology.primaryStockLabel} stock. You are trying to move ${qtyVal} units, but only ${targetProd.storeroomStock} units of "${targetProd.name}" remain.`);
                  return;
                }

                // Fire the core stock transfer callback
                onTransferStock(transferProductId, qtyVal);
                setTransferSuccess(true);
                setTransferQty('');

                setTimeout(() => {
                  setTransferSuccess(false);
                }, 1500);
              }}
              className="bg-gray-50 border border-gray-150 rounded-2xl p-6 shadow-sm space-y-5"
            >
              <div className="border-b border-gray-200 pb-3">
                <h3 className="text-sm font-bold text-gray-800">Move stock between operational locations</h3>
                <p className="text-xs text-gray-400 mt-0.5">Transfer {businessProfile.terminology.itemLabel.toLowerCase()} quantities from {businessProfile.terminology.primaryStockLabel} into {businessProfile.terminology.secondaryStockLabel}, where they become available for transactions.</p>
              </div>

              {/* Product selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Select {businessProfile.terminology.itemLabel} *</label>
                <select
                  required
                  value={transferProductId}
                  onChange={(e) => {
                    setTransferProductId(e.target.value);
                    setTransferError('');
                    setTransferSuccess(false);
                  }}
                  className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">-- Choose {businessProfile.terminology.itemLabel} --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (SKU: {p.sku})
                    </option>
                  ))}
                </select>
              </div>

              {/* Current stock indicators helper */}
              {(() => {
                const target = products.find(p => p.id === transferProductId);
                if (!target) return null;
                return (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white border border-gray-150 p-4 rounded-2xl text-center">
                      <span className="text-[9px] text-gray-400 font-bold block uppercase">{businessProfile.terminology.primaryStockLabel} Stock</span>
                      <span className="text-sm font-black text-gray-800 font-mono mt-0.5 block">{target.storeroomStock} units</span>
                    </div>
                    <div className="bg-teal-50/50 border border-teal-100 p-4 rounded-2xl text-center">
                      <span className="text-[9px] text-teal-800 font-bold block uppercase">{businessProfile.terminology.secondaryStockLabel} Stock</span>
                      <span className="text-sm font-black text-teal-700 font-mono mt-0.5 block">{target.fridgeStock} units</span>
                    </div>
                  </div>
                );
              })()}

              {/* Transfer amount */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Quantity to Move (Units) *</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="e.g. 24"
                  value={transferQty}
                  onChange={(e) => {
                    setTransferQty(e.target.value);
                    setTransferError('');
                    setTransferSuccess(false);
                  }}
                  className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                />
              </div>

              {transferError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-xl font-bold flex items-center gap-1.5">
                  <AlertTriangle size={15} /> {transferError}
                </p>
              )}

              {transferSuccess && (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-3 rounded-xl font-bold flex items-center gap-1.5">
                  <Check size={15} /> Stock transferred successfully into {businessProfile.terminology.secondaryStockLabel}.
                </p>
              )}

              {/* Controls */}
              <div className="border-t border-gray-200 pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setTransferQty('');
                    setTransferError('');
                    setTransferSuccess(false);
                  }}
                  className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2 rounded-xl text-xs"
                >
                  Clear Form
                </button>
                <button
                  type="submit"
                  disabled={!transferProductId}
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed font-bold py-2 rounded-xl text-xs shadow transition-all cursor-pointer"
                >
                  Transfer Cold Stock
                </button>
              </div>

            </form>

          </div>
        )}

      </div>

      {/* ================= MODAL: ADD PRODUCT FORM ================= */}
      {isAddProdOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAddProductSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-100 bg-teal-50/50">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-1.5">
                <Package size={18} className="text-teal-600" /> New Product Registry
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Define core item specs for retail listing</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Visual Icon</label>
                  <select
                    value={pEmoji}
                    onChange={(e) => setPEmoji(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="🍔">🍔 Food</option>
                    <option value="🍟">🍟 Fries</option>
                    <option value="🍺">🍺 Alcohol</option>
                    <option value="☕">☕ Drink</option>
                    <option value="🧀">🧀 Cheese</option>
                    <option value="🥑">🥑 Grocer</option>
                    <option value="🥣">🥣 Bowl</option>
                    <option value="🧥">🧥 Cloth</option>
                    <option value="👜">👜 Bag</option>
                    <option value="📦">📦 Stock</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Product Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Sourdough Loaf"
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Unique SKU *</label>
                  <input
                    type="text"
                    required
                    placeholder="BAK-SOU-01"
                    value={pSku}
                    onChange={(e) => setPSku(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Category *</label>
                  <select
                    value={pCategory}
                    onChange={(e) => setPCategory(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="Food">Food</option>
                    <option value="Beverages">Beverages</option>
                    <option value="Groceries">Groceries</option>
                    <option value="Apparel">Apparel</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Cost Price *</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold">{businessProfile.currency}</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="3.50"
                      value={pCost}
                      onChange={(e) => setPCost(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Selling Retail Price *</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold">{businessProfile.currency}</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="8.99"
                      value={pPrice}
                      onChange={(e) => setPPrice(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Initial Stock Level</label>
                  <input
                    type="number"
                    placeholder="50"
                    value={pStock}
                    onChange={(e) => setPStock(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Min Safety stock Alert</label>
                  <input
                    type="number"
                    placeholder="10"
                    value={pMinStock}
                    onChange={(e) => setPMinStock(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Barcode Value</label>
                <input
                  type="text"
                  placeholder="100000201"
                  value={pBarcode}
                  onChange={(e) => setPBarcode(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                />
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setIsAddProdOpen(false)}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 px-4 rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow"
              >
                Save Product
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL: EDIT PRODUCT BUFFER DETAILS ================= */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleEditProductSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-100 bg-teal-50/50">
              <h3 className="text-base font-bold text-gray-800">Edit Settings: {editingProduct.name}</h3>
              <p className="text-xs text-gray-400 mt-0.5">SKU: {editingProduct.sku}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Retail Selling Price *</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold">{businessProfile.currency}</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={editingProduct.price}
                      onChange={(e) => setEditingProduct({ ...editingProduct, price: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Supplier Cost Price *</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold">{businessProfile.currency}</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={editingProduct.costPrice}
                      onChange={(e) => setEditingProduct({ ...editingProduct, costPrice: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Override Stock Level</label>
                  <input
                    type="number"
                    value={editingProduct.stock}
                    onChange={(e) => setEditingProduct({ ...editingProduct, stock: parseInt(e.target.value) || 0 })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                  <p className="text-[9px] text-amber-600 mt-0.5">⚠ Modifying stock manually bypasses audit trail records!</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Safety stock limit</label>
                  <input
                    type="number"
                    value={editingProduct.minStock}
                    onChange={(e) => setEditingProduct({ ...editingProduct, minStock: parseInt(e.target.value) || 0 })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 px-4 rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow"
              >
                Update Stock Info
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
