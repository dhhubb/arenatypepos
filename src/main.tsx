/**
 * ============================================================================
 * MODULE: main.tsx — Application Bootstrap / Entry Point
 * ----------------------------------------------------------------------------
 * This is the very first file the browser runs. Its only job is to:
 *   1. Locate the root <div id="root"> element inside index.html.
 *   2. Mount the top-level <App /> React component into that element.
 *   3. Wrap the app in <StrictMode> so React highlights potential problems
 *      (accidental side effects, deprecated APIs) during development.
 *   4. Load the global Tailwind CSS styles via "./index.css".
 * No business logic lives here — it is purely the startup wiring.
 * ============================================================================
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
