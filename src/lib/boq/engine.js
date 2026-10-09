import {
  calculateQuantity,
} from "./formulas";

import {
  resolveGeometry,
} from "./geometry";

import {
  calculateAmount,
  getSelectedRate,
} from "./pricing";

import {
  validateRule,
} from "./validator";

import {
  logger,
} from "./logger";

import {
  normalizeTakeoff,
  round,
  toNumber,
} from "./utils";

async function loadBOQData(
  supabase
) {
  const [
    rulesResult,
    pricesResult,
    sectionsResult,
  ] = await Promise.all([
    supabase
      .from("boq_rules")
      .select("*")
      .eq("is_active", true)
      .order("priority", {
        ascending: true,
      }),

    supabase
      .from("price_items")
      .select("*")
      .eq("is_active", true),

    supabase
      .from("boq_sections")
      .select(
        `
          section_code,
          section_name,
          sort_order
        `
      )
      .eq("is_active", true),
  ]);

  if (rulesResult.error) {
    throw new Error(
      `Unable to load BOQ rules: ${rulesResult.error.message}`
    );
  }

  if (pricesResult.error) {
    throw new Error(
      `Unable to load price items: ${pricesResult.error.message}`
    );
  }

  if (sectionsResult.error) {
    throw new Error(
      `Unable to load BOQ sections: ${sectionsResult.error.message}`
    );
  }

  return {
    rules:
      rulesResult.data || [],

    prices:
      pricesResult.data || [],

    sections:
      sectionsResult.data || [],
  };
}

function createLookupMaps({
  prices,
  sections,
}) {
  const pricesByCode =
    new Map(
      prices.map((item) => [
        item.item_code,
        item,
      ])
    );

  const sectionsByCode =
    new Map(
      sections.map((section) => [
        section.section_code,
        section,
      ])
    );

  return {
    pricesByCode,
    sectionsByCode,
  };
}

function buildBOQItem({
  rule,
  priceItem,
  section,
  quantity,
  unitRate,
  priceLevel,
  geometry,
}) {
  return {
    itemNumber: "",

    itemCode:
      priceItem.item_code,

    sectionCode:
      rule.section_code ||
      priceItem.section_code ||
      "00",

    section:
      section?.section_name ||
      priceItem.category ||
      "General",

    category:
      priceItem.category ||
      "",

    subCategory:
      priceItem.sub_category ||
      "",

    description:
      priceItem.description ||
      priceItem.item_code,

    unit:
      priceItem.unit ||
      "item",

    quantity,

    materialRate:
      toNumber(
        priceItem.material_rate
      ),

    laborRate:
      toNumber(
        priceItem.labor_rate
      ),

    equipmentRate:
      toNumber(
        priceItem.equipment_rate
      ),

    transportRate:
      toNumber(
        priceItem.transport_rate
      ),

    rate:
      round(
        unitRate,
        2
      ),

    amount:
      calculateAmount(
        quantity,
        unitRate
      ),

    priceLevel,

    source:
      priceItem.source_name ||
      "Ventra UAE Base Rate",

    confidence:
      toNumber(
        priceItem.confidence_score
      ),

    notes:
      rule.notes || "",

    geometryKey:
      geometry?.key || null,

    geometryValue:
      toNumber(
        geometry?.value
      ),

    formulaType:
      rule.formula_type ||
      "multiply",
  };
}

function sortAndNumberItems(
  items
) {
  items.sort((a, b) => {
    const sectionCompare =
      String(
        a.sectionCode
      ).localeCompare(
        String(
          b.sectionCode
        )
      );

    if (sectionCompare !== 0) {
      return sectionCompare;
    }

    return String(
      a.itemCode
    ).localeCompare(
      String(
        b.itemCode
      )
    );
  });

  const sectionCounters =
    new Map();

  for (const item of items) {
    const currentCount =
      sectionCounters.get(
        item.sectionCode
      ) || 0;

    const nextCount =
      currentCount + 1;

    sectionCounters.set(
      item.sectionCode,
      nextCount
    );

    item.itemNumber =
      `${item.sectionCode}.${String(
        nextCount
      ).padStart(2, "0")}`;
  }

  return items;
}

async function saveProjectBOQ({
  supabase,
  projectId,
  items,
}) {
  if (
    !projectId ||
    items.length === 0
  ) {
    return;
  }

  const {
    error: deleteError,
  } = await supabase
    .from("project_boq_items")
    .delete()
    .eq(
      "project_id",
      projectId
    )
    .eq(
      "source",
      "Ventra Rule Engine"
    );

  if (deleteError) {
    throw new Error(
      `Unable to clear previous BOQ items: ${deleteError.message}`
    );
  }

  const rows =
    items.map(
      (item, index) => ({
        project_id:
          projectId,

        section_code:
          item.sectionCode,

        item_code:
          item.itemCode,

        description:
          item.description,

        unit:
          item.unit,

        quantity:
          item.quantity,

        material_rate:
          item.materialRate,

        labor_rate:
          item.laborRate,

        equipment_rate:
          item.equipmentRate,

        transport_rate:
          item.transportRate,

        unit_rate:
          item.rate,

        total_amount:
          item.amount,

        source:
          "Ventra Rule Engine",

        notes:
          item.notes,

        sort_order:
          index + 1,
      })
    );

  const {
    error: insertError,
  } = await supabase
    .from("project_boq_items")
    .insert(rows);

  if (insertError) {
    throw new Error(
      `Unable to save BOQ items: ${insertError.message}`
    );
  }
}

export async function generateBOQ({
  supabase,
  input,
}) {
  const projectId =
    input?.projectId || null;

  const projectName =
    input?.projectName ||
    "Untitled Project";

  const priceLevel =
    input?.priceLevel ||
    "standard";

  const vatPercentage =
    Math.max(
      0,
      toNumber(
        input?.vatPercentage ?? 5
      )
    );

  const takeoff =
    normalizeTakeoff(
      input?.takeoff
    )
 console.log("========== TAKEOFF ==========");
console.log(JSON.stringify(takeoff, null, 2));
console.log("=============================");

  logger.debug(
    "Normalized takeoff",
    takeoff
  );

  const {
    rules,
    prices,
    sections,
  } = await loadBOQData(
    supabase
  );

  logger.debug(
    "Database records",
    {
      rulesCount:
        rules.length,

      pricesCount:
        prices.length,

      sectionsCount:
        sections.length,
    }
  );

  const {
    pricesByCode,
    sectionsByCode,
  } = createLookupMaps({
    prices,
    sections,
  });

  const warnings = [];
  const validationErrors = [];
  const items = [];

  for (const rule of rules) {
    const priceItem =
      pricesByCode.get(
        rule.item_code
      );

    const validation =
      validateRule({
        rule,
        priceItem,
        takeoff,
      });

    warnings.push(
      ...validation.warnings
    );

    if (!validation.valid) {
      validationErrors.push({
        itemCode:
          rule.item_code,

        errors:
          validation.errors,
      });

      logger.warn(
        `Invalid rule: ${rule.item_code}`,
        validation.errors
      );

      continue;
    }

    const geometry =
      validation.geometry ||
      resolveGeometry(
        rule,
        takeoff
      );

    const {
      quantity,
      error: quantityError,
    } = calculateQuantity({
      rule,
      takeoff,
      baseValue:
        geometry.value,
    });

    if (quantityError) {
      validationErrors.push({
        itemCode:
          rule.item_code,

        errors: [
          quantityError,
        ],
      });

      logger.warn(
        `Quantity calculation failed: ${rule.item_code}`,
        quantityError
      );

      continue;
    }

    logger.debug(
      `Rule calculation: ${rule.item_code}`,
      {
        geometryKey:
          geometry.key,

        geometryValue:
          geometry.value,

        formulaType:
          rule.formula_type,

        multiplier:
          rule.multiplier,

        quantity,
      }
    );

    if (quantity <= 0) {
      warnings.push(
        `Rule ${rule.item_code} generated zero quantity from ${geometry.key || "unknown geometry"}.`
      );

      continue;
    }

    const sectionCode =
      rule.section_code ||
      priceItem.section_code ||
      "00";

    const section =
      sectionsByCode.get(
        sectionCode
      );

    const unitRate =
      getSelectedRate(
        priceItem,
        priceLevel
      );

    const item =
      buildBOQItem({
        rule,
        priceItem,
        section,
        quantity,
        unitRate,
        priceLevel,
        geometry,
      });

    items.push(item);
  }

  sortAndNumberItems(
    items
  );

  const subtotal =
    round(
      items.reduce(
        (sum, item) =>
          sum + item.amount,
        0
      ),
      2
    );

  const vatAmount =
    round(
      subtotal *
        (
          vatPercentage /
          100
        ),
      2
    );

  const grandTotal =
    round(
      subtotal +
        vatAmount,
      2
    );

  await saveProjectBOQ({
    supabase,
    projectId,
    items,
  });

  if (items.length === 0) {
    return {
      success: false,

      error:
        "No BOQ items were generated.",

      debug: {
        takeoff,

        totalRules:
          rules.length,

        totalPrices:
          prices.length,

        warnings,

        validationErrors,
      },
    };
  }

  return {
    success: true,

    boq: {
      projectId,
      projectName,
      currency: "AED",
      priceLevel,
      takeoff,
      items,

      assumptions: [
        "Quantities were generated from detected drawing geometry.",
        "Rates were loaded from the Ventra UAE price database.",
      ],

      warnings,
      validationErrors,

      summary: {
        totalItems:
          items.length,

        totalRules:
          rules.length,

        invalidRules:
          validationErrors.length,

        subtotal,
        vatPercentage,
        vatAmount,
        grandTotal,
      },
    },
  };
}