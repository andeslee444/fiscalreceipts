// Minimal placeholder — Task 4b replaces this with full home page.
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold mb-4">GovBudget</h1>
      <p className="text-muted-foreground mb-8">
        Federal defense budget data — every number citation-backed with PDF page-level
        provenance.
      </p>
      <nav className="flex flex-col gap-2">
        <Link href="/programs/" className="text-primary hover:underline">
          Browse Programs →
        </Link>
        <Link href="/companies/" className="text-primary hover:underline">
          Browse Companies →
        </Link>
        <Link href="/data/" className="text-primary hover:underline">
          Explore Data →
        </Link>
        <Link href="/methodology/" className="text-primary hover:underline">
          Methodology →
        </Link>
      </nav>
    </div>
  );
}
