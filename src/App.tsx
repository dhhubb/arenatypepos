/**
 * ============================================================================
 * MODULE: App.tsx — Root Application Orchestrator
 * ----------------------------------------------------------------------------
 * The central hub that ties every feature together. Responsibilities:
 *   - STATE OWNERSHIP: holds all core data (products, customers, suppliers,
 *     sales, journal entries, accounts, users, payroll, licensing, admin
 *     controls, etc.) as the single source of truth.
 *   - PERSISTENCE: loads state from localStorage on startup and saves every
 *     change back, so data survives page refreshes; also supports import,
 *     export, backup, and reset of the whole database.
 *   - BUSINESS LOGIC GLUE: coordinated handlers (e.g. completing a sale)
 *     update inventory AND post the matching double-entry journal entries.
 *   - AUTH & ROLES: manages the logged-in user session and gates each module
 *     (POS, inventory, accounting, payroll, etc.) by user role.
 *   - LICENSING & REMOTE ADMIN: enforces license validity and applies
 *     admin controls (maintenance mode, module locks, announcements) that
 *     synchronize across browser tabs via BroadcastChannel/localStorage.
 *   - LAYOUT & ROUTING: renders the header, sidebar navigation, the active
 *     feature view, and the floating AI assistant.
 * ============================================================================
 */
import { useState, useEffect, useRef } from 'react';
import { database, DATABASE_MODE, API_BASE_URL, hasAuthToken, setAuthToken } from './services/database';
import type { ConnectionStatus, CollectionName, PersistResult } from './services/database';
import { 
  Product, 
  Customer, 
  Supplier, 
  Sale, 
  PurchaseOrder, 
  JournalEntry, 
  BusinessProfile,
  User,
  Account,
  Employee,
  Payrun,
  Timesheet,
  TaxRemittance,
  DailyCashUp,
  SoftwareLicense,
  LicenseBillingCycle,
  AdminControlState,
  ControlledModule
} from './types';
import { 
  MOCK_PRODUCTS, 
  MOCK_CUSTOMERS, 
  MOCK_SUPPLIERS, 
  MOCK_JOURNAL_ENTRIES, 
  MOCK_SALES, 
  MOCK_PURCHASE_ORDERS, 
  createJournalEntryForSale, 
  createJournalEntryForPurchase,
  createJournalEntryForCustomerPayment,
  createJournalEntryForSupplierPayment,
  createJournalEntryForCapital,
  createJournalEntryForOpeningStock,
  DEFAULT_ACCOUNTS,
  MOCK_EMPLOYEES,
  createJournalEntryForPayroll,
  validateJournalEntry
} from './utils/accounting';
import { roundMoney } from './utils/money';
import {
  createSession,
  resolveSession,
  hashPassword,
  verifyPassword,
  upgradeLegacyCredential,
  isAdministrator,
  canMutate,
  isHashedCredential,
  defaultTabForRole,
  ROLE_MODULES
} from './utils/auth';
import PayrollView from './components/PayrollView';

import DashboardView from './components/DashboardView';
import POSView from './components/POSView';
import InventoryView from './components/InventoryView';
import AccountingView from './components/AccountingView';
import CRMView from './components/CRMView';
import SettingsView from './components/SettingsView';
import LoginView from './components/LoginView';
import CashUpView from './components/CashUpView';
import AIAgentView from './components/AIAgentView';

import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  Briefcase, 
  Users, 
  Settings, 
  Store,
  Coins,
  LogOut,
  User as UserIcon,
  Sparkles,
  Bot,
  Send,
  LockKeyhole,
  Megaphone,
  Database,
  AlertTriangle
} from 'lucide-react';

const MOCK_USERS: User[] = [
  { id: 'u-admin', username: 'admin', passwordHash: 'admin123', userType: 'ADMIN', fullName: 'Alexandra Admin', isActive: true },
  { id: 'u-cashier', username: 'cashier', passwordHash: 'cashier123', userType: 'CASHIER', fullName: 'Charlie Cashier', isActive: true },
  { id: 'u-general', username: 'general', passwordHash: 'general123', userType: 'GENERAL', fullName: 'Jane General', isActive: true },
  { id: 'u-audit', username: 'audit', passwordHash: 'audit123', userType: 'AUDIT', fullName: 'Arthur Audit', isActive: true }
];

// Storage version bumped to v2 so any previously seeded data is discarded and
// the app starts from a clean, zero database on existing installations too.
const LOCAL_STORAGE_KEY_PREFIX = 'pos_accounting_v2_';
const APPLICATION_NAME = 'Afritecx Badboy';

const DEFAULT_PROFILE: BusinessProfile = {
  name: 'Maboko Dinku Investments',
  address: 'Stand 42, Plumtree Border Post Commercial Centre, Plumtree, Zimbabwe',
  phone: '+263 (19) 456-2342',
  email: 'accounts@mabokodinku.co.zw',
  taxRate: 15, // 15% Standard Zimbabwe VAT/GST
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

/** Builds an active license ending one year after its initial issue date. */
const createDefaultLicense = (): SoftwareLicense => {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  return {
    licenseKey: 'AFRITECX-BADBOY-ANNUAL-DEMO',
    licensedTo: DEFAULT_PROFILE.name,
    billingCycle: 'ANNUAL',
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'ACTIVE'
  };
};

const DEFAULT_ADMIN_CONTROL: AdminControlState = {
  maintenanceMode: false,
  systemLocked: false,
  disabledModules: [],
  announcement: '',
  forceLogoutToken: 0,
  updatedAt: new Date().toISOString()
};



export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pos' | 'inventory' | 'accounting' | 'crm' | 'payroll' | 'cashup' | 'ai' | 'settings'>('dashboard');

  // Core Application States
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(DEFAULT_PROFILE);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payruns, setPayruns] = useState<Payrun[]>([]);
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [taxRemittances, setTaxRemittances] = useState<TaxRemittance[]>([]);
  const [dailyCashUps, setDailyCashUps] = useState<DailyCashUp[]>([]);
  const [softwareLicense, setSoftwareLicense] = useState<SoftwareLicense>(createDefaultLicense);
  const [adminControl, setAdminControl] = useState<AdminControlState>(DEFAULT_ADMIN_CONTROL);

  // --- REAL DATABASE CONNECTION STATE ---
  const [dbStatus, setDbStatus] = useState<ConnectionStatus>(DATABASE_MODE === 'remote' ? 'connecting' : 'local');
  const [dbLastSync, setDbLastSync] = useState<string>('');
  const [dbError, setDbError] = useState<string>('');
  /** Latest write failure, shown as a banner so silent data loss is impossible. */
  const [syncError, setSyncError] = useState<string>('');
  const remoteReadyRef = useRef(false);

  // 1. Initial State Loading from LocalStorage or Seeds
  useEffect(() => {
    const loadState = <T,>(key: string, fallback: T): T => {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY_PREFIX + key);
      return stored ? JSON.parse(stored) : fallback;
    };

    // Migrate older profiles without industry or terminology configuration.
    const loadedProfile = loadState('profile', DEFAULT_PROFILE);
    const patchedProfile: BusinessProfile = {
      ...DEFAULT_PROFILE,
      ...loadedProfile,
      terminology: {
        ...DEFAULT_PROFILE.terminology,
        ...(loadedProfile as Partial<BusinessProfile>).terminology
      }
    };
    setBusinessProfile(patchedProfile);
    saveState('profile', patchedProfile);
    
    // Database Migration Safeguard: Auto-patch old caches lacking storeroomStock or fridgeStock fields
    const loadedProducts = loadState('products', MOCK_PRODUCTS);
    const patchedProducts = loadedProducts.map((p: any) => {
      if (p.storeroomStock === undefined || p.fridgeStock === undefined) {
        // Preserve legacy quantities and make them immediately sellable.
        const legacyTotal = Math.max(0, Number(p.stock) || 0);
        return {
          ...p,
          storeroomStock: 0,
          fridgeStock: legacyTotal,
          stock: legacyTotal
        };
      }
      return p;
    });
    setProducts(patchedProducts);
    saveState('products', patchedProducts);

    setCustomers(loadState('customers', MOCK_CUSTOMERS));
    setSuppliers(loadState('suppliers', MOCK_SUPPLIERS));
    setSales(loadState('sales', MOCK_SALES));
    setPurchaseOrders(loadState('purchase_orders', MOCK_PURCHASE_ORDERS));
    setJournalEntries(loadState('journal_entries', MOCK_JOURNAL_ENTRIES));
    
    // Chart of Accounts Seeding
    const loadedAccounts = loadState('accounts', DEFAULT_ACCOUNTS);
    setAccounts(loadedAccounts);
    
    // User database seeding load. Legacy plain-text credentials are re-hashed
    // with PBKDF2 so no readable password is ever left in storage.
    const loadedUsers = loadState('users', MOCK_USERS);
    (async () => {
      const migrated: User[] = [];
      let changed = false;
      for (const user of loadedUsers) {
        if (isHashedCredential(user.passwordHash)) {
          migrated.push(user);
          continue;
        }
        const upgraded = await upgradeLegacyCredential(user, user.passwordHash);
        if (upgraded) {
          migrated.push(upgraded);
          changed = true;
        } else {
          // Unreadable legacy value: lock the account instead of guessing.
          migrated.push({ ...user, passwordHash: await hashPassword(crypto.randomUUID()) });
          changed = true;
        }
      }
      setUsers(migrated);
      if (changed) saveState('users', migrated);
    })();
    setUsers(loadedUsers);

    // Seeding corporate employees list
    const loadedEmployees = loadState('employees', MOCK_EMPLOYEES);
    setEmployees(loadedEmployees);

    // Seeding payrun registers
    const loadedPayruns = loadState('payruns', []);
    setPayruns(loadedPayruns);

    // Timesheets start empty; staff/managers create their own submissions.
    setTimesheets(loadState('timesheets', []));

    // Seeding Tax Remittances
    setTaxRemittances(loadState('tax_remittances', []));

    // Seeding Daily Shift Close Cash Reconciliations
    setDailyCashUps(loadState('daily_cashups', []));

    // Hydrate software licensing and centralized administration controls.
    setSoftwareLicense(loadState('software_license', createDefaultLicense()));
    setAdminControl(loadState('admin_control', DEFAULT_ADMIN_CONTROL));

    // Restore a session only when its signature still verifies against the
    // user table. There is deliberately no automatic login: previously the app
    // silently signed everyone in as ADMIN on first load.
    const storedSession = localStorage.getItem(LOCAL_STORAGE_KEY_PREFIX + 'active_session');

    // In remote mode the server owns the session, so a cached login is only
    // trusted after the stored bearer token is confirmed against /auth/me.
    // Restoring an unverified session would show a signed-in UI whose writes
    // all fail with 401.
    if (database.isRemote) {
      if (!hasAuthToken()) {
        localStorage.removeItem(LOCAL_STORAGE_KEY_PREFIX + 'active_session');
        setAuthReady(true);
        return;
      }
      database
        .currentUser()
        .then(remoteUser => {
          if (remoteUser) {
            const u = remoteUser as { id: string; username: string; userType: User['userType']; fullName: string; isActive: boolean };
            setCurrentUser({
              id: u.id,
              username: u.username,
              userType: u.userType,
              fullName: u.fullName,
              isActive: u.isActive,
              passwordHash: ''
            });
          } else {
            setAuthToken(null);
            localStorage.removeItem(LOCAL_STORAGE_KEY_PREFIX + 'active_session');
          }
        })
        .catch(() => {
          setAuthToken(null);
          localStorage.removeItem(LOCAL_STORAGE_KEY_PREFIX + 'active_session');
        })
        .finally(() => setAuthReady(true));
      return;
    }

    resolveSession(storedSession, loadedUsers)
      .then(user => {
        if (user) {
          setCurrentUser(user);
        } else if (storedSession) {
          // Forged, expired or revoked — drop it rather than trusting it.
          localStorage.removeItem(LOCAL_STORAGE_KEY_PREFIX + 'active_session');
        }
      })
      .finally(() => setAuthReady(true));
  }, []);

  /**
   * Receives administrator control changes made in another tab on the same
   * hosted deployment. localStorage covers older browsers; BroadcastChannel
   * provides immediate synchronization where supported.
   */
  useEffect(() => {
    const applyIncomingControl = (nextControl: AdminControlState) => {
      const forceLogoutChanged = nextControl.forceLogoutToken !== adminControl.forceLogoutToken;
      setAdminControl(nextControl);
      if (forceLogoutChanged && currentUser?.userType !== 'ADMIN') {
        localStorage.removeItem(LOCAL_STORAGE_KEY_PREFIX + 'active_session');
        setCurrentUser(null);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_STORAGE_KEY_PREFIX + 'admin_control' && event.newValue) {
        applyIncomingControl(JSON.parse(event.newValue));
      }
      if (event.key === LOCAL_STORAGE_KEY_PREFIX + 'software_license' && event.newValue) {
        setSoftwareLicense(JSON.parse(event.newValue));
      }
    };

    window.addEventListener('storage', onStorage);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('afritecx_badboy_admin');
      channel.onmessage = (event) => applyIncomingControl(event.data as AdminControlState);
    } catch {
      channel = null;
    }

    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.close();
    };
  }, [adminControl.forceLogoutToken, currentUser]);

  // 2. LocalStorage Sync helpers
  const saveState = (key: string, data: any) => {
    localStorage.setItem(LOCAL_STORAGE_KEY_PREFIX + key, JSON.stringify(data));
  };

  /**
   * Drops the local session when the server rejects our credentials.
   *
   * Keeping the user "logged in" after a 401 is worse than signing them out:
   * every later edit looks accepted but never reaches the database.
   */
  const handleServerSessionExpired = () => {
    setCurrentUser(null);
    setActiveTab('dashboard');
    localStorage.removeItem(LOCAL_STORAGE_KEY_PREFIX + 'active_session');
    void database.logout();
  };

  /**
   * Mirrors the difference between two collection snapshots to the SQL backend.
   *
   * Writing only the delta (rather than replacing the whole table) is what makes
   * multi-terminal use safe: a cashier's sale is an INSERT, not an overwrite of
   * every other terminal's rows. LocalStorage remains the offline cache, so a
   * network failure never blocks a sale.
   */
  const syncCollection = <T extends Record<string, any>>(
    collection: CollectionName,
    previous: T[],
    next: T[],
    keyField: keyof T = 'id' as keyof T,
    immutable = false
  ) => {
    if (!database.isRemote) return;
    const keyOf = (record: T) => String(record[keyField]);
    const previousByKey = new Map(previous.map(record => [keyOf(record), record]));
    const nextByKey = new Map(next.map(record => [keyOf(record), record]));

    const created = next.filter(record => !previousByKey.has(keyOf(record)));
    const updated = immutable
      ? []
      : next.filter(record => {
          const before = previousByKey.get(keyOf(record));
          return before && JSON.stringify(before) !== JSON.stringify(record);
        });
    const removed = immutable
      ? []
      : previous.filter(record => !nextByKey.has(keyOf(record)));

    void (async () => {
      const results: PersistResult[] = [];
      if (created.length) results.push(await database.insert(collection, created));
      for (const record of updated) {
        results.push(await database.update(collection, keyOf(record), record as Record<string, unknown>));
      }
      for (const record of removed) {
        results.push(await database.remove(collection, keyOf(record)));
      }

      // A reload restores the signed session but not the in-memory bearer
      // token, so the server answers 401. Without this the UI would keep
      // accepting edits that were never persisted, and the till would drift
      // from the books with no warning.
      if (results.some(result => result.unauthenticated)) {
        setSyncError('Your session expired. Sign in again to save changes to the server.');
        handleServerSessionExpired();
        return;
      }
      const failed = results.find(result => !result.ok);
      if (failed) {
        setSyncError(failed.error ?? 'Changes could not be saved to the server.');
      }
    })();
  };

  // State Change Interceptors: update React state, refresh the offline cache,
  // and mirror the delta to the SQL database.
  const updateProducts = (newProds: Product[]) => {
    syncCollection('products', products, newProds);
    setProducts(newProds);
    saveState('products', newProds);
  };

  const updateCustomers = (newCusts: Customer[]) => {
    syncCollection('customers', customers, newCusts);
    setCustomers(newCusts);
    saveState('customers', newCusts);
  };

  const updateSuppliers = (newSupps: Supplier[]) => {
    syncCollection('suppliers', suppliers, newSupps);
    setSuppliers(newSupps);
    saveState('suppliers', newSupps);
  };

  const updateSales = (newSales: Sale[]) => {
    syncCollection('sales', sales, newSales);
    setSales(newSales);
    saveState('sales', newSales);
  };

  const updatePurchaseOrders = (newPOs: PurchaseOrder[]) => {
    syncCollection('purchase_orders', purchaseOrders, newPOs);
    setPurchaseOrders(newPOs);
    saveState('purchase_orders', newPOs);
  };

  /** The ledger is append-only: existing postings are never mutated or deleted. */
  const updateJournalEntries = (newJEs: JournalEntry[]) => {
    syncCollection('journal_entries', journalEntries, newJEs, 'id', true);
    setJournalEntries(newJEs);
    saveState('journal_entries', newJEs);
  };

  const updateProfile = (newProfile: BusinessProfile) => {
    setBusinessProfile(newProfile);
    saveState('profile', newProfile);
  };

  const updateAccounts = (newAccs: Account[]) => {
    syncCollection('accounts', accounts, newAccs, 'code');
    setAccounts(newAccs);
    saveState('accounts', newAccs);
  };

  const handleAddAccount = (newAcc: Account) => {
    if (!requireWriteAccess("add an account")) return;
    const nextAccs = [...accounts, newAcc];
    updateAccounts(nextAccs);
  };

  const handleDeleteAccount = (code: string) => {
    if (!requireWriteAccess("delete an account")) return;
    const nextAccs = accounts.filter(a => a.code !== code);
    updateAccounts(nextAccs);
  };

  const updateEmployees = (newEmps: Employee[]) => {
    syncCollection('employees', employees, newEmps);
    setEmployees(newEmps);
    saveState('employees', newEmps);
  };

  const updatePayruns = (newPRs: Payrun[]) => {
    syncCollection('payruns', payruns, newPRs);
    setPayruns(newPRs);
    saveState('payruns', newPRs);
  };

  const handleAddEmployee = (newEmp: Employee) => {
    if (!requireWriteAccess("add an employee")) return;
    const nextEmps = [...employees, newEmp];
    updateEmployees(nextEmps);
  };

  const handleRunPayroll = (payrun: Payrun) => {
    if (!requireWriteAccess('run payroll')) return;
    // 1. Persist the payrun cycle
    const nextPayruns = [...payruns, payrun];
    updatePayruns(nextPayruns);

    // 2. Publish automatic wages ledger double entry
    const payrollJE = createJournalEntryForPayroll(payrun, payrun.paymentMethod);
    const nextJournalEntries = [...journalEntries, payrollJE];
    updateJournalEntries(nextJournalEntries);
  };

  const updateTimesheets = (newTimesheets: Timesheet[]) => {
    syncCollection('timesheets', timesheets, newTimesheets);
    setTimesheets(newTimesheets);
    saveState('timesheets', newTimesheets);
  };

  const updateTaxRemittances = (newRemittances: TaxRemittance[]) => {
    syncCollection('tax_remittances', taxRemittances, newRemittances);
    setTaxRemittances(newRemittances);
    saveState('tax_remittances', newRemittances);
  };

  const updateDailyCashUps = (newCashUps: DailyCashUp[]) => {
    syncCollection('daily_cashups', dailyCashUps, newCashUps);
    setDailyCashUps(newCashUps);
    saveState('daily_cashups', newCashUps);
  };

  /** Persists an updated commercial software license. */
  const updateSoftwareLicense = (license: SoftwareLicense) => {
    setSoftwareLicense(license);
    saveState('software_license', license);
  };

  /** Synchronizes administrator controls across this installation and open tabs. */
  const updateAdminControl = (control: AdminControlState) => {
    const nextControl = { ...control, updatedAt: new Date().toISOString() };
    setAdminControl(nextControl);
    saveState('admin_control', nextControl);
    try {
      const channel = new BroadcastChannel('afritecx_badboy_admin');
      channel.postMessage(nextControl);
      channel.close();
    } catch {
      // localStorage storage events remain the compatibility fallback.
    }
  };

  /** Activates or renews a license according to the selected billing cycle. */
  const handleActivateLicense = (billingCycle: LicenseBillingCycle, licenseKey: string) => {
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);
    const monthsByCycle: Record<LicenseBillingCycle, number> = {
      MONTHLY: 1,
      QUARTERLY: 3,
      SEMI_ANNUAL: 6,
      ANNUAL: 12
    };
    expiresAt.setMonth(expiresAt.getMonth() + monthsByCycle[billingCycle]);
    updateSoftwareLicense({
      licenseKey: licenseKey.trim() || `AFRITECX-${billingCycle}-${Date.now().toString(36).toUpperCase()}`,
      licensedTo: businessProfile.name,
      billingCycle,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'ACTIVE'
    });
  };

  const handleAddDailyCashUp = (newCashUp: DailyCashUp) => {
    if (!requireWriteAccess("record a cash up")) return;
    const nextCashUps = [...dailyCashUps, newCashUp];
    updateDailyCashUps(nextCashUps);
  };

  const handleUpdateTimesheetStatus = (id: string, status: any) => {
    const nextTimesheets = timesheets.map(ts => {
      if (ts.id === id) {
        return { ...ts, status };
      }
      return ts;
    });
    updateTimesheets(nextTimesheets);
  };

  const handleRemitTax = (amount: number, method: 'CASH' | 'CARD', quarter: string) => {
    if (!requireWriteAccess('remit tax')) return;
    const nextRemit: TaxRemittance = {
      id: `REMIT-${Date.now()}`,
      paymentDate: new Date().toISOString().split('T')[0],
      amount,
      method,
      quarter
    };
    updateTaxRemittances([...taxRemittances, nextRemit]);

    // Create journal entry to Debit Sales Tax Payable (2200) and Credit cash resources
    const je: JournalEntry = {
      id: `JE-REMIT-${nextRemit.id}`,
      date: nextRemit.paymentDate,
      description: `Tax Authority Remittance Payment: ${quarter}`,
      reference: nextRemit.id,
      lines: [
        { accountCode: '2200', type: 'DEBIT', amount: parseFloat(amount.toFixed(2)) },
        { accountCode: method === 'CASH' ? '1010' : '1020', type: 'CREDIT', amount: parseFloat(amount.toFixed(2)) }
      ]
    };
    const nextJournalEntries = [...journalEntries, je];
    updateJournalEntries(nextJournalEntries);
  };

  const updateUsers = (newUsers: User[]) => {
    setUsers(newUsers);
    saveState('users', newUsers);
  };

  // User management database actions
  const handleAddUser = (newUser: User) => {
    const nextUsers = [...users, newUser];
    updateUsers(nextUsers);
  };

  const handleToggleUserStatus = (userId: string) => {
    const nextUsers = users.map(u => {
      if (u.id === userId) {
        return { ...u, isActive: !u.isActive };
      }
      return u;
    });
    updateUsers(nextUsers);
  };

  /**
   * Verifies credentials and returns the authenticated user (or an error).
   *
   * Two modes:
   *   - Remote SQL: the server is the authority; it validates the password
   *     against its PBKDF2 hash and issues a bearer token.
   *   - Local: the password is verified against the PBKDF2 hash stored in the
   *     browser. A successful legacy plain-text login is transparently
   *     upgraded to a hash.
   */
  const handleAuthenticate = async (
    username: string,
    password: string
  ): Promise<{ user?: User; error?: string }> => {
    if (database.isRemote) {
      try {
        const result = await database.login(username, password);
        const remote = result.user as { id: string; username: string; userType: User['userType']; fullName: string; isActive: boolean };
        return {
          user: {
            id: remote.id,
            username: remote.username,
            userType: remote.userType,
            fullName: remote.fullName,
            isActive: remote.isActive,
            passwordHash: ''
          }
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Authentication failed' };
      }
    }

    const found = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!found) return { error: 'Invalid username or password.' };
    if (!found.isActive) return { error: 'This account has been disabled by the administrator.' };

    const ok = await verifyPassword(password, found.passwordHash);
    if (!ok) return { error: 'Invalid username or password.' };

    const upgraded = await upgradeLegacyCredential(found, password);
    if (upgraded) updateUsers(users.map(u => (u.id === upgraded.id ? upgraded : u)));
    return { user: upgraded ?? found };
  };

  /**
   * Starts a session. The persisted value is an HMAC-signed token, not the raw
   * user object, so it cannot be edited to escalate privileges.
   */
  const handleLoginSuccess = async (user: User) => {
    setCurrentUser(user);
    const session = await createSession(user);
    localStorage.setItem(LOCAL_STORAGE_KEY_PREFIX + 'active_session', JSON.stringify(session));
    setActiveTab(defaultTabForRole(user.userType));

    // The startup snapshot runs before a token exists, so it is rejected with
    // 401 and leaves the UI showing empty totals. Pull the real data now that
    // the login has stored a token.
    if (database.isRemote) {
      const snapshot = await database.loadSnapshot();
      if (snapshot) {
        hydrateFromSnapshot(snapshot);
        setDbStatus('connected');
        setDbLastSync(new Date().toLocaleTimeString());
        remoteReadyRef.current = true;
      }
    }
  };

  const handleLogout = async () => {
    setCurrentUser(null);
    localStorage.removeItem(LOCAL_STORAGE_KEY_PREFIX + 'active_session');
    await database.logout();
  };

  /** Returns whether the current license can run business modules. */
  const licenseIsActive = softwareLicense.status === 'ACTIVE'
    && new Date(softwareLicense.expiresAt).getTime() > Date.now();

  /**
   * A module is available when (a) the role is permitted to open it and
   * (b) an administrator has not remotely disabled it. Administrators bypass
   * the remote switch so they can always repair a deployment.
   */
  const isModuleAvailable = (module: ControlledModule) => {
    if (!currentUser) return false;
    const allowed = ROLE_MODULES[currentUser.userType] ?? [];
    if (!allowed.includes(module)) return false;
    return currentUser.userType === 'ADMIN' || !adminControl.disabledModules.includes(module);
  };

  /** Re-routes a session that landed on a tab its role cannot open. */
  useEffect(() => {
    if (!currentUser) return;
    const allowed = ROLE_MODULES[currentUser.userType] ?? [];
    if (!allowed.includes(activeTab)) setActiveTab(defaultTabForRole(currentUser.userType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, activeTab]);

  // --- FLOATING AI HELP CHATBOT STATES & HANDLERS ---
  const [isFloatingAIActive, setIsFloatingAIActive] = useState(false);
  const [floatingChatQuery, setFloatingChatQuery] = useState('');
  const [floatingMessages, setFloatingMessages] = useState<{ id: string; sender: 'AI' | 'USER'; text: string }[]>([
    { id: 'f-init', sender: 'AI', text: 'Hi! I am the Afritecx Badboy AI assistant. Type **"guide"** for a setup walkthrough or ask me about operations and accounting.' }
  ]);

  /**
   * Processes natural language inputs inside the floating chatbot, returning helpful startup steps.
   */
  const handleFloatingSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!floatingChatQuery.trim()) return;

    const userText = floatingChatQuery.trim();
    setFloatingMessages(prev => [...prev, { id: `f-u-${Date.now()}`, sender: 'USER', text: userText }]);
    setFloatingChatQuery('');

    // Simulated latency
    setTimeout(() => {
      let response = '';
      const query = userText.toLowerCase();

      if (query.includes('guide') || query.includes('start') || query.includes('how to')) {
        response = `### 🚀 Afritecx Badboy Quick Guide\n1. Open **Settings Admin** to select an industry preset and customize terminology.\n2. Go to **Checkout POS**, select ${businessProfile.terminology.itemLabel.toLowerCase()} records, and complete a transaction.\n3. Receive supply orders into **${businessProfile.terminology.primaryStockLabel}** and transfer available quantities into **${businessProfile.terminology.secondaryStockLabel}**.\n4. Process staff salary runs inside **Wages & Payroll**.\n5. Audit general ledger logs inside **General Bookkeeping**.`;
      } else if (query.includes('accounting') || query.includes('ledger') || query.includes('double')) {
        response = `### 📊 Double-Entry Rules\n*   **Sales**: Debit Cash Drawer (1010), Credit Sales Revenue (4010) and Sales Tax Payable (2200). Deduct stock from Inventory (1200) to COGS (5010).\n*   **Restocks**: Debit Inventory (1200), Credit AP (2010).\n*   Identity matches: **Assets = Liabilities + Equity**.`;
      } else {
        response = `I am researching the database for: "${userText}". Type **"guide"** for a full walkthrough, or ask about double-entry rules.`;
      }

      setFloatingMessages(prev => [...prev, { id: `f-ai-${Date.now()}`, sender: 'AI', text: response }]);
    }, 600);
  };

  /**
   * Central write guard.
   *
   * Every mutating handler calls this first. AUDIT sessions are read-only, and
   * a missing session is refused outright. The SQL server repeats the same check
   * server-side (see `authorize()` in server/index.mjs), so bypassing the UI
   * does not bypass the rule.
   */
  const requireWriteAccess = (action: string): boolean => {
    if (!currentUser) {
      alert('You must sign in before making changes.');
      return false;
    }
    if (!canMutate(currentUser)) {
      alert(`Read-only ${currentUser.userType} sessions cannot ${action}.`);
      return false;
    }
    return true;
  };

  /** Only administrators may manage users, licensing and destructive actions. */
  const requireAdministrator = (action: string): boolean => {
    if (!isAdministrator(currentUser)) {
      alert(`Only an administrator can ${action}.`);
      return false;
    }
    return true;
  };

  // 3. CORE COORDINATED LEDGER METHODS (THE ACCOUNTING GLUE)

  // A. Checkout a sale from the POS terminal
  const handleAddSale = (sale: Sale) => {
    if (!requireWriteAccess('record a sale')) return;

    // Build and validate the posting *before* committing the sale, so a
    // rounding defect can never leave a sale recorded without its ledger entry.
    const saleJournalEntry = createJournalEntryForSale(sale);
    const problem = validateJournalEntry(saleJournalEntry);
    if (problem) {
      alert(`Sale could not be posted to the ledger: ${problem}`);
      return;
    }

    updateSales([...sales, sale]);
    updateJournalEntries([...journalEntries, saleJournalEntry]);
  };

  /**
   * Atomically deducts all POS cart lines so multi-item sales cannot overwrite
   * one another. Model A uses secondary stock only; Model B falls back to the
   * primary location when the secondary location cannot cover the sale.
   */
  const handleUpdateProductStock = (
    saleItems: { productId: string; quantity: number }[],
    mode: 'SECONDARY_ONLY' | 'AUTO_FALLBACK'
  ) => {
    const quantities = new Map(saleItems.map(item => [item.productId, item.quantity]));

    const nextProducts = products.map(product => {
      const quantity = quantities.get(product.id);
      if (!quantity) return product;

      let primary = Number.isFinite(product.storeroomStock) ? product.storeroomStock : 0;
      let secondary = Number.isFinite(product.fridgeStock) ? product.fridgeStock : product.stock;

      if (mode === 'SECONDARY_ONLY') {
        secondary = Math.max(0, secondary - quantity);
      } else {
        const fromSecondary = Math.min(secondary, quantity);
        secondary -= fromSecondary;
        const remainder = quantity - fromSecondary;
        primary = Math.max(0, primary - remainder);
      }

      return {
        ...product,
        storeroomStock: primary,
        fridgeStock: secondary,
        stock: primary + secondary
      };
    });

    updateProducts(nextProducts);
  };

  // Transfer stock from Storeroom bulk storage into cold ready-to-sell Fridges
  const handleTransferStock = (productId: string, quantityToTransfer: number) => {
    if (!requireWriteAccess("transfer stock")) return;
    const nextProducts = products.map(p => {
      if (p.id === productId) {
        const actualTransfer = Math.min(p.storeroomStock, quantityToTransfer);
        const nextStore = p.storeroomStock - actualTransfer;
        const nextFridge = p.fridgeStock + actualTransfer;
        return {
          ...p,
          storeroomStock: nextStore,
          fridgeStock: nextFridge,
          stock: nextStore + nextFridge
        };
      }
      return p;
    });
    updateProducts(nextProducts);
  };

  // C. Charge / credit store credit directly (Outstanding debt A/R)
  const handleAdjustCustomerCredit = (customerId: string, amountToDeduct: number) => {
    if (!requireWriteAccess('adjust customer credit')) return;
    const nextCustomers = customers.map(c => {
      if (c.id === customerId) {
        // e.g. outstanding debt means storeCredit decreases (goes further negative)
        return { ...c, storeCredit: parseFloat((c.storeCredit + amountToDeduct).toFixed(2)) };
      }
      return c;
    });
    updateCustomers(nextCustomers);
  };

  // D. Create custom manual Customer Addition
  const handleAddCustomer = (customer: Customer) => {
    if (!requireWriteAccess("add a customer")) return;
    const nextCustomers = [...customers, customer];
    updateCustomers(nextCustomers);
  };

  // E. Process Supplier Purchase Order
  const handleAddPurchaseOrder = (po: PurchaseOrder) => {
    if (!requireWriteAccess("record a purchase order")) return;
    // 1. Record PO in historical list
    const nextPOs = [...purchaseOrders, po];
    updatePurchaseOrders(nextPOs);

    // 2. Generate and append automatic Purchase Book Ledger journal entry
    const poJournalEntry = createJournalEntryForPurchase(po);
    const nextJournalEntries = [...journalEntries, poJournalEntry];
    updateJournalEntries(nextJournalEntries);

    // 3. Increase products physical stock counts (Adds to Storeroom bulk storage)
    const nextProducts = products.map(prod => {
      const orderItem = po.items.find(item => item.productId === prod.id);
      if (orderItem) {
        const nextStore = prod.storeroomStock + orderItem.quantity;
        return { 
          ...prod, 
          storeroomStock: nextStore,
          stock: nextStore + prod.fridgeStock
        };
      }
      return prod;
    });
    updateProducts(nextProducts);

    // 4. Update Accounts Payable owed to Supplier if purchased on credit
    if (po.paymentMethod === 'ACCOUNTS_PAYABLE') {
      const nextSuppliers = suppliers.map(s => {
        if (s.id === po.supplierId) {
          return { ...s, balanceOwed: parseFloat((s.balanceOwed + po.total).toFixed(2)) };
        }
        return s;
      });
      updateSuppliers(nextSuppliers);
    }
  };

  // F. Receive customer cash to pay off store credit debt (Increments cash/bank, credits AR)
  const handleReceiveCustomerPayment = (customerId: string, amount: number, method: 'CASH' | 'CARD') => {
    if (!requireWriteAccess('receive a customer payment')) return;
    const cust = customers.find(c => c.id === customerId);
    if (!cust) return;

    const rounded = roundMoney(amount);
    if (rounded <= 0) {
      alert('Enter a payment amount greater than zero.');
      return;
    }
    // Paying more than the debt would push store credit positive, i.e. the shop
    // owing the customer, with no ledger entry to explain the difference.
    const owed = Math.abs(Math.min(0, cust.storeCredit));
    if (rounded > owed) {
      alert(`${cust.name} only owes ${owed.toFixed(2)}. Reduce the payment to that amount.`);
      return;
    }

    const nextCustomers = customers.map(c => {
      if (c.id === customerId) {
        return { ...c, storeCredit: parseFloat((c.storeCredit + amount).toFixed(2)) };
      }
      return c;
    });
    updateCustomers(nextCustomers);

    // 2. Create and post matching accounting Journal Entry (Debit: Cash/Bank; Credit: AR)
    const paymentId = `CUSTPMT-${Date.now()}`;
    const je = createJournalEntryForCustomerPayment(
      paymentId, 
      new Date().toISOString().split('T')[0], 
      cust.name, 
      amount, 
      method
    );
    const nextJournalEntries = [...journalEntries, je];
    updateJournalEntries(nextJournalEntries);
  };

  // G. Record payout check to Wholesaler supplier (Decrements cash/bank, debits AP)
  const handlePaySupplier = (supplierId: string, amount: number, method: 'CASH' | 'CARD') => {
    if (!requireWriteAccess('pay a supplier')) return;
    const supp = suppliers.find(s => s.id === supplierId);
    if (!supp) return;

    const rounded = roundMoney(amount);
    if (rounded <= 0) {
      alert('Enter a payment amount greater than zero.');
      return;
    }
    if (rounded > roundMoney(supp.balanceOwed)) {
      alert(`Only ${supp.balanceOwed.toFixed(2)} is owed to ${supp.name}. Reduce the payment to that amount.`);
      return;
    }

    const nextSuppliers = suppliers.map(s => {
      if (s.id === supplierId) {
        return { ...s, balanceOwed: parseFloat((s.balanceOwed - amount).toFixed(2)) };
      }
      return s;
    });
    updateSuppliers(nextSuppliers);

    // 2. Post corresponding journal entry
    const paymentId = `SUPPMT-${Date.now()}`;
    const je = createJournalEntryForSupplierPayment(
      paymentId,
      new Date().toISOString().split('T')[0],
      supp.name,
      amount,
      method
    );
    const nextJournalEntries = [...journalEntries, je];
    updateJournalEntries(nextJournalEntries);
  };

  // H. Save custom products manually from inventory catalog
  /**
   * Adds a product and posts its opening stock to the ledger.
   *
   * Without the opening entry, the first sale credits Inventory (1200) for goods
   * that were never debited into it, which drives the asset negative and makes
   * the balance sheet disagree with the stock on hand.
   */
  const handleAddProduct = (product: Product) => {
    if (!requireWriteAccess('add a product')) return;

    updateProducts([...products, product]);

    const openingEntry = createJournalEntryForOpeningStock(
      `PROD-${product.id}`,
      new Date().toISOString().split('T')[0],
      [{ name: product.name, quantity: product.stock, costPrice: product.costPrice }]
    );
    if (openingEntry && !validateJournalEntry(openingEntry)) {
      updateJournalEntries([...journalEntries, openingEntry]);
    }
  };

  const handleUpdateProduct = (product: Product) => {
    if (!requireWriteAccess('update a product')) return;

    const previous = products.find(p => p.id === product.id);
    updateProducts(products.map(p => (p.id === product.id ? product : p)));

    // Stock added through an edit is still stock: capitalise the increase so
    // inventory value tracks the quantities the POS will sell from.
    const addedUnits = previous ? Math.max(0, product.stock - previous.stock) : 0;
    if (addedUnits > 0) {
      const openingEntry = createJournalEntryForOpeningStock(
        `ADJ-${product.id}-${Date.now()}`,
        new Date().toISOString().split('T')[0],
        [{ name: product.name, quantity: addedUnits, costPrice: product.costPrice }]
      );
      if (openingEntry && !validateJournalEntry(openingEntry)) {
        updateJournalEntries([...journalEntries, openingEntry]);
      }
    }
  };

  /**
   * Loads a small, industry-neutral starter catalogue so a brand-new (zeroed)
   * database can process a sale immediately. Half of each item's stock is
   * placed in the sellable secondary location so both POS stock models work.
   */
  const handleSeedStarterCatalogue = () => {
    if (currentUser?.userType === 'AUDIT') {
      alert('Read-only Audit users cannot modify the catalogue.');
      return;
    }
    if (products.length > 0) {
      alert('Your catalogue already contains products. Delete them first if you want to reload samples.');
      return;
    }

    const samples = [
      { name: 'Standard Item', sku: 'SKU-001', category: 'General', price: 25, costPrice: 15, qty: 60, emoji: '📦' },
      { name: 'Premium Item', sku: 'SKU-002', category: 'General', price: 60, costPrice: 38, qty: 40, emoji: '⭐' },
      { name: 'Value Pack', sku: 'SKU-003', category: 'General', price: 15, costPrice: 8, qty: 80, emoji: '🎁' },
      { name: 'Add-on Service', sku: 'SKU-004', category: 'Services', price: 20, costPrice: 5, qty: 100, emoji: '🛠️' },
      { name: 'Accessory', sku: 'SKU-005', category: 'Accessories', price: 12, costPrice: 6, qty: 50, emoji: '🎒' },
      { name: 'Seasonal Special', sku: 'SKU-006', category: 'General', price: 35, costPrice: 20, qty: 30, emoji: '🎉' }
    ];

    const starter: Product[] = samples.map((s, index) => {
      const fridge = Math.floor(s.qty / 2);
      return {
        id: `starter-${Date.now()}-${index}`,
        name: s.name,
        sku: s.sku,
        category: s.category,
        price: s.price,
        costPrice: s.costPrice,
        storeroomStock: s.qty - fridge,
        fridgeStock: fridge,
        stock: s.qty,
        minStock: 10,
        barcode: `90000000${index + 1}`,
        image: s.emoji
      };
    });

    updateProducts(starter);

    const openingEntry = createJournalEntryForOpeningStock(
      `SEED-${Date.now()}`,
      new Date().toISOString().split('T')[0],
      starter.map(item => ({ name: item.name, quantity: item.stock, costPrice: item.costPrice }))
    );
    if (openingEntry && !validateJournalEntry(openingEntry)) {
      updateJournalEntries([...journalEntries, openingEntry]);
    }

    alert(`Starter catalogue loaded (${starter.length} products). You can now add them to the cart and complete a sale.`);
  };

  // I. Add Custom Manual Ledger Postings
  const handleAddManualJournalEntry = (entry: JournalEntry) => {
    if (!requireWriteAccess('post a journal entry')) return;

    const problem = validateJournalEntry(entry);
    if (problem) {
      alert(`Journal entry rejected: ${problem}`);
      return;
    }
    updateJournalEntries([...journalEntries, entry]);
  };

  // J. Inject Owner Equity Capital Investment
  const handleInjectCapital = (amount: number, accountCode: '1010' | '1020') => {
    if (!requireWriteAccess("inject capital")) return;
    const id = `CAP-${Date.now()}`;
    const je = createJournalEntryForCapital(
      id,
      new Date().toISOString().split('T')[0],
      `Owner Cash Capital Injection`,
      amount,
      accountCode
    );
    const nextJournalEntries = [...journalEntries, je];
    updateJournalEntries(nextJournalEntries);
  };

  /**
   * Overwrites the complete local storage and React states with an imported JSON database backup file.
   * This facilitates restoring backups, importing pre-configured inventory, or cloning across clients.
   */
  const handleImportDatabase = (importedData: any) => {
    if (!requireAdministrator('import a database backup')) return;
    try {
      if (!importedData || typeof importedData !== 'object') {
        throw new Error('Invalid database format.');
      }

      // 1. Update Profile & Store configurations
      if (importedData.businessProfile) {
        updateProfile({
          ...DEFAULT_PROFILE,
          ...importedData.businessProfile,
          terminology: {
            ...DEFAULT_PROFILE.terminology,
            ...(importedData.businessProfile.terminology ?? {})
          }
        });
      }

      // 2. Overwrite other state components
      if (Array.isArray(importedData.products)) {
        updateProducts(importedData.products);
      }
      if (Array.isArray(importedData.customers)) {
        updateCustomers(importedData.customers);
      }
      if (Array.isArray(importedData.suppliers)) {
        updateSuppliers(importedData.suppliers);
      }
      if (Array.isArray(importedData.sales)) {
        updateSales(importedData.sales);
      }
      if (Array.isArray(importedData.purchaseOrders)) {
        updatePurchaseOrders(importedData.purchaseOrders);
      }
      if (Array.isArray(importedData.journalEntries)) {
        updateJournalEntries(importedData.journalEntries);
      }
      if (Array.isArray(importedData.users)) {
        updateUsers(importedData.users);
      }
      if (Array.isArray(importedData.accounts)) {
        updateAccounts(importedData.accounts);
      }
      if (Array.isArray(importedData.employees)) {
        updateEmployees(importedData.employees);
      }
      if (Array.isArray(importedData.payruns)) {
        updatePayruns(importedData.payruns);
      }
      if (Array.isArray(importedData.timesheets)) {
        updateTimesheets(importedData.timesheets);
      }
      if (Array.isArray(importedData.taxRemittances)) {
        updateTaxRemittances(importedData.taxRemittances);
      }
      if (Array.isArray(importedData.dailyCashUps)) {
        updateDailyCashUps(importedData.dailyCashUps);
      }
      if (importedData.softwareLicense) {
        updateSoftwareLicense(importedData.softwareLicense);
      }
      if (importedData.adminControl) {
        updateAdminControl(importedData.adminControl);
      }

      alert('Database import completed successfully! All ledger accounts, inventory levels, sales records, and user sessions have been restored.');
      setActiveTab('dashboard');
    } catch (err: any) {
      alert(`Database Restore Error: ${err.message || err}`);
    }
  };

  /** Rehydrates all application state from a server snapshot. */
  const hydrateFromSnapshot = (snapshot: Record<string, any>) => {
    if (snapshot.profile) {
      setBusinessProfile({
        ...DEFAULT_PROFILE,
        ...snapshot.profile,
        terminology: { ...DEFAULT_PROFILE.terminology, ...(snapshot.profile.terminology ?? {}) }
      });
    }
    if (Array.isArray(snapshot.products)) setProducts(snapshot.products);
    if (Array.isArray(snapshot.customers)) setCustomers(snapshot.customers);
    if (Array.isArray(snapshot.suppliers)) setSuppliers(snapshot.suppliers);
    if (Array.isArray(snapshot.sales)) setSales(snapshot.sales);
    if (Array.isArray(snapshot.purchase_orders)) setPurchaseOrders(snapshot.purchase_orders);
    if (Array.isArray(snapshot.journal_entries)) setJournalEntries(snapshot.journal_entries);
    if (Array.isArray(snapshot.users)) setUsers(snapshot.users);
    if (Array.isArray(snapshot.accounts)) setAccounts(snapshot.accounts);
    if (Array.isArray(snapshot.employees)) setEmployees(snapshot.employees);
    if (Array.isArray(snapshot.payruns)) setPayruns(snapshot.payruns);
    if (Array.isArray(snapshot.timesheets)) setTimesheets(snapshot.timesheets);
    if (Array.isArray(snapshot.tax_remittances)) setTaxRemittances(snapshot.tax_remittances);
    if (Array.isArray(snapshot.daily_cashups)) setDailyCashUps(snapshot.daily_cashups);
    if (snapshot.software_license) setSoftwareLicense(snapshot.software_license);
    if (snapshot.admin_control) setAdminControl(snapshot.admin_control);
  };

  /**
   * On startup, pull the authoritative snapshot from the real database server
   * (when VITE_API_BASE_URL is configured). If the server is unreachable the
   * app keeps running from the local cache and shows an error status.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!database.isRemote) {
        setDbStatus('local');
        remoteReadyRef.current = true;
        return;
      }
      setDbStatus('connecting');
      const snapshot = await database.loadSnapshot();
      if (cancelled) return;
      if (snapshot) {
        hydrateFromSnapshot(snapshot);
        setDbStatus('connected');
        setDbLastSync(new Date().toLocaleTimeString());
      } else {
        const online = await database.healthCheck();
        if (cancelled) return;
        setDbStatus(online ? 'connected' : 'error');
        if (!online) setDbError('Database server unreachable — running from local cache.');
      }
      remoteReadyRef.current = true;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Debounced write-through sync of the *singleton* documents. Collections are
   * no longer pushed as a blob: every record is written at the point of
   * creation through `persist*` helpers below, which prevents one till from
   * overwriting another's sales with a stale snapshot.
   */
  useEffect(() => {
    if (!database.isRemote || !remoteReadyRef.current) return;
    const timer = setTimeout(async () => {
      const results = await Promise.all([
        database.saveSingleton('profile', businessProfile),
        database.saveSingleton('software_license', softwareLicense),
        database.saveSingleton('admin_control', adminControl)
      ]);
      const failed = results.find(result => !result.ok);
      if (failed) {
        setDbStatus('error');
        setDbError(failed.error ?? 'Sync failed');
      } else {
        setDbStatus('connected');
        setDbLastSync(new Date().toLocaleTimeString());
        setDbError('');
      }
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessProfile, softwareLicense, adminControl]);

  /** Allows the Settings screen to re-test the configured connection. */
  const handleTestDatabaseConnection = async () => {
    if (!database.isRemote) {
      alert('No remote database is configured. Add VITE_API_BASE_URL to your environment to connect a real server.');
      return;
    }
    setDbStatus('connecting');
    const online = await database.healthCheck();
    setDbStatus(online ? 'connected' : 'error');
    setDbError(online ? '' : 'Connection test failed. Check the API URL and server status.');
    alert(online ? 'Connected to the database server successfully.' : 'Could not reach the database server.');
  };

  /**
   * Factory reset (demo restore).
   *
   * Only administrators may run it, the action is confirmed, and it clears just
   * this application's keys rather than every key on the origin (the old
   * `localStorage.clear()` also destroyed unrelated apps' data on the host).
   */
  const handleResetDatabase = async () => {
    if (!requireAdministrator('reset the database')) return;
    if (!window.confirm('This deletes all products, sales, ledger entries and users on this installation. Continue?')) {
      return;
    }

    Object.keys(localStorage)
      .filter(key => key.startsWith(LOCAL_STORAGE_KEY_PREFIX))
      .forEach(key => localStorage.removeItem(key));

    setBusinessProfile(DEFAULT_PROFILE);
    setProducts(MOCK_PRODUCTS);
    setCustomers(MOCK_CUSTOMERS);
    setSuppliers(MOCK_SUPPLIERS);
    setSales(MOCK_SALES);
    setPurchaseOrders(MOCK_PURCHASE_ORDERS);
    setJournalEntries(MOCK_JOURNAL_ENTRIES);
    setAccounts(DEFAULT_ACCOUNTS);
    setEmployees(MOCK_EMPLOYEES);
    setPayruns([]);
    setTimesheets([]);
    setTaxRemittances([]);
    setDailyCashUps([]);
    setActiveTab('dashboard');

    // Wipe the server tables too, so a reset cannot be undone by the next sync.
    if (database.isRemote) await database.reset();
  };

  // Hold the shell until the stored session has been verified, otherwise the
  // login screen flashes for already-authenticated users.
  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <span className="text-xs font-bold uppercase tracking-widest">Restoring session…</span>
      </div>
    );
  }

  if (currentUser === null) {
    return (
      <LoginView
        users={users}
        onLoginSuccess={handleLoginSuccess}
        onAuthenticate={handleAuthenticate}
      />
    );
  }

  const deploymentBlocked = currentUser.userType !== 'ADMIN' && (
    !licenseIsActive || adminControl.systemLocked || adminControl.maintenanceMode
  );

  if (deploymentBlocked) {
    const reason = !licenseIsActive
      ? 'This Afritecx Badboy license is expired or suspended.'
      : adminControl.systemLocked
        ? 'The administrator has remotely locked this deployment.'
        : 'The deployment is currently in maintenance mode.';
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <LockKeyhole size={32} className="mx-auto mb-4 text-amber-400" />
          <h1 className="text-lg font-black uppercase tracking-wider">Afritecx Badboy Access Restricted</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">{reason}</p>
          {adminControl.announcement && (
            <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs font-semibold text-amber-200">
              {adminControl.announcement}
            </p>
          )}
          <button onClick={handleLogout} className="mt-6 rounded-xl bg-teal-600 px-5 py-2.5 text-xs font-bold">
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans antialiased animate-fade-in">
      
      {/* 1. TOP HEADER BRAND BAR */}
      <header className="bg-slate-900 text-white shadow-md px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-teal-600 p-2 rounded-xl text-white shadow shadow-teal-500/20">
            <Store size={22} className="stroke-[2.2]" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-wide uppercase">{APPLICATION_NAME}</h1>
            <p className="text-[10px] text-teal-400 font-bold flex items-center gap-1">
              <Coins size={12} /> {businessProfile.name} · {businessProfile.businessType.replace(/_/g, ' ')}
            </p>
          </div>
        </div>

        {/* Session details, database status, Role, and LogOut panel */}
        <div className="flex items-center gap-4.5">
          <div
            className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold sm:flex ${
              dbStatus === 'connected'
                ? 'border-teal-500/30 bg-teal-500/10 text-teal-300'
                : dbStatus === 'error'
                  ? 'border-red-500/30 bg-red-500/10 text-red-300'
                  : 'border-slate-600 bg-slate-800 text-slate-300'
            }`}
            title={dbError || (database.isRemote ? API_BASE_URL : 'Browser localStorage')}
          >
            <Database size={12} />
            {dbStatus === 'connected' ? 'Server Connected' : dbStatus === 'error' ? 'Sync Error' : dbStatus === 'connecting' ? 'Connecting…' : 'Local DB'}
            {dbLastSync && dbStatus === 'connected' && <span className="text-teal-400/70">· {dbLastSync}</span>}
          </div>
          <div className="hidden sm:flex flex-col items-end text-xs">
            <span className="font-bold text-gray-200 flex items-center gap-1">
              <UserIcon size={12} className="text-teal-400" /> {currentUser.fullName}
            </span>
            <span className="text-[9px] text-teal-400 uppercase font-black tracking-wider bg-teal-500/10 px-1.5 py-0.5 rounded-md mt-0.5 border border-teal-500/20">
              Role: {currentUser.userType}
            </span>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden sm:block"></div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-red-900/30 text-gray-300 hover:text-red-400 border border-slate-700 hover:border-red-500/20 py-1.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <LogOut size={13} /> Logout
          </button>
        </div>
      </header>

      {adminControl.announcement && (
        <div className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
          <Megaphone size={13} /> {adminControl.announcement}
        </div>
      )}

      {/* 2. BODY LAYOUT: LEFT SIDEBAR NAVIGATION + RIGHT SCREEN CONTAINER */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* SIDEBAR NAVIGATION PANEL */}
        <nav className="w-full md:w-64 bg-slate-800 text-gray-300 flex flex-row md:flex-col justify-around md:justify-start gap-1 p-2 md:p-4 border-r border-slate-700/50 overflow-x-auto md:overflow-x-visible shrink-0">
          
          <div className="hidden md:block mb-5 px-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Main Menu</span>
            <div className="border-b border-slate-700/40 mt-1"></div>
          </div>

          {/* Analytics (Locked for Cashiers) */}
          {currentUser.userType !== 'CASHIER' && (
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide w-full transition-all cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-teal-600 text-white shadow-md shadow-teal-600/10'
                  : 'hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <LayoutDashboard size={16} /> <span className="hidden sm:inline">Analytics Panel</span>
            </button>
          )}

          {/* POS Terminal */}
          <button
            onClick={() => setActiveTab('pos')}
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide w-full transition-all cursor-pointer ${
              activeTab === 'pos'
                ? 'bg-teal-600 text-white shadow-md shadow-teal-600/10'
                : 'hover:bg-slate-700/50 hover:text-white'
            }`}
          >
            <ShoppingCart size={16} /> <span className="hidden sm:inline">Checkout POS</span>
          </button>

          {/* Inventory restocking (Locked for Cashiers/Audit) */}
          {(currentUser.userType === 'ADMIN' || currentUser.userType === 'GENERAL') && (
            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide w-full transition-all cursor-pointer ${
                activeTab === 'inventory'
                  ? 'bg-teal-600 text-white shadow-md shadow-teal-600/10'
                  : 'hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <Package size={16} /> <span className="hidden sm:inline">Stocks & Supply</span>
            </button>
          )}

          {/* CRM Accounts */}
          <button
            onClick={() => setActiveTab('crm')}
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide w-full transition-all cursor-pointer ${
              activeTab === 'crm'
                ? 'bg-teal-600 text-white shadow-md shadow-teal-600/10'
                : 'hover:bg-slate-700/50 hover:text-white'
            }`}
          >
            <Users size={16} /> <span className="hidden sm:inline">CRM & Wholesalers</span>
          </button>

          {/* Bookkeeping (Locked for Cashiers) */}
          {currentUser.userType !== 'CASHIER' && (
            <button
              onClick={() => setActiveTab('accounting')}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide w-full transition-all cursor-pointer ${
                activeTab === 'accounting'
                  ? 'bg-teal-600 text-white shadow-md shadow-teal-600/10'
                  : 'hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <Briefcase size={16} /> <span className="hidden sm:inline">General Bookkeeping</span>
            </button>
          )}

          {/* Wages & Payroll (Locked for Cashiers) */}
          {currentUser.userType !== 'CASHIER' && (
            <button
              onClick={() => setActiveTab('payroll')}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide w-full transition-all cursor-pointer ${
                activeTab === 'payroll'
                  ? 'bg-teal-600 text-white shadow-md shadow-teal-600/10'
                  : 'hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <Users size={16} /> <span className="hidden sm:inline">Wages & Payroll</span>
            </button>
          )}

          {/* Close Shift & Cash Up */}
          <button
            onClick={() => setActiveTab('cashup')}
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide w-full transition-all cursor-pointer ${
              activeTab === 'cashup'
                ? 'bg-teal-600 text-white shadow-md shadow-teal-600/10'
                : 'hover:bg-slate-700/50 hover:text-white'
            }`}
          >
            <Coins size={16} /> <span className="hidden sm:inline">Close Shift (Cash Up)</span>
          </button>

          {/* Afritecx Badboy AI Business Agent */}
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide w-full transition-all cursor-pointer ${
              activeTab === 'ai'
                ? 'bg-teal-600 text-white shadow-md shadow-teal-600/10'
                : 'hover:bg-slate-700/50 hover:text-white'
            }`}
          >
            <Sparkles size={16} className="text-teal-400" /> <span className="hidden sm:inline">Afritecx AI Agent</span>
          </button>

          <div className="hidden md:block my-4 px-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">System Panel</span>
            <div className="border-b border-slate-700/40 mt-1"></div>
          </div>

          {isModuleAvailable('settings') && (
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold tracking-wide w-full transition-all cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-teal-600 text-white shadow-md shadow-teal-600/10'
                  : 'hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <Settings size={16} /> <span className="hidden sm:inline">{currentUser.userType === 'AUDIT' ? 'Configuration Audit' : 'Settings Admin'}</span>
            </button>
          )}
        </nav>

        {/* MAIN VIEWPORT WINDOW */}
        <main className="flex min-h-0 flex-1 flex-col justify-start overflow-y-auto p-4 animate-fade-in md:p-6 lg:overflow-hidden">
          {/*
            A failed write must never be silent: the POS would keep taking sales
            that never reach the SQL database. The banner stays until the next
            successful sync or an explicit dismissal.
          */}
          {syncError && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 print:hidden">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{syncError}</span>
              <button
                type="button"
                onClick={() => setSyncError('')}
                className="rounded-md px-1.5 text-rose-300 transition hover:bg-rose-500/20 hover:text-white"
                aria-label="Dismiss sync error"
              >
                ✕
              </button>
            </div>
          )}

          {activeTab !== 'settings' && !isModuleAvailable(activeTab as ControlledModule) && (
            <div className="flex h-full items-center justify-center rounded-2xl border border-amber-100 bg-amber-50 p-8 text-center">
              <div>
                <LockKeyhole size={28} className="mx-auto mb-3 text-amber-600" />
                <h2 className="text-sm font-black uppercase text-amber-900">Module Disabled</h2>
                <p className="mt-1 text-xs text-amber-700">An administrator disabled this module from the control center.</p>
              </div>
            </div>
          )}
          
          {activeTab === 'dashboard' && isModuleAvailable('dashboard') && (<DashboardView
              sales={sales}
              journalEntries={journalEntries}
              products={products}
              customers={customers}
              suppliers={suppliers}
              businessProfile={businessProfile}
              onNavigate={(tab) => setActiveTab(tab)}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'pos' && isModuleAvailable('pos') && (
            <POSView
              products={products}
              customers={customers}
              businessProfile={businessProfile}
              onAddSale={handleAddSale}
              onAddCustomer={handleAddCustomer}
              onUpdateProductStock={handleUpdateProductStock}
              onAdjustCustomerCredit={handleAdjustCustomerCredit}
              currentUser={currentUser}
              onSeedStarterCatalogue={handleSeedStarterCatalogue}
            />
          )}

          {activeTab === 'inventory' && isModuleAvailable('inventory') && (<InventoryView
              products={products}
              suppliers={suppliers}
              businessProfile={businessProfile}
              onAddProduct={handleAddProduct}
              onUpdateProduct={handleUpdateProduct}
              onAddPurchaseOrder={handleAddPurchaseOrder}
              currentUser={currentUser}
              onTransferStock={handleTransferStock}
            />
          )}

          {activeTab === 'crm' && isModuleAvailable('crm') && (
            <CRMView
              customers={customers}
              suppliers={suppliers}
              businessProfile={businessProfile}
              onReceiveCustomerPayment={handleReceiveCustomerPayment}
              onPaySupplier={handlePaySupplier}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'accounting' && isModuleAvailable('accounting') && (<AccountingView
              journalEntries={journalEntries}
              businessProfile={businessProfile}
              onAddManualJournalEntry={handleAddManualJournalEntry}
              sales={sales}
              purchaseOrders={purchaseOrders}
              accounts={accounts}
              onAddAccount={handleAddAccount}
              onDeleteAccount={handleDeleteAccount}
              customers={customers}
              suppliers={suppliers}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'payroll' && isModuleAvailable('payroll') && (<PayrollView
              employees={employees}
              payruns={payruns}
              businessProfile={businessProfile}
              onAddEmployee={handleAddEmployee}
              onRunPayroll={handleRunPayroll}
              timesheets={timesheets}
              onUpdateTimesheetStatus={handleUpdateTimesheetStatus}
              taxRemittances={taxRemittances}
              onRemitTax={handleRemitTax}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'cashup' && isModuleAvailable('cashup') && (
            <CashUpView
              sales={sales}
              journalEntries={journalEntries}
              businessProfile={businessProfile}
              accounts={accounts}
              onAddManualJournalEntry={handleAddManualJournalEntry}
              dailyCashUps={dailyCashUps}
              onAddDailyCashUp={handleAddDailyCashUp}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'ai' && isModuleAvailable('ai') && (
            <AIAgentView
              products={products}
              suppliers={suppliers}
              accounts={accounts}
              currentUser={currentUser}
              onAddPurchaseOrder={handleAddPurchaseOrder}
              onAddManualJournalEntry={handleAddManualJournalEntry}
              businessProfile={businessProfile}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              businessProfile={businessProfile}
              onUpdateProfile={updateProfile}
              onResetDatabase={handleResetDatabase}
              onInjectCapital={handleInjectCapital}
              users={users}
              onAddUser={handleAddUser}
              onToggleUserStatus={handleToggleUserStatus}
              currentUser={currentUser}
              // Database export, backup, import, and cloning variables
              products={products}
              customers={customers}
              suppliers={suppliers}
              sales={sales}
              purchaseOrders={purchaseOrders}
              journalEntries={journalEntries}
              accounts={accounts}
              employees={employees}
              payruns={payruns}
              timesheets={timesheets}
              taxRemittances={taxRemittances}
              dailyCashUps={dailyCashUps}
              onImportDatabase={handleImportDatabase}
              softwareLicense={softwareLicense}
              adminControl={adminControl}
              onActivateLicense={handleActivateLicense}
              onUpdateAdminControl={updateAdminControl}
              onSuspendLicense={() => updateSoftwareLicense({ ...softwareLicense, status: 'SUSPENDED' })}
              databaseInfo={{
                mode: database.mode,
                endpoint: API_BASE_URL,
                status: dbStatus,
                lastSync: dbLastSync,
                error: dbError
              }}
              onTestConnection={handleTestDatabaseConnection}
            />
          )}

        </main>
      </div>
      
      {/* 3. APP FOOTER */}
      <footer className="bg-slate-900 border-t border-slate-800 text-slate-500 py-2.5 px-6 text-center text-[10px] font-semibold flex flex-col sm:flex-row justify-between items-center gap-1 shrink-0">
        <span>© 2026 {APPLICATION_NAME}. Configured for {businessProfile.name}.</span>
        {/*
          The storage line reports the live connection state. It previously read
          "Online • Secure SQLite Sandbox Sync" unconditionally, which claimed a
          server connection even when the app was running from localStorage.
        */}
        <span className={dbStatus === 'connected' ? 'text-teal-500 font-bold' : dbStatus === 'error' ? 'text-rose-400 font-bold' : 'text-amber-400 font-bold'}>
          {dbStatus === 'connected'
            ? 'Status: Online • SQL Database Sync Active'
            : dbStatus === 'error'
              ? 'Status: Sync Error • Using Cached Data'
              : dbStatus === 'connecting'
                ? 'Status: Connecting to SQL Database…'
                : 'Status: Offline • Browser Storage Only'}
        </span>
      </footer>

      {/* ==========================================================================
         FLOATING AI HELPER DRAWER (Bypasses Dedicated Tabs)
         ========================================================================== */}
      <div className="fixed bottom-6 right-6 z-50 print:hidden">
        {isFloatingAIActive ? (
          /* Active Chat Box Popup overlay */
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl shadow-2xl w-[320px] sm:w-[360px] h-[420px] flex flex-col overflow-hidden animate-scale-up">
            
            {/* Header */}
            <div className="bg-slate-950 p-3.5 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="bg-teal-600 p-1.5 rounded-lg">
                  <Bot size={14} />
                </div>
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-teal-400">Afritecx AI Assistant</h4>
                  <span className="text-[9px] text-slate-400 font-semibold block">Instant Startup Guide Chat</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFloatingAIActive(false)}
                className="text-slate-400 hover:text-white font-bold text-xs p-1"
              >
                ✕
              </button>
            </div>

            {/* Messages body */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {floatingMessages.map(msg => (
                <div 
                  key={msg.id} 
                  className={`flex flex-col max-w-[85%] space-y-0.5 ${
                    msg.sender === 'USER' ? 'ml-auto items-end' : 'mr-auto items-start'
                  }`}
                >
                  <span className="text-[8px] text-slate-500 font-black font-mono">{msg.sender === 'AI' ? 'AI Agent' : 'You'}</span>
                  <div 
                    className={`p-2.5 rounded-xl text-[11px] leading-relaxed whitespace-pre-wrap ${
                      msg.sender === 'USER' 
                        ? 'bg-teal-600 text-white rounded-tr-none' 
                        : 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700/40'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Chat bottom Form inputs */}
            <form onSubmit={handleFloatingSendMessage} className="p-2.5 bg-slate-950 border-t border-slate-800 flex gap-1.5">
              <input
                type="text"
                placeholder="Ask about POS guides, ledger entries..."
                value={floatingChatQuery}
                onChange={(e) => setFloatingChatQuery(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2.5 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 font-semibold"
              />
              <button
                type="submit"
                className="bg-teal-600 hover:bg-teal-500 text-white p-1.5 rounded-lg cursor-pointer"
              >
                <Send size={12} />
              </button>
            </form>

          </div>
        ) : (
          /* Floating Circular Glowing Button Trigger */
          <button
            type="button"
            onClick={() => setIsFloatingAIActive(true)}
            className="bg-teal-600 hover:bg-teal-500 text-white p-4 rounded-full shadow-2xl flex items-center justify-center hover:scale-105 transition-all cursor-pointer relative group"
            title="Ask Afritecx AI Assistant"
          >
            {/* Pulsing glow boundary */}
            <span className="absolute inset-0 rounded-full bg-teal-500/20 animate-ping"></span>
            <Bot size={22} className="stroke-[2.2] relative z-10" />
            <span className="absolute right-12 bg-slate-900 text-white text-[10px] py-1 px-2.5 rounded-lg font-bold border border-slate-800 tracking-wide opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-md pointer-events-none">
              Afritecx AI Guide
            </span>
          </button>
        )}
      </div>

    </div>
  );
}
