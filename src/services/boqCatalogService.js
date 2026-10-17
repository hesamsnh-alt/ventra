import "server-only";

import { createClient } from "@supabase/supabase-js";

function createServerSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing."
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is missing."
    );
  }

  return createClient(url, key, {
    db: {
      schema: "public",
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function fetchAllActivePriceItems(
  supabase
) {
  const pageSize = 1000;
  const rows = [];

  for (
    let from = 0;
    ;
    from += pageSize
  ) {
    const { data, error } =
      await supabase
        .from("price_items")
        .select("*")
        .eq("is_active", true)
        .order("item_code", {
          ascending: true,
        })
        .range(
          from,
          from + pageSize - 1
        );

    if (error) {
      throw error;
    }

    const page =
      Array.isArray(data)
        ? data
        : [];

    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows;
}

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function normalizeUnit(value) {
  return clean(value)
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/\s+/g, "");
}

function quantityCapability(item) {
  const unit =
    normalizeUnit(item?.unit);

  if (
    [
      "m2",
      "sqm",
      "sq.m",
      "m²",
    ].includes(unit)
  ) {
    return {
      quantityType: "area",
      status: "measurable_when_geometry_available",
    };
  }

  if (
    [
      "m",
      "lm",
      "lin.m",
      "linear.m",
    ].includes(unit)
  ) {
    return {
      quantityType: "length",
      status: "measurable_when_geometry_available",
    };
  }

  if (
    [
      "m3",
      "cum",
      "cu.m",
      "m³",
    ].includes(unit)
  ) {
    return {
      quantityType: "volume",
      status: "measurable_when_geometry_available",
    };
  }

  if (
    [
      "no",
      "nos",
      "nr",
      "item",
      "each",
      "ea",
      "set",
      "point",
      "unit",
    ].includes(unit)
  ) {
    return {
      quantityType: "count",
      status: "measurable_when_object_count_available",
    };
  }

  return {
    quantityType: "unknown",
    status: "review_required",
  };
}

export async function loadBoqDatabaseCatalog() {
  const supabase =
    createServerSupabase();

  const [
    sectionsResult,
    priceItems,
  ] =
    await Promise.all([
      supabase
        .from("boq_sections")
        .select(
          "section_code, section_name, sort_order, is_active"
        )
        .eq("is_active", true)
        .order("sort_order", {
          ascending: true,
        }),

      fetchAllActivePriceItems(
        supabase
      ),
    ]);

  if (sectionsResult.error) {
    throw sectionsResult.error;
  }

  const sections =
    Array.isArray(
      sectionsResult.data
    )
      ? sectionsResult.data
      : [];

  const itemsBySection =
    new Map();

  for (const item of priceItems) {
    const sectionCode =
      clean(
        item.section_code
      ) || "UNASSIGNED";

    if (
      !itemsBySection.has(
        sectionCode
      )
    ) {
      itemsBySection.set(
        sectionCode,
        []
      );
    }

    const capability =
      quantityCapability(item);

    itemsBySection
      .get(sectionCode)
      .push({
        itemCode:
          clean(item.item_code),
        description:
          clean(item.description),
        category:
          clean(item.category),
        subCategory:
          clean(
            item.sub_category
          ),
        unit:
          clean(item.unit),
        standardRate:
          Number(
            item.standard_rate
          ) || 0,
        economyRate:
          Number(
            item.economy_rate
          ) || 0,
        premiumRate:
          Number(
            item.premium_rate
          ) || 0,
        materialRate: Number(item.material_rate) || 0,
        laborRate: Number(item.labor_rate) || 0,
        equipmentRate: Number(item.equipment_rate) || 0,
        transportRate: Number(item.transport_rate) || 0,
        quantityType:
          capability.quantityType,
        quantityStatus:
          capability.status,
        sourceName:
          clean(
            item.source_name
          ),
        confidenceScore:
          Number(
            item.confidence_score
          ) || 0,
      });
  }

  const knownSectionCodes =
    new Set(
      sections.map(
        (section) =>
          clean(
            section.section_code
          )
      )
    );

  const catalogSections =
    sections.map(
      (section) => {
        const code =
          clean(
            section.section_code
          );

        const items =
          itemsBySection.get(
            code
          ) || [];

        const categories =
          [
            ...new Set(
              items
                .map(
                  (item) =>
                    item.category
                )
                .filter(Boolean)
            ),
          ];

        const subCategories =
          [
            ...new Set(
              items
                .map(
                  (item) =>
                    item.subCategory
                )
                .filter(Boolean)
            ),
          ];

        return {
          sectionCode:
            code,
          sectionName:
            clean(
              section.section_name
            ),
          sortOrder:
            Number(
              section.sort_order
            ) || 0,
          itemCount:
            items.length,
          categories,
          subCategories,
          items,
        };
      }
    );

  for (
    const [
      sectionCode,
      items,
    ] of itemsBySection.entries()
  ) {
    if (
      knownSectionCodes.has(
        sectionCode
      )
    ) {
      continue;
    }

    catalogSections.push({
      sectionCode,
      sectionName:
        "Unmapped Database Items",
      sortOrder: 9999,
      itemCount:
        items.length,
      categories: [
        ...new Set(
          items
            .map(
              (item) =>
                item.category
            )
            .filter(Boolean)
        ),
      ],
      subCategories: [
        ...new Set(
          items
            .map(
              (item) =>
                item.subCategory
            )
            .filter(Boolean)
        ),
      ],
      items,
    });
  }

  const measurableCount =
    priceItems.reduce(
      (count, item) =>
        quantityCapability(
          item
        ).status !==
        "review_required"
          ? count + 1
          : count,
      0
    );

  return {
    source:
      "supabase_database",
    sectionCount:
      catalogSections.length,
    priceItemCount:
      priceItems.length,
    measurableCandidateCount:
      measurableCount,
    reviewRequiredCount:
      priceItems.length -
      measurableCount,
    sections:
      catalogSections.sort(
        (a, b) =>
          a.sortOrder -
          b.sortOrder ||
          a.sectionCode.localeCompare(
            b.sectionCode
          )
      ),
  };
}
