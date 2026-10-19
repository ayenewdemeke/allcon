# conkit

A lightweight everyday toolkit for construction projects, for engineers and architects
rather than whole companies. Live at https://conkit.app.

- **Drawings:** PDF sets on the APS Viewer; measure, mark up, export marked-up PDFs and
  share read-only links.
- **Plan review:** check sheets against design manuals in the library; findings cite
  manual sections and can be kept as markups.
- **Estimate:** import a schedule of values, map model elements and sheet measurements to
  it, and export priced quantities.
- **Models:** Revit / IFC through APS Model Derivative, with element quantities.

Stack: Next.js 16 (App Router) · TypeScript · Prisma 7 + PostgreSQL (Neon) · Better Auth ·
Tailwind + shadcn/ui (Base UI) · Autodesk Platform Services (OSS, Model Derivative, Viewer).

## 3D models from drawings

AI apps connected through MCP build 3D models two ways:

- **conkit's model format** (`src/lib/ifc/spec.ts`): structural and architectural elements as
  profiles swept along paths, doors and windows in host walls, rooms. Compiled to IFC4X3 by
  `src/lib/ifc/compile.ts` and viewed in the browser (web-ifc + three.js).
- **Detailed models**: real IFC edited with IfcOpenShell through whitelisted `ifcopenshell.api`
  operations. The engine is a Python function, `api/ifc.py`, deployed by Vercel alongside the
  app (dependencies in `requirements.txt`). Only conkit's server can call it.

To run the IfcOpenShell engine locally (port 5328, where the dev server looks for it):

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
npm run dev:ifc
```

## Setup

1. `npm install` (also generates the Prisma client)
2. `cp .env.example .env.local` and fill it in (each variable is documented there):
   - **Neon**: pooled `DATABASE_URL` and direct `DIRECT_URL`.
   - **BETTER_AUTH_SECRET**: `openssl rand -base64 32`.
   - **APS**: a "Traditional Web App" with the Data Management and Model Derivative APIs.
     Register `http://localhost:3000/api/auth/callback/autodesk` as a callback URL.
3. `npm run db:deploy` to apply migrations
4. `npm run dev` and open http://localhost:3000

## Sign-in

Handled by Better Auth (`src/lib/auth.ts`). Methods, in the order shown:

1. **Autodesk** (always on): OAuth via the APS app above.
2. **Google** (optional): set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; redirect URI
   `{APP_URL}/api/auth/callback/google`.
3. **Email link** (always on): sent through Resend when `RESEND_API_KEY`/`EMAIL_FROM` are
   set; in development without them, the link is printed in the dev server console.

Accounts with the same email are linked, and every new user gets their own organization.

## How the upload path works

1. The browser asks `POST /api/projects/:id/models` for signed S3 URLs and uploads the file
   directly to the app's APS bucket, so the file never goes through our server.
2. `POST /api/models/:id/complete` finalizes the upload and starts an SVF2 translation.
3. The project page polls `GET /api/models/:id/status`, which syncs the APS manifest.
4. When the model is ready, it opens in the APS Viewer.

## Pricing: line items, mapping, report

- **Line items** (`/line-items`): import a schedule of values or bill of quantities from
  .xlsx/.csv. The importer finds the header row, guesses columns, treats figure-less rows as
  section headings and LS/amount-only rows as lump sums. Units are normalised (`cu yd` → `CY`).
  Try it with `samples/riverside-schedule-of-values.xlsx` (regenerate with
  `node scripts/make-sample-sov.mjs`).
- **Mapping** (`/mapping`): element groups (category + type) are mapped to line items as
  rules, re-applied to every new model version. Suggestions combine text similarity, a
  UNIFORMAT → MasterFormat crosswalk on Revit's Assembly Code, element-type agreement and unit
  compatibility; nothing is applied until accepted. 2D measurements are assigned per markup, or
  automatically via "New measurements go to" in the sheet panel.
- **Report** (`/report`): contract vs. model vs. drawing quantities per line, variance flags,
  quantity-source breakdown and unmapped groups; **Export to Excel** adds the element- and
  measurement-level detail behind every line.

## Drawing sheets (2D)

PDF sets upload straight to the APS bucket, like models. The browser reads page sizes and
sheet numbers with pdf.js during upload, and each page becomes a `Sheet`; the PDF itself is
never split. A sheet opens in the **APS Viewer** (`Autodesk.PDF`), with **Edit2D** for
lengths and areas (snapping to linework, vertex editing, undo) and our SVG overlay for counts,
notes, arrows, clouds and value labels. The Viewer reads the PDF through
`GET /api/drawings/:id/pdf`, which passes Range requests through to storage and lets the
browser cache the file. Markups are stored as PDF-point coordinates; values are computed from
the sheet's scale, so recalibrating updates every measurement.

## Model data storage

Only the slim element rows needed for mapping and valuation go in Postgres. The complete
Model Derivative property dump for each model version is kept as one gzipped JSON file in
storage (`model_version.properties_object_key`), so elements can be re-extracted without
calling APS again.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | Route type generation + `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run db:migrate` | Create/apply a migration after editing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply existing migrations (CI / production) |
| `npm run db:studio` | Browse the database |

## Deploying (Vercel)

Set the same env vars in Vercel with `APP_URL` pointing at the deployed domain, and register
`{APP_URL}/api/auth/callback/autodesk` (and the Google one, if used) with each provider. Run
`npm run db:deploy` against the production database before the first deploy.
