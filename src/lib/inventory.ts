import {
  getStoredProducts,
  saveProducts,
  type Product,
  type ProductVariant,
} from "@/lib/articles";
import { getSharedStateValue, setSharedStateValue } from "@/lib/shared-state-client";
import {
  getPurchaseOrderTotals,
  getPurchaseReceipts,
  type PurchaseOrder,
} from "@/lib/purchasing";

export type InventoryMovementType =
  | "Beginvoorraad"
  | "Inkoopontvangst"
  | "Verkoopreservering"
  | "Vrijgave reservering"
  | "Verkoopzending"
  | "Retour"
  | "Voorraadcorrectie"
  | "Schade"
  | "Verlies"
  | "Transfer in"
  | "Transfer uit";

export type InventoryMovement = {
  id: string;
  variantId: string;
  productId: string;
  sku: string;
  productCode: string;
  productName: string;
  color: string;
  size: string;
  type: InventoryMovementType;
  quantity: number;
  physicalBefore: number;
  physicalAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  referenceType: string;
  referenceId: string;
  referenceNumber: string;
  reason: string;
  notes: string;
  warehouse: string;
  location: string;
  userName: string;
  createdAt: string;
};

export type InventoryVariantRow = {
  productId: string;
  variantId: string;
  productCode: string;
  productName: string;
  collection: string;
  category: string;
  supplier: string;
  status: string;
  sku: string;
  color: string;
  size: string;
  physicalStock: number;
  reservedStock: number;
  availableStock: number;
  incomingStock: number;
  minimumStock: number;
  purchasePrice: number;
  stockValue: number;
  warehouse: string;
  location: string;
  lastMovementAt: string;
};

export type InventoryCorrectionInput = {
  productId: string;
  variantId: string;
  quantity: number;
  type:
    | "Voorraadcorrectie"
    | "Schade"
    | "Verlies"
    | "Retour";
  reason: string;
  notes?: string;
  warehouse?: string;
  location?: string;
  userName?: string;
};

export type InventorySettings = {
  minimumStockByVariant: Record<string, number>;
  warehouseByVariant: Record<string, string>;
  locationByVariant: Record<string, string>;
};

const movementStorageKey =
  "fashion-erp-inventory-movements-v1";

const settingsStorageKey =
  "fashion-erp-inventory-settings-v1";

export const inventorySharedStateKeys = [
  movementStorageKey,
  settingsStorageKey,
] as const;

const defaultWarehouse = "Amsterdam";
const defaultLocation = "MAG-A";

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function getSettings(): InventorySettings {
  const parsed = getSharedStateValue<Partial<InventorySettings>>(
    settingsStorageKey,
    {},
  );

  return {
    minimumStockByVariant: parsed.minimumStockByVariant ?? {},
    warehouseByVariant: parsed.warehouseByVariant ?? {},
    locationByVariant: parsed.locationByVariant ?? {},
  };
}

function saveSettings(settings: InventorySettings) {
  setSharedStateValue(settingsStorageKey, settings);
}

export function getInventoryMovements() {
  return getSharedStateValue<InventoryMovement[]>(movementStorageKey, []);
}

export function saveInventoryMovements(
  movements: InventoryMovement[],
) {
  setSharedStateValue(movementStorageKey, movements);
}

function findProductAndVariant(
  productId: string,
  variantId: string,
) {
  const products = getStoredProducts();
  const productIndex = products.findIndex(
    (product) => product.id === productId,
  );

  if (productIndex < 0) {
    return null;
  }

  const variantIndex = products[
    productIndex
  ].variants.findIndex(
    (variant) => variant.id === variantId,
  );

  if (variantIndex < 0) {
    return null;
  }

  return {
    products,
    productIndex,
    variantIndex,
    product: products[productIndex],
    variant:
      products[productIndex].variants[variantIndex],
  };
}

function getVariantWarehouse(
  variantId: string,
  settings = getSettings(),
) {
  return (
    settings.warehouseByVariant[variantId] ??
    defaultWarehouse
  );
}

function getVariantLocation(
  variantId: string,
  settings = getSettings(),
) {
  return (
    settings.locationByVariant[variantId] ??
    defaultLocation
  );
}

export function setInventoryVariantSettings(
  variantId: string,
  changes: {
    minimumStock?: number;
    warehouse?: string;
    location?: string;
  },
) {
  const settings = getSettings();

  if (typeof changes.minimumStock === "number") {
    settings.minimumStockByVariant[variantId] =
      Math.max(0, Math.floor(changes.minimumStock));
  }

  if (typeof changes.warehouse === "string") {
    settings.warehouseByVariant[variantId] =
      changes.warehouse.trim() || defaultWarehouse;
  }

  if (typeof changes.location === "string") {
    settings.locationByVariant[variantId] =
      changes.location.trim() || defaultLocation;
  }

  saveSettings(settings);
}

function getIncomingByVariant(
  purchaseOrders: PurchaseOrder[],
) {
  const incoming = new Map<string, number>();

  purchaseOrders
    .filter(
      (order) =>
        order.status === "Besteld" ||
        order.status === "Deels ontvangen",
    )
    .forEach((order) => {
      (order.lines ?? []).forEach((line) => {
        const remaining = Math.max(
          0,
          line.orderedQuantity -
            line.receivedQuantity,
        );

        incoming.set(
          line.variantId,
          (incoming.get(line.variantId) ?? 0) +
            remaining,
        );
      });
    });

  return incoming;
}

function getLastMovementByVariant() {
  const lastMovement = new Map<string, string>();

  getInventoryMovements()
    .slice()
    .sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
    .forEach((movement) => {
      if (!lastMovement.has(movement.variantId)) {
        lastMovement.set(
          movement.variantId,
          movement.createdAt,
        );
      }
    });

  return lastMovement;
}

/**
 * @param purchaseOrders Inkooporders uit de database (fetchPurchaseOrders).
 */
export function getInventoryRows(
  purchaseOrders: PurchaseOrder[],
): InventoryVariantRow[] {
  reconcilePurchaseReceiptMovements();

  const products = getStoredProducts();
  const incomingByVariant =
    getIncomingByVariant(purchaseOrders);
  const lastMovementByVariant =
    getLastMovementByVariant();
  const settings = getSettings();

  return products.flatMap((product) =>
    product.variants.map((variant) => {
      const minimumStock =
        settings.minimumStockByVariant[
          variant.id
        ] ?? 5;

      const availableStock = Math.max(
        0,
        variant.physicalStock -
          variant.reservedStock,
      );

      return {
        productId: product.id,
        variantId: variant.id,
        productCode: product.code,
        productName: product.name,
        collection: product.collection,
        category: product.category,
        supplier: product.supplier,
        status: product.status,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        physicalStock: variant.physicalStock,
        reservedStock: variant.reservedStock,
        availableStock,
        incomingStock:
          incomingByVariant.get(variant.id) ?? 0,
        minimumStock,
        purchasePrice: variant.purchasePrice,
        stockValue:
          variant.physicalStock *
          variant.purchasePrice,
        warehouse: getVariantWarehouse(
          variant.id,
          settings,
        ),
        location: getVariantLocation(
          variant.id,
          settings,
        ),
        lastMovementAt:
          lastMovementByVariant.get(variant.id) ??
          product.updatedAt,
      };
    }),
  );
}

export function getInventoryRowByVariantId(
  variantId: string,
  purchaseOrders: PurchaseOrder[],
) {
  return (
    getInventoryRows(purchaseOrders).find(
      (row) => row.variantId === variantId,
    ) ?? null
  );
}

export function getInventoryMovementsForVariant(
  variantId: string,
) {
  return getInventoryMovements()
    .filter(
      (movement) =>
        movement.variantId === variantId,
    )
    .sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
}

export function createInventoryCorrection(
  input: InventoryCorrectionInput,
) {
  const found = findProductAndVariant(
    input.productId,
    input.variantId,
  );

  if (!found) {
    throw new Error(
      "Artikelvariant niet gevonden.",
    );
  }

  const quantity = Math.trunc(input.quantity);

  if (quantity === 0) {
    throw new Error(
      "De voorraadmutatie mag niet 0 zijn.",
    );
  }

  const {
    products,
    productIndex,
    variantIndex,
    product,
    variant,
  } = found;

  const physicalBefore = variant.physicalStock;
  const physicalAfter = Math.max(
    0,
    physicalBefore + quantity,
  );

  const appliedQuantity =
    physicalAfter - physicalBefore;

  if (appliedQuantity === 0) {
    throw new Error(
      "Deze mutatie verandert de voorraad niet.",
    );
  }

  products[productIndex].variants[
    variantIndex
  ].physicalStock = physicalAfter;

  products[productIndex].updatedAt =
    new Date().toISOString();

  saveProducts(products);

  const settings = getSettings();
  const now = new Date().toISOString();

  const movement: InventoryMovement = {
    id: createId("inventory-movement"),
    variantId: variant.id,
    productId: product.id,
    sku: variant.sku,
    productCode: product.code,
    productName: product.name,
    color: variant.color,
    size: variant.size,
    type: input.type,
    quantity: appliedQuantity,
    physicalBefore,
    physicalAfter,
    reservedBefore: variant.reservedStock,
    reservedAfter: variant.reservedStock,
    referenceType: "HANDMATIG",
    referenceId: "",
    referenceNumber: "",
    reason: input.reason.trim(),
    notes: input.notes?.trim() ?? "",
    warehouse:
      input.warehouse?.trim() ||
      getVariantWarehouse(
        variant.id,
        settings,
      ),
    location:
      input.location?.trim() ||
      getVariantLocation(
        variant.id,
        settings,
      ),
    userName:
      input.userName?.trim() || "Daan",
    createdAt: now,
  };

  saveInventoryMovements([
    ...getInventoryMovements(),
    movement,
  ]);

  return movement;
}

export function reconcilePurchaseReceiptMovements() {
  if (typeof window === "undefined") {
    return;
  }

  const movements = getInventoryMovements();
  const existingReferences = new Set(
    movements
      .filter(
        (movement) =>
          movement.referenceType ===
          "PURCHASE_RECEIPT",
      )
      .map(
        (movement) =>
          `${movement.referenceId}:${movement.variantId}`,
      ),
  );

  const products = getStoredProducts();
  const productByVariant = new Map<
    string,
    {
      product: Product;
      variant: ProductVariant;
    }
  >();

  products.forEach((product) => {
    product.variants.forEach((variant) => {
      productByVariant.set(variant.id, {
        product,
        variant,
      });
    });
  });

  const settings = getSettings();
  const additions: InventoryMovement[] = [];

  getPurchaseReceipts().forEach((receipt) => {
    receipt.lines.forEach((line) => {
      const referenceKey = `${receipt.id}:${line.variantId}`;

      if (existingReferences.has(referenceKey)) {
        return;
      }

      const productVariant =
        productByVariant.get(line.variantId);

      if (!productVariant) {
        return;
      }

      const { product, variant } =
        productVariant;

      const physicalAfter =
        variant.physicalStock;

      additions.push({
        id: createId("inventory-movement"),
        variantId: variant.id,
        productId: product.id,
        sku: variant.sku,
        productCode: product.code,
        productName: product.name,
        color: variant.color,
        size: variant.size,
        type: "Inkoopontvangst",
        quantity: line.quantity,
        physicalBefore: Math.max(
          0,
          physicalAfter - line.quantity,
        ),
        physicalAfter,
        reservedBefore:
          variant.reservedStock,
        reservedAfter:
          variant.reservedStock,
        referenceType:
          "PURCHASE_RECEIPT",
        referenceId: receipt.id,
        referenceNumber:
          receipt.receiptNumber,
        reason: "Goederenontvangst",
        notes: receipt.notes,
        warehouse: getVariantWarehouse(
          variant.id,
          settings,
        ),
        location: getVariantLocation(
          variant.id,
          settings,
        ),
        userName:
          receipt.receivedBy || "Magazijn",
        createdAt: receipt.createdAt,
      });

      existingReferences.add(referenceKey);
    });
  });

  if (additions.length > 0) {
    saveInventoryMovements([
      ...movements,
      ...additions,
    ]);
  }
}

/**
 * @param purchaseOrders Inkooporders uit de database (fetchPurchaseOrders).
 */
export function getInventoryDashboard(
  purchaseOrders: PurchaseOrder[],
) {
  const rows = getInventoryRows(purchaseOrders);
  const movements = getInventoryMovements();

  const physicalStock = rows.reduce(
    (total, row) =>
      total + row.physicalStock,
    0,
  );

  const reservedStock = rows.reduce(
    (total, row) =>
      total + row.reservedStock,
    0,
  );

  const availableStock = rows.reduce(
    (total, row) =>
      total + row.availableStock,
    0,
  );

  const incomingStock = rows.reduce(
    (total, row) =>
      total + row.incomingStock,
    0,
  );

  const stockValue = rows.reduce(
    (total, row) =>
      total + row.stockValue,
    0,
  );

  const lowStockVariants = rows.filter(
    (row) =>
      row.availableStock > 0 &&
      row.availableStock <= row.minimumStock,
  ).length;

  const outOfStockVariants = rows.filter(
    (row) => row.availableStock === 0,
  ).length;

  const openPurchaseValue = purchaseOrders
    .filter(
      (order) =>
        order.status === "Besteld" ||
        order.status === "Deels ontvangen",
    )
    .reduce(
      (total, order) =>
        total +
        getPurchaseOrderTotals(order)
          .remainingValue,
      0,
    );

  return {
    totalVariants: rows.length,
    physicalStock,
    reservedStock,
    availableStock,
    incomingStock,
    stockValue,
    lowStockVariants,
    outOfStockVariants,
    openPurchaseValue,
    movementCount: movements.length,
  };
}