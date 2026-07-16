"use client";

import { useState } from "react";
import {
  CalendarDays,
  Camera,
  CloudSun,
  HardHat,
  PackageCheck,
  Plus,
  TriangleAlert,
} from "lucide-react";

import "./ProjectDailyReports.css";

const initialReports = [
  {
    id: 1,
    date: "14 Jul 2026",
    author: "Reza Karimi",
    workers: 18,
    weather: "Sunny",
    progress: 4,
    materials: "Concrete and reinforcement steel delivered",
    issues: "No major issue reported",
    notes: "Structural works continued on the ground floor.",
  },
  {
    id: 2,
    date: "13 Jul 2026",
    author: "Reza Karimi",
    workers: 15,
    weather: "Hot",
    progress: 3,
    materials: "Block delivery completed",
    issues: "Two-hour delay in material delivery",
    notes: "Blockwork started in the service area.",
  },
];

export default function ProjectDailyReports() {
  const [reports, setReports] = useState(initialReports);
  const [formOpen, setFormOpen] = useState(false);

  const [formData, setFormData] = useState({
    workers: "",
    weather: "",
    progress: "",
    materials: "",
    issues: "",
    notes: "",
  });

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    const newReport = {
      id: Date.now(),
      date: new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      author: "Site Supervisor",
      workers: Number(formData.workers) || 0,
      weather: formData.weather || "Not recorded",
      progress: Number(formData.progress) || 0,
      materials: formData.materials || "No material update",
      issues: formData.issues || "No issue reported",
      notes: formData.notes || "No additional notes",
    };

    setReports((current) => [newReport, ...current]);

    setFormData({
      workers: "",
      weather: "",
      progress: "",
      materials: "",
      issues: "",
      notes: "",
    });

    setFormOpen(false);
  }

  return (
    <section className="daily-reports-panel">
      <div className="daily-reports-header">
        <div>
          <span>PROJECT RECORDS</span>
          <h2>Daily Reports</h2>
        </div>

        <button
          type="button"
          onClick={() => setFormOpen((current) => !current)}
        >
          <Plus size={17} />
          Add Report
        </button>
      </div>

      {formOpen && (
        <form className="daily-report-form" onSubmit={handleSubmit}>
          <div className="daily-report-form-grid">
            <label>
              Workers on Site
              <input
                type="number"
                name="workers"
                min="0"
                value={formData.workers}
                onChange={handleChange}
                placeholder="18"
              />
            </label>

            <label>
              Weather
              <input
                name="weather"
                value={formData.weather}
                onChange={handleChange}
                placeholder="Sunny"
              />
            </label>

            <label>
              Progress Today %
              <input
                type="number"
                name="progress"
                min="0"
                max="100"
                value={formData.progress}
                onChange={handleChange}
                placeholder="4"
              />
            </label>

            <label>
              Materials Delivered
              <input
                name="materials"
                value={formData.materials}
                onChange={handleChange}
                placeholder="Concrete, steel, blocks..."
              />
            </label>

            <label className="daily-report-full-field">
              Issues
              <textarea
                name="issues"
                value={formData.issues}
                onChange={handleChange}
                placeholder="Write any site issue or delay..."
              />
            </label>

            <label className="daily-report-full-field">
              Daily Notes
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Describe today's completed work..."
              />
            </label>
          </div>

          <div className="daily-report-form-actions">
            <button
              type="button"
              className="daily-report-cancel"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </button>

            <button type="submit" className="daily-report-save">
              Save Daily Report
            </button>
          </div>
        </form>
      )}

      <div className="daily-report-list">
        {reports.map((report) => (
          <article key={report.id} className="daily-report-card">
            <div className="daily-report-card-top">
              <div>
                <span>{report.author}</span>
                <h3>{report.date}</h3>
              </div>

              <strong>+{report.progress}% progress</strong>
            </div>

            <div className="daily-report-metrics">
              <div>
                <HardHat size={18} />
                <span>Workers</span>
                <strong>{report.workers}</strong>
              </div>

              <div>
                <CloudSun size={18} />
                <span>Weather</span>
                <strong>{report.weather}</strong>
              </div>

              <div>
                <PackageCheck size={18} />
                <span>Materials</span>
                <strong>{report.materials}</strong>
              </div>
            </div>

            <div className="daily-report-details">
              <div>
                <TriangleAlert size={17} />

                <div>
                  <span>Issues</span>
                  <p>{report.issues}</p>
                </div>
              </div>

              <div>
                <CalendarDays size={17} />

                <div>
                  <span>Work Summary</span>
                  <p>{report.notes}</p>
                </div>
              </div>
            </div>

            <button type="button" className="daily-report-photos">
              <Camera size={17} />
              Site Photos
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}