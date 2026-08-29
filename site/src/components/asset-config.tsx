"use client";

/**
 * Runtime asset configuration provider.
 *
 * The asset base URL is NOT baked into the build. Instead, it is read at
 * runtime from /config.json (committed pointing at the R2 host; rewritten by
 * scripts/launch/rewrite-config.mjs on a deploy, and answered as "/assets" by
 * scripts/serve-static.mjs so the gate suite stays hermetic). One build
 * artifact therefore works in both gated and prod environments.
 *
 * Tri-persona review Wave 4, item 1 — `ssrBase`. The FIRST paint used to fall
 * back to DEFAULT_ASSET_BASE ("/assets") unconditionally, which is what
 * `curl https://fiscalreceipts.com/downloads/` sees: fifteen download links
 * to a path nothing serves. `ssrBase` seeds that first value from the SAME
 * config.json at build time (lib/asset-base.ts) so the static HTML carries
 * working absolute URLs, while the runtime fetch below still has the last
 * word — a deploy that re-points the host does not need a rebuild, and the
 * local gate suite still resolves to its own /assets/.
 *
 * Usage:
 *   <AssetConfigProvider ssrBase={getAssetBase()}>
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

/**
 * Has the RUNTIME /config.json answer landed yet?
 *
 * Wave 4: with `ssrBase` seeding an absolute production host, a consumer that
 * probes the asset bundle on mount would fire its first probe at prod R2 even
 * on 127.0.0.1 — CORS-blocked, so `/downloads/` would flash its
 * "not attached to this deployment" banner on every local page load before
 * hydration corrected the base. Consumers that probe wait on this instead of
 * racing the fetch.
 */
const AssetConfigResolvedContext = createContext<boolean>(false);

interface AssetConfigProviderProps {
  children: React.ReactNode;
  /** Pre-resolved base for SSR/test scenarios (skips fetch). */
  initialBase?: string;
  /**
   * Build-time seed for the first paint (lib/asset-base.ts). Unlike
   * `initialBase` this does NOT skip the runtime fetch — it only decides what
   * the static HTML says before hydration.
   */
  ssrBase?: string;
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
  ssrBase,
}: AssetConfigProviderProps) {
  const [base, setBase] = React.useState<string>(
    initialBase ?? ssrBase ?? DEFAULT_ASSET_BASE,
  );
  const [resolved, setResolved] = React.useState<boolean>(
    initialBase !== undefined,
  );

  React.useEffect(() => {
    if (initialBase) return; // skip fetch when caller provides value
    getConfigPromise().then((cfg) => {
      setBase(cfg.assetBaseUrl.replace(/\/$/, "")); // strip trailing slash
      setResolved(true);
    });
  }, [initialBase]);

  return (
    <AssetConfigContext.Provider value={base}>
      <AssetConfigResolvedContext.Provider value={resolved}>
        {children}
      </AssetConfigResolvedContext.Provider>
    </AssetConfigContext.Provider>
  );
}

/** True once the runtime /config.json answer has been applied. */
export function useAssetConfigResolved(): boolean {
  return useContext(AssetConfigResolvedContext);
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
