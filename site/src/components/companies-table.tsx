"use client";

/**
 * Client-side companies table with confidence chip display.
 */

import Link from "next/link";
import type { EntityTop } from "@/lib/data";
import { Cite } from "@/components/cite";

interface CompaniesTableProps {
  companies: EntityTop[];
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-red-100 text-red-700",
};

export function CompaniesTable({ companies }: CompaniesTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left">
          <tr>
            <th className="px-4 py-3 font-medium text-muted-foreground w-10 text-right">
              #
            </th>
            <th className="px-4 py-3 font-medium">Company</th>
            <th className="px-4 py-3 font-medium text-center w-24">
              UEIs
            </th>
            <th className="px-4 py-3 font-medium text-right">
              Total obligations ⁂
            </th>
            <th className="px-4 py-3 font-medium text-center w-28">
              Confidence
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {companies.map((c, i) => (
            <tr key={c.slug} className="hover:bg-muted/40 transition-colors">
              <td className="px-4 py-3 text-right text-muted-foreground/60 text-xs tabular-nums">
                {i + 1}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/company/${c.slug}/`}
                  className="font-medium hover:underline text-foreground"
                >
                  {c.display_name}
                </Link>
              </td>
              <td className="px-4 py-3 text-center text-muted-foreground tabular-nums">
                {c.uei_count}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                <Cite value={c.total_obligation} units="USD" />
              </td>
              <td className="px-4 py-3 text-center">
                <span
                  className={[
                    "inline-block rounded px-2 py-0.5 text-xs font-medium",
                    CONFIDENCE_COLORS[c.worst_confidence] ??
                      "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {c.worst_confidence}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
