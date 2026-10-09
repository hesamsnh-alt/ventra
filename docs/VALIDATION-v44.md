# Ventra v44 validation

- Next.js: 16.3.8; React: 19.2.4.
- npm test: 205 passed, 0 failed, 0 skipped.
- Production build: npm run build -- --webpack succeeded, with placeholder Supabase configuration.
- Focused ESLint check: new language components, metadata/unit/estimate helpers, shared workspace, photos, unit confirmation and locale check script passed. A full legacy-project lint pass is not claimed.
- Turbopack development HTTP smoke check: home page returned 200 for en/fa/ar cookies; initial HTML lang and dir matched each locale, and localized pricing labels were present. This checks server rendering, not mouse/touch behavior.
- Translation catalog: 804 reviewed bilingual entries. Remaining static JSX UI text: 321. check:locales intentionally fails complete-coverage validation until these are translated. Dynamic/server error messages need a separate coverage pass.
- PGlite database tests verified installation/reinstallation, commercial usage controls, membership permissions and private shared documents. These are local tests; no migration was run against the user's live Supabase.
- Live paid Autodesk/OpenAI analysis, Stripe payment, the user's DWG and device-specific 3D camera behavior were not tested.

Consult README-START-HERE-FA.md before installation.
