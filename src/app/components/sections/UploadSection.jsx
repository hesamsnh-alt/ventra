
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Link from "next/link";
import {
  UploadCloud,
  FileText,
  Image,
  FileSpreadsheet,
  FolderOpen,
  ArrowRight,
} from "lucide-react";

export default function UploadSection() {
  return (
    <LocalizedElement as="section" className="upload-section" id="upload">
      <LocalizedElement as="div" className="upload-container">

        <LocalizedElement as="div" className="upload-left">

          <LocalizedElement as="span" className="upload-badge">
            AI Project Upload
          </LocalizedElement>

          <LocalizedElement as="h2">
            Upload your project.
            <LocalizedElement as="br" />
            Let AI do the hard work.
          </LocalizedElement>

          <LocalizedElement as="p">
            Upload drawings, BOQ files, specifications or images.
            Ventra automatically prepares your project for estimation,
            quotations and project management.
          </LocalizedElement>

          <LocalizedElement as="div" className="upload-files">

            <LocalizedElement as="span">
              <FileText size={16}/>
              PDF
            </LocalizedElement>

            <LocalizedElement as="span">
              <FolderOpen size={16}/>
              DWG
            </LocalizedElement>

            <LocalizedElement as="span">
              <FileSpreadsheet size={16}/>
              XLSX
            </LocalizedElement>

            <LocalizedElement as="span">
              <Image size={16} aria-label="Image file" />
              JPG
            </LocalizedElement>

            <LocalizedElement as="span">
              IFC
            </LocalizedElement>

            <LocalizedElement as="span">
              DXF
            </LocalizedElement>

          </LocalizedElement>

        </LocalizedElement>

        <LocalizedElement as="div" className="upload-right">

          <LocalizedElement as="div" className="dropzone">

            <UploadCloud
              size={70}
              strokeWidth={1.5}
            />

            <LocalizedElement as="h3">
              Open your project upload
            </LocalizedElement>

            <LocalizedElement as="p">
              PDF • DWG • IFC • DXF • XLSX • Images
            </LocalizedElement>

            <LocalizedLink  href="/tools/drawings">

              Open Project Upload

              <ArrowRight size={18}/>

            </LocalizedLink>

          </LocalizedElement>

          <LocalizedElement as="div" className="upload-status">

            <LocalizedElement as="div" className="status-item">
              ✓ AI Ready
            </LocalizedElement>

            <LocalizedElement as="div" className="status-item">
              ✓ BOQ Generation
            </LocalizedElement>

            <LocalizedElement as="div" className="status-item">
              ✓ Cost Estimation
            </LocalizedElement>

            <LocalizedElement as="div" className="status-item">
              ✓ Project Dashboard
            </LocalizedElement>

          </LocalizedElement>

        </LocalizedElement>

      </LocalizedElement>
    </LocalizedElement>
  );
}
