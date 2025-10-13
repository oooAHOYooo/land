# AGSCOUT (Static)

Local-first scouting tools for land parcels and multifamily underwriting. No accounts; everything stays in your browser via localStorage.

## Structure

public/
- index.html (hub)
- land.html (Land Scout)
- multi.html (Multifamily Scout)
- js/
  - app-shared.js (shared helpers)
  - app-land.js (Land app)
  - app-multi.js (Multifamily app)

netlify.toml (deploy config)

## Local development

Use any static server to serve the `public` directory. For example:

```bash
npx serve public
```

Then open the printed URL. Data persists in localStorage per app.

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
