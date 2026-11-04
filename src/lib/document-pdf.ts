"use client";

import { jsPDF } from "jspdf";
import * as QRCode from "qrcode";
import {
  getPurchaseOrderTotals,
  loadPurchaseOrderById,
} from "@/lib/purchasing";
import {
  getSalesOrderById,
  getSalesOrderTotals,
  loadSalesOrderById,
  type SalesOrder,
  type SalesOrderLine,
} from "@/lib/sales";
import { getInvoiceById } from "@/lib/invoices";
import { fetchSuppliers } from "@/lib/suppliers";
import {
  getCreditNoteById,
} from "@/lib/returns";
import {
  getCompanySettings,
  type CompanySettings,
} from "@/lib/company-settings";
import { getPaymentConditionText } from "@/lib/pricing-engine";
import {
  fetchProducts,
  getStoredProducts,
} from "@/lib/articles";
import { getCustomers, resolveColor } from "@/lib/master-data";
import type {
  BusinessDocumentType,
  DocumentEmailAttachment,
} from "@/lib/document-emails";
import {
  SALES_TERMS_TEXT,
  SALES_TERMS_TITLE,
} from "@/lib/legal/sales-terms";

type MatrixRow = {
  label: string;
  quantities: Record<string, number>;
};

type FashionArticleBlock = {
  productId?: string;
  imageDataUrl?: string;
  productCode: string;
  productName: string;
  brand: string;
  season: string;
  color: string;
  colorCode: string;
  sku: string;
  barcode: string;
  sizes: string[];
  matrixRows: MatrixRow[];
  total: number;
  orderNumber: string;
  salesPrice?: number;
  recommendedRetailPrice?: number;
  purchasePrice?: number;
  lineTotal?: number;
};

type DocumentMetaRow = {
  label: string;
  value: string;
};

type DocumentLanguage = "nl" | "en";

type DocumentDefinition = {
  documentType: BusinessDocumentType;
  title: string;
  number: string;
  date: string;
  customerId?: string;
  customerName: string;
  customerLines: string[];
  language?: DocumentLanguage;
  meta: DocumentMetaRow[];
  articleBlocks: FashionArticleBlock[];
  totalUnits: number;
  totalArticles: number;
  subtotal?: number;
  vat?: number;
  total?: number;
  currency?: string;
  notes: string;
  filename: string;
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_X = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const FOOTER_Y = 286;
const STANDARD_SIZES = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
];

type PrimaryProductMedia = {
  assetId: string;
  imageUrl: string;
  name: string;
  versionNumber: number;
};

type PrimaryProductMediaMap = Record<
  string,
  PrimaryProductMedia
>;

async function getPrimaryProductMedia(
  productIds: string[],
): Promise<PrimaryProductMediaMap> {
  const normalizedIds = [
    ...new Set(
      productIds
        .map((productId) => productId.trim())
        .filter(Boolean),
    ),
  ];

  if (normalizedIds.length === 0) {
    return {};
  }

  const response = await fetch(
    "/api/media/products/primary",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productIds: normalizedIds,
      }),
    },
  );

  const result = (await response
    .json()
    .catch(() => null)) as
    | PrimaryProductMediaMap
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      result &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : "Productafbeeldingen konden niet worden geladen.",
    );
  }

  return (result ?? {}) as PrimaryProductMediaMap;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(
        new Error(
          "Productafbeelding kon niet worden gelezen.",
        ),
      );
    };

    reader.onerror = () => {
      reject(
        new Error(
          "Productafbeelding kon niet worden gelezen.",
        ),
      );
    };

    reader.readAsDataURL(blob);
  });
}

async function imageUrlToDataUrl(imageUrl: string) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(
      "Productafbeelding kon niet worden gedownload.",
    );
  }

  return blobToDataUrl(await response.blob());
}

async function attachPrimaryProductImages(
  definition: DocumentDefinition,
) {
  if (
    definition.documentType !==
    "SALES_ORDER_CONFIRMATION"
  ) {
    return;
  }

  const productIds = definition.articleBlocks
    .map((block) => block.productId ?? "")
    .filter(Boolean);

  if (productIds.length === 0) {
    return;
  }

  const mediaByProductId =
    await getPrimaryProductMedia(productIds);

  await Promise.all(
    definition.articleBlocks.map(async (block) => {
      const productId = block.productId ?? "";
      const media = mediaByProductId[productId];

      if (!media?.imageUrl) {
        return;
      }

      try {
        block.imageDataUrl =
          await imageUrlToDataUrl(media.imageUrl);
      } catch {
        // Een ontbrekende of onleesbare afbeelding mag het
        // volledige bedrijfsdocument niet blokkeren.
        block.imageDataUrl = undefined;
      }
    }),
  );
}


type DocumentCustomerRecord = {
  id?: unknown;
  companyName?: unknown;
  contactPerson?: unknown;
  email?: unknown;
  address?: unknown;
  postalCode?: unknown;
  city?: unknown;
  vatNumber?: unknown;
};

function asDocumentText(value: unknown) {
  return String(value ?? "").trim();
}

async function fetchDocumentCustomer(
  customerId: string,
): Promise<DocumentCustomerRecord | null> {
  const normalizedId = customerId.trim();

  if (!normalizedId) {
    return null;
  }

  const response = await fetch(
    "/api/customers",
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    },
  );

  const body = (await response
    .json()
    .catch(() => null)) as
    | DocumentCustomerRecord[]
    | {
        customers?: DocumentCustomerRecord[];
        data?: DocumentCustomerRecord[];
        error?: string;
      }
    | null;

  if (!response.ok) {
    const message =
      body &&
      !Array.isArray(body) &&
      typeof body.error === "string"
        ? body.error
        : "Klantgegevens konden niet worden geladen.";

    throw new Error(message);
  }

  const customers = Array.isArray(body)
    ? body
    : Array.isArray(body?.customers)
      ? body.customers
      : Array.isArray(body?.data)
        ? body.data
        : [];

  return (
    customers.find(
      (customer) =>
        asDocumentText(customer.id) ===
        normalizedId,
    ) ?? null
  );
}

async function attachCurrentCustomerData(
  definition: DocumentDefinition,
) {
  if (
    definition.documentType ===
      "PURCHASE_ORDER" ||
    !definition.customerId
  ) {
    return;
  }

  const customer =
    await fetchDocumentCustomer(
      definition.customerId,
    );

  if (!customer) {
    return;
  }

  const companyName =
    asDocumentText(customer.companyName) ||
    definition.customerName;

  const contactPerson = asDocumentText(
    customer.contactPerson,
  );
  const address = asDocumentText(
    customer.address,
  );
  const postalCode = asDocumentText(
    customer.postalCode,
  );
  const city = asDocumentText(
    customer.city,
  );
  const vatNumber = asDocumentText(
    customer.vatNumber,
  );
  const email = asDocumentText(
    customer.email,
  );

  definition.customerName = companyName;

  definition.customerLines = [
    contactPerson,
    address,
    [postalCode, city]
      .filter(Boolean)
      .join(" ")
      .trim(),
    vatNumber
      ? `BTW-nummer: ${vatNumber}`
      : "",
    email,
  ].filter(Boolean);
}

function getPdfImageFormat(dataUrl: string) {
  if (
    dataUrl.startsWith("data:image/jpeg") ||
    dataUrl.startsWith("data:image/jpg")
  ) {
    return "JPEG";
  }

  if (dataUrl.startsWith("data:image/webp")) {
    return "WEBP";
  }

  return "PNG";
}

function formatCurrency(
  value: number,
  currency = "EUR",
) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(`${value}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function sanitizeFilename(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeSize(size: string) {
  return size.trim().toUpperCase();
}

function getSortedSizes(sizes: string[]) {
  const unique = Array.from(
    new Set(sizes.map(normalizeSize)),
  );

  return unique.sort((first, second) => {
    const firstIndex =
      STANDARD_SIZES.indexOf(first);
    const secondIndex =
      STANDARD_SIZES.indexOf(second);

    if (firstIndex >= 0 && secondIndex >= 0) {
      return firstIndex - secondIndex;
    }

    if (firstIndex >= 0) {
      return -1;
    }

    if (secondIndex >= 0) {
      return 1;
    }

    return first.localeCompare(second, "nl", {
      numeric: true,
    });
  });
}

type StoredProduct =
  ReturnType<typeof getStoredProducts>[number];

type ProductReferenceInput = {
  productId?: string;
  productCode?: string;
  sku?: string;
};

function normalizeProductReference(
  value: unknown,
) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function createProductResolver() {
  const storedProducts = getStoredProducts();

  const productsById = new Map(
    storedProducts.map((product) => [
      product.id,
      product,
    ]),
  );

  const productsByReference =
    new Map<string, StoredProduct>();

  storedProducts.forEach((product) => {
    const record =
      product as unknown as Record<
        string,
        unknown
      >;

    const references = [
      record.productCode,
      record.code,
      record.articleNumber,
      record.articleCode,
      record.sku,
    ]
      .map(normalizeProductReference)
      .filter(Boolean);

    references.forEach((reference) => {
      if (
        !productsByReference.has(reference)
      ) {
        productsByReference.set(
          reference,
          product,
        );
      }
    });
  });

  return ({
    productId,
    productCode,
    sku,
  }: ProductReferenceInput) => {
    if (productId) {
      const product =
        productsById.get(productId);

      if (product) {
        return product;
      }
    }

    const references = [
      productCode,
      sku,
    ]
      .map(normalizeProductReference)
      .filter(Boolean);

    for (const reference of references) {
      const product =
        productsByReference.get(reference);

      if (product) {
        return product;
      }
    }

    return undefined;
  };
}


function getBlockColorCode(
  product: StoredProduct | undefined,
  color: string,
) {
  const normalized = color.trim().toLowerCase();
  const variantCode = product?.variants
    ?.find(
      (variant) =>
        variant.color.trim().toLowerCase() ===
          normalized &&
        variant.colorCode?.trim(),
    )
    ?.colorCode?.trim();

  // Varianten zonder eigen kleurnummer vallen terug op de stamkleur.
  return variantCode || resolveColor(color)?.code || "";
}

type DocumentCustomerInput = {
  customerId?: string;
  companyName?: string;
  contactPerson?: string;
  city?: string;
  email?: string;
  vatNumber?: string;
};

function firstText(
  record: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = String(
      record[key] ?? "",
    ).trim();

    if (value) {
      return value;
    }
  }

  return "";
}

function resolveDocumentCustomer({
  customerId,
  companyName,
  contactPerson,
  city,
  email,
  vatNumber,
}: DocumentCustomerInput) {
  const customer = customerId
    ? getCustomers().find(
        (item) => item.id === customerId,
      )
    : undefined;

  const record =
    (customer ?? {}) as unknown as Record<
      string,
      unknown
    >;

  const resolvedCompanyName =
    firstText(record, [
      "companyName",
      "name",
      "tradeName",
      "customerName",
    ]) || companyName?.trim() || "—";

  const resolvedContactPerson =
    firstText(record, [
      "contactPerson",
      "contactName",
      "primaryContact",
    ]) || contactPerson?.trim() || "";

  const street = firstText(record, [
    "street",
    "streetName",
    "addressStreet",
  ]);

  const houseNumber = firstText(record, [
    "houseNumber",
    "houseNumberAddition",
    "streetNumber",
    "number",
  ]);

  const directAddress = firstText(record, [
    "address",
    "invoiceAddress",
    "billingAddress",
    "visitAddress",
  ]);

  const streetLine =
    [street, houseNumber]
      .filter(Boolean)
      .join(" ")
      .trim() || directAddress;

  const postalCode = firstText(record, [
    "postalCode",
    "zipCode",
    "postcode",
  ]);

  const resolvedCity =
    firstText(record, [
      "city",
      "town",
      "place",
    ]) || city?.trim() || "";

  const cityLine = [
    postalCode,
    resolvedCity,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const resolvedVatNumber =
    firstText(record, [
      "vatNumber",
      "vatId",
      "btwNumber",
      "taxNumber",
    ]) || vatNumber?.trim() || "";

  const resolvedEmail =
    firstText(record, [
      "email",
      "emailAddress",
      "primaryEmail",
    ]) || email?.trim() || "";

  return {
    name: resolvedCompanyName,
    lines: [
      resolvedContactPerson,
      streetLine,
      cityLine,
      resolvedVatNumber
        ? `BTW-nummer: ${resolvedVatNumber}`
        : "",
      resolvedEmail,
    ].filter(Boolean),
  };
}

function groupSalesLines(
  order: SalesOrder,
  documentType:
    | "SALES_ORDER_CONFIRMATION"
    | "PACKING_SLIP",
): FashionArticleBlock[] {
  const groups = new Map<
    string,
    SalesOrderLine[]
  >();

  order.lines
    .filter((line) => line.quantity > 0)
    .forEach((line) => {
    const key = [
      line.productId,
      line.productCode,
      line.productName,
      line.color,
    ].join("::");

    const current = groups.get(key) ?? [];
    current.push(line);
    groups.set(key, current);
  });

  const resolveProduct =
    createProductResolver();

  return Array.from(groups.values()).map(
    (lines) => {
      const first = lines[0];
      const product = resolveProduct({
        productId: first.productId,
        productCode: first.productCode,
        sku: first.sku,
      });
      const sizes = getSortedSizes(
        lines.map((line) => line.size),
      );

      const ordered: Record<string, number> = {};
      const reserved: Record<string, number> = {};
      const open: Record<string, number> = {};
      const delivered: Record<string, number> = {};

      sizes.forEach((size) => {
        ordered[size] = 0;
        reserved[size] = 0;
        open[size] = 0;
        delivered[size] = 0;
      });

      lines.forEach((line) => {
        const size = normalizeSize(line.size);
        const reservedQuantity =
          typeof line.reservedQuantity === "number"
            ? line.reservedQuantity
            : 0;

        ordered[size] += line.quantity;
        reserved[size] += reservedQuantity;
        delivered[size] += line.deliveredQuantity;
        open[size] += Math.max(
          0,
          line.quantity -
            line.deliveredQuantity -
            reservedQuantity,
        );
      });

      const rows =
        documentType ===
        "SALES_ORDER_CONFIRMATION"
          ? [
              {
                label: "Besteld",
                quantities: ordered,
              },
            ]
          : [
              {
                label: "Besteld",
                quantities: ordered,
              },
              {
                label: "Geleverd",
                quantities: delivered,
              },
            ];

      return {
        productId:
          product?.id ?? first.productId,
        productCode: first.productCode,
        productName: first.productName,
        brand: product?.brand ?? "",
        season: product?.seasonType ?? "",
        color: first.color,
        colorCode: getBlockColorCode(
          product,
          first.color,
        ),
        sku: first.sku,
        barcode: "",
        sizes,
        matrixRows: rows,
        total: lines.reduce(
          (sum, line) => sum + line.quantity,
          0,
        ),
        orderNumber: order.orderNumber,
        salesPrice: first.unitPrice,
        recommendedRetailPrice:
          order.status === "Concept"
            ? product?.recommendedRetailPrice ??
              first.recommendedRetailPrice ??
              0
            : first.recommendedRetailPrice ?? 0,
        lineTotal: lines.reduce(
          (sum, line) =>
            sum +
            line.quantity *
              line.unitPrice *
              (1 -
                line.discountPercentage / 100),
          0,
        ),
      };
    },
  );
}

type SalesDeliveryLineData = {
  id: string;
  sales_order_line_id: string;
  product_id: string;
  product_name: string;
  product_code: string;
  sku: string;
  color: string;
  size: string;
  quantity: number;
};

type SalesDeliveryData = {
  id: string;
  delivery_number: string;
  delivery_date: string;
  sales_order_id: string;
  sales_delivery_lines: SalesDeliveryLineData[];
};

/**
 * Packing slips are requested by referenceId without saying whether it's a
 * whole sales order or one specific delivery out of it, so this just tries
 * the delivery lookup and treats a miss as "it's an order id" — the only
 * two things referenceId can be for PACKING_SLIP.
 */
async function fetchSalesDelivery(
  id: string,
): Promise<SalesDeliveryData | null> {
  try {
    const response = await fetch(
      `/api/sales-deliveries/${id}`,
      { cache: "no-store" },
    );

    if (!response.ok) return null;

    return (await response.json()) as SalesDeliveryData;
  } catch {
    return null;
  }
}

function groupDeliveryLines(
  delivery: SalesDeliveryData,
  order: SalesOrder,
): FashionArticleBlock[] {
  const orderLinesById = new Map(
    order.lines.map((line) => [line.id, line]),
  );

  const groups = new Map<string, SalesDeliveryLineData[]>();

  delivery.sales_delivery_lines
    .filter((line) => line.quantity > 0)
    .forEach((line) => {
      const key = [
        line.product_id,
        line.product_name,
        line.color,
      ].join("::");

      const current = groups.get(key) ?? [];
      current.push(line);
      groups.set(key, current);
    });

  const resolveProduct = createProductResolver();

  return Array.from(groups.values()).map((lines) => {
    const first = lines[0];
    const orderLine = orderLinesById.get(
      first.sales_order_line_id,
    );
    const product = resolveProduct({
      productId: first.product_id,
      sku: first.sku,
    });
    const sizes = getSortedSizes(
      lines.map((line) => line.size),
    );

    const delivered: Record<string, number> = {};
    sizes.forEach((size) => {
      delivered[size] = 0;
    });

    lines.forEach((line) => {
      delivered[normalizeSize(line.size)] += line.quantity;
    });

    const total = lines.reduce(
      (sum, line) => sum + line.quantity,
      0,
    );

    const unitPrice = orderLine?.unitPrice ?? 0;
    const discountPercentage =
      orderLine?.discountPercentage ?? 0;

    return {
      productId: product?.id ?? first.product_id,
      productCode: first.product_code,
      productName: first.product_name,
      brand: product?.brand ?? "",
      season: product?.seasonType ?? "",
      color: first.color,
      colorCode: getBlockColorCode(
        product,
        first.color,
      ),
      sku: first.sku,
      barcode: "",
      sizes,
      matrixRows: [
        {
          label: "Geleverd",
          quantities: delivered,
        },
      ],
      total,
      orderNumber: order.orderNumber,
      salesPrice: unitPrice,
      recommendedRetailPrice:
        orderLine?.recommendedRetailPrice ?? 0,
      lineTotal:
        total * unitPrice * (1 - discountPercentage / 100),
    } satisfies FashionArticleBlock;
  });
}

async function getSalesDefinition(
  referenceId: string,
  documentType:
    | "SALES_ORDER_CONFIRMATION"
    | "PACKING_SLIP",
): Promise<DocumentDefinition> {
  const delivery =
    documentType === "PACKING_SLIP"
      ? await fetchSalesDelivery(referenceId)
      : null;

  const order = delivery
    ? await loadSalesOrderById(delivery.sales_order_id)
    : getSalesOrderById(referenceId);

  if (!order) {
    throw new Error(
      "Verkooporder niet gevonden.",
    );
  }

  const totals = getSalesOrderTotals(order);
  const documentCustomer =
    resolveDocumentCustomer({
      customerId: order.customerId,
      companyName: order.customerName,
      contactPerson: order.contactPerson,
      city: order.city,
      email: order.email,
    });
  const title =
    documentType ===
    "SALES_ORDER_CONFIRMATION"
      ? "ORDERBEVESTIGING"
      : "PAKBON";

  const documentNumber = delivery
    ? delivery.delivery_number
    : order.orderNumber;
  const documentDate = delivery
    ? delivery.delivery_date
    : order.orderDate;

  const articleBlocks = delivery
    ? groupDeliveryLines(delivery, order)
    : groupSalesLines(order, documentType);

  const totalUnits = delivery
    ? delivery.sales_delivery_lines.reduce(
        (sum, line) => sum + line.quantity,
        0,
      )
    : totals.quantity;

  return {
    documentType,
    title,
    number: documentNumber,
    date: documentDate,
    customerId: order.customerId,
    customerName: documentCustomer.name,
    customerLines: documentCustomer.lines,
    meta: [
      {
        label:
          documentType ===
          "SALES_ORDER_CONFIRMATION"
            ? "Ordernummer"
            : "Pakbonnummer",
        value: documentNumber,
      },
      {
        label: "Datum",
        value: formatDate(documentDate),
      },
      {
        label: "Stuks",
        value: `${totalUnits} stuks`,
      },
      {
        label: "Debiteurnummer",
        value: order.customerNumber || "—",
      },
      {
        label: "Gewenste levering",
        value: formatDate(
          order.requestedDeliveryDate,
        ),
      },
      {
        label: "Betalingstermijn",
        value: getPaymentConditionText(order),
      },
      {
        label: "Status",
        value: order.status,
      },
    ],
    articleBlocks,
    totalUnits,
    totalArticles: new Set(
      articleBlocks.map((block) => block.productId),
    ).size,
    subtotal:
      documentType ===
      "SALES_ORDER_CONFIRMATION"
        ? totals.subtotal
        : undefined,
    vat:
      documentType ===
      "SALES_ORDER_CONFIRMATION"
        ? totals.vat
        : undefined,
    total:
      documentType ===
      "SALES_ORDER_CONFIRMATION"
        ? totals.total
        : undefined,
    currency: "EUR",
    notes: order.notes || "",
    filename: sanitizeFilename(
      `${title}-${documentNumber}.pdf`,
    ),
  };
}

async function getPurchaseDefinition(
  referenceId: string,
  language: DocumentLanguage = "nl",
): Promise<DocumentDefinition> {
  const order = await loadPurchaseOrderById(referenceId);

  if (!order) {
    throw new Error(
      "Inkooporder niet gevonden.",
    );
  }

  const suppliers = await fetchSuppliers();
  const supplier = suppliers.find(
    (item) => item.id === order.supplierId,
  );

  const supplierAddressLines = supplier
    ? [
        supplier.address ||
          [supplier.street, supplier.houseNumber]
            .filter(Boolean)
            .join(" "),
        [supplier.postalCode, supplier.city]
          .filter(Boolean)
          .join(" "),
        supplier.country,
        supplier.vatNumber
          ? `${language === "en" ? "VAT" : "BTW"}: ${supplier.vatNumber}`
          : "",
        supplier.email,
      ].filter(Boolean)
    : [];

  const totals = getPurchaseOrderTotals(order);

  const groups = new Map<
    string,
    typeof order.lines
  >();

  order.lines.forEach((line) => {
    const key = [
      line.productId,
      line.productCode,
      line.productName,
      line.color,
    ].join("::");

    const current = groups.get(key) ?? [];
    current.push(line);
    groups.set(key, current);
  });

  const resolveProduct =
    createProductResolver();

  const articleBlocks =
    Array.from(groups.values()).map(
      (lines) => {
        const first = lines[0];
        const product = resolveProduct({
          productCode: first.productCode,
          sku: first.sku,
        });
        const sizes = getSortedSizes(
          lines.map((line) => line.size),
        );

        const ordered: Record<string, number> =
          {};

        sizes.forEach((size) => {
          ordered[size] = 0;
        });

        lines.forEach((line) => {
          ordered[normalizeSize(line.size)] +=
            line.orderedQuantity;
        });

        return {
          productCode: first.productCode,
          productName: first.productName,
          brand: product?.brand ?? "",
          season: order.collectionCode || "",
          color: first.color,
          colorCode: getBlockColorCode(
            product,
            first.color,
          ),
          sku: first.sku,
          barcode: "",
          sizes,
          matrixRows: [
            {
              label: "Besteld",
              quantities: ordered,
            },
          ],
          total: lines.reduce(
            (sum, line) =>
              sum + line.orderedQuantity,
            0,
          ),
          orderNumber: order.orderNumber,
          purchasePrice: first.purchasePrice,
          lineTotal: lines.reduce(
            (sum, line) =>
              sum +
              line.orderedQuantity *
                line.purchasePrice,
            0,
          ),
        } satisfies FashionArticleBlock;
      },
    );

  return {
    documentType: "PURCHASE_ORDER",
    title:
      language === "en"
        ? "PURCHASE ORDER"
        : "INKOOPORDER",
    number: order.orderNumber,
    date: order.orderDate,
    customerName: order.supplierName,
    customerLines: [
      ...supplierAddressLines,
      order.supplierReference
        ? `${
            language === "en" ? "Reference" : "Referentie"
          }: ${order.supplierReference}`
        : "",
    ].filter(Boolean),
    meta: [
      {
        label:
          language === "en"
            ? "Order number"
            : "Ordernummer",
        value: order.orderNumber,
      },
      {
        label:
          language === "en"
            ? "Date"
            : "Datum",
        value: formatDate(order.orderDate),
      },
      {
        label:
          language === "en"
            ? "Units"
            : "Stuks",
        value:
          language === "en"
            ? String(totals.orderedQuantity)
            : `${totals.orderedQuantity} stuks`,
      },
      {
        label:
          language === "en"
            ? "Collection"
            : "Collectie",
        value: order.collectionCode || "—",
      },
      {
        label:
          language === "en"
            ? "Expected delivery"
            : "Verwachte levering",
        value: formatDate(
          order.expectedDeliveryDate,
        ),
      },
      {
        label:
          language === "en"
            ? "Payment terms"
            : "Betalingstermijn",
        value: getPaymentConditionText(order, language),
      },
      {
        label:
          language === "en"
            ? "Currency"
            : "Valuta",
        value: order.currency,
      },
    ],
    language,
    articleBlocks,
    totalUnits: totals.orderedQuantity,
    totalArticles: new Set(
      order.lines.map((line) => line.productId),
    ).size,
    subtotal: totals.subtotal,
    total: totals.subtotal,
    currency: order.currency,
    notes: order.notes || "",
    filename: sanitizeFilename(
      language === "en"
        ? `Purchase-Order-${order.orderNumber}.pdf`
        : `Inkooporder-${order.orderNumber}.pdf`,
    ),
  };
}

function getInvoiceDefinition(
  referenceId: string,
): DocumentDefinition {
  const invoice = getInvoiceById(referenceId);

  if (!invoice) {
    throw new Error("Factuur niet gevonden.");
  }

  const documentCustomer =
    resolveDocumentCustomer({
      customerId: invoice.customerId,
      companyName: invoice.customerName,
      contactPerson: invoice.contactPerson,
      city: invoice.city,
      email: invoice.email,
      vatNumber: invoice.customerVatNumber,
    });

  const groups = new Map<
    string,
    typeof invoice.lines
  >();

  invoice.lines.forEach((line) => {
    const key = [
      line.productCode,
      line.productName,
      line.color,
    ].join("::");

    const current = groups.get(key) ?? [];
    current.push(line);
    groups.set(key, current);
  });

  const resolveProduct =
    createProductResolver();

  const articleBlocks =
    Array.from(groups.values()).map(
      (lines) => {
        const first = lines[0];
        const product = resolveProduct({
          productCode: first.productCode,
          sku: first.sku,
        });
        const sizes = getSortedSizes(
          lines.map((line) => line.size),
        );

        const invoiced: Record<string, number> =
          {};

        sizes.forEach((size) => {
          invoiced[size] = 0;
        });

        lines.forEach((line) => {
          invoiced[normalizeSize(line.size)] +=
            line.quantity;
        });

        return {
          productId: product?.id,
          productCode: first.productCode,
          productName: first.productName,
          brand: product?.brand ?? "",
          season: product?.seasonType ?? "",
          color: first.color,
          colorCode: getBlockColorCode(
            product,
            first.color,
          ),
          sku: first.sku,
          barcode: "",
          sizes,
          matrixRows: [
            {
              label: "Aantal",
              quantities: invoiced,
            },
          ],
          total: lines.reduce(
            (sum, line) => sum + line.quantity,
            0,
          ),
          orderNumber:
            invoice.salesOrderNumber,
          salesPrice: first.unitPrice,
          lineTotal: lines.reduce(
            (sum, line) =>
              sum + line.lineSubtotal,
            0,
          ),
        } satisfies FashionArticleBlock;
      },
    );

  return {
    documentType: "INVOICE",
    title: "FACTUUR",
    number: invoice.invoiceNumber,
    date: invoice.invoiceDate,
    customerId: invoice.customerId,
    customerName: documentCustomer.name,
    customerLines: documentCustomer.lines,
    meta: [
      {
        label: "Factuurnummer",
        value: invoice.invoiceNumber,
      },
      {
        label: "Datum",
        value: formatDate(invoice.invoiceDate),
      },
      {
        label: "Verkooporder",
        value: invoice.salesOrderNumber || "—",
      },
      {
        label: "Vervaldatum",
        value: formatDate(invoice.dueDate),
      },
      {
        label: "Debiteurnummer",
        value: invoice.customerNumber || "—",
      },
      {
        label: "Betalingstermijn",
        value: getPaymentConditionText(invoice),
      },
      {
        label: "Status",
        value: invoice.status,
      },
    ],
    articleBlocks,
    totalUnits: invoice.lines.reduce(
      (sum, line) => sum + line.quantity,
      0,
    ),
    totalArticles: new Set(
      invoice.lines.map(
        (line) => line.productCode,
      ),
    ).size,
    subtotal: invoice.subtotal,
    vat: invoice.vatAmount,
    total: invoice.total,
    currency: "EUR",
    notes: invoice.notes || "",
    filename: sanitizeFilename(
      `Factuur-${invoice.invoiceNumber}.pdf`,
    ),
  };
}

function getCreditNoteDefinition(
  referenceId: string,
): DocumentDefinition {
  const credit = getCreditNoteById(
    referenceId,
  );

  if (!credit) {
    throw new Error(
      "Creditfactuur niet gevonden.",
    );
  }

  const originalInvoice = getInvoiceById(
    credit.originalInvoiceId,
  );

  const documentCustomer =
    resolveDocumentCustomer({
      customerId: originalInvoice?.customerId,
      companyName: credit.customerName,
      contactPerson:
        originalInvoice?.contactPerson,
      city: originalInvoice?.city,
      email: originalInvoice?.email,
      vatNumber:
        originalInvoice?.customerVatNumber,
    });

  const groups = new Map<
    string,
    typeof credit.lines
  >();

  credit.lines.forEach((line) => {
    const key = [
      line.productCode,
      line.productName,
      line.color,
    ].join("::");

    const current = groups.get(key) ?? [];
    current.push(line);
    groups.set(key, current);
  });

  const resolveProduct =
    createProductResolver();

  const articleBlocks =
    Array.from(groups.values()).map(
      (lines) => {
        const first = lines[0];
        const product = resolveProduct({
          productCode: first.productCode,
          sku: first.sku,
        });

        const sizes = getSortedSizes(
          lines.map((line) => line.size),
        );

        const quantities: Record<
          string,
          number
        > = {};

        sizes.forEach((size) => {
          quantities[size] = 0;
        });

        lines.forEach((line) => {
          quantities[
            normalizeSize(line.size)
          ] += line.quantity;
        });

        return {
          productId: product?.id,
          productCode: first.productCode,
          productName: first.productName,
          brand: product?.brand ?? "",
          season: product?.seasonType ?? "",
          color: first.color,
          colorCode: getBlockColorCode(
            product,
            first.color,
          ),
          sku: first.sku,
          barcode: "",
          sizes,
          matrixRows: [
            {
              label: "Credit",
              quantities,
            },
          ],
          total: lines.reduce(
            (sum, line) =>
              sum + line.quantity,
            0,
          ),
          orderNumber:
            credit.originalInvoiceNumber,
          salesPrice: -Math.abs(
            first.unitPrice,
          ),
          lineTotal: -Math.abs(
            lines.reduce(
              (sum, line) =>
                sum + line.lineSubtotal,
              0,
            ),
          ),
        } satisfies FashionArticleBlock;
      },
    );

  return {
    documentType: "CREDIT_NOTE",
    title: "CREDITFACTUUR",
    number: credit.creditNumber,
    date: credit.creditDate,
    customerId: originalInvoice?.customerId,
    customerName: documentCustomer.name,
    customerLines: documentCustomer.lines,
    meta: [
      {
        label: "Creditnummer",
        value: credit.creditNumber,
      },
      {
        label: "Datum",
        value: formatDate(
          credit.creditDate,
        ),
      },
      {
        label: "Originele factuur",
        value:
          credit.originalInvoiceNumber,
      },
      {
        label: "Retour",
        value: credit.rmaNumber,
      },
      {
        label: "Debiteurnummer",
        value:
          originalInvoice?.customerNumber ||
          "—",
      },
      {
        label: "Status",
        value: credit.status,
      },
    ],
    articleBlocks,
    totalUnits: credit.lines.reduce(
      (sum, line) =>
        sum + line.quantity,
      0,
    ),
    totalArticles: new Set(
      credit.lines.map(
        (line) => line.productCode,
      ),
    ).size,
    subtotal: -Math.abs(credit.subtotal),
    vat: -Math.abs(credit.vatAmount),
    total: -Math.abs(credit.total),
    currency: "EUR",
    notes:
      credit.reason ||
      `Credit op ${credit.originalInvoiceNumber}`,
    filename: sanitizeFilename(
      `Creditfactuur-${credit.creditNumber}.pdf`,
    ),
  };
}

async function getDefinition(
  documentType: BusinessDocumentType,
  referenceId: string,
  language: DocumentLanguage = "nl",
) {
  if (documentType === "PURCHASE_ORDER") {
    return getPurchaseDefinition(
      referenceId,
      language,
    );
  }

  if (
    documentType ===
    "SALES_ORDER_CONFIRMATION"
  ) {
    return getSalesDefinition(
      referenceId,
      "SALES_ORDER_CONFIRMATION",
    );
  }

  if (documentType === "PACKING_SLIP") {
    return getSalesDefinition(
      referenceId,
      "PACKING_SLIP",
    );
  }

  if (documentType === "CREDIT_NOTE") {
    return getCreditNoteDefinition(
      referenceId,
    );
  }

  return getInvoiceDefinition(referenceId);
}

function getCompanyDisplayName(settings: CompanySettings) {
  return (
    settings.company.tradeName.trim() ||
    settings.company.name.trim() ||
    "Fashion ERP"
  );
}

function getCompanyAddressLines(settings: CompanySettings) {
  const company = settings.company;

  const cityLine = [
    company.postalCode.trim(),
    company.city.trim(),
  ]
    .filter(Boolean)
    .join(" ");

  const lines = [
    company.address.trim(),
    cityLine,
    company.country.trim(),
    company.email.trim(),
    company.phone.trim(),
    company.website.trim(),
  ];

  if (
    settings.documents.showVatNumber &&
    company.vatNumber.trim()
  ) {
    lines.push(`BTW: ${company.vatNumber.trim()}`);
  }

  if (company.chamberOfCommerceNumber.trim()) {
    lines.push(
      `KvK: ${company.chamberOfCommerceNumber.trim()}`,
    );
  }

  if (
    settings.documents.showBankDetails &&
    company.iban.trim()
  ) {
    lines.push(`IBAN: ${company.iban.trim()}`);
  }

  return lines.filter(Boolean);
}

type HeaderBlockMetrics = {
  bottomY: number;
};

function getContainedImageSize(
  pdf: jsPDF,
  dataUrl: string,
  maxWidth: number,
  maxHeight: number,
) {
  const properties = pdf.getImageProperties(dataUrl);
  const sourceWidth = Number(properties.width) || 1;
  const sourceHeight = Number(properties.height) || 1;
  const scale = Math.min(
    maxWidth / sourceWidth,
    maxHeight / sourceHeight,
  );

  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  };
}

function drawCompanyHeader(
  pdf: jsPDF,
  settings: CompanySettings,
): HeaderBlockMetrics {
  const companyName = getCompanyDisplayName(settings);
  const logoDataUrl =
    settings.company.logoDataUrl?.trim() || "";

  const logoTop = 9;
  const logoMaxWidth = 48;
  const logoMaxHeight = 24;
  let y = logoTop;
  let logoBottom = logoTop;

  if (logoDataUrl) {
    try {
      const size = getContainedImageSize(
        pdf,
        logoDataUrl,
        logoMaxWidth,
        logoMaxHeight,
      );

      const format = logoDataUrl.startsWith(
        "data:image/jpeg",
      )
        ? "JPEG"
        : "PNG";

      pdf.addImage(
        logoDataUrl,
        format,
        MARGIN_X,
        logoTop,
        size.width,
        size.height,
        undefined,
        "FAST",
      );

      logoBottom = logoTop + size.height;
      y = logoBottom + 4;
    } catch {
      pdf.setTextColor(20, 20, 20);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(15);
      pdf.text(companyName, MARGIN_X, 17);
      logoBottom = 18;
      y = 23;
    }
  } else {
    pdf.setTextColor(20, 20, 20);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text(companyName, MARGIN_X, 17);
    logoBottom = 18;
    y = 23;
  }

  if (!settings.documents.showCompanyDetails) {
    return {
      bottomY: Math.max(logoBottom, y),
    };
  }

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(20, 20, 20);

  getCompanyAddressLines(settings).forEach(
    (line) => {
      const wrapped = pdf.splitTextToSize(
        line,
        72,
      );

      pdf.text(wrapped, MARGIN_X, y);
      y += wrapped.length * 3.7;
    },
  );

  return {
    bottomY: Math.max(logoBottom, y - 1),
  };
}
function drawCustomerHeader(
  pdf: jsPDF,
  definition: DocumentDefinition,
): HeaderBlockMetrics {
  const rightX = PAGE_WIDTH - MARGIN_X;
  const availableWidth = 72;
  let y = 17;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.5);
  pdf.setTextColor(20, 20, 20);

  const nameLines = pdf.splitTextToSize(
    definition.customerName,
    availableWidth,
  );

  pdf.text(nameLines, rightX, y, {
    align: "right",
  });

  y += nameLines.length * 4.5 + 1;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);

  definition.customerLines.forEach((line) => {
    const wrapped = pdf.splitTextToSize(
      line,
      availableWidth,
    );

    pdf.text(wrapped, rightX, y, {
      align: "right",
    });

    y += wrapped.length * 4;
  });

  return {
    bottomY: y,
  };
}
function normalizePaymentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function buildInvoicePaymentQrPayload(
  definition: DocumentDefinition,
  settings: CompanySettings,
) {
  if (
    definition.documentType !== "INVOICE" ||
    typeof definition.total !== "number"
  ) {
    return "";
  }

  const companyName = normalizePaymentText(
    getCompanyDisplayName(settings),
  ).slice(0, 70);

  const iban = settings.company.iban
    .replace(/\s+/g, "")
    .toUpperCase();

  if (!companyName || !iban) {
    return "";
  }

  const bic = settings.company.bic
    .replace(/\s+/g, "")
    .toUpperCase();

  const amount = definition.total.toFixed(2);

  // EPC069-12 SEPA Credit Transfer QR.
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    bic,
    companyName,
    iban,
    `EUR${amount}`,
    "",
    "",
    normalizePaymentText(
      `Factuur ${definition.number}`,
    ).slice(0, 140),
    "",
  ].join("\n");
}

function drawQrCode(
  pdf: jsPDF,
  payload: string,
  x: number,
  y: number,
  size: number,
) {
  const qr = QRCode.create(payload, {
    errorCorrectionLevel: "M",
  });

  const moduleCount = qr.modules.size;
  const quietZone = 2;
  const totalModules =
    moduleCount + quietZone * 2;
  const moduleSize = size / totalModules;

  pdf.setFillColor(255, 255, 255);
  pdf.rect(x, y, size, size, "F");
  pdf.setFillColor(10, 10, 10);

  for (
    let row = 0;
    row < moduleCount;
    row += 1
  ) {
    for (
      let column = 0;
      column < moduleCount;
      column += 1
    ) {
      const index =
        row * moduleCount + column;

      if (!qr.modules.data[index]) {
        continue;
      }

      pdf.rect(
        x +
          (column + quietZone) *
            moduleSize,
        y +
          (row + quietZone) *
            moduleSize,
        moduleSize + 0.02,
        moduleSize + 0.02,
        "F",
      );
    }
  }
}

function drawHeader(
  pdf: jsPDF,
  definition: DocumentDefinition,
  settings: CompanySettings,
) {
  const companyMetrics = drawCompanyHeader(
    pdf,
    settings,
  );
  const customerMetrics = drawCustomerHeader(
    pdf,
    definition,
  );

  const titleY =
    Math.max(
      companyMetrics.bottomY,
      customerMetrics.bottomY,
    ) + 8;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.setTextColor(20, 20, 20);
  pdf.text(
    definition.title,
    PAGE_WIDTH / 2,
    titleY,
    { align: "center" },
  );

  const metaBoxY = titleY + 7;
  const rowsPerColumn = Math.ceil(
    definition.meta.length / 2,
  );

  const metaBoxHeight = Math.max(
    definition.documentType === "INVOICE"
      ? 43
      : 38,
    12 + rowsPerColumn * 5,
  );

  pdf.setDrawColor(70, 70, 70);
  pdf.setLineWidth(0.2);
  pdf.rect(
    MARGIN_X,
    metaBoxY,
    CONTENT_WIDTH,
    metaBoxHeight,
  );

  // Alleen documenten met een functioneel rechterpaneel
  // reserveren ruimte naast de metadata:
  // - factuur: betaal-QR;
  // - creditfactuur: verwijzing naar originele factuur;
  // - pakbon: documentbarcode.
  const hasRightPanel =
    definition.documentType === "INVOICE" ||
    definition.documentType === "CREDIT_NOTE" ||
    definition.documentType === "PACKING_SLIP";

  const dividerX = 142;

  if (hasRightPanel) {
    pdf.setDrawColor(140, 140, 140);
    pdf.line(
      dividerX,
      metaBoxY + 5,
      dividerX,
      metaBoxY + metaBoxHeight - 5,
    );
  }

  definition.meta.forEach((row, index) => {
    const column =
      index >= rowsPerColumn ? 1 : 0;
    const localIndex =
      column === 0
        ? index
        : index - rowsPerColumn;

    const x = hasRightPanel
      ? column === 0
        ? MARGIN_X + 3
        : 76
      : column === 0
        ? MARGIN_X + 3
        : 104;

    const rowY =
      metaBoxY + 10 + localIndex * 5;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.2);
    pdf.setTextColor(20, 20, 20);
    pdf.text(`${row.label}:`, x, rowY);

    pdf.setFont("helvetica", "bold");
    pdf.text(
      row.value,
      x + 31,
      rowY,
      {
        maxWidth: hasRightPanel
          ? column === 0
            ? 26
            : 31
          : column === 0
            ? 52
            : 57,
      },
    );
  });

  const paymentPayload =
    buildInvoicePaymentQrPayload(
      definition,
      settings,
    );

  if (
    definition.documentType === "INVOICE"
  ) {
    const panelCenterX =
      (dividerX +
        PAGE_WIDTH -
        MARGIN_X) /
      2;

    if (paymentPayload) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6.8);
      pdf.text(
        "SCAN OM TE BETALEN",
        panelCenterX,
        metaBoxY + 7,
        { align: "center" },
      );

      const qrSize = Math.min(
        25,
        metaBoxHeight - 15,
      );

      drawQrCode(
        pdf,
        paymentPayload,
        panelCenterX - qrSize / 2,
        metaBoxY + 9,
        qrSize,
      );

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.2);
      pdf.text(
        definition.number,
        panelCenterX,
        metaBoxY + 11 + qrSize,
        { align: "center" },
      );
    } else {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.text(
        "BETALING",
        panelCenterX,
        metaBoxY + 12,
        { align: "center" },
      );

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.5);
      const paymentLines =
        pdf.splitTextToSize(
          "Vul een IBAN in bij Bedrijfsinstellingen om de betaal-QR te tonen.",
          45,
        );

      pdf.text(
        paymentLines,
        panelCenterX,
        metaBoxY + 18,
        { align: "center" },
      );
    }
  } else if (
    definition.documentType ===
    "CREDIT_NOTE"
  ) {
    const panelCenterX =
      (dividerX +
        PAGE_WIDTH -
        MARGIN_X) /
      2;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.text(
      "CREDIT OP",
      panelCenterX,
      metaBoxY + 15,
      { align: "center" },
    );

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(
      definition.meta.find(
        (row) =>
          row.label ===
          "Originele factuur",
      )?.value || "—",
      panelCenterX,
      metaBoxY + 22,
      { align: "center" },
    );
  } else if (
    definition.documentType ===
    "PACKING_SLIP"
  ) {
    drawDocumentBarcode(
      pdf,
      definition.number,
      dividerX + 7,
      metaBoxY + 9,
      43,
      Math.min(
        17,
        metaBoxHeight - 16,
      ),
    );
  }

  return metaBoxY + metaBoxHeight + 6;
}
function drawDocumentBarcode(
  pdf: jsPDF,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const safe = value || "DOCUMENT";
  const weights = Array.from(safe).flatMap(
    (character) => {
      const code = character.charCodeAt(0);

      return [
        1 + (code % 3),
        1 + ((code >> 2) % 2),
        1 + ((code >> 4) % 3),
      ];
    },
  );

  const totalWeight = weights.reduce(
    (sum, item) => sum + item,
    0,
  );

  let cursor = x;

  weights.forEach((weight, index) => {
    const barWidth =
      (weight / totalWeight) * width;

    if (index % 2 === 0) {
      pdf.setFillColor(20, 20, 20);
      pdf.rect(
        cursor,
        y,
        Math.max(0.25, barWidth),
        height,
        "F",
      );
    }

    cursor += barWidth;
  });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.4);
  pdf.text(value, x + width / 2, y + height + 4, {
    align: "center",
  });
}

function hasArticleImage(
  block: FashionArticleBlock,
  definition: DocumentDefinition,
) {
  return Boolean(
    block.imageDataUrl &&
      definition.documentType ===
        "SALES_ORDER_CONFIRMATION",
  );
}

function getBlockHeight(
  block: FashionArticleBlock,
  definition: DocumentDefinition,
) {
  const headerHeight = hasArticleImage(
    block,
    definition,
  )
    ? 35
    : 18;

  const { chunks } = getSizeLayout(block.sizes);

  return (
    headerHeight +
    chunks.length *
      (5 + block.matrixRows.length * 5)
  );
}

const SIZE_COLUMN_START = MARGIN_X + 48;
const ORDER_COLUMN_X = 130;
const MIN_TOTAL_COLUMN_X = 105;
// Ruimte tussen de eerste maat en de kolom Totaal; daarna volgt Ordernr.
const SIZE_AREA_WIDTH = ORDER_COLUMN_X - SIZE_COLUMN_START - 16;
const PREFERRED_SIZE_COLUMN_WIDTH = 12;
const MIN_SIZE_COLUMN_WIDTH = 6.5;

function getSizeLayout(sizes: string[]) {
  const count = Math.max(sizes.length, 1);
  const fitsOnOneRow =
    count === 1 ||
    SIZE_AREA_WIDTH / (count - 1) >=
      MIN_SIZE_COLUMN_WIDTH;
  const perRow = fitsOnOneRow
    ? count
    : Math.floor(
        SIZE_AREA_WIDTH / MIN_SIZE_COLUMN_WIDTH,
      ) + 1;
  const columnWidth =
    perRow === 1
      ? PREFERRED_SIZE_COLUMN_WIDTH
      : Math.min(
          PREFERRED_SIZE_COLUMN_WIDTH,
          SIZE_AREA_WIDTH / (perRow - 1),
        );

  // Bij veel maten breken we de maattabel af over meerdere regels,
  // zodat een maat nooit in de kolom Totaal terechtkomt.
  const chunks: string[][] = [];

  for (let index = 0; index < sizes.length; index += perRow) {
    chunks.push(sizes.slice(index, index + perRow));
  }

  if (chunks.length === 0) {
    chunks.push([]);
  }

  return {
    chunks,
    columnWidth,
    fontSize: columnWidth < 9 ? 5.8 : 6.5,
    totalColumnX: Math.max(
      MIN_TOTAL_COLUMN_X,
      SIZE_COLUMN_START +
        (perRow - 1) * columnWidth +
        8,
    ),
  };
}

function drawArticleBlock(
  pdf: jsPDF,
  block: FashionArticleBlock,
  y: number,
  definition: DocumentDefinition,
) {
  const isEnglish = definition.language === "en";
  const showImage = hasArticleImage(
    block,
    definition,
  );
  const blockHeight = getBlockHeight(
    block,
    definition,
  );
  const tableHeaderY = showImage
    ? y + 34
    : y + 17;
  const firstRowY = tableHeaderY + 5;
  const dividerY = tableHeaderY - 4;

  pdf.setDrawColor(90, 90, 90);
  pdf.setLineWidth(0.2);
  pdf.rect(
    MARGIN_X,
    y,
    CONTENT_WIDTH,
    blockHeight,
  );

  let productTextX = MARGIN_X + 3;

  if (showImage && block.imageDataUrl) {
    const imageX = MARGIN_X + 3;
    const imageY = y + 3;
    const imageMaxWidth = 25;
    const imageMaxHeight = 25;

    try {
      const size = getContainedImageSize(
        pdf,
        block.imageDataUrl,
        imageMaxWidth,
        imageMaxHeight,
      );

      const centeredX =
        imageX +
        (imageMaxWidth - size.width) / 2;
      const centeredY =
        imageY +
        (imageMaxHeight - size.height) / 2;

      pdf.setDrawColor(210, 210, 210);
      pdf.rect(
        imageX,
        imageY,
        imageMaxWidth,
        imageMaxHeight,
      );

      pdf.addImage(
        block.imageDataUrl,
        getPdfImageFormat(
          block.imageDataUrl,
        ),
        centeredX,
        centeredY,
        size.width,
        size.height,
        undefined,
        "FAST",
      );

      productTextX = MARGIN_X + 32;
    } catch {
      productTextX = MARGIN_X + 3;
    }
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.6);
  pdf.setTextColor(15, 15, 15);

  pdf.text(
    `${block.productCode} — ${block.productName}`,
    productTextX,
    y + 6,
  );

  pdf.setFontSize(6.8);
  pdf.setFont("helvetica", "normal");
  pdf.text(
    `${isEnglish ? "Brand" : "Merk"}: ${block.brand || "—"}`,
    productTextX,
    y + (showImage ? 13 : 9),
  );

  pdf.text(
    `${isEnglish ? "Season" : "Seizoen"}: ${block.season || "—"}`,
    showImage ? productTextX : 95,
    y + (showImage ? 18 : 9),
  );

  pdf.setDrawColor(80, 80, 80);
  pdf.line(
    MARGIN_X + 3,
    dividerY,
    PAGE_WIDTH - MARGIN_X - 3,
    dividerY,
  );

  const sizeLayout = getSizeLayout(block.sizes);
  const sizeColumnStart = SIZE_COLUMN_START;
  const sizeColumnWidth = sizeLayout.columnWidth;
  const rowsHeight = block.matrixRows.length * 5;
  const chunkY = (chunkIndex: number) =>
    chunkIndex * (5 + rowsHeight);

  const totalColumnX = sizeLayout.totalColumnX;
  const orderColumnX = ORDER_COLUMN_X;
  const salesPriceColumnX = 155;
  const retailPriceColumnX = 183;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.3);

  pdf.text(
    isEnglish ? "Color" : "Kleur",
    MARGIN_X + 3,
    tableHeaderY,
  );

  pdf.text(
    isEnglish ? "Color no." : "Kleurnr.",
    MARGIN_X + 25,
    tableHeaderY,
  );

  pdf.setFontSize(
    Math.min(6.3, sizeLayout.fontSize),
  );

  sizeLayout.chunks.forEach(
    (chunk, chunkIndex) => {
      chunk.forEach((size, index) => {
        pdf.text(
          size,
          sizeColumnStart +
            index * sizeColumnWidth,
          tableHeaderY + chunkY(chunkIndex),
        );
      });
    },
  );

  pdf.setFontSize(6.3);

  pdf.text(
    isEnglish ? "Total" : "Totaal",
    totalColumnX,
    tableHeaderY,
  );

  pdf.text(
    isEnglish ? "Order no." : "Ordernr.",
    orderColumnX,
    tableHeaderY,
  );

  if (
    definition.documentType ===
    "SALES_ORDER_CONFIRMATION"
  ) {
    pdf.text(
      isEnglish ? "Sales price" : "Verkoopprijs",
      salesPriceColumnX,
      tableHeaderY,
    );

    pdf.text(
      isEnglish ? "RRP" : "Adviesprijs",
      retailPriceColumnX,
      tableHeaderY,
    );
  } else {
    pdf.text(
      isEnglish ? "Price" : "Prijs",
      salesPriceColumnX,
      tableHeaderY,
    );
  }

  block.matrixRows.forEach(
    (row, rowIndex) => {
      const rowY =
        firstRowY + rowIndex * 5;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.5);

      pdf.text(
        rowIndex === 0
          ? block.color || "—"
          : row.label,
        MARGIN_X + 3,
        rowY,
      );

      pdf.text(
        rowIndex === 0
          ? block.colorCode || "—"
          : "",
        MARGIN_X + 25,
        rowY,
      );

      pdf.setFontSize(sizeLayout.fontSize);

      sizeLayout.chunks.forEach(
        (chunk, chunkIndex) => {
          chunk.forEach((size, index) => {
            const quantity =
              row.quantities[size] ?? 0;

            pdf.text(
              quantity > 0
                ? String(quantity)
                : "",
              sizeColumnStart +
                index * sizeColumnWidth,
              rowY + chunkY(chunkIndex),
            );
          });
        },
      );

      pdf.setFontSize(6.5);

      const rowTotal = Object.values(
        row.quantities,
      ).reduce(
        (sum, quantity) =>
          sum + quantity,
        0,
      );

      pdf.text(
        String(rowTotal),
        totalColumnX,
        rowY,
      );

      pdf.text(
        block.orderNumber,
        orderColumnX,
        rowY,
      );

      if (
        definition.documentType ===
        "SALES_ORDER_CONFIRMATION"
      ) {
        pdf.text(
          typeof block.salesPrice === "number"
            ? formatCurrency(
                block.salesPrice,
                definition.currency,
              )
            : "—",
          salesPriceColumnX,
          rowY,
        );

        pdf.text(
          typeof block.recommendedRetailPrice ===
          "number"
            ? formatCurrency(
                block.recommendedRetailPrice,
                definition.currency,
              )
            : "—",
          retailPriceColumnX,
          rowY,
        );
      } else {
        const price =
          definition.documentType ===
          "PURCHASE_ORDER"
            ? block.purchasePrice
            : definition.documentType ===
                "PACKING_SLIP"
              ? block.recommendedRetailPrice
              : block.salesPrice;

        pdf.text(
          typeof price === "number"
            ? formatCurrency(
                price,
                definition.currency,
              )
            : "—",
          salesPriceColumnX,
          rowY,
        );
      }
    },
  );

  return y + blockHeight;
}

function drawTotals(
  pdf: jsPDF,
  definition: DocumentDefinition,
  startY: number,
) {
  const isEnglish = definition.language === "en";
  let y = startY;

  pdf.setDrawColor(40, 40, 40);
  pdf.line(158, y, 196, y);

  y += 6;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text(isEnglish ? "Articles" : "Artikelen", 158, y);
  pdf.text(
    String(definition.totalArticles),
    196,
    y,
    { align: "right" },
  );

  y += 5;
  pdf.text(isEnglish ? "Units" : "Stuks", 158, y);
  pdf.text(
    String(definition.totalUnits),
    196,
    y,
    { align: "right" },
  );

  if (
    typeof definition.subtotal === "number"
  ) {
    y += 6;
    pdf.setFont("helvetica", "normal");
    pdf.text(isEnglish ? "Subtotal" : "Subtotaal", 158, y);
    pdf.text(
      formatCurrency(
        definition.subtotal,
        definition.currency,
      ),
      196,
      y,
      { align: "right" },
    );
  }

  if (typeof definition.vat === "number") {
    y += 5;
    pdf.text(isEnglish ? "VAT" : "BTW", 158, y);
    pdf.text(
      formatCurrency(
        definition.vat,
        definition.currency,
      ),
      196,
      y,
      { align: "right" },
    );
  }

  if (typeof definition.total === "number") {
    y += 6;
    pdf.setDrawColor(40, 40, 40);
    pdf.line(158, y - 3, 196, y - 3);
    pdf.setFont("helvetica", "bold");
    pdf.text(isEnglish ? "Total" : "Totaal", 158, y);
    pdf.text(
      formatCurrency(
        definition.total,
        definition.currency,
      ),
      196,
      y,
      { align: "right" },
    );
  }

  return y + 5;
}

function drawNotes(
  pdf: jsPDF,
  notes: string,
  startY: number,
  language?: DocumentLanguage,
) {
  if (!notes.trim()) {
    return startY;
  }

  const lines = pdf.splitTextToSize(
    notes,
    CONTENT_WIDTH - 8,
  );

  const height = 10 + lines.length * 4;

  pdf.setDrawColor(120, 120, 120);
  pdf.rect(
    MARGIN_X,
    startY,
    CONTENT_WIDTH,
    height,
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.text(
    language === "en" ? "NOTES" : "OPMERKINGEN",
    MARGIN_X + 3,
    startY + 5,
  );

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.text(
    lines,
    MARGIN_X + 3,
    startY + 10,
  );

  return startY + height;
}

function drawOrderApprovalBlock(
  pdf: jsPDF,
  startY: number,
) {
  const blockHeight = 53;
  const y = Math.max(startY, 214);

  pdf.setTextColor(25, 25, 25);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text(
    "AKKOORDVERKLARING",
    MARGIN_X,
    y,
  );

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.8);

  const statement = pdf.splitTextToSize(
    "Met ondertekening van deze orderbevestiging bevestigt u akkoord te gaan met de vermelde artikelen, aantallen, prijzen, levervoorwaarden en overige afspraken. De toepasselijke algemene verkoopvoorwaarden zijn opgenomen op de volgende pagina's van dit document.",
    CONTENT_WIDTH,
  );

  pdf.text(statement, MARGIN_X, y + 5);

  const lineStartY = y + 22;
  const labelWidth = 24;
  const firstColumnX = MARGIN_X;
  const secondColumnX = 110;

  const drawField = (
    label: string,
    x: number,
    fieldY: number,
    lineWidth: number,
  ) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.8);
    pdf.text(label, x, fieldY);
    pdf.setDrawColor(80, 80, 80);
    pdf.setLineWidth(0.2);
    pdf.line(
      x + labelWidth,
      fieldY,
      x + labelWidth + lineWidth,
      fieldY,
    );
  };

  drawField(
    "Plaats:",
    firstColumnX,
    lineStartY,
    55,
  );
  drawField(
    "Datum:",
    secondColumnX,
    lineStartY,
    55,
  );
  drawField(
    "Naam:",
    firstColumnX,
    lineStartY + 10,
    55,
  );
  drawField(
    "Functie:",
    secondColumnX,
    lineStartY + 10,
    55,
  );

  pdf.text(
    "Handtekening:",
    firstColumnX,
    lineStartY + 22,
  );
  pdf.line(
    firstColumnX + 29,
    lineStartY + 22,
    PAGE_WIDTH - MARGIN_X,
    lineStartY + 22,
  );

  return y + blockHeight;
}


function drawSalesTermsPages(pdf: jsPDF) {
  const paragraphs = SALES_TERMS_TEXT
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const topY = 17;
  const bottomY = FOOTER_Y - 12;
  const textWidth = CONTENT_WIDTH;
  let y = topY;

  const addTermsPage = (
    continuation = false,
  ) => {
    pdf.addPage();

    y = topY;

    pdf.setTextColor(20, 20, 20);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);

    pdf.text(
      continuation
        ? `${SALES_TERMS_TITLE} – VERVOLG`
        : SALES_TERMS_TITLE,
      MARGIN_X,
      y,
    );

    y += 8;

    pdf.setDrawColor(120, 120, 120);
    pdf.setLineWidth(0.2);
    pdf.line(
      MARGIN_X,
      y,
      PAGE_WIDTH - MARGIN_X,
      y,
    );

    y += 7;
  };

  addTermsPage();

  paragraphs.forEach((paragraph) => {
    const isArticleHeading =
      /^Artikel\s+\d+/i.test(paragraph);

    pdf.setFont(
      "helvetica",
      isArticleHeading ? "bold" : "normal",
    );
    pdf.setFontSize(
      isArticleHeading ? 8.2 : 6.6,
    );

    const lines = pdf.splitTextToSize(
      paragraph,
      textWidth,
    );

    const lineHeight = isArticleHeading
      ? 4
      : 3.25;

    const requiredHeight =
      lines.length * lineHeight +
      (isArticleHeading ? 2.5 : 2);

    if (y + requiredHeight > bottomY) {
      addTermsPage(true);

      pdf.setFont(
        "helvetica",
        isArticleHeading
          ? "bold"
          : "normal",
      );
      pdf.setFontSize(
        isArticleHeading ? 8.2 : 6.6,
      );
    }

    pdf.text(
      lines,
      MARGIN_X,
      y,
      {
        lineHeightFactor: 1.15,
      },
    );

    y += requiredHeight;
  });
}

function drawFooter(
  pdf: jsPDF,
  definition: DocumentDefinition,
  settings: CompanySettings,
  pageNumber: number,
  pageCount: number,
) {
  const company = settings.company;
  const footerParts: string[] = [];

  if (settings.documents.showCompanyDetails) {
    const companyName = getCompanyDisplayName(settings);
    const cityLine = [
      company.postalCode.trim(),
      company.city.trim(),
    ]
      .filter(Boolean)
      .join(" ");

    footerParts.push(
      companyName,
      [company.address.trim(), cityLine]
        .filter(Boolean)
        .join(", "),
      company.email.trim(),
      company.phone.trim(),
    );
  }

  if (
    settings.documents.showVatNumber &&
    company.vatNumber.trim()
  ) {
    footerParts.push(`BTW ${company.vatNumber.trim()}`);
  }

  if (company.chamberOfCommerceNumber.trim()) {
    footerParts.push(
      `KvK ${company.chamberOfCommerceNumber.trim()}`,
    );
  }

  if (
    settings.documents.showBankDetails &&
    company.iban.trim()
  ) {
    footerParts.push(`IBAN ${company.iban.trim()}`);
  }

  const footerLine = footerParts
    .filter(Boolean)
    .join("  ·  ");

  pdf.setDrawColor(175, 175, 175);
  pdf.setLineWidth(0.15);
  pdf.line(MARGIN_X, FOOTER_Y - 8, PAGE_WIDTH - MARGIN_X, FOOTER_Y - 8);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.0);
  pdf.setTextColor(65, 65, 65);

  if (footerLine) {
    const wrapped = pdf.splitTextToSize(
      footerLine,
      CONTENT_WIDTH - 10,
    );

    pdf.text(wrapped, MARGIN_X, FOOTER_Y - 3);
  }

  pdf.text(
    `${definition.title} ${definition.number}`,
    MARGIN_X,
    FOOTER_Y + 4,
  );

  pdf.text(
    `Pagina ${pageNumber} / ${pageCount}`,
    PAGE_WIDTH - MARGIN_X,
    FOOTER_Y + 4,
    { align: "right" },
  );
}

export async function createBusinessDocumentPdf(
  documentType: BusinessDocumentType,
  referenceId: string,
  options?: {
    language?: DocumentLanguage;
  },
) {
  const language =
    options?.language ?? "nl";

  if (
    documentType === "SALES_ORDER_CONFIRMATION"
  ) {
    const salesOrder =
      getSalesOrderById(referenceId);

    if (salesOrder?.status === "Concept") {
      await fetchProducts();
    }
  }

  const definition = await getDefinition(
    documentType,
    referenceId,
    options?.language ?? "nl",
  );
  const settings = getCompanySettings();

  await attachCurrentCustomerData(
    definition,
  );

  await attachPrimaryProductImages(
    definition,
  );

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  let y = drawHeader(
    pdf,
    definition,
    settings,
  );

  definition.articleBlocks.forEach(
    (block, index) => {
      const blockHeight =
        getBlockHeight(
          block,
          definition,
        );

      if (y + blockHeight > 270) {
        pdf.addPage();
        y = 14;
      }

      y = drawArticleBlock(
        pdf,
        block,
        y,
        definition,
      );

      y += 4;

      if (
        index ===
        definition.articleBlocks.length - 1
      ) {
        if (y > 252) {
          pdf.addPage();
          y = 18;
        }

        y = drawTotals(
          pdf,
          definition,
          y,
        );

        if (
          definition.notes &&
          y < 245
        ) {
          y = drawNotes(
            pdf,
            definition.notes,
            y + 3,
            definition.language,
          );
        }

        if (
          definition.documentType ===
          "SALES_ORDER_CONFIRMATION"
        ) {
          if (y > 212) {
            pdf.addPage();
            y = 18;
          }

          y = drawOrderApprovalBlock(
            pdf,
            y + 5,
          );
        }
      }
    },
  );

  if (
    definition.articleBlocks.length === 0
  ) {
    y = drawTotals(pdf, definition, y);

    if (
      definition.documentType ===
      "SALES_ORDER_CONFIRMATION"
    ) {
      if (y > 212) {
        pdf.addPage();
        y = 18;
      }

      drawOrderApprovalBlock(
        pdf,
        y + 5,
      );
    }
  }

  if (
    definition.documentType ===
    "SALES_ORDER_CONFIRMATION"
  ) {
    drawSalesTermsPages(pdf);
  }

  const pageCount = pdf.getNumberOfPages();

  for (
    let pageNumber = 1;
    pageNumber <= pageCount;
    pageNumber += 1
  ) {
    pdf.setPage(pageNumber);

    drawFooter(
      pdf,
      definition,
      settings,
      pageNumber,
      pageCount,
    );
  }

  return {
    pdf,
    filename: definition.filename,
  };
}

export async function openBusinessDocumentPdf(
  documentType: BusinessDocumentType,
  referenceId: string,
  options?: {
    language?: DocumentLanguage;
  },
) {
  const pdfWindow = window.open(
    "about:blank",
    "_blank",
  );

  if (!pdfWindow) {
    throw new Error(
      "De browser blokkeert het PDF-venster. Sta pop-ups toe voor deze website.",
    );
  }

  pdfWindow.document.open();
  pdfWindow.document.write(`
    <!doctype html>
    <html lang="nl">
      <head>
        <meta charset="utf-8" />
        <title>PDF voorbereiden</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #f4f7fb;
            color: #14233a;
          }

          main {
            text-align: center;
          }

          strong {
            display: block;
            margin-bottom: 8px;
            font-size: 18px;
          }

          span {
            color: #68788f;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <main>
          <strong>PDF wordt voorbereid…</strong>
          <span>Een moment geduld.</span>
        </main>
      </body>
    </html>
  `);
  pdfWindow.document.close();

  try {
    const { pdf, filename } =
      await createBusinessDocumentPdf(
        documentType,
        referenceId,
        options,
      );

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);

    pdfWindow.location.replace(url);

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 5 * 60_000);

    return filename;
  } catch (error) {
    pdfWindow.document.open();
    pdfWindow.document.write(`
      <!doctype html>
      <html lang="nl">
        <head>
          <meta charset="utf-8" />
          <title>PDF kon niet worden geopend</title>
        </head>
        <body style="font-family: sans-serif; padding: 32px;">
          <h1>PDF kon niet worden geopend</h1>
          <p>Sluit dit venster en probeer het opnieuw.</p>
        </body>
      </html>
    `);
    pdfWindow.document.close();

    throw error;
  }
}

export async function downloadBusinessDocumentPdf(
  documentType: BusinessDocumentType,
  referenceId: string,
  options?: {
    language?: DocumentLanguage;
  },
) {
  const { pdf, filename } =
    await createBusinessDocumentPdf(
      documentType,
      referenceId,
      options,
    );

  pdf.save(filename);

  return filename;
}

export async function createBusinessDocumentPdfAttachment(
  documentType: BusinessDocumentType,
  referenceId: string,
  options?: {
    language?: DocumentLanguage;
  },
): Promise<DocumentEmailAttachment> {
  const { pdf, filename } =
    await createBusinessDocumentPdf(
      documentType,
      referenceId,
      options,
    );

  const dataUri = pdf.output("datauristring");
  const base64Content =
    dataUri.split(",")[1] ?? "";

  if (!base64Content) {
    throw new Error(
      "De PDF-bijlage kon niet worden opgebouwd.",
    );
  }

  return {
    filename,
    content: base64Content,
    contentType: "application/pdf",
  };
}
