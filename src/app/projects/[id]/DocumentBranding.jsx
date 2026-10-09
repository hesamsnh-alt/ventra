"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import { useState, useSyncExternalStore } from "react";
import { emptyBranding } from "@/lib/commercialDocument.mjs";
import "./DocumentBranding.css";

const eventName = "ventra:document-branding";
function subscribe(callback) {
  window.addEventListener("storage", callback);
  window.addEventListener(eventName, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(eventName, callback); };
}
export function useDocumentBranding(projectId) {
  const key = `ventra:document-branding:${projectId}`;
  const raw = useSyncExternalStore(subscribe, () => { try { return window.localStorage.getItem(key) || ""; } catch { return ""; } }, () => "");
  let branding = emptyBranding;
  try { branding = { ...emptyBranding, ...JSON.parse(raw || "{}") }; } catch {}
  function updateBranding(next) {
    window.localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(eventName));
  }
  return [branding, updateBranding];
}
export default function DocumentBranding({ branding, onChange }) {
  const [error, setError] = useState("");
  function update(field, value) {
    try { onChange({ ...branding, [field]: value }); setError(""); }
    catch { setError("Branding could not be saved. Browser storage may be full or unavailable."); }
  }
  async function upload(field, file) {
    if (!file) return;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error("Use PNG, JPG or WebP up to 2 MB.");
      const bitmap = await createImageBitmap(file);
      const ratio = Math.min(1, (field === "logo" ? 600 : 1600) / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      update(field, canvas.toDataURL("image/png"));
    } catch (cause) { setError(cause.message || "Image could not be loaded."); }
  }
  return <>
    <LocalizedElement as="details" className="document-branding-editor commercial-no-print"><LocalizedElement as="summary">Company logo and letterhead</LocalizedElement>
      <LocalizedElement as="div" className="document-branding-fields">{[["companyName", "Company name"], ["address", "Address"], ["contact", "Phone / Email"], ["taxNumber", "Tax registration number"]].map(([field, label]) => <LocalizedElement as="label" key={field}>{label}<LocalizedElement as="input" value={branding[field]} onChange={(event) => update(field, event.target.value)} /></LocalizedElement>)}</LocalizedElement>
      {["logo", "letterhead"].map((field) => <LocalizedElement as="label" key={field}>{field === "logo" ? "Company logo" : "Letterhead header image"}<LocalizedElement as="input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { upload(field, event.target.files?.[0]); event.target.value = ""; }} />{branding[field] && <LocalizedElement as="button" type="button" onClick={() => update(field, "")}>Remove {field}</LocalizedElement>}</LocalizedElement>)}
      <LocalizedElement as="small">Saved in this browser draft. Use Save shared version to sync it across devices. Included in print/PDF.</LocalizedElement>
      {error && <LocalizedElement as="p" role="alert">{error}</LocalizedElement>}
    </LocalizedElement>
    <DocumentHeader branding={branding} />
  </>;
}
export function DocumentHeader({ branding }) {
  const safeImage = (value) => /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value || "");
  return <LocalizedElement as="header" className="commercial-document-header">
    {safeImage(branding.letterhead) && <LocalizedElement as="img" className="commercial-letterhead" src={branding.letterhead} alt="Company letterhead" />}
    <LocalizedElement as="div" className="commercial-company">{safeImage(branding.logo) && <LocalizedElement as="img" className="commercial-logo" src={branding.logo} alt="Company logo" />}<LocalizedElement as="div"><LocalizedElement as="strong">{branding.companyName}</LocalizedElement><LocalizedElement as="p">{branding.address}</LocalizedElement><LocalizedElement as="p">{branding.contact}</LocalizedElement>{branding.taxNumber && <LocalizedElement as="p">TRN: {branding.taxNumber}</LocalizedElement>}</LocalizedElement></LocalizedElement>
  </LocalizedElement>;
}
