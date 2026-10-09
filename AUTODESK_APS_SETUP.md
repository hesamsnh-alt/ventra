# Autodesk APS integration in Ventra

Server-side environment variables:

```env
APS_CLIENT_ID=your_client_id
APS_CLIENT_SECRET=your_client_secret
APS_BUCKET_KEY=optional_unique_bucket_key
APS_REGION=EMEA
APS_BUCKET_POLICY=transient
```

Available API routes:

- `GET /api/aps/token` tests server-to-server authentication.
- `POST /api/aps/upload` accepts `multipart/form-data` with a `file` field and uploads it to APS OSS.
- `POST /api/aps/translate` accepts JSON `{ "urn": "...", "rootFilename": "" }` and starts Model Derivative translation to SVF2.
- `GET /api/aps/status/:urn` returns the translation manifest.
- `GET /api/aps/viewer-token` returns a short-lived Viewer token.

Drawing analysis remains separate from Autodesk APS:

- PDF and image drawing analysis uses the existing OpenAI pipeline.
- DWG, RVT, IFC, and DXF files can be uploaded and translated through APS.
- Geometry/metadata extraction can be connected after the translation manifest reports success.

Do not prefix APS secrets with `NEXT_PUBLIC_` and never use them in client components.
