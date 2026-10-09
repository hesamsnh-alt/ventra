import {
  round,
  toNumber,
} from "./utils";

export function getBaseRate(
  priceItem
) {
  return (
    toNumber(
      priceItem?.material_rate
    ) +
    toNumber(
      priceItem?.labor_rate
    ) +
    toNumber(
      priceItem?.equipment_rate
    ) +
    toNumber(
      priceItem?.transport_rate
    )
  );
}

export function getSelectedRate(
  priceItem,
  priceLevel
) {
  const level =
    String(
      priceLevel || "standard"
    ).toLowerCase();

  if (
    level === "economy"
  ) {
    const economyRate =
      toNumber(
        priceItem?.economy_rate
      );

    if (economyRate > 0) {
      return economyRate;
    }
  }

  if (
    level === "premium"
  ) {
    const premiumRate =
      toNumber(
        priceItem?.premium_rate
      );

    if (premiumRate > 0) {
      return premiumRate;
    }
  }

  const standardRate =
    toNumber(
      priceItem?.standard_rate
    );

  if (standardRate > 0) {
    return standardRate;
  }

  return getBaseRate(
    priceItem
  );
}

export function calculateAmount(
  quantity,
  unitRate
) {
  return round(
    toNumber(quantity) *
      toNumber(unitRate),
    2
  );
}