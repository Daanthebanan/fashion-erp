import {
  getStoredProducts,
  saveProducts,
} from "@/lib/articles";
import { getSharedStateValue, setSharedStateValue } from "@/lib/shared-state-client";
import {
  appendHistoryEventsOnce,
} from "@/lib/history-engine";

export type PurchaseOrderStatus =
  | "Concept"
  | "Besteld"
  | "Deels ontvangen"
  | "Ontvangen"
  | "Geannuleerd";

export type PurchaseOrderLine = {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  variantId: string;
  sku: string;
  color: string;
  size: string;
  orderedQuantity: number;
  receivedQuantity: number;
  purchasePrice: number;
  // Collectie van het artikel (bijv. HS27); alleen gevuld vanuit de API.
  collectionCode?: string;
};

export type PurchaseReceiptLine = {
  id: string;
  purchaseOrderLineId: string;
  productId: string;
  variantId: string;
  sku: string;
  productName: string;
  color: string;
  size: string;
  quantity: number;
};

export type PurchaseReceipt = {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  receiptDate: string;
  packingSlipNumber: string;
  receivedBy: string;
  notes: string;
  lines: PurchaseReceiptLine[];
  createdAt: string;
};

export type PurchaseOrder = {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  collectionCode: string;
  orderDate: string;
  expectedDeliveryDate: string;
  status: PurchaseOrderStatus;
  currency: string;
  paymentDays: number;
  supplierReference: string;
  deliveryAddress: string;
  notes: string;
  lines: PurchaseOrderLine[];
  receiptIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderInput = {
  supplierId: string;
  supplierName: string;
  collectionCode: string;
  expectedDeliveryDate: string;
  status: PurchaseOrderStatus;
  currency?: string;
  paymentDays?: number;
  supplierReference?: string;
  deliveryAddress?: string;
  notes: string;
  lines: PurchaseOrderLine[];
};

export type ReceivePurchaseOrderInput = {
  receivedByLine: Record<string, number>;
  packingSlipNumber?: string;
  receivedBy?: string;
  notes?: string;
  receiptDate?: string;
};

const orderStorageKey = "fashion-erp-purchase-orders";
const receiptStorageKey = "fashion-erp-purchase-receipts";

export const purchasingSharedStateKeys = [
  orderStorageKey,
  receiptStorageKey,
] as const;

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function normalizePurchaseOrder(
  order: PurchaseOrder,
): PurchaseOrder {
  return {
    ...order,
    currency: order.currency || "EUR",
    paymentDays:
      typeof order.paymentDays === "number"
        ? order.paymentDays
        : 30,
    supplierReference:
      order.supplierReference || "",
    deliveryAddress: order.deliveryAddress || "",
    receiptIds: Array.isArray(order.receiptIds)
      ? order.receiptIds
      : [],
  };
}

function getNextOrderNumber(
  orders: PurchaseOrder[],
) {
  const year = new Date().getFullYear();

  const highestNumber = orders.reduce(
    (highest, order) => {
      const match = order.orderNumber.match(
        /I\d{4}-(\d+)/,
      );

      if (!match) {
        return highest;
      }

      return Math.max(highest, Number(match[1]));
    },
    0,
  );

  return `I${year}-${String(
    highestNumber + 1,
  ).padStart(5, "0")}`;
}

function getNextReceiptNumber(
  receipts: PurchaseReceipt[],
) {
  const year = new Date().getFullYear();

  const highestNumber = receipts.reduce(
    (highest, receipt) => {
      const match = receipt.receiptNumber.match(
        /IO\d{4}-(\d+)/,
      );

      if (!match) {
        return highest;
      }

      return Math.max(highest, Number(match[1]));
    },
    0,
  );

  return `IO${year}-${String(
    highestNumber + 1,
  ).padStart(5, "0")}`;
}

export function getPurchaseOrders(): PurchaseOrder[] {
  return getSharedStateValue<PurchaseOrder[]>(orderStorageKey, []).map(
    normalizePurchaseOrder,
  );
}

export function savePurchaseOrders(
  orders: PurchaseOrder[],
) {
  setSharedStateValue(orderStorageKey, orders);
}

export function getPurchaseReceipts(): PurchaseReceipt[] {
  return getSharedStateValue<PurchaseReceipt[]>(receiptStorageKey, []);
}

export function savePurchaseReceipts(
  receipts: PurchaseReceipt[],
) {
  setSharedStateValue(receiptStorageKey, receipts);
}

export function getPurchaseOrderById(id: string) {
  return (
    getPurchaseOrders().find(
      (order) => order.id === id,
    ) ?? null
  );
}

/**
 * Fetches the purchase order from the actual database-backed API
 * (/api/purchase-orders), unlike getPurchaseOrderById which reads from the
 * separate shared-state cache that purchase orders created via
 * /api/purchase-orders never get written into.
 */
export async function loadPurchaseOrderById(
  id: string,
): Promise<PurchaseOrder | null> {
  const response = await fetch("/api/purchase-orders", {
    cache: "no-store",
  });

  const orders = (await response.json()) as PurchaseOrder[];

  if (!Array.isArray(orders)) {
    return null;
  }

  return orders.find((order) => order.id === id) ?? null;
}

export function getPurchaseReceiptById(
  id: string,
) {
  return (
    getPurchaseReceipts().find(
      (receipt) => receipt.id === id,
    ) ?? null
  );
}

export function getReceiptsForPurchaseOrder(
  purchaseOrderId: string,
) {
  return getPurchaseReceipts()
    .filter(
      (receipt) =>
        receipt.purchaseOrderId === purchaseOrderId,
    )
    .sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
}

export function createPurchaseOrder(
  input: PurchaseOrderInput,
) {
  const orders = getPurchaseOrders();
  const now = new Date().toISOString();

  const order: PurchaseOrder = {
    id: createId("purchase-order"),
    orderNumber: getNextOrderNumber(orders),
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    collectionCode: input.collectionCode,
    orderDate: getToday(),
    expectedDeliveryDate:
      input.expectedDeliveryDate,
    status: input.status,
    currency: input.currency || "EUR",
    paymentDays: input.paymentDays ?? 30,
    supplierReference:
      input.supplierReference || "",
    deliveryAddress: input.deliveryAddress || "",
    notes: input.notes,
    lines: input.lines.map((line) => ({
      ...line,
      id: createId("purchase-line"),
      receivedQuantity: 0,
    })),
    receiptIds: [],
    createdAt: now,
    updatedAt: now,
  };

  savePurchaseOrders([...orders, order]);

  return order;
}

export function updatePurchaseOrder(
  id: string,
  changes: Partial<
    Omit<
      PurchaseOrder,
      "id" | "orderNumber" | "createdAt"
    >
  >,
) {
  const orders = getPurchaseOrders();

  const updatedOrders = orders.map((order) =>
    order.id === id
      ? {
          ...order,
          ...changes,
          updatedAt: new Date().toISOString(),
        }
      : order,
  );

  savePurchaseOrders(updatedOrders);

  return (
    updatedOrders.find((order) => order.id === id) ??
    null
  );
}

export function updatePurchaseOrderStatus(
  id: string,
  status: PurchaseOrderStatus,
) {
  return updatePurchaseOrder(id, { status });
}

export async function updatePurchaseOrderStatusRemote(
  id: string,
  status: PurchaseOrderStatus,
) {
  const response = await fetch(
    `/api/purchase-orders/${id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status,
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ??
        "Inkooporder status wijzigen mislukt.",
    );
  }

  return data;
}

export function duplicatePurchaseOrder(id: string) {
  const source = getPurchaseOrderById(id);

  if (!source) {
    throw new Error("Inkooporder niet gevonden.");
  }

  return createPurchaseOrder({
    supplierId: source.supplierId,
    supplierName: source.supplierName,
    collectionCode: source.collectionCode,
    expectedDeliveryDate:
      source.expectedDeliveryDate,
    status: "Concept",
    currency: source.currency,
    paymentDays: source.paymentDays,
    supplierReference: "",
    deliveryAddress: source.deliveryAddress,
    notes: source.notes,
    lines: source.lines.map((line) => ({
      ...line,
      id: "",
      receivedQuantity: 0,
    })),
  });
}

export function cancelPurchaseOrder(id: string) {
  const order = getPurchaseOrderById(id);

  if (!order) {
    throw new Error("Inkooporder niet gevonden.");
  }

  if (order.status === "Ontvangen") {
    throw new Error(
      "Een volledig ontvangen inkooporder kan niet worden geannuleerd.",
    );
  }

  return updatePurchaseOrderStatus(
    id,
    "Geannuleerd",
  );
}

export function reopenPurchaseOrder(id: string) {
  const order = getPurchaseOrderById(id);

  if (!order) {
    throw new Error("Inkooporder niet gevonden.");
  }

  const totals = getPurchaseOrderTotals(order);

  let status: PurchaseOrderStatus = "Besteld";

  if (totals.receivedQuantity === 0) {
    status = "Besteld";
  } else if (
    totals.receivedQuantity <
    totals.orderedQuantity
  ) {
    status = "Deels ontvangen";
  } else {
    status = "Ontvangen";
  }

  return updatePurchaseOrderStatus(id, status);
}

export function receivePurchaseOrder(
  orderId: string,
  input:
    | ReceivePurchaseOrderInput
    | Record<string, number>,
) {
  const normalizedInput: ReceivePurchaseOrderInput =
    typeof input === "object" &&
    input !== null &&
    "receivedByLine" in input
      ? (input as ReceivePurchaseOrderInput)
      : {
          receivedByLine: input as Record<string, number>,
        };

  const orders = getPurchaseOrders();
  const order = orders.find(
    (item) => item.id === orderId,
  );

  if (!order) {
    throw new Error("Inkooporder niet gevonden.");
  }

  if (
    order.status === "Geannuleerd" ||
    order.status === "Ontvangen"
  ) {
    throw new Error(
      "Voor deze inkooporder kan geen ontvangst meer worden geboekt.",
    );
  }

  const products = getStoredProducts();
  const receiptLines: PurchaseReceiptLine[] = [];

  const updatedLines = order.lines.map((line) => {
    const requestedQuantity = Math.max(
      0,
      Math.floor(
        normalizedInput.receivedByLine[line.id] ?? 0,
      ),
    );

    const remainingQuantity = Math.max(
      0,
      line.orderedQuantity -
        line.receivedQuantity,
    );

    const quantityToReceive = Math.min(
      requestedQuantity,
      remainingQuantity,
    );

    if (quantityToReceive <= 0) {
      return line;
    }

    const productIndex = products.findIndex(
      (product) => product.id === line.productId,
    );

    if (productIndex >= 0) {
      const variantIndex = products[
        productIndex
      ].variants.findIndex(
        (variant) => variant.id === line.variantId,
      );

      if (variantIndex >= 0) {
        products[productIndex].variants[
          variantIndex
        ].physicalStock += quantityToReceive;

        products[productIndex].updatedAt =
          new Date().toISOString();
      }
    }

    receiptLines.push({
      id: createId("receipt-line"),
      purchaseOrderLineId: line.id,
      productId: line.productId,
      variantId: line.variantId,
      sku: line.sku,
      productName: line.productName,
      color: line.color,
      size: line.size,
      quantity: quantityToReceive,
    });

    return {
      ...line,
      receivedQuantity:
        line.receivedQuantity + quantityToReceive,
    };
  });

  if (receiptLines.length === 0) {
    throw new Error(
      "Vul minimaal één te ontvangen aantal in.",
    );
  }

  saveProducts(products);

  const totalOrdered = updatedLines.reduce(
    (total, line) =>
      total + line.orderedQuantity,
    0,
  );

  const totalReceived = updatedLines.reduce(
    (total, line) =>
      total + line.receivedQuantity,
    0,
  );

  let status: PurchaseOrderStatus;

  if (totalReceived === 0) {
    status = "Besteld";
  } else if (totalReceived < totalOrdered) {
    status = "Deels ontvangen";
  } else {
    status = "Ontvangen";
  }

  const receipts = getPurchaseReceipts();
  const now = new Date().toISOString();

  const receipt: PurchaseReceipt = {
    id: createId("purchase-receipt"),
    receiptNumber: getNextReceiptNumber(receipts),
    purchaseOrderId: order.id,
    purchaseOrderNumber: order.orderNumber,
    supplierId: order.supplierId,
    supplierName: order.supplierName,
    receiptDate:
      normalizedInput.receiptDate || getToday(),
    packingSlipNumber:
      normalizedInput.packingSlipNumber?.trim() ||
      "",
    receivedBy:
      normalizedInput.receivedBy?.trim() || "",
    notes: normalizedInput.notes?.trim() || "",
    lines: receiptLines,
    createdAt: now,
  };

  const updatedOrder: PurchaseOrder = {
    ...order,
    lines: updatedLines,
    status,
    receiptIds: [
      ...(order.receiptIds || []),
      receipt.id,
    ],
    updatedAt: now,
  };

  savePurchaseReceipts([...receipts, receipt]);

  savePurchaseOrders(
    orders.map((item) =>
      item.id === orderId ? updatedOrder : item,
    ),
  );

  return {
    order: updatedOrder,
    receipt,
  };
}

export function deletePurchaseOrder(id: string) {
  const order = getPurchaseOrderById(id);

  if (!order) {
    return;
  }

  if (
    order.status !== "Concept" &&
    order.receiptIds.length > 0
  ) {
    throw new Error(
      "Een inkooporder met ontvangsten kan niet worden verwijderd.",
    );
  }

  const orders = getPurchaseOrders();

  savePurchaseOrders(
    orders.filter((item) => item.id !== id),
  );
}

export function getPurchaseOrderTotals(
  order: PurchaseOrder,
) {
  const lines = Array.isArray(order.lines)
    ? order.lines
    : [];

  const subtotal = lines.reduce(
    (total, line) =>
      total +
      Number(line.orderedQuantity ?? 0) *
      Number(line.purchasePrice ?? 0),
    0,
  );

  const receivedValue = lines.reduce(
    (total, line) =>
      total +
      line.receivedQuantity * line.purchasePrice,
    0,
  );

  const orderedQuantity = lines.reduce(
    (total, line) =>
      total + line.orderedQuantity,
    0,
  );

  const receivedQuantity = lines.reduce(
    (total, line) =>
      total + line.receivedQuantity,
    0,
  );

  const remainingQuantity = Math.max(
    0,
    orderedQuantity - receivedQuantity,
  );

  const remainingValue = Math.max(
    0,
    subtotal - receivedValue,
  );

  const receiptProgress =
    orderedQuantity > 0
      ? Math.round(
          (receivedQuantity / orderedQuantity) * 100,
        )
      : 0;

  return {
    subtotal,
    receivedValue,
    remainingValue,
    orderedQuantity,
    receivedQuantity,
    remainingQuantity,
    receiptProgress,
  };
}

export function isPurchaseOrderOverdue(
  order: PurchaseOrder,
) {
  if (
    !order.expectedDeliveryDate ||
    order.status === "Ontvangen" ||
    order.status === "Geannuleerd" ||
    order.status === "Concept"
  ) {
    return false;
  }

  return order.expectedDeliveryDate < getToday();
}

export function getPurchaseOrderDaysOverdue(
  order: PurchaseOrder,
) {
  if (!isPurchaseOrderOverdue(order)) {
    return 0;
  }

  const expected = new Date(
    `${order.expectedDeliveryDate}T12:00:00`,
  );

  const today = new Date(`${getToday()}T12:00:00`);

  return Math.max(
    0,
    Math.floor(
      (today.getTime() - expected.getTime()) /
        86_400_000,
    ),
  );
}

export function getPurchaseOrderDashboard() {
  const orders = getPurchaseOrders();

  const openOrders = orders.filter(
    (order) =>
      order.status === "Besteld" ||
      order.status === "Deels ontvangen",
  );

  const overdueOrders = openOrders.filter(
    isPurchaseOrderOverdue,
  );

  const openValue = openOrders.reduce(
    (total, order) =>
      total +
      getPurchaseOrderTotals(order).remainingValue,
    0,
  );

  const incomingQuantity = openOrders.reduce(
    (total, order) =>
      total +
      getPurchaseOrderTotals(order)
        .remainingQuantity,
    0,
  );

  return {
    totalOrders: orders.length,
    conceptOrders: orders.filter(
      (order) => order.status === "Concept",
    ).length,
    openOrders: openOrders.length,
    overdueOrders: overdueOrders.length,
    openValue,
    incomingQuantity,
  };
}export function filterPurchaseOrders(
  orders: PurchaseOrder[],
  filters: {
    search: string;
    status: PurchaseOrderStatus | "Alle statussen";
    supplierId: string;
    overdueOnly: boolean;
  },
) {
  const query = filters.search.trim().toLowerCase();

  return orders.filter((order) => {
    if (
      filters.status !== "Alle statussen" &&
      order.status !== filters.status
    ) {
      return false;
    }

    if (
      filters.supplierId &&
      order.supplierId !== filters.supplierId
    ) {
      return false;
    }

    if (
      filters.overdueOnly &&
      !isPurchaseOrderOverdue(order)
    ) {
      return false;
    }

    if (!query) {
      return true;
    }

    return (
      order.orderNumber.toLowerCase().includes(query) ||
      order.supplierName.toLowerCase().includes(query) ||
      (order.collectionCode ?? "")
        .toLowerCase()
        .includes(query) ||
      (order.supplierReference ?? "")
        .toLowerCase()
        .includes(query)
    );
  });
}