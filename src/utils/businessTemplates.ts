/**
 * ============================================================================
 * MODULE: utils/businessTemplates.ts — Industry Configuration Presets
 * ----------------------------------------------------------------------------
 * Makes the software adaptable to any industry. Each preset defines the
 * user-facing terminology for a business type (e.g. "Patron" vs "Customer",
 * "Fridges" vs "Sales Floor"). Applying a preset only relabels the interface —
 * it NEVER deletes products, sales, ledger entries, or other stored data.
 *   - BUSINESS_TEMPLATES: the full list shown during business setup.
 *   - getBusinessTemplate(): safely looks up one preset with a generic
 *     fallback so the app never crashes on an unknown business type.
 * ============================================================================
 */
import { BusinessTerminology, BusinessType } from '../types';

export interface BusinessTemplate {
  type: BusinessType;
  name: string;
  description: string;
  terminology: BusinessTerminology;
}

/**
 * Non-destructive industry presets. Applying one changes labels and workflow
 * language only; it never removes sales, products, accounts, or ledger data.
 */
export const BUSINESS_TEMPLATES: BusinessTemplate[] = [
  {
    type: 'RETAIL',
    name: 'Retail Store',
    description: 'General shops, supermarkets, convenience stores, and specialty retail.',
    terminology: {
      itemLabel: 'Product',
      customerLabel: 'Customer',
      supplierLabel: 'Supplier',
      primaryStockLabel: 'Stockroom',
      secondaryStockLabel: 'Sales Floor'
    }
  },
  {
    type: 'BAR_BOTTLESTORE',
    name: 'Bar & Bottlestore',
    description: 'Bars, taverns, liquor retailers, and beverage outlets.',
    terminology: {
      itemLabel: 'Drink / Item',
      customerLabel: 'Patron',
      supplierLabel: 'Beverage Supplier',
      primaryStockLabel: 'Storeroom',
      secondaryStockLabel: 'Fridges'
    }
  },
  {
    type: 'RESTAURANT',
    name: 'Restaurant & Food Service',
    description: 'Restaurants, cafes, takeaways, bakeries, and catering businesses.',
    terminology: {
      itemLabel: 'Menu Item',
      customerLabel: 'Guest',
      supplierLabel: 'Food Supplier',
      primaryStockLabel: 'Dry Store',
      secondaryStockLabel: 'Kitchen'
    }
  },
  {
    type: 'WHOLESALE',
    name: 'Wholesale & Distribution',
    description: 'Bulk trading, distribution centers, and B2B supply operations.',
    terminology: {
      itemLabel: 'Stock Item',
      customerLabel: 'Trade Account',
      supplierLabel: 'Vendor',
      primaryStockLabel: 'Warehouse',
      secondaryStockLabel: 'Dispatch Bay'
    }
  },
  {
    type: 'SERVICES',
    name: 'Professional Services',
    description: 'Consultancies, repair businesses, agencies, salons, and service firms.',
    terminology: {
      itemLabel: 'Service',
      customerLabel: 'Client',
      supplierLabel: 'Contractor',
      primaryStockLabel: 'Service Catalog',
      secondaryStockLabel: 'Work Queue'
    }
  },
  {
    type: 'PHARMACY',
    name: 'Pharmacy & Healthcare Retail',
    description: 'Pharmacies, dispensaries, clinics, and healthcare supply businesses.',
    terminology: {
      itemLabel: 'Medicine / Item',
      customerLabel: 'Patient',
      supplierLabel: 'Pharmaceutical Supplier',
      primaryStockLabel: 'Dispensary Store',
      secondaryStockLabel: 'Counter Stock'
    }
  },
  {
    type: 'HARDWARE',
    name: 'Hardware & Building Supplies',
    description: 'Hardware shops, building suppliers, and industrial material retailers.',
    terminology: {
      itemLabel: 'Material / Item',
      customerLabel: 'Customer',
      supplierLabel: 'Trade Supplier',
      primaryStockLabel: 'Warehouse',
      secondaryStockLabel: 'Shop Floor'
    }
  },
  {
    type: 'FASHION',
    name: 'Fashion & Apparel',
    description: 'Clothing stores, boutiques, footwear, and textile retailers.',
    terminology: {
      itemLabel: 'Apparel Item',
      customerLabel: 'Customer',
      supplierLabel: 'Vendor',
      primaryStockLabel: 'Backroom',
      secondaryStockLabel: 'Showroom'
    }
  },
  {
    type: 'ELECTRONICS',
    name: 'Electronics & Technology',
    description: 'Device retailers, computer shops, and electronics service centers.',
    terminology: {
      itemLabel: 'Device / Item',
      customerLabel: 'Customer',
      supplierLabel: 'Technology Vendor',
      primaryStockLabel: 'Secure Store',
      secondaryStockLabel: 'Display Floor'
    }
  },
  {
    type: 'OTHER',
    name: 'Custom Business',
    description: 'Start with neutral terminology and customize every label.',
    terminology: {
      itemLabel: 'Item',
      customerLabel: 'Customer',
      supplierLabel: 'Supplier',
      primaryStockLabel: 'Primary Stock',
      secondaryStockLabel: 'Available Stock'
    }
  }
];

/** Returns the requested preset or a safe generic fallback. */
export function getBusinessTemplate(type: BusinessType): BusinessTemplate {
  return BUSINESS_TEMPLATES.find(template => template.type === type) ?? BUSINESS_TEMPLATES[0];
}