/**
 * ============================================================================
 * MODULE: types/index.ts — Central Type Definitions (Data Contracts)
 * ----------------------------------------------------------------------------
 * The single source of truth for the shape of every piece of data in the app:
 * accounts, journal entries, products, customers, suppliers, sales, purchase
 * orders, users/roles, payroll, timesheets, cash-ups, reminders, licensing,
 * admin controls, and business configuration. Components and utilities import
 * these interfaces so TypeScript can guarantee the whole system speaks the
 * same "language" and catch mismatches at compile time. No runtime logic here.
 * ============================================================================
 */

/**
 * Represents the fundamental classifications of accounts in double-entry bookkeeping.
 */
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

/**
 * Defines the structure for a general ledger account inside our Chart of Accounts.
 */
export interface Account {
  code: string; // 4-digit unique accounting code (e.g., "1010" for Cash Drawer)
  name: string; // Descriptive ledger name (e.g., "Carling Stock Inventory")
  type: AccountType; // Category classifier for double-entry direction
  balance: number; // Real-time calculated ZAR balance
  description?: string; // Optional accountant notes
  isSystem?: boolean; // Core accounts protected from deletion
}

/**
 * Represents a single split line item inside a balanced Journal Entry.
 */
export interface TransactionLine {
  accountCode: string; // Target account to apply transaction
  type: 'DEBIT' | 'CREDIT'; // Entry classification
  amount: number; // Monetary split value
}

/**
 * Represents a double-entry bookkeeping record posted chronologically to the General Ledger.
 */
export interface JournalEntry {
  id: string; // Unique audit transaction code
  date: string; // ISO date of posting
  description: string; // Explanation of split balances
  reference: string; // Cross-reference code (Invoice, PO, check)
  lines: TransactionLine[]; // Balanced offset debit and credit lines
  createdBy?: string; // System operator username
}

/**
 * Schema defining bar catalog products.
 * Supports split-stock warehousing: Storeroom (bulk storage) and Fridge (cold, ready-to-sell).
 */
export interface Product {
  id: string; // Unique primary key
  name: string; // Product name (e.g., Castle Lager 750ml)
  sku: string; // Barcode SKU identifier
  category: string; // Section grouping (e.g., Lagers & Ciders)
  price: number; // Sales checkout price (ZAR base)
  costPrice: number; // Wholesale restock cost (ZAR base)
  storeroomStock: number; // Bulk warehouse / storeroom stock levels
  fridgeStock: number; // Cold ready-to-sell shelf stock levels
  stock: number; // Total combined stock (storeroomStock + fridgeStock)
  minStock: number; // Buffer threshold for automatic warnings
  barcode?: string; // Optional scan value
  image?: string; // Icon or visual emoji representation
}

/**
 * Defines a shopping basket line inside the active POS terminal.
 */
export interface CartItem {
  product: Product; // Target bar product
  quantity: number; // Units to purchase
  discount: number; // Discount percentage (0 - 100)
}

/**
 * Customer profile for tracking credits and receivables (A/R).
 */
export interface Customer {
  id: string; // Unique client key
  name: string; // Client full name
  phone: string; // Mobile phone for contact
  email: string; // Contact email
  storeCredit: number; // Negative balance means accounts receivable tab
  creditLimit: number; // Allowed debt ceiling
}

/**
 * Wholesaler supplier profile for tracking inventory acquisitions and payables (A/P).
 */
export interface Supplier {
  id: string; // Vendor key
  name: string; // Company corporate name
  phone: string; // Service support phone
  email: string; // Billing email
  balanceOwed: number; // Owed accounts payable debt
}

/**
 * Stores finalized POS retail transaction audits.
 */
export interface Sale {
  id: string; // Unique transaction code
  invoiceNo: string; // Generated sequential invoice number
  date: string; // Sale posting date
  customerId?: string; // Linked client ID if using credit
  items: {
    productId: string;
    name: string;
    quantity: number;
    price: number;
    costPrice: number;
    discount: number;
    total: number;
  }[];
  subtotal: number; // Sum pre-tax prices
  discountAmount: number; // Sum line discounts
  taxAmount: number; // Calculated VAT/GST
  total: number; // Grand total paid
  paymentMethod: 'CASH' | 'CARD' | 'CUSTOMER_CREDIT'; // Processing tender
  cashReceived?: number; // Cash tendered
  changeGiven?: number; // Till cash returned
}

/**
 * Procurement PO for restocking bar lagers and spirits.
 */
export interface PurchaseOrder {
  id: string; // Procurement key
  poNo: string; // Supplier PO invoice number
  date: string; // Delivery date
  supplierId: string; // Wholesaler ID
  items: {
    productId: string;
    name: string;
    quantity: number;
    costPrice: number;
    total: number;
  }[];
  total: number; // Total invoice cost
  isReceived: boolean; // Received stock flag
  isPaid: boolean; // Payment finalized flag
  paymentMethod?: 'CASH' | 'CARD' | 'ACCOUNTS_PAYABLE'; // Funding offset
}

/**
 * Supported display currency codes.
 */
export type CurrencyCode = 'ZAR' | 'USD' | 'BWP' | 'EUR';

/**
 * Defines exchange rates relative to 1 ZAR.
 */
export interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  rate: number; // e.g. 0.053 for USD
  name: string;
}

/**
 * Industry presets supported by Afritecx Badboy's business setup.
 */
export type BusinessType =
  | 'RETAIL'
  | 'BAR_BOTTLESTORE'
  | 'RESTAURANT'
  | 'WHOLESALE'
  | 'SERVICES'
  | 'PHARMACY'
  | 'HARDWARE'
  | 'FASHION'
  | 'ELECTRONICS'
  | 'OTHER';

/**
 * Configurable terminology used to adapt workflows to different industries.
 */
export interface BusinessTerminology {
  itemLabel: string; // Product, medicine, menu item, service, material, etc.
  customerLabel: string; // Customer, client, patient, guest, account, etc.
  supplierLabel: string; // Supplier, vendor, contractor, distributor, etc.
  primaryStockLabel: string; // Warehouse, backroom, dispensary, catalog, etc.
  secondaryStockLabel: string; // Sales floor, counter, kitchen, work queue, etc.
}

/**
 * Corporate profile settings.
 */
export interface BusinessProfile {
  name: string; // Store name
  address: string; // Store border post street address
  phone: string; // Contact line
  email: string; // Admin mail
  taxRate: number; // Tax percent (GST/VAT)
  currency: CurrencyCode; // Active display currency code
  businessType: BusinessType; // Selected industry configuration
  terminology: BusinessTerminology; // User-facing labels for this organization
}

/**
 * Access levels allowed in the system.
 */
export type UserType = 'ADMIN' | 'GENERAL' | 'CASHIER' | 'AUDIT';

/**
 * Operator profile database schema.
 */
export interface User {
  id: string; // Unique system key
  username: string; // Security login handle
  passwordHash: string; // Plaintext or hashed credentials
  userType: UserType; // Privilege tier
  fullName: string; // Full operator name
  isActive: boolean; // Account status indicator
}

/**
 * Tracks the current logged-in user session.
 */
export interface UserSession {
  currentUser: User; // Authenticated profile
  loginTime: string; // Timestamp
}

/**
 * Staff wage payment configurations.
 */
export type PayType = 'HOURLY' | 'SALARY';

/**
 * Corporate employee schema.
 */
export interface Employee {
  id: string; // Employee key
  name: string; // Full staff name
  role: string; // Corporate title
  payType: PayType; // Compensation model
  payRate: number; // Wage rate (hourly or monthly flat rate)
  taxWithholdingRate: number; // Income Tax percentage
  email: string; // Personal email
  taxId: string; // National Tax identifier
  isActive: boolean; // Employment status flag
}

/**
 * Split payroll line detailing payouts for a single employee.
 */
export interface PayrunItem {
  employeeId: string; // Target worker ID
  employeeName: string; // Full worker name
  payType: PayType; // Active pay structure
  payRate: number; // Base rate
  hoursWorked: number; // Hours logged (for hourly compensation)
  grossPay: number; // Pre-tax wage
  taxWithheld: number; // Income tax withheld
  netPay: number; // Net salary disbursed
}

/**
 * Finalized corporate pay cycle.
 */
export interface Payrun {
  id: string; // Payrun identifier
  payrunNo: string; // Sequential reference code
  startDate: string; // Beginning of pay cycle
  endDate: string; // Term of pay cycle
  paymentDate: string; // Disbursement date
  totalGross: number; // Wage expense total
  totalTax: number; // Tax withholding liability
  totalNet: number; // Net cash output
  paymentMethod: 'CASH' | 'CARD'; // Cash drawer / bank checker
  items: PayrunItem[]; // List of pay slips distributed
}

/**
 * Timesheet status boundaries.
 */
export type TimesheetStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Employee timesheet submissions.
 */
export interface Timesheet {
  id: string; // Timesheet identifier
  employeeId: string; // Submitting worker ID
  employeeName: string; // Full worker name
  startDate: string; // Period start
  endDate: string; // Period end
  hoursWorked: number; // Worked hours logged
  notes?: string; // Optional task comments
  status: TimesheetStatus; // Approval boundary
  submittedDate: string; // Date of submission
}

/**
 * Income Tax Remittances paid to revenue authorities.
 */
export interface TaxRemittance {
  id: string; // Remittance key
  paymentDate: string; // Date paid
  amount: number; // Monies cleared
  method: 'CASH' | 'CARD'; // Funding account
  quarter: string; // Fiscal period
}

/**
 * Shift closure cash drawer audits and safe deposit logs.
 */
export interface DailyCashUp {
  id: string; // Reconcile transaction identifier
  date: string; // Audit date
  closedBy: string; // Closing manager
  expectedCash: number; // Cash Drawer ledger balance
  actualCash: number; // Physical count
  discrepancy: number; // cash over/short variance
  amountDeposited: number; // Monies transferred to bank checking
  floatRetained: number; // Till float left
}

/**
 * Custom reminders for managers.
 */
export interface Reminder {
  id: string; // Reminder identifier
  title: string; // Heading
  notes?: string; // Notes
  targetDate: string; // Due date
  isCompleted: boolean; // Status
  category: 'STOCK' | 'TAX' | 'PAYROLL' | 'OTHER'; // Type grouping
}

/** Supported commercial license renewal periods. */
export type LicenseBillingCycle = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';

/** Current activation condition of an Afritecx Badboy installation. */
export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

/** Persisted software license assigned to one configured organization. */
export interface SoftwareLicense {
  licenseKey: string;
  licensedTo: string;
  billingCycle: LicenseBillingCycle;
  issuedAt: string;
  expiresAt: string;
  status: LicenseStatus;
}

/** Modules an administrator can centrally enable or disable. */
export type ControlledModule =
  | 'dashboard'
  | 'pos'
  | 'inventory'
  | 'crm'
  | 'accounting'
  | 'payroll'
  | 'cashup'
  | 'ai'
  | 'settings';

/**
 * Administrative control state. Changes synchronize across open tabs on the
 * same Afritecx Badboy deployment through localStorage/BroadcastChannel.
 */
export interface AdminControlState {
  maintenanceMode: boolean;
  systemLocked: boolean;
  disabledModules: ControlledModule[];
  announcement: string;
  forceLogoutToken: number;
  updatedAt: string;
}
