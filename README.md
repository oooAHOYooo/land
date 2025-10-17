# AGSCOUT (Static)

Local-first scouting tools for land parcels, single-family, and multifamily underwriting. No accounts; everything stays in your browser via localStorage. You can also keep local JSON files under `public/data` that auto-load on page open.

## Structure

public/
- index.html (hub)
- land.html (Land Scout)
- multi.html (Multifamily Scout)
- single.html (Single Family Scout)
- js/
  - app-shared.js (shared helpers)
  - app-land.js (Land app)
  - app-multi.js (Multifamily app)
  - app-single.js (Single Family app)
 - data/
  - land.json (optional; auto-merged into Land)
  - multi.json (optional; auto-merged into Multifamily)
  - single.json (optional; auto-merged into Single Family)

netlify.toml (deploy config)

## Local development

Use any static server to serve the `public` directory. For example:

```bash
npx serve public
```

Then open the printed URL. Data persists in localStorage per app.

### Optional: Local JSON files

Place arrays of rows in:

- `public/data/land.json`
- `public/data/multi.json`
- `public/data/single.json`

On load, each app fetches its JSON (if present) and merges rows into localStorage using a stable `id` derived from key address fields. This lets you copy/paste from Zillow or other sources into JSON and have it appear automatically.

Schemas (all fields optional unless noted):

Land (`app-land.js`):

```
State, County, Town, Parcel, Acres, Price, WaterProximity, Link, Lat, Lon, Tag, Note, CommuteMin, Walkable, WaterVibe, Joy
```

Multifamily (`app-multi.js`):

```
Address, City, State, Units, RentPerUnit, VacancyPercent, OtherIncomeMonthly, TaxesAnnual, InsuranceAnnual, OpExAnnual, Price, DownPercent, RatePercent, TermYears, HOAmonthly, Notes, Tag, Lat, Lon, Link
```

Single Family (`app-single.js`):

```
Address, City, State, Beds, Baths, Sqft, Price, RentZestimate, TaxesAnnual, InsuranceAnnual, HOAmonthly, Notes, Tag, Lat, Lon, Link
```

Tips:

- Use `Tag` to control map pins (e.g., `shortlist`, `visit`).
- Coordinates (`Lat`,`Lon`) are optional but required for map pins.
- You can still use Import CSV/JSON in the UI to add data manually.

## Deploy to Netlify

- Connect the repo to Netlify
- Publish directory: `public`
- Build command: none

`netlify.toml` already sets:

```toml
[build]
  publish = "public"
  functions = "netlify/functions"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```
