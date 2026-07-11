"use client";

export default function Card({ children, className = "" }) {
  return (
    <div className={`vt-card ${className}`}>
      {children}
    </div>
  );
}