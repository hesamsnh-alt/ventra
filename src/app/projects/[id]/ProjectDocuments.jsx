"use client";

import { useRef, useState } from "react";
import {
  File,
  FileImage,
  FileText,
  FolderOpen,
  Trash2,
  UploadCloud,
} from "lucide-react";

import "./ProjectDocuments.css";

function getFileIcon(fileName) {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (["jpg", "jpeg", "png", "webp"].includes(extension)) {
    return FileImage;
  }

  if (["pdf", "doc", "docx", "txt"].includes(extension)) {
    return FileText;
  }

  return File;
}

function formatFileSize(size) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectDocuments() {
  const fileInputRef = useRef(null);

  const [documents, setDocuments] = useState([
  {
    id: 1,
    name: "Architectural Rev01.pdf",
    category: "Drawings",
    revision: "Rev 01",
    status: "Approved",
    size: "4.8 MB",
    uploadedBy: "Ahmed",
    uploadedDate:"14 Jul 2026",
    version:1,
  },
  {
    id: 2,
    name: "Structural BOQ.xlsx",
    category: "BOQ",
    revision: "Rev 03",
    status: "Pending",
    size: "820 KB",
    uploadedBy: "Reza",
  },
]);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFiles(event) {
   const newDocuments = selectedFiles.map((file) => ({
  id: `${file.name}-${file.lastModified}`,
  name: file.name,
  size: formatFileSize(file.size),
  type: "Project File",
  uploadedBy: "Current User",
}));

    setDocuments((currentDocuments) => [
      ...newDocuments,
      ...currentDocuments,
    ]);

    event.target.value = "";
  }

  function removeDocument(documentId) {
    setDocuments((currentDocuments) =>
      currentDocuments.filter(
        (document) => document.id !== documentId
      )
    );
  }

  return (
    <section className="documents-panel">
      <div className="documents-header">
        <div>
          <span>PROJECT FILES</span>
          <h2>Drawings & Documents</h2>
        </div>

        <button type="button" onClick={openFilePicker}>
          <UploadCloud size={17} />
          Upload Files
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.dwg,.dxf,.ifc,.xlsx,.xls,.jpg,.jpeg,.png"
          onChange={handleFiles}
          hidden
        />
      </div>

      <button
        type="button"
        className="documents-dropzone"
        onClick={openFilePicker}
      >
        <div className="documents-upload-icon">
          <FolderOpen size={34} />
        </div>

        <strong>Drop project files here</strong>

        <span>
          PDF, DWG, DXF, IFC, Excel and project images
        </span>
      </button>

      <div className="documents-list">
        {documents.length === 0 ? (
          <div className="documents-empty">
            No project files uploaded yet.
          </div>
        ) : (
                   documents.map((document) => {
            const Icon = getFileIcon(document.name);

            return (
              <article
                key={document.id}
                className="document-item"
              >
                <div className="document-icon">
                  <Icon size={22} />
                </div>

                <div className="document-info">
                  <strong>{document.name}</strong>

                  <span>
                    {document.category} · {document.size}
                  </span>

                  <div className="document-tags">
                    <span className="revision-tag">
                      {document.revision}
                    </span>

                    <span
                      className={`status-tag ${document.status.toLowerCase()}`}
                    >
                      {document.status}
                    </span>
                  </div>
                </div>

                <div className="document-user">
                  <span>Version {document.version}</span>
                  <strong>{document.uploadedBy}</strong>
                  <small>{document.uploadedDate}</small>
                </div>

                <button
                  type="button"
                  className="document-delete"
                  onClick={() => removeDocument(document.id)}
                  aria-label={`Remove ${document.name}`}
                >
                  <Trash2 size={17} />
                </button>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}