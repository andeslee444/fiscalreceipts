import type { MetadataRoute } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

function jsonDir(): string {
  return join(process.cwd(), "..", "data", "site", "json");
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(jsonDir(), rel), "utf8")) as T;
}

interface ProgramRow {
  pe_bli: string;
}
interface EntityTop {
  slug: string;
}
interface AgencyRow {
  org: string;
}
interface DistrictIndexRow {
  pop_district: string;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL.replace(/\/$/, "");
  const now = new Date().toISOString();

  // ── Static core pages ────────────────────────────────────────────────────
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/programs/`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/companies/`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/data/`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/downloads/`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/methodology/`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/about/`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
  ];

  // ── Dynamic program pages ─────────────────────────────────────────────────
  let programPages: MetadataRoute.Sitemap = [];
  try {
    const programs = readJson<ProgramRow[]>("programs.json");
    programPages = programs.map((p) => ({
      url: `${base}/program/${p.pe_bli}/`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    }));
  } catch {
    // sidecars not yet generated — sitemap will be incomplete
  }

  // ── Dynamic company pages ─────────────────────────────────────────────────
  let companyPages: MetadataRoute.Sitemap = [];
  try {
    const entities = readJson<EntityTop[]>("entities_top.json");
    companyPages = entities.map((e) => ({
      url: `${base}/company/${e.slug}/`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));
  } catch {
    // sidecars not yet generated
  }

  // ── Dynamic agency pages ──────────────────────────────────────────────────
  let agencyPages: MetadataRoute.Sitemap = [];
  try {
    const agencies = readJson<AgencyRow[]>("agencies.json");
    agencyPages = agencies.map((a) => ({
      url: `${base}/agency/${a.org}/`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    }));
  } catch {
    // sidecars not yet generated
  }

  // ── Feed page ─────────────────────────────────────────────────────────────
  const feedPages: MetadataRoute.Sitemap = [
    {
      url: `${base}/feed/`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    },
  ];

  // ── District pages ────────────────────────────────────────────────────────
  let districtPages: MetadataRoute.Sitemap = [];
  try {
    const districtIndex = readJson<{ districts: DistrictIndexRow[] }>(
      "districts/index.json",
    );
    const indexPage: MetadataRoute.Sitemap = [
      {
        url: `${base}/district/`,
        lastModified: now,
        changeFrequency: "monthly" as const,
        priority: 0.75,
      },
    ];
    districtPages = [
      ...indexPage,
      ...districtIndex.districts.map((d) => ({
        url: `${base}/district/${d.pop_district}/`,
        lastModified: now,
        changeFrequency: "monthly" as const,
        priority: 0.65,
      })),
    ];
  } catch {
    // sidecars not yet generated
  }

  return [
    ...staticPages,
    ...programPages,
    ...companyPages,
    ...agencyPages,
    ...feedPages,
    ...districtPages,
  ];
}
