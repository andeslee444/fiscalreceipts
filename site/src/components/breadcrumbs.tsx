import Link from "next/link";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/jsonld";

/**
 * Breadcrumbs — UI + BreadcrumbList JSON-LD (Task 8).
 * Renders a compact breadcrumb trail and injects schema.org BreadcrumbList.
 *
 * Usage:
 *   <Breadcrumbs items={[
 *     { label: "Home", href: "/" },
 *     { label: "Programs", href: "/programs/" },
 *     { label: "Defense Research Sciences" },
 *   ]} />
 */

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <>
      {/* BreadcrumbList JSON-LD — emitted alongside UI for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(breadcrumbListJsonLd(items)),
        }}
      />
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground mb-4">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {i > 0 && (
                <span aria-hidden="true" className="text-muted-foreground/50">
                  ›
                </span>
              )}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="hover:text-foreground transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "text-foreground font-medium" : ""}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
    </>
  );
}
