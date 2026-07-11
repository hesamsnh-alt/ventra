export default function UploadSection() {
  return (
    <section className="upload-section">
      <div className="upload-container">
        <div className="upload-content">
          <span className="upload-badge">Upload & Analyze</span>

          <h2>Upload your project files and let Ventra estimate faster.</h2>

          <p>
            Upload drawings, BOQ files, images, or documents. Ventra helps you
            organize project data and prepare smarter quotations.
          </p>

          <div className="upload-box">
            <div className="upload-icon">↑</div>
            <h3>Drag & drop your files here</h3>
            <p>PDF, DWG, Excel, Images</p>
            <button>Choose File</button>
          </div>
        </div>
      </div>
    </section>
  );
}