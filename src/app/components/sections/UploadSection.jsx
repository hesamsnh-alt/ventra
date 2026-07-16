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
    <section className="upload-section" id="upload">
      <div className="upload-container">

        <div className="upload-left">

          <span className="upload-badge">
            AI Project Upload
          </span>

          <h2>
            Upload your project.
            <br />
            Let AI do the hard work.
          </h2>

          <p>
            Upload drawings, BOQ files, specifications or images.
            Ventra automatically prepares your project for estimation,
            quotations and project management.
          </p>

          <div className="upload-files">

            <span>
              <FileText size={16}/>
              PDF
            </span>

            <span>
              <FolderOpen size={16}/>
              DWG
            </span>

            <span>
              <FileSpreadsheet size={16}/>
              XLSX
            </span>

            <span>
              <Image size={16}/>
              JPG
            </span>

            <span>
              IFC
            </span>

            <span>
              DXF
            </span>

          </div>

        </div>

        <div className="upload-right">

          <div className="dropzone">

            <UploadCloud
              size={70}
              strokeWidth={1.5}
            />

            <h3>
              Drag & Drop Files
            </h3>

            <p>
              PDF • DWG • IFC • DXF • XLSX • Images
            </p>

            <button>

              Choose Files

              <ArrowRight size={18}/>

            </button>

          </div>

          <div className="upload-status">

            <div className="status-item">
              ✓ AI Ready
            </div>

            <div className="status-item">
              ✓ BOQ Generation
            </div>

            <div className="status-item">
              ✓ Cost Estimation
            </div>

            <div className="status-item">
              ✓ Project Dashboard
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}