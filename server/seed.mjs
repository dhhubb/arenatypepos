/**
 * ============================================================================
 * server/seed.mjs — Temporary seeded database for testing
 * ----------------------------------------------------------------------------
 * Builds a throwaway SQLite database populated with a realistic trading week
 * for a bar bottlestore: stock, patrons, suppliers, sales, purchase orders,
 * payroll, timesheets, till reconciliations and a fully balanced ledger.
 *
 *   node server/seed.mjs                  # -> /tmp/afritecx-test/afritecx.db
 *   node server/seed.mjs /tmp/mytest      # -> /tmp/mytest/afritecx.db
 *   node server/seed.mjs --force /tmp/x   # overwrite an existing database
 *
 * Then point the server at it:
 *
 *   DB_DIR=/tmp/afritecx-test node server/index.mjs
 *
 * Every journal entry is written through the same balance check the live server
 * uses, so a database produced here can never be internally inconsistent. The
 * script exits non-zero if any invariant fails.
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, transaction, assertLedgerBalanced } from './schema.mjs';
import { hashPassword } from './password.mjs';
import { DEFAULT_ACCOUNTS, SEED_USERS, DEFAULT_PROFILE, DEFAULT_ADMIN_CONTROL, defaultLicense } from './defaults.mjs';

// Must match the server's default, otherwise `npm run seed` followed by
// `npm start` would populate one directory and serve an empty database from
// another.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = process.env.DB_DIR || path.join(__dirname, 'data');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const cents = value => Math.round(Number(value) * 100);
const major = value => Math.round(Number(value) || 0) / 100;

/** Fixed clock so repeated runs produce identical, diffable data. */
const TODAY = new Date('2026-11-19T09:00:00.000Z');

function daysAgo(days) {
  const date = new Date(TODAY.getTime());
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function at(days, hour = 12, minute = 0) {
  return `${daysAgo(days)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
// Opening stock, before the trading week is deducted.
const PRODUCTS = [
  ['p-lager-750', 'Castle Lager 750ml', 'CL-750', 'Lagers & Ciders', 25.0, 18.5, 120, 40, 24],
  ['p-lager-500', 'Castle Lager 500ml', 'CL-500', 'Lagers & Ciders', 18.0, 13.0, 120, 40, 20],
  ['p-ndovu-750', 'Zambezi Lager 750ml', 'ZL-750', 'Lagers & Ciders', 24.0, 17.5, 48, 12, 12],
  ['p-coke-2l', 'Coca-Cola 2L', 'CC-2L', 'Soft Drinks', 12.0, 8.0, 100, 40, 24],
  ['p-fanta-2l', 'Fanta Orange 2L', 'FO-2L', 'Soft Drinks', 12.0, 8.0, 48, 12, 12],
  ['p-water-500', 'Still Water 500ml', 'SW-500', 'Soft Drinks', 5.0, 2.5, 80, 40, 12],
  ['p-jameson', "Jameson Irish Whiskey 750ml", 'JW-750', 'Spirits', 95.0, 72.0, 2, 2, 6],
  ['p-gordons', "Gordon's Gin 750ml", 'GG-750', 'Spirits', 78.0, 58.0, 10, 4, 6],
  ['p-brands', 'Brands & Coke Combo', 'BC-COMBO', 'Combos', 40.0, 29.0, 24, 6, 8]
];

// [id, name, phone, email, openingBalance, creditLimit]. The opening balance
// column is unused: outstanding credit is derived from the credit sales so it
// always agrees with the A/R ledger.
const CUSTOMERS = [
  ['c-tafara', 'Tafara Moyo', '+263 77 123 4567', 'tafara.moyo@example.co.zw', 0, 1000.0],
  ['c-ruvimbo', 'Ruvimbo Chari', '+263 71 987 6543', 'ruvimbo.chari@example.co.zw', 0, 900.0],
  ['c-sipho', 'Sipho Ndlovu', '+263 78 555 1234', 'sipho.ndlovu@example.co.zw', 0, 300.0]
];

const SUPPLIERS = [
  ['s-delta', 'Delta Beverages', '+263 9 888 1000', 'orders@delta.co.zw'],
  ['s-afdis', 'Afdis Distillers', '+263 4 620 000', 'trade@afdis.co.zw'],
  ['s-cocacola', 'Coca-Cola Zimbabwe', '+263 9 466 200', 'supply@cocacola.co.zw']
];

// Restocks received during the week, bought on account. Each one both debits
// Inventory and adds its units to the storeroom, so the Inventory account and
// the stock on the shelves always tell the same story.
const RESTOCKS = [
  {
    id: 'po-2001', poNo: 'PO-2001', supplierId: 's-delta', daysBack: 10,
    items: [
      { productId: 'p-lager-750', quantity: 48, unitCost: 18.5 },
      { productId: 'p-lager-500', quantity: 48, unitCost: 13.0 }
    ]
  },
  {
    id: 'po-2002', poNo: 'PO-2002', supplierId: 's-afdis', daysBack: 8,
    items: [
      { productId: 'p-jameson', quantity: 6, unitCost: 72.0 },
      { productId: 'p-gordons', quantity: 2, unitCost: 58.0 }
    ]
  }
].map(restock => {
  const items = restock.items.map(item => ({
    ...item,
    name: PRODUCTS.find(([id]) => id === item.productId)[1],
    total: major(cents(item.unitCost) * item.quantity)
  }));
  const total = major(items.reduce((sum, item) => sum + cents(item.total), 0));
  return { ...restock, items, total, date: daysAgo(restock.daysBack) };
});

const EMPLOYEES = [
  ['e-charlie', 'Charlie Cashier', 'Till Operator', 'HOURLY', 20.0, 0.15, 'charlie@mabokodinku.co.zw', 'ZW-EMP-001', 1],
  ['e-naledi', 'Naledi Banda', 'Bar Attendant', 'HOURLY', 18.0, 0.15, 'naledi@mabokodinku.co.zw', 'ZW-EMP-002', 1],
  ['e-farai', 'Farai Zhou', 'Store Manager', 'MONTHLY', 950.0, 0.22, 'farai@mabokodinku.co.zw', 'ZW-EMP-003', 1]
];

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------
const journalEntries = [];

/**
 * Records a balanced journal entry.
 *
 * Debits and credits are accumulated separately and must agree, so a typo in
 * the seed data fails loudly here instead of producing a database that only
 * looks correct.
 */
function post(id, date, description, reference, lines, createdBy = 'seed') {
  const debits = lines.filter(line => line.type === 'DEBIT').reduce((sum, line) => sum + cents(line.amount), 0);
  const credits = lines.filter(line => line.type === 'CREDIT').reduce((sum, line) => sum + cents(line.amount), 0);
  if (debits !== credits) {
    throw new Error(`${id} is unbalanced: debits ${major(debits)} vs credits ${major(credits)}`);
  }
  journalEntries.push({ id, date, description, reference, createdBy, lines });
}

/**
 * Opening position.
 *
 * Inventory is valued from the catalogue rather than guessed, so the Inventory
 * account starts at exactly what is on the shelves. Hardcoding a round number
 * here previously left the account negative once the week's COGS was posted.
 */
const OPENING_CASH = 3000.0;
const OPENING_EQUIPMENT = 1850.0;
const openingInventory = major(PRODUCTS.reduce(
  (sum, [, , , , , costPrice, storeroom, fridge]) => sum + cents(costPrice) * (storeroom + fridge),
  0
));

post('JE-OPENING-CAPITAL', daysAgo(14), 'Opening capital injection', 'OPENING-001', [
  { accountCode: '1010', type: 'DEBIT', amount: OPENING_CASH },
  { accountCode: '1200', type: 'DEBIT', amount: openingInventory },
  { accountCode: '3100', type: 'CREDIT', amount: major(cents(OPENING_CASH) + cents(openingInventory)) }
]);

post('JE-OPENING-EQUIPMENT', daysAgo(14), 'POS terminal, scanner and shelving', 'OPENING-002', [
  { accountCode: '1300', type: 'DEBIT', amount: OPENING_EQUIPMENT },
  { accountCode: '3100', type: 'CREDIT', amount: OPENING_EQUIPMENT }
]);

// Trading days. Each day's sales are posted as one summarised entry, which is
// how a shop that batches its day-end actually books them.
/**
 * Trading week. Each line is one invoice:
 * [id, invoiceNo, date, customerIndex, paymentMethod, productIndex, quantity, discount]
 *
 * `customerIndex` is 1-based into CUSTOMERS and only meaningful for credit
 * sales; 0 means a walk-in patron.
 */
const SALES = [
  ['sale-1001', 'INV-1001', daysAgo(6), 0, 'CASH', 0, 48, 0],
  ['sale-1002', 'INV-1002', daysAgo(6), 0, 'CARD', 1, 48, 0],
  ['sale-1003', 'INV-1003', daysAgo(5), 2, 'CUSTOMER_CREDIT', 6, 6, 0],
  ['sale-1004', 'INV-1004', daysAgo(5), 0, 'CASH', 3, 48, 0],
  ['sale-1005', 'INV-1005', daysAgo(4), 0, 'CASH', 0, 72, 0],
  ['sale-1006', 'INV-1006', daysAgo(4), 0, 'CARD', 5, 96, 0],
  ['sale-1007', 'INV-1007', daysAgo(3), 0, 'CARD', 8, 24, 20.0],
  ['sale-1008', 'INV-1008', daysAgo(3), 0, 'CASH', 4, 36, 0],
  ['sale-1009', 'INV-1009', daysAgo(2), 0, 'CASH', 1, 72, 0],
  ['sale-1010', 'INV-1010', daysAgo(2), 1, 'CUSTOMER_CREDIT', 7, 8, 0],
  ['sale-1011', 'INV-1011', daysAgo(1), 0, 'CARD', 0, 48, 0],
  ['sale-1012', 'INV-1012', daysAgo(1), 0, 'CASH', 3, 60, 0],
  ['sale-1013', 'INV-1013', daysAgo(1), 0, 'CASH', 2, 36, 0]
];

const TAX_RATE = DEFAULT_PROFILE.taxRate / 100;

const saleRecords = SALES.map(([id, invoiceNo, date, customerIndex, paymentMethod, productIndex, qty, discount]) => {
  const product = PRODUCTS[productIndex];
  const subtotal = major(cents(product[4]) * qty);
  const discountAmount = discount;
  const taxable = major(cents(subtotal) - cents(discountAmount));
  const taxAmount = major(cents(taxable * TAX_RATE));
  const total = major(cents(taxable) + cents(taxAmount));
  const costPrice = product[5];
  const costTotal = major(cents(costPrice) * qty);

  return {
    id,
    invoiceNo,
    date,
    customerId: customerIndex ? CUSTOMERS[customerIndex - 1][0] : undefined,
    subtotal,
    discountAmount,
    taxAmount,
    total,
    paymentMethod,
    cashReceived: paymentMethod === 'CASH' ? Math.ceil(total / 10) * 10 : undefined,
    changeGiven: paymentMethod === 'CASH' ? major(Math.ceil(total / 10) * 10 - cents(total)) : undefined,
    costTotal,
    items: [{
      productId: product[0],
      name: product[1],
      quantity: qty,
      price: product[4],
      costPrice,
      discount: discountAmount,
      total
    }]
  };
});

/**
 * Applies the week's trading to opening stock, so the shelf counts look lived-in.
 *
 * Restocks land in the storeroom, sales come out of it, and the fridge is
 * topped up from the storeroom the way a bottlestore actually operates. Returns
 * `{ storeroom, fridge }` keyed by product id, leaving the catalogue untouched.
 */
function stockAfterSales() {
  const received = new Map();
  for (const restock of RESTOCKS) {
    for (const item of restock.items) {
      received.set(item.productId, (received.get(item.productId) ?? 0) + item.quantity);
    }
  }

  const sold = new Map();
  for (const sale of saleRecords) {
    const item = sale.items[0];
    sold.set(item.productId, (sold.get(item.productId) ?? 0) + item.quantity);
  }

  const remaining = new Map();
  for (const [id, , , , , , storeroom, fridge] of PRODUCTS) {
    const stocked = storeroom + (received.get(id) ?? 0);
    const onHand = Math.max(0, stocked + fridge - (sold.get(id) ?? 0));
    const fridgeLeft = Math.min(fridge, onHand);
    remaining.set(id, { storeroom: onHand - fridgeLeft, fridge: fridgeLeft });
  }
  return remaining;
}

// One summarised journal entry per trading day.
const salesByDate = new Map();
for (const sale of saleRecords) {
  const bucket = salesByDate.get(sale.date) ?? [];
  bucket.push(sale);
  salesByDate.set(sale.date, bucket);
}

for (const [date, sales] of [...salesByDate].sort()) {
  const net = major(sales.reduce((sum, sale) => sum + cents(sale.subtotal) - cents(sale.discountAmount), 0));
  const tax = major(sales.reduce((sum, sale) => sum + cents(sale.taxAmount), 0));
  const cogs = major(sales.reduce((sum, sale) => sum + cents(sale.costTotal), 0));
  const byMethod = method => major(sales
    .filter(sale => sale.paymentMethod === method)
    .reduce((sum, sale) => sum + cents(sale.total), 0));
  const cash = byMethod('CASH');
  const card = byMethod('CARD');
  const credit = byMethod('CUSTOMER_CREDIT');

  const lines = [
    { accountCode: '5010', type: 'DEBIT', amount: cogs },
    { accountCode: '1200', type: 'CREDIT', amount: cogs },
    { accountCode: '4010', type: 'CREDIT', amount: net }
  ];
  if (tax > 0) lines.push({ accountCode: '2200', type: 'CREDIT', amount: tax });
  if (cash > 0) lines.push({ accountCode: '1010', type: 'DEBIT', amount: cash });
  if (card > 0) lines.push({ accountCode: '1020', type: 'DEBIT', amount: card });
  if (credit > 0) lines.push({ accountCode: '1100', type: 'DEBIT', amount: credit });

  post(`JE-SALES-${date}`, date, `Daily sales summary (${sales.length} invoices)`, `DAY-${date}`, lines);
}

// Purchases on account from the beverage suppliers. The amount posted here is
// the same figure the storeroom receives above, so Inventory on the balance
// sheet stays equal to the value of the stock actually on the shelves.
for (const restock of RESTOCKS) {
  const supplierName = SUPPLIERS.find(([id]) => id === restock.supplierId)[1];
  post(`JE-${restock.poNo}`, restock.date, `Restock: ${supplierName} order`, restock.poNo, [
    { accountCode: '1200', type: 'DEBIT', amount: restock.total },
    { accountCode: '2010', type: 'CREDIT', amount: restock.total }
  ]);
}

// Operating costs.
post('JE-RENT', daysAgo(7), 'November store rent', 'RENT-NOV', [
  { accountCode: '6010', type: 'DEBIT', amount: 850.0 },
  { accountCode: '1010', type: 'CREDIT', amount: 850.0 }
]);
post('JE-UTILITIES', daysAgo(5), 'Electricity, water and internet', 'UTIL-NOV', [
  { accountCode: '6030', type: 'DEBIT', amount: 275.4 },
  { accountCode: '1020', type: 'CREDIT', amount: 275.4 }
]);
post('JE-BANK-FEES', daysAgo(2), 'Card processing fees', 'FEES-NOV', [
  { accountCode: '6050', type: 'DEBIT', amount: 42.75 },
  { accountCode: '1020', type: 'CREDIT', amount: 42.75 }
]);

// Payroll: 40 hours at R20 for Charlie, released by card.
const gross = 800.0;
const tax = major(cents(gross) * 0.15);
const net = major(cents(gross) - cents(tax));
post('JE-PAYROLL-PR-1001', daysAgo(3), 'Payrun #PR-1001 — Charlie Cashier', 'PAYROLL-PR-1001', [
  { accountCode: '6020', type: 'DEBIT', amount: gross },
  { accountCode: '2210', type: 'CREDIT', amount: tax },
  { accountCode: '1020', type: 'CREDIT', amount: net }
]);

// Banking: cash is moved from the drawer to the bank during the week.
post('JE-BANK-DEPOSIT', daysAgo(4), 'Cash deposit to bank', 'DEP-001', [
  { accountCode: '1020', type: 'DEBIT', amount: 6000.0 },
  { accountCode: '1010', type: 'CREDIT', amount: 6000.0 }
]);

// Till reconciliation: a small shortage goes to 6060, never to bank fees.
post('JE-CASHUP-001', daysAgo(1), 'Till reconciliation — shortage', 'CASHUP-001', [
  { accountCode: '6060', type: 'DEBIT', amount: 5.25 },
  { accountCode: '1010', type: 'CREDIT', amount: 5.25 }
]);

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const force = argv.includes('--force');
  const target = argv.find(arg => !arg.startsWith('--')) || DEFAULT_DIR;
  return { force, dir: path.resolve(target) };
}

function main() {
  const { force, dir } = parseArgs(process.argv.slice(2));
  const file = path.join(dir, 'afritecx.db');

  if (fs.existsSync(file) && !force) {
    console.error(`Refusing to overwrite ${file}\nPass --force to replace it, or choose another directory.`);
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });
  if (force) {
    // Remove the WAL sidecars too; a stale -wal alongside a fresh database is
    // how you get "database disk image is malformed" on the next open.
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(file + suffix, { force: true });
    }
  }

  const db = openDatabase(dir);
  const now = new Date().toISOString();

  transaction(db, () => {
    const insertUser = db.prepare(
      'INSERT INTO users (id, username, password_hash, user_type, full_name, is_active, created_at) VALUES (?,?,?,?,?,1,?)'
    );
    for (const [id, username, fullName, role, password] of SEED_USERS) {
      insertUser.run(id, username, hashPassword(password), role, fullName, now);
    }

    const insertAccount = db.prepare(
      'INSERT INTO accounts (code, name, type, description, is_system) VALUES (?,?,?,?,1)'
    );
    for (const [code, name, type, description] of DEFAULT_ACCOUNTS) {
      insertAccount.run(code, name, type, description);
    }

    const insertProduct = db.prepare(`INSERT INTO products
      (id, name, sku, category, price, cost_price, storeroom_stock, fridge_stock, stock, min_stock, barcode, image)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const stockLeft = stockAfterSales();
    for (const [id, name, sku, category, price, costPrice, , , minStock] of PRODUCTS) {
      const { storeroom, fridge } = stockLeft.get(id);
      insertProduct.run(id, name, sku, category, cents(price), cents(costPrice),
        storeroom, fridge, storeroom + fridge, minStock, sku, null);
    }

    const insertCustomer = db.prepare(
      'INSERT INTO customers (id, name, phone, email, store_credit, credit_limit) VALUES (?,?,?,?,?,?)'
    );
    // Outstanding credit comes from the credit sales above, so the patron
    // balances add up to the A/R figure the ledger reports. The app stores debt
    // as a negative storeCredit (see POSView: "negative means debt"), which is
    // also what the dashboard counts to show active credit accounts.
    const owedByCustomer = new Map();
    for (const sale of saleRecords) {
      if (!sale.customerId) continue;
      owedByCustomer.set(sale.customerId, (owedByCustomer.get(sale.customerId) ?? 0) + cents(sale.total));
    }
    for (const [id, name, phone, email, , limit] of CUSTOMERS) {
      insertCustomer.run(id, name, phone, email, -(owedByCustomer.get(id) ?? 0), cents(limit));
    }

    const insertSupplier = db.prepare(
      'INSERT INTO suppliers (id, name, phone, email, balance_owed) VALUES (?,?,?,?,?)'
    );
    // Owed balances mirror the purchase orders posted to A/P, so the supplier
    // cards add up to the Accounts Payable figure on the balance sheet.
    const owedBySupplier = new Map();
    for (const restock of RESTOCKS) {
      owedBySupplier.set(restock.supplierId,
        (owedBySupplier.get(restock.supplierId) ?? 0) + cents(restock.total));
    }
    for (const [id, name, phone, email] of SUPPLIERS) {
      insertSupplier.run(id, name, phone, email, owedBySupplier.get(id) ?? 0);
    }

    const insertSale = db.prepare(`INSERT INTO sales
      (id, invoice_no, date, customer_id, subtotal, discount_amount, tax_amount, total,
       payment_method, cash_received, change_given, items)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const sale of saleRecords) {
      insertSale.run(sale.id, sale.invoiceNo, sale.date, sale.customerId ?? null,
        cents(sale.subtotal), cents(sale.discountAmount), cents(sale.taxAmount), cents(sale.total),
        sale.paymentMethod,
        sale.cashReceived === undefined ? null : cents(sale.cashReceived),
        sale.changeGiven === undefined ? null : cents(sale.changeGiven),
        JSON.stringify(sale.items));
    }

    const insertPo = db.prepare(`INSERT INTO purchase_orders
      (id, po_no, date, supplier_id, items, total, is_received, is_paid, payment_method)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const restock of RESTOCKS) {
      insertPo.run(restock.id, restock.poNo, restock.date, restock.supplierId,
        JSON.stringify(restock.items.map(item => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          costPrice: item.unitCost
        }))),
        cents(restock.total), 1, 0, 'CREDIT');
    }

    const insertEmployee = db.prepare(`INSERT INTO employees
      (id, name, role, pay_type, pay_rate, tax_withholding_rate, email, tax_id, is_active)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const [id, name, role, payType, payRate, withholding, email, taxId, active] of EMPLOYEES) {
      insertEmployee.run(id, name, role, payType, cents(payRate), withholding, email, taxId, active);
    }

    db.prepare(`INSERT INTO payruns
      (id, payrun_no, start_date, end_date, payment_date, total_gross, total_tax, total_net, payment_method, items)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'pr-1001', 'PR-1001', daysAgo(10), daysAgo(3), daysAgo(3),
      cents(gross), cents(tax), cents(net), 'CARD',
      JSON.stringify([{
        employeeId: 'e-charlie', employeeName: 'Charlie Cashier',
        hoursWorked: 40, grossPay: gross, tax, netPay: net
      }])
    );

    const insertTimesheet = db.prepare(`INSERT INTO timesheets
      (id, employee_id, employee_name, start_date, end_date, hours_worked, notes, status, submitted_date)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    insertTimesheet.run('ts-1001', 'e-charlie', 'Charlie Cashier', daysAgo(10), daysAgo(3), 40,
      'Standard trading week', 'APPROVED', daysAgo(4));
    insertTimesheet.run('ts-1002', 'e-naledi', 'Naledi Banda', daysAgo(10), daysAgo(3), 32,
      'Covered two extra evenings', 'PENDING', daysAgo(2));

    db.prepare('INSERT INTO tax_remittances (id, payment_date, amount, method, quarter) VALUES (?,?,?,?,?)')
      .run('tax-2026-q3', daysAgo(9), cents(430.0), 'BANK_TRANSFER', '2026-Q3');

    const insertCashup = db.prepare(`INSERT INTO daily_cashups
      (id, date, closed_by, expected_cash, actual_cash, discrepancy, amount_deposited, float_retained)
      VALUES (?,?,?,?,?,?,?,?)`);
    insertCashup.run('cu-001', daysAgo(1), 'Charlie Cashier',
      cents(28.75), cents(23.5), cents(-5.25), cents(20.0), cents(3.5));

    const insertEntry = db.prepare(
      'INSERT INTO journal_entries (id, date, description, reference, created_by, created_at) VALUES (?,?,?,?,?,?)'
    );
    const insertLine = db.prepare(
      'INSERT INTO journal_lines (entry_id, account_code, type, amount) VALUES (?,?,?,?)'
    );
    for (const entry of journalEntries) {
      insertEntry.run(entry.id, entry.date, entry.description, entry.reference, entry.createdBy, at(0));
      for (const line of entry.lines) {
        insertLine.run(entry.id, line.accountCode, line.type, cents(line.amount));
      }
    }

    db.prepare('INSERT INTO business_profile (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_PROFILE));
    db.prepare('INSERT INTO software_license (id, data) VALUES (1, ?)').run(JSON.stringify(defaultLicense()));
    db.prepare('INSERT INTO admin_control (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_ADMIN_CONTROL));
  },
    // The same invariant the live server enforces before committing.
    () => assertLedgerBalanced(db)
  );

  // Report what was written so the run is self-verifying.
  const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const totals = db.prepare(`
    SELECT SUM(CASE WHEN type='DEBIT' THEN amount ELSE 0 END) AS debit,
           SUM(CASE WHEN type='CREDIT' THEN amount ELSE 0 END) AS credit
    FROM journal_lines`).get();

  console.log(`Seeded test database: ${file}`);
  console.log(`  users ${count('users')}  products ${count('products')}  customers ${count('customers')}  suppliers ${count('suppliers')}`);
  console.log(`  sales ${count('sales')}  purchase orders ${count('purchase_orders')}  employees ${count('employees')}  payruns ${count('payruns')}`);
  console.log(`  journal entries ${count('journal_entries')}  lines ${count('journal_lines')}  cashups ${count('daily_cashups')}`);
  console.log(`  ledger debits ${major(totals.debit)}  credits ${major(totals.credit)}`);
  console.log(`\nStart the server against it:\n  DB_DIR=${dir} node server/index.mjs`);
  console.log(`Sign in as admin / ${process.env.SEED_ADMIN_PASSWORD ? '<SEED_ADMIN_PASSWORD>' : 'admin123'}`);

  db.close();
}

main();
