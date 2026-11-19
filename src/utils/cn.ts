/**
 * ============================================================================
 * MODULE: utils/cn.ts — Tailwind Class Name Helper
 * ----------------------------------------------------------------------------
 * A tiny utility used throughout the UI to combine CSS class names safely.
 *   - clsx: lets you pass conditional/array/object class values and returns a
 *     single clean class string.
 *   - twMerge: intelligently de-duplicates conflicting Tailwind classes
 *     (e.g. "p-2 p-4" becomes "p-4") so later classes correctly win.
 * Import `cn(...)` anywhere you build dynamic className strings.
 * ============================================================================
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
