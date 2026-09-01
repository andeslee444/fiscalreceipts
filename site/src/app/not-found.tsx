import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Page Not Found",
  description: "The page you were looking for could not be found.",
};

export default function NotFound() {
  return (
    <div className="spine py-20 text-center">
      <h1 className="text-6xl font-bold text-muted-foreground/40 mb-4">404</h1>
      <h2 className="text-2xl font-bold mb-3">Page not found</h2>
      <p className="text-muted-foreground mb-8">
        The page you were looking for could not be found. It may have been
        moved or the URL may be incorrect.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          data-search-trigger
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          aria-label="Search for a program, company, or agency"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          Search {SITE_NAME}
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg border border-border bg-card text-foreground px-6 py-2.5 text-sm font-semibold hover:bg-muted transition-colors"
        >
          Home
        </Link>
        <Link
          href="/programs/"
          className="inline-flex items-center justify-center rounded-lg border border-border bg-card text-foreground px-6 py-2.5 text-sm font-semibold hover:bg-muted transition-colors"
        >
          Browse programs
        </Link>
      </div>
    </div>
  );
}
