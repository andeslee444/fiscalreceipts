import type { Metadata } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import Link from "next/link";
import "./globals.css";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Read built_at from site_meta.json at build time
function getBuiltAt(): string {
  try {
    const metaPath = join(process.cwd(), "..", "data", "site", "json", "site_meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    return meta.built_at ?? "";
  } catch {
    return "";
  }
}

const builtAt = getBuiltAt();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Federal defense budget data — every number citation-backed with PDF page-level provenance.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Skip link for keyboard / screen reader users */}
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>

        {/* ── Site Header ── */}
        <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
          <div className="container mx-auto flex h-14 items-center px-4 gap-6">
            <Link href="/" className="font-semibold text-foreground hover:text-primary">
              {SITE_NAME}
            </Link>

            <nav className="flex items-center gap-4 text-sm" aria-label="Main navigation">
              <Link href="/programs/" className="text-muted-foreground hover:text-foreground transition-colors">
                Programs
              </Link>
              <Link href="/companies/" className="text-muted-foreground hover:text-foreground transition-colors">
                Companies
              </Link>
              <Link href="/data/" className="text-muted-foreground hover:text-foreground transition-colors">
                Data
              </Link>
              <Link href="/methodology/" className="text-muted-foreground hover:text-foreground transition-colors">
                Methodology
              </Link>
            </nav>

            {/* Slots for search trigger (Task 7) and receipts toggle (Task 3) */}
            <div className="ml-auto flex items-center gap-2">
              {/* id="search-trigger-slot" — Task 7 fills this */}
              <div id="search-trigger-slot" />
              {/* id="receipts-toggle-slot" — Task 3 fills this */}
              <div id="receipts-toggle-slot" />
            </div>
          </div>
        </header>

        {/* ── Main Content ── */}
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>

        {/* ── Site Footer ── */}
        <footer className="border-t border-border mt-16 py-8 text-sm text-muted-foreground">
          <div className="container mx-auto px-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <span className="font-medium text-foreground">{SITE_NAME}</span>
              {" — "}
              <span>Federal defense budget data with citation provenance.</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-xs">
              {builtAt && (
                <span>
                  Data as of{" "}
                  <time dateTime={builtAt}>
                    {new Date(builtAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                </span>
              )}
              <Link href="/methodology/" className="hover:text-foreground transition-colors">
                Methodology
              </Link>
              <Link href="/downloads/" className="hover:text-foreground transition-colors">
                Downloads
              </Link>
              <Link href="/about/" className="hover:text-foreground transition-colors">
                About
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
