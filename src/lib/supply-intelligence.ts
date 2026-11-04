"use client";

import {
  getStoredProducts,
} from "@/lib/articles";
import {
  getSalesOrders,
} from "@/lib/sales";
import {
  getCustomerReturns,
} from "@/lib/returns";
import type { PurchaseOrder } from "@/lib/purchasing";

type Dimension =
  | "category"
  | "garmentType"
  | "material"
  | "fit"
  | "colorFamily"
  | "color"
  | "size";

export type SupplyDimensionRow = {
  value: string;
  soldQuantity: number;
  returnedQuantity: number;
  netQuantity: number;
  revenue: number;
  returnRate: number;
  share: number;
};

function getProductMap() {
  return new Map(
    getStoredProducts().map((product) => [
      product.id,
      product,
    ]),
  );
}

export function buildSupplyAnalysis(
  dimension: Dimension,
): SupplyDimensionRow[] {
  const productMap = getProductMap();
  const rows = new Map<
    string,
    Omit<
      SupplyDimensionRow,
      "returnRate" | "share"
    >
  >();

  function valueFor(
    productId: string,
    color: string,
    size: string,
  ) {
    const product = productMap.get(productId);

    if (dimension === "color") {
      return color || "Onbekend";
    }

    if (dimension === "size") {
      return size || "Onbekend";
    }

    if (!product) {
      return "Onbekend";
    }

    if (dimension === "category") {
      return product.category || "Onbekend";
    }

    if (dimension === "garmentType") {
      return (
        product.garmentType ||
        product.category ||
        "Onbekend"
      );
    }

    if (dimension === "material") {
      return product.material || "Onbekend";
    }

    if (dimension === "fit") {
      return product.fit || "Onbekend";
    }

    return (
      product.colorFamily ||
      color ||
      "Onbekend"
    );
  }

  getSalesOrders().forEach((order) => {
    if (order.status === "Geannuleerd") {
      return;
    }

    order.lines.forEach((line) => {
      const key = valueFor(
        line.productId,
        line.color,
        line.size,
      );

      const current = rows.get(key) || {
        value: key,
        soldQuantity: 0,
        returnedQuantity: 0,
        netQuantity: 0,
        revenue: 0,
      };

      current.soldQuantity += line.quantity;
      current.netQuantity += line.quantity;
      current.revenue +=
        line.quantity *
        line.unitPrice *
        (1 - line.discountPercentage / 100);

      rows.set(key, current);
    });
  });

  getCustomerReturns().forEach((item) =>
    item.lines.forEach((line) => {
      const key = valueFor(
        line.productId,
        line.color,
        line.size,
      );

      const current = rows.get(key) || {
        value: key,
        soldQuantity: 0,
        returnedQuantity: 0,
        netQuantity: 0,
        revenue: 0,
      };

      current.returnedQuantity +=
        line.returnQuantity;
      current.netQuantity -=
        line.returnQuantity;

      rows.set(key, current);
    }),
  );

  const totalNet = [...rows.values()].reduce(
    (sum, row) =>
      sum + Math.max(0, row.netQuantity),
    0,
  );

  return [...rows.values()]
    .map((row) => ({
      ...row,
      revenue:
        Math.round(row.revenue * 100) / 100,
      returnRate:
        row.soldQuantity > 0
          ? Math.round(
              (row.returnedQuantity /
                row.soldQuantity) *
                1000,
            ) / 10
          : 0,
      share:
        totalNet > 0
          ? Math.round(
              (Math.max(0, row.netQuantity) /
                totalNet) *
                1000,
            ) / 10
          : 0,
    }))
    .sort(
      (first, second) =>
        second.netQuantity -
        first.netQuantity,
    );
}

/**
 * @param purchases Inkooporders uit de database (fetchPurchaseOrders).
 */
export function getSupplyDashboard(
  purchases: PurchaseOrder[],
) {
  const products = getStoredProducts();
  const orders = getSalesOrders().filter(
    (order) => order.status !== "Geannuleerd",
  );
  const returns = getCustomerReturns();

  const sold = orders.reduce(
    (total, order) =>
      total +
      order.lines.reduce(
        (lineTotal, line) =>
          lineTotal + line.quantity,
        0,
      ),
    0,
  );

  const returned = returns.reduce(
    (total, item) =>
      total +
      item.lines.reduce(
        (lineTotal, line) =>
          lineTotal + line.returnQuantity,
        0,
      ),
    0,
  );

  const stock = products.reduce(
    (total, product) =>
      total +
      product.variants.reduce(
        (variantTotal, variant) =>
          variantTotal +
          variant.physicalStock,
        0,
      ),
    0,
  );

  // Onderweg = bestelde orders; concepten zijn nog niet besteld.
  const incoming = purchases
    .filter(
      (order) =>
        order.status === "Besteld" ||
        order.status === "Deels ontvangen",
    )
    .reduce(
      (total, order) =>
        total +
        (order.lines ?? []).reduce(
          (lineTotal, line) =>
            lineTotal +
            Math.max(
              0,
              line.orderedQuantity -
                line.receivedQuantity,
            ),
          0,
        ),
      0,
    );

  return {
    sold,
    returned,
    returnRate:
      sold > 0
        ? Math.round(
            (returned / sold) * 1000,
          ) / 10
        : 0,
    stock,
    incoming,
    dataPoints:
      orders.length +
      returns.length +
      purchases.length,
  };
}

export function getSimpleOrderAdvice() {
  const sizeCurve = buildSupplyAnalysis("size");
  const colorCurve =
    buildSupplyAnalysis("colorFamily");

  return {
    sizeCurve: sizeCurve.slice(0, 10),
    colorCurve: colorCurve.slice(0, 10),
    message:
      sizeCurve.length === 0
        ? "STITCH begint vanaf de eerste order met het opbouwen van verkoop- en retourhistorie."
        : "Gebruik de netto verkoopaandelen als eerste richtlijn voor de maat- en kleurverdeling van een volgende inkooporder.",
  };
}
