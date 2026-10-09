"use client";

import { create } from "zustand";
import {
  calculateGrandTotal,
  calculateRow,
} from "../utils/calculations";
import { DEFAULT_SECTION } from "../constants/sections";
import { DEFAULT_UNIT } from "../constants/units";

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `boq-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function createEmptyRow(overrides = {}) {
  return calculateRow({
    id: createId(),
    itemNo: "",
    description: "",
    section: DEFAULT_SECTION,
    unit: DEFAULT_UNIT,
    quantity: 0,
    unitRate: 0,
    total: 0,
    confidence: null,
    sourcePage: null,
    sourceType: "manual",
    notes: "",
    ...overrides,
  });
}

function normalizeImportedRow(row = {}, index = 0) {
  return calculateRow({
    id: row.id || createId(),
    itemNo:
      row.itemNo ??
      row.item_no ??
      row.code ??
      `${index + 1}`,
    description:
      row.description ??
      row.item ??
      row.name ??
      "",
    section:
      row.section ??
      row.category ??
      DEFAULT_SECTION,
    unit:
      row.unit ??
      row.uom ??
      DEFAULT_UNIT,
    quantity:
      row.quantity ??
      row.qty ??
      0,
    unitRate:
      row.unitRate ??
      row.unit_rate ??
      row.rate ??
      0,
    confidence:
      row.confidence ?? null,
    sourcePage:
      row.sourcePage ??
      row.source_page ??
      row.page ??
      null,
    sourceType:
      row.sourceType ??
      row.source_type ??
      "ai",
    notes:
      row.notes ??
      "",
  });
}

function recalculateRows(rows) {
  return rows.map((row) => calculateRow(row));
}

function getTotals(rows, vatRate) {
  return calculateGrandTotal(rows, vatRate);
}

const initialRows = [createEmptyRow()];

const initialTotals = getTotals(initialRows, 5);

export const useBoqStore = create((set, get) => ({
  rows: initialRows,

  vatRate: 5,

  subtotal: initialTotals.subtotal,

  vat: initialTotals.vat,

  grandTotal: initialTotals.grandTotal,

  selectedRowIds: [],

  searchQuery: "",

  sectionFilter: "all",

  isDirty: false,

  lastUpdatedAt: null,

  setRows: (rows = []) => {
    const safeRows =
      Array.isArray(rows) && rows.length > 0
        ? recalculateRows(rows)
        : [createEmptyRow()];

    const totals = getTotals(
      safeRows,
      get().vatRate
    );

    set({
      rows: safeRows,
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  addRow: (overrides = {}) => {
    const currentRows = get().rows;

    const nextRows = [
      ...currentRows,
      createEmptyRow(overrides),
    ];

    const totals = getTotals(
      nextRows,
      get().vatRate
    );

    set({
      rows: nextRows,
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  insertRowAfter: (rowId, overrides = {}) => {
    const currentRows = get().rows;

    const rowIndex = currentRows.findIndex(
      (row) => row.id === rowId
    );

    const newRow = createEmptyRow(overrides);

    const nextRows =
      rowIndex === -1
        ? [...currentRows, newRow]
        : [
            ...currentRows.slice(0, rowIndex + 1),
            newRow,
            ...currentRows.slice(rowIndex + 1),
          ];

    const totals = getTotals(
      nextRows,
      get().vatRate
    );

    set({
      rows: nextRows,
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  updateRow: (rowId, updates = {}) => {
    const nextRows = get().rows.map((row) => {
      if (row.id !== rowId) {
        return row;
      }

      return calculateRow({
        ...row,
        ...updates,
      });
    });

    const totals = getTotals(
      nextRows,
      get().vatRate
    );

    set({
      rows: nextRows,
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  updateCell: (rowId, field, value) => {
    if (!field) {
      return;
    }

    get().updateRow(rowId, {
      [field]: value,
    });
  },

  deleteRow: (rowId) => {
    const filteredRows = get().rows.filter(
      (row) => row.id !== rowId
    );

    const nextRows =
      filteredRows.length > 0
        ? filteredRows
        : [createEmptyRow()];

    const totals = getTotals(
      nextRows,
      get().vatRate
    );

    set({
      rows: nextRows,
      selectedRowIds: get().selectedRowIds.filter(
        (id) => id !== rowId
      ),
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  deleteSelectedRows: () => {
    const selectedIds = get().selectedRowIds;

    if (selectedIds.length === 0) {
      return;
    }

    const filteredRows = get().rows.filter(
      (row) => !selectedIds.includes(row.id)
    );

    const nextRows =
      filteredRows.length > 0
        ? filteredRows
        : [createEmptyRow()];

    const totals = getTotals(
      nextRows,
      get().vatRate
    );

    set({
      rows: nextRows,
      selectedRowIds: [],
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  duplicateRow: (rowId) => {
    const currentRows = get().rows;

    const rowIndex = currentRows.findIndex(
      (row) => row.id === rowId
    );

    if (rowIndex === -1) {
      return;
    }

    const sourceRow = currentRows[rowIndex];

    const duplicatedRow = calculateRow({
      ...sourceRow,
      id: createId(),
      itemNo: sourceRow.itemNo
        ? `${sourceRow.itemNo}-COPY`
        : "",
      sourceType: "manual",
    });

    const nextRows = [
      ...currentRows.slice(0, rowIndex + 1),
      duplicatedRow,
      ...currentRows.slice(rowIndex + 1),
    ];

    const totals = getTotals(
      nextRows,
      get().vatRate
    );

    set({
      rows: nextRows,
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  clearBoq: () => {
    const rows = [createEmptyRow()];
    const totals = getTotals(
      rows,
      get().vatRate
    );

    set({
      rows,
      selectedRowIds: [],
      searchQuery: "",
      sectionFilter: "all",
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  importRows: (rows = [], options = {}) => {
    if (!Array.isArray(rows)) {
      return;
    }

    const normalizedRows = rows.map(
      normalizeImportedRow
    );

    const shouldReplace =
      options.replace !== false;

    const currentRows = get().rows;

    const nextRows = shouldReplace
      ? normalizedRows
      : [...currentRows, ...normalizedRows];

    const safeRows =
      nextRows.length > 0
        ? nextRows
        : [createEmptyRow()];

    const totals = getTotals(
      safeRows,
      get().vatRate
    );

    set({
      rows: safeRows,
      selectedRowIds: [],
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  importAiBoq: (aiResult, options = {}) => {
    const rows =
      aiResult?.items ??
      aiResult?.rows ??
      aiResult?.boq ??
      aiResult?.data?.items ??
      [];

    get().importRows(rows, options);
  },

  setVatRate: (value) => {
    const numericRate = Number(value);

    const vatRate = Number.isFinite(numericRate)
      ? Math.max(0, numericRate)
      : 0;

    const totals = getTotals(
      get().rows,
      vatRate
    );

    set({
      vatRate,
      ...totals,
      isDirty: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  recalculate: () => {
    const rows = recalculateRows(get().rows);

    const totals = getTotals(
      rows,
      get().vatRate
    );

    set({
      rows,
      ...totals,
      lastUpdatedAt: new Date().toISOString(),
    });
  },

  setSelectedRowIds: (ids = []) => {
    set({
      selectedRowIds: Array.isArray(ids)
        ? [...new Set(ids)]
        : [],
    });
  },

  toggleRowSelection: (rowId) => {
    const selectedIds = get().selectedRowIds;

    const nextSelectedIds = selectedIds.includes(
      rowId
    )
      ? selectedIds.filter((id) => id !== rowId)
      : [...selectedIds, rowId];

    set({
      selectedRowIds: nextSelectedIds,
    });
  },

  selectAllRows: () => {
    set({
      selectedRowIds: get().rows.map(
        (row) => row.id
      ),
    });
  },

  clearSelection: () => {
    set({
      selectedRowIds: [],
    });
  },

  setSearchQuery: (value = "") => {
    set({
      searchQuery: String(value),
    });
  },

  setSectionFilter: (value = "all") => {
    set({
      sectionFilter: value || "all",
    });
  },

  markSaved: () => {
    set({
      isDirty: false,
    });
  },

  resetStore: () => {
    const rows = [createEmptyRow()];
    const totals = getTotals(rows, 5);

    set({
      rows,
      vatRate: 5,
      selectedRowIds: [],
      searchQuery: "",
      sectionFilter: "all",
      isDirty: false,
      lastUpdatedAt: null,
      ...totals,
    });
  },
}));

export function getFilteredBoqRows(state) {
  const query = String(
    state.searchQuery || ""
  )
    .trim()
    .toLowerCase();

  return state.rows.filter((row) => {
    const matchesSection =
      state.sectionFilter === "all" ||
      row.section === state.sectionFilter;

    const searchableText = [
      row.itemNo,
      row.description,
      row.section,
      row.unit,
      row.notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesQuery =
      !query || searchableText.includes(query);

    return matchesSection && matchesQuery;
  });
}