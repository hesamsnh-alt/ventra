# Ventra v44.1 hotfix

Start with [README-v44.1-HOTFIX-FA.md](README-v44.1-HOTFIX-FA.md) for the two-file upgrade from v44. No new database migration is required for this hotfix.

# Ventra v44

Start with [README-START-HERE-FA.md](README-START-HERE-FA.md). This is a complete source package based on the submitted ventra.zip.

Run scripts/INSTALL-VENTRA-v44.sql in the existing Supabase database, preserve your own .env.local, then run npm ci, npm test and npm run build -- --webpack.

English/Persian/Arabic selection, saved locale and RTL are implemented. Translation coverage is incomplete; the remaining static UI labels are recorded in docs/translation-review-static-ui.json. npm run check:locales intentionally reports incomplete coverage.

Local tests and production build do not certify live Supabase, Stripe, OpenAI or Autodesk integration or accuracy for every drawing. Historical version notes remain for reference; follow the v44 start guide for installation.
