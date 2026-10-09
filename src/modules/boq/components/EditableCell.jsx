"use client";

import { useState } from "react";

export default function EditableCell({
  value,
  type = "text",
  placeholder = "",
  disabled = false,
  className = "",
  onChange,
  onBlur,
}) {
  const [localValue, setLocalValue] = useState(value ?? "");

  const [sourceValue,setSourceValue]=useState(value);
  // Reset the draft when the external value changes, before rendering the input.
  if(sourceValue!==value){setSourceValue(value);setLocalValue(value??"");}

  function handleChange(event) {
    const nextValue = event.target.value;
    setLocalValue(nextValue);
  }

  function handleBlur() {
    let nextValue = localValue;

    if (type === "number") {
      const numeric = Number(localValue);
      nextValue = Number.isFinite(numeric) ? numeric : 0;
      setLocalValue(nextValue);
    }

    onChange?.(nextValue);
    onBlur?.(nextValue);
  }

  return (
    <input
      type={type === "number" ? "number" : "text"}
      value={localValue}
      placeholder={placeholder}
      disabled={disabled}
      onChange={handleChange}
      onBlur={handleBlur}
      className={[
        "w-full bg-transparent",
        "outline-none",
        "border border-transparent",
        "focus:border-yellow-400",
        "rounded",
        "px-2 py-1",
        className,
      ].join(" ")}
    />
  );
}