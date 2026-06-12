"use client";

/**
 * Runtime asset configuration provider.
 *
 * The asset base URL is NOT baked into the build. Instead, it is read at
 * runtime from /config.json (committed with default value {"assetBaseUrl": "/assets"}).
 * Production deployments rewrite config.json to point at the R2 host — same
 * build artifact works in both gated and prod environments.
 *
 * Usage:
 *   <AssetConfigProvider>
 *     <App />
 *   </AssetConfigProvider>
 *
 *   // In any client component:
 *   const assetUrl = useAssetUrl();
 *   const pdfHref = assetUrl('/pdfs/abc123.pdf#page=5');
 */

import React, { createContext, useContext } from "react";

const DEFAULT_ASSET_BASE = "/assets";

interface AssetConfig {
  assetBaseUrl: string;
}

// Module-level promise — fetched once, never re-fetched (even in StrictMode).
let _configPromise: Promise<AssetConfig> | null = null;

function getConfigPromise(): Promise<AssetConfig> {
  if (!_configPromise) {
    _configPromise = fetch("/config.json")
      .then((r) => {
        if (!r.ok) throw new Error(`/config.json returned ${r.status}`);
        return r.json() as Promise<AssetConfig>;
      })
      .catch((err) => {
        console.error(
          "[govbudget/asset-config] Failed to load /config.json — falling back to default '/assets'.",
          err,
        );
        return { assetBaseUrl: DEFAULT_ASSET_BASE };
      });
  }
  return _configPromise;
}

// Context: stores the resolved base URL (or default if not yet loaded)
const AssetConfigContext = createContext<string>(DEFAULT_ASSET_BASE);

interface AssetConfigProviderProps {
  children: React.ReactNode;
  /** Pre-resolved base for SSR/test scenarios (skips fetch). */
  initialBase?: string;
}

/**
 * Provider that fetches /config.json once and makes assetBaseUrl available
 * to all child components via useAssetUrl().
 *
 * Place this near the root of the client tree (e.g., in a client wrapper
 * around the layout or on pages that use asset URLs).
 */
export function AssetConfigProvider({
  children,
  initialBase,
}: AssetConfigProviderProps) {
  const [base, setBase] = React.useState<string>(
    initialBase ?? DEFAULT_ASSET_BASE,
  );

  React.useEffect(() => {
    if (initialBase) return; // skip fetch when caller provides value
    getConfigPromise().then((cfg) => {
      setBase(cfg.assetBaseUrl.replace(/\/$/, "")); // strip trailing slash
    });
  }, [initialBase]);

  return (
    <AssetConfigContext.Provider value={base}>
      {children}
    </AssetConfigContext.Provider>
  );
}

/**
 * Hook returning a function that resolves a relative asset path to a full URL.
 *
 *   const assetUrl = useAssetUrl();
 *   assetUrl('/pdfs/abc.pdf#page=1')  → 'https://r2.example.com/pdfs/abc.pdf#page=1'
 *                                         (or '/assets/pdfs/abc.pdf#page=1' in dev)
 *
 * The path should start with '/'. Fragment (#...) is preserved.
 */
export function useAssetUrl(): (path: string) => string {
  const base = useContext(AssetConfigContext);
  return React.useCallback(
    (path: string) => {
      // Preserve fragment: split on first '#', resolve base+path, reattach fragment
      const [pathPart, ...fragmentParts] = path.split("#");
      const fragment = fragmentParts.length > 0 ? `#${fragmentParts.join("#")}` : "";
      const normalizedPath = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
      return `${base}${normalizedPath}${fragment}`;
    },
    [base],
  );
}

/**
 * Directly export the context for advanced use (e.g., bypassing the hook).
 */
export { AssetConfigContext };
