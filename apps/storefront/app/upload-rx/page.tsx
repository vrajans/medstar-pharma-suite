"use client";
import { useState } from "react";

export default function UploadRx() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <div className="space-y-4 rounded-lg bg-surface p-4">
      <h1 className="text-lg font-semibold">Upload prescription</h1>
      <ul className="list-disc pl-5 text-sm text-muted">
        <li>Doctor name, registration number and signature must be visible</li>
        <li>Patient name and date should be clear</li>
        <li>Photo or PDF, up to 10 MB</li>
      </ul>
      <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line p-4 text-sm">
        <span>📷 Take a photo or choose a file</span>
        <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null); }} />
      </label>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview && <img src={preview} alt="Prescription preview" className="max-h-80 rounded" />}
      {file && !sent && (
        <button onClick={() => setSent(true)} className="min-h-12 w-full rounded-lg bg-brand-700 text-white">Send to pharmacist</button>
      )}
      {sent && <p className="text-sm text-ok">Received. A registered pharmacist will review it and add the medicines to your order. You can also call the store.</p>}
      <p className="text-xs text-muted">Production: uploads go to the private Supabase Storage bucket <code>prescriptions/&lt;org&gt;/&lt;customer&gt;/</code> and are viewable only by the store pharmacist through short-lived signed links.</p>
    </div>
  );
}
