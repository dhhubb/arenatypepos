/**
 * ============================================================================
 * MODULE: components/SettingsView.tsx — Admin Settings & Business Setup
 * ----------------------------------------------------------------------------
 * The administrator control room for configuring the deployment:
 *   - BUSINESS SETUP: name, address, contact, tax rate, currency, and the
 *     industry template + editable terminology that adapt the whole app.
 *   - CAPITAL INJECTION: post owner capital contributions to the ledger.
 *   - DATABASE MANAGER: export/backup, import/restore, clone, and reset the
 *     entire local database (JSON).
 *   - USER MANAGEMENT: create users and enable/disable accounts by role.
 *   - LICENSING & REMOTE CONTROL: rendered via <LicenseControlPanel> to manage
 *     the subscription period and central admin controls.
 * Most write actions are restricted to ADMIN; AUDIT can view configuration.
 * ============================================================================
 */
import React, { useEffect, useState } from 'react';
import { BusinessProfile, BusinessType, User, UserType, CurrencyCode, Product, Customer, Supplier, Sale, PurchaseOrder, JournalEntry, Account, Employee, Payrun, Timesheet, TaxRemittance, DailyCashUp, SoftwareLicense, LicenseBillingCycle, AdminControlState } from '../types';
import { Settings, ShieldAlert, CheckCircle, HelpCircle, DollarSign, ArrowDown, Building, Users, Shield, Plus, Lock, Database, Download, Copy } from 'lucide-react';
import { BUSINESS_TEMPLATES, getBusinessTemplate } from '../utils/businessTemplates';
import LicenseControlPanel from './LicenseControlPanel';
import { hashPassword } from '../utils/auth';

interface SettingsViewProps {
  businessProfile: BusinessProfile;
  onUpdateProfile: (profile: BusinessProfile) => void;
  onResetDatabase: () => void;
  onInjectCapital: (amount: number, accountCode: '1010' | '1020') => void;
  users: User[];
  onAddUser: (user: User) => void;
  onToggleUserStatus: (userId: string) => void;
  currentUser: User | null;
  // Stateful database files replication variables
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  purchaseOrders: PurchaseOrder[];
  journalEntries: JournalEntry[];
  accounts: Account[];
  employees: Employee[];
  payruns: Payrun[];
  timesheets: Timesheet[];
  taxRemittances: TaxRemittance[];
  dailyCashUps: DailyCashUp[];
  onImportDatabase: (importedData: any) => void;
  /** Live status of the local cache / configured remote database. */
  databaseInfo: {
    mode: 'local' | 'remote';
    endpoint: string;
    status: 'local' | 'connecting' | 'connected' | 'error';
    lastSync: string;
    error: string;
  };
  onTestConnection: () => void;
  softwareLicense: SoftwareLicense;
  adminControl: AdminControlState;
  onActivateLicense: (cycle: LicenseBillingCycle, key: string) => void;
  onUpdateAdminControl: (control: AdminControlState) => void;
  onSuspendLicense: () => void;
}

export default function SettingsView({
  businessProfile,
  onUpdateProfile,
  onResetDatabase,
  onInjectCapital,
  users,
  onAddUser,
  onToggleUserStatus,
  currentUser,
  // Deserializers
  products,
  customers,
  suppliers,
  sales,
  purchaseOrders,
  journalEntries,
  accounts,
  employees,
  payruns,
  timesheets,
  taxRemittances,
  dailyCashUps,
  onImportDatabase,
  databaseInfo,
  onTestConnection,
  softwareLicense,
  adminControl,
  onActivateLicense,
  onUpdateAdminControl,
  onSuspendLicense
}: SettingsViewProps) {
  // Business State
  const [name, setName] = useState(businessProfile.name);
  const [address, setAddress] = useState(businessProfile.address);
  const [phone, setPhone] = useState(businessProfile.phone);
  const [email, setEmail] = useState(businessProfile.email);
  const [taxRate, setTaxRate] = useState(businessProfile.taxRate.toString());
  const [currency, setCurrency] = useState(businessProfile.currency);
  const [businessType, setBusinessType] = useState<BusinessType>(businessProfile.businessType);
  const [itemLabel, setItemLabel] = useState(businessProfile.terminology.itemLabel);
  const [customerLabel, setCustomerLabel] = useState(businessProfile.terminology.customerLabel);
  const [supplierLabel, setSupplierLabel] = useState(businessProfile.terminology.supplierLabel);
  const [primaryStockLabel, setPrimaryStockLabel] = useState(businessProfile.terminology.primaryStockLabel);
  const [secondaryStockLabel, setSecondaryStockLabel] = useState(businessProfile.terminology.secondaryStockLabel);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Capital Injection State
  const [capAmount, setCapAmount] = useState('');
  const [capDestination, setCapDestination] = useState<'1010' | '1020'>('1010');
  const [capSuccess, setCapSuccess] = useState(false);

  // New User Form State
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newUserType, setNewUserType] = useState<UserType>('CASHIER');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [userSuccess, setUserSuccess] = useState(false);
  const [userError, setUserError] = useState('');

  /** Keeps the setup form synchronized after database restore or profile import. */
  useEffect(() => {
    setName(businessProfile.name);
    setAddress(businessProfile.address);
    setPhone(businessProfile.phone);
    setEmail(businessProfile.email);
    setTaxRate(businessProfile.taxRate.toString());
    setCurrency(businessProfile.currency);
    setBusinessType(businessProfile.businessType);
    setItemLabel(businessProfile.terminology.itemLabel);
    setCustomerLabel(businessProfile.terminology.customerLabel);
    setSupplierLabel(businessProfile.terminology.supplierLabel);
    setPrimaryStockLabel(businessProfile.terminology.primaryStockLabel);
    setSecondaryStockLabel(businessProfile.terminology.secondaryStockLabel);
  }, [businessProfile]);

  const handleSubmitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUser?.userType !== 'ADMIN') {
      alert('Only an administrator can change business configuration.');
      return;
    }
    onUpdateProfile({
      name,
      address,
      phone,
      email,
      taxRate: parseFloat(taxRate) || 0,
      currency,
      businessType,
      terminology: {
        itemLabel,
        customerLabel,
        supplierLabel,
        primaryStockLabel,
        secondaryStockLabel
      }
    });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  /** Applies a non-destructive industry preset to the editable terminology. */
  const handleApplyIndustryTemplate = (type: BusinessType) => {
    const template = getBusinessTemplate(type);
    setBusinessType(type);
    setItemLabel(template.terminology.itemLabel);
    setCustomerLabel(template.terminology.customerLabel);
    setSupplierLabel(template.terminology.supplierLabel);
    setPrimaryStockLabel(template.terminology.primaryStockLabel);
    setSecondaryStockLabel(template.terminology.secondaryStockLabel);
    setSaveSuccess(false);
  };

  const handleInjectCapitalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUser?.userType !== 'ADMIN') {
      alert('Only an administrator can post capital adjustments.');
      return;
    }
    const amt = parseFloat(capAmount) || 0;
    if (amt <= 0) {
      alert('Please enter a positive capital amount.');
      return;
    }

    onInjectCapital(amt, capDestination);
    setCapSuccess(true);
    setCapAmount('');
    setTimeout(() => setCapSuccess(false), 2000);
  };

  const handleResetDataClick = () => {
    if (currentUser?.userType !== 'ADMIN') {
      alert('Only an administrator can reset the database.');
      return;
    }
    const doubleCheck = window.confirm('Are you sure you want to reset all data? This will wipe current POS transactions, purchases, new customer accounts, and manual ledger records, restoring original high-fidelity mock data.');
    if (doubleCheck) {
      onResetDatabase();
      alert('Database restored to initial seeding state successfully!');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
      
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-100 px-6 py-4">
        <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
          <Settings size={18} className="text-teal-600" /> Admin Panel & System Settings
        </h2>
          <p className="text-xs text-gray-400 mt-0.5">Configure the organization, industry terminology, users, currency, capital, and database</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* LIVE DATABASE CONNECTION STATUS */}
        <div className="mx-auto mb-6 max-w-5xl rounded-2xl border border-gray-100 bg-slate-900 p-4 text-white">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-teal-600 p-2">
                <Database size={16} />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider">Database Connection</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {databaseInfo.mode === 'remote'
                    ? <>Connected to server: <span className="font-mono text-slate-200">{databaseInfo.endpoint}</span></>
                    : 'Running on the local browser database (offline mode).'}
                </p>
                <p className="mt-1 text-[10px] font-semibold">
                  Status:{' '}
                  <span className={
                    databaseInfo.status === 'connected' ? 'text-teal-400'
                      : databaseInfo.status === 'error' ? 'text-red-400'
                        : 'text-amber-300'
                  }>
                    {databaseInfo.status.toUpperCase()}
                  </span>
                  {databaseInfo.lastSync && <span className="ml-2 text-slate-500">Last sync {databaseInfo.lastSync}</span>}
                </p>
                {databaseInfo.error && <p className="mt-1 text-[10px] text-red-300">{databaseInfo.error}</p>}
                {databaseInfo.mode === 'local' && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    To connect a real database, set <span className="font-mono">VITE_API_BASE_URL</span> and run the bundled server (see DATABASE.md).
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onTestConnection}
              className="shrink-0 rounded-xl bg-teal-600 px-3.5 py-2 text-xs font-bold hover:bg-teal-500"
            >
              Test Connection
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl mx-auto">
          
          {/* Left Block: Business Profile */}
          <form onSubmit={handleSubmitProfile} className="bg-gray-50 border border-gray-100 rounded-2xl p-5 sm:p-6 space-y-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 pb-2 mb-2 flex items-center gap-1.5">
              <Building size={14} className="text-teal-600" /> Business Setup & Industry Configuration
            </h3>

            <div className="rounded-2xl border border-teal-100 bg-teal-50/50 p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-teal-800 mb-1">Industry Setup Template</label>
                <select
                  value={businessType}
                  onChange={(e) => handleApplyIndustryTemplate(e.target.value as BusinessType)}
                  className="w-full bg-white border border-teal-200 rounded-xl py-2.5 px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {BUSINESS_TEMPLATES.map(template => (
                    <option key={template.type} value={template.type}>{template.name}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-[10px] leading-relaxed text-teal-700/80">
                  {getBusinessTemplate(businessType).description} Applying a template changes terminology only and never deletes existing records.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Items are called</label>
                  <input value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-1.5 px-2.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Customers are called</label>
                  <input value={customerLabel} onChange={(e) => setCustomerLabel(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-1.5 px-2.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Suppliers are called</label>
                  <input value={supplierLabel} onChange={(e) => setSupplierLabel(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-1.5 px-2.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Primary stock location</label>
                  <input value={primaryStockLabel} onChange={(e) => setPrimaryStockLabel(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-1.5 px-2.5 text-xs" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Available / secondary location</label>
                  <input value={secondaryStockLabel} onChange={(e) => setSecondaryStockLabel(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-1.5 px-2.5 text-xs" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Company Registered Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Physical Store Address</label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={2}
                className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Support Phone</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Support Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">POS Sales Tax rate (%)</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Active Store Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-bold"
                >
                  <option value="ZAR">ZAR - South African Rand (Base)</option>
                  <option value="USD">USD - United States Dollar</option>
                  <option value="BWP">BWP - Botswana Pula</option>
                  <option value="EUR">EUR - Euro (Other)</option>
                </select>
              </div>
            </div>

            {saveSuccess && (
              <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-3 rounded-xl font-bold flex items-center gap-1.5">
                <CheckCircle size={15} /> Store profile updated successfully!
              </p>
            )}

            <button
              type="submit"
              className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-xl text-xs shadow transition duration-150 cursor-pointer"
            >
                Save Business Configuration
            </button>
          </form>

          {/* Right Block: Capital Injection & Database reset */}
          <div className="space-y-6">
            
            {/* Owner's Capital Injection Tool */}
            <form onSubmit={handleInjectCapitalSubmit} className="bg-gray-50 border border-gray-100 rounded-2xl p-5 sm:p-6 space-y-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 pb-2 mb-2 flex items-center gap-1.5">
                <DollarSign size={14} className="text-teal-600" /> Capital Investment (Owner Injection)
              </h3>
              
              <div className="p-3 bg-teal-50 border border-teal-100 rounded-xl text-xs text-teal-800 flex items-start gap-2 leading-relaxed">
                <HelpCircle size={15} className="shrink-0 mt-0.5" />
                <p>Injecting private capital increases company cash reserves and credits Owner Equity (3100) on your double-entry balance sheet.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Funding Amount *</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 font-bold">{currency}</span>
                    <input
                      type="number"
                      step="1"
                      required
                      placeholder="5000"
                      value={capAmount}
                      onChange={(e) => setCapAmount(e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-xl py-2 pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Asset Target Account *</label>
                  <select
                    value={capDestination}
                    onChange={(e) => setCapDestination(e.target.value as any)}
                    className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="1010">1010 - Cash Drawer Box</option>
                    <option value="1020">1020 - Card Clearing (Bank Account)</option>
                  </select>
                </div>
              </div>

              {capSuccess && (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-3 rounded-xl font-bold flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle size={15} /> Capital posted! Debited {capDestination === '1010' ? 'Cash Drawer' : 'Bank'} & Credited Owner Capital (3100).
                </p>
              )}

              <button
                type="submit"
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-xl text-xs shadow transition duration-150 cursor-pointer flex items-center justify-center gap-1"
              >
                <ArrowDown size={14} /> Post Capital Injection
              </button>
            </form>

            {/* Stateful database files replication controls (Backup, Export, Import, and Clone) */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 sm:p-6 space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-teal-600 border-b border-gray-200 pb-2 mb-2 flex items-center gap-1.5">
                <Database size={14} /> Database File Backup Manager
              </h3>
              
              <p className="text-xs text-gray-500 leading-relaxed">
                Compile your entire business profile, ledger entries, timesheets, and bar catalog into a portable JSON database backup file. Export to save snapshots locally, or upload any previous backup to restore or clone your system configuration.
              </p>

              {currentUser?.userType !== 'ADMIN' ? (
                <div className="p-3 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl flex items-start gap-2.5 text-xs">
                  <Lock size={15} className="shrink-0 mt-0.5" />
                  <p>Database file export, backup, and restore overrides are restricted to the Administrator role.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Export Trigger */}
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const payload = {
                          version: '1.0.0',
                          timestamp: new Date().toISOString(),
                          businessProfile,
                          products,
                          customers,
                          suppliers,
                          sales,
                          purchaseOrders,
                          journalEntries,
                          users,
                          accounts,
                          employees,
                          payruns,
                          timesheets,
                          taxRemittances,
                          dailyCashUps,
                          softwareLicense,
                          adminControl
                        };

                        const jsonStr = JSON.stringify(payload, null, 2);
                        const blob = new Blob([jsonStr], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.setAttribute('href', url);
                        const safeBusinessName = businessProfile.name.replace(/[^a-z0-9]/gi, '_');
                        link.setAttribute('download', `Afritecx_Badboy_${safeBusinessName}_Backup_${new Date().toISOString().split('T')[0]}.json`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      } catch (err: any) {
                        alert(`Export Failed: ${err.message || err}`);
                      }
                    }}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Download size={14} /> Backup & Export Database (.json)
                  </button>

                  {/* Clone / Copy to clipboard */}
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const payload = {
                          version: '1.0.0',
                          timestamp: new Date().toISOString(),
                          businessProfile,
                          products,
                          customers,
                          suppliers,
                          sales,
                          purchaseOrders,
                          journalEntries,
                          users,
                          accounts,
                          employees,
                          payruns,
                          timesheets,
                          taxRemittances,
                          dailyCashUps,
                          softwareLicense,
                          adminControl
                        };
                        navigator.clipboard.writeText(JSON.stringify(payload));
                        alert('Database configuration copied to clipboard! You can paste this on another browser to clone.');
                      } catch (err: any) {
                        alert(`Clone Copy Failed: ${err.message || err}`);
                      }
                    }}
                    className="w-full bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Copy size={14} /> Clone Session config (Copy JSON)
                  </button>

                  <div className="border-t border-gray-100 my-2 pt-2">
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5">Import & Restore Backup File</label>
                    <div className="relative">
                      <input
                        type="file"
                        accept=".json"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;

                          const reader = new FileReader();
                          reader.onload = (event) => {
                            try {
                              const imported = JSON.parse(event.target?.result as string);
                              const confirmRestore = window.confirm('Security Warning: Importing this backup file will completely overwrite all current sales history, inventory products, wage slips, and user logins. This process cannot be undone. Do you wish to proceed?');
                              if (confirmRestore) {
                                onImportDatabase(imported);
                              }
                            } catch (err) {
                              alert('Invalid JSON backup file. Parse failed.');
                            }
                          };
                          reader.readAsText(file);
                        }}
                        className="w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-[11px] file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 file:cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Emergency Wiping Zone */}
            <div className="bg-red-50 border border-red-100 rounded-2xl p-5 sm:p-6 space-y-4">
              <h3 className="text-xs font-bold text-red-800 uppercase tracking-wider border-b border-red-200 pb-2 mb-2 flex items-center gap-1.5">
                <ShieldAlert size={14} className="text-red-600" /> Database Maintenance Zone
              </h3>

              <p className="text-xs text-red-700/80 leading-relaxed">
                Clicking below will flush all local storage transactions, reset sales registers, AP/AR ledgers, and rebuild original mock data states. Use only for demo testing or clearing sandbox audits.
              </p>

              <button
                type="button"
                onClick={handleResetDataClick}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-xl text-xs shadow transition duration-150 cursor-pointer"
              >
                Reset Database to Seed State
              </button>
            </div>

          </div>

        </div>

        {/* SECTION: USER DATABASE ADMINISTRATION PANEL */}
        <div className="max-w-5xl mx-auto mt-8 border-t border-gray-200 pt-8">
          <div className="flex flex-col md:flex-row gap-6">
            
            {/* Left Col: Register New User */}
            <div className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl p-5 sm:p-6 space-y-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 pb-2 mb-2 flex items-center gap-1.5">
                <Users size={14} className="text-teal-600" /> User Database Provisioning
              </h3>

              {currentUser?.userType !== 'ADMIN' ? (
                <div className="p-4 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl flex items-start gap-2.5 leading-relaxed text-xs">
                  <Lock size={15} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Access Restrained</p>
                    <p className="mt-0.5 text-amber-700/80">User creation and administrative overrides are exclusive to the Administrator role.</p>
                  </div>
                </div>
              ) : (
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setUserError('');
                    setUserSuccess(false);

                    if (!newUsername.trim() || !newFullName.trim() || !newUserPassword.trim()) {
                      setUserError('All fields are required.');
                      return;
                    }
                    if (newUserPassword.length < 8) {
                      setUserError('Choose a password of at least 8 characters.');
                      return;
                    }
                    if (users.some(u => u.username.toLowerCase() === newUsername.trim().toLowerCase())) {
                      setUserError('A user with this username already exists.');
                      return;
                    }

                    // Only the derived hash is persisted; the plain password never
                    // leaves this function.
                    const newUser: User = {
                      id: `u-${Date.now()}`,
                      username: newUsername.trim().toLowerCase(),
                      passwordHash: await hashPassword(newUserPassword),
                      userType: newUserType,
                      fullName: newFullName.trim(),
                      isActive: true
                    };

                    onAddUser(newUser);
                    setUserSuccess(true);
                    setNewUsername('');
                    setNewFullName('');
                    setNewUserPassword('');
                  }} 
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Username *</label>
                      <input
                        type="text"
                        required
                        placeholder="cashier_jane"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Full Display Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="Jane Doe"
                        value={newFullName}
                        onChange={(e) => setNewFullName(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">System Security Role *</label>
                      <select
                        value={newUserType}
                        onChange={(e) => setNewUserType(e.target.value as UserType)}
                        className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                      >
                        <option value="CASHIER">CASHIER (Sales & Payments)</option>
                        <option value="GENERAL">GENERAL (Inventory & Activity)</option>
                        <option value="AUDIT">AUDIT (Read-only Access)</option>
                        <option value="ADMIN">ADMIN (Full Access)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Password *</label>
                      <input
                        type="password"
                        required
                        placeholder="••••••••"
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                      />
                    </div>
                  </div>

                  {userError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-xl font-bold flex items-center gap-1.5">
                      <ShieldAlert size={15} /> {userError}
                    </p>
                  )}

                  {userSuccess && (
                    <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-3 rounded-xl font-bold flex items-center gap-1.5 animate-fade-in">
                      <CheckCircle size={15} /> User registered in local storage database.
                    </p>
                  )}

                  <button
                    type="submit"
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow flex items-center justify-center gap-1 transition-all"
                  >
                    <Plus size={14} /> Provision User Profile
                  </button>
                </form>
              )}
            </div>

            {/* Right Col: Current Profiles List */}
            <div className="flex-1 bg-white border border-gray-100 rounded-2xl p-5 sm:p-6 space-y-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 pb-2 flex items-center gap-1.5">
                <Shield size={14} className="text-teal-600" /> User Directory & Account Controls
              </h3>

              <div className="overflow-hidden border border-gray-100 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                      <th className="py-2.5 px-3">Display Profile</th>
                      <th className="py-2.5 px-3">Username</th>
                      <th className="py-2.5 px-3 text-center">Security Role</th>
                      <th className="py-2.5 px-3 text-right">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50/40">
                        <td className="py-3 px-3 font-semibold text-gray-800">{user.fullName}</td>
                        <td className="py-3 px-3 font-mono text-gray-400 font-bold">{user.username}</td>
                        <td className="py-3 px-3 text-center">
                          <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${
                            user.userType === 'ADMIN' 
                              ? 'bg-rose-100 text-rose-800' 
                              : user.userType === 'GENERAL'
                                ? 'bg-indigo-100 text-indigo-800'
                                : user.userType === 'CASHIER'
                                  ? 'bg-sky-100 text-sky-800'
                                  : 'bg-amber-100 text-amber-800'
                          }`}>
                            {user.userType}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            disabled={currentUser?.userType !== 'ADMIN' || user.username === 'admin'}
                            onClick={() => onToggleUserStatus(user.id)}
                            className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${
                              user.isActive 
                                ? 'bg-teal-50 text-teal-600 hover:bg-teal-100 border border-teal-200 disabled:border-transparent' 
                                : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                            }`}
                          >
                            {user.isActive ? 'Active' : 'Disabled'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>

        <LicenseControlPanel
          license={softwareLicense}
          control={adminControl}
          currentUser={currentUser}
          onActivateLicense={onActivateLicense}
          onUpdateControl={onUpdateAdminControl}
          onSuspendLicense={onSuspendLicense}
        />
      </div>

    </div>
  );
}
