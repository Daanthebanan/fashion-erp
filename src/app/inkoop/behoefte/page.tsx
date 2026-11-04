"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchProducts, type Product } from "@/lib/articles";
import { fetchSuppliers, type Supplier } from "@/lib/suppliers";
import { loadSalesOrders, type SalesOrder } from "@/lib/sales";
import type { PurchaseOrder } from "@/lib/purchasing";

type DemandVariant = {
  variantId: string;
  size: string;
  quantity: number;
  alreadyOrdered: number;
};

function netVariantQuantity(variant: DemandVariant, extra: number) {
  return Math.max(0, variant.quantity + extra - variant.alreadyOrdered);
}

type DemandRow = {
  productId: string;
  productCode: string;
  productName: string;
  supplierName: string;
  purchasePrice: number;
  color: string;
  variants: DemandVariant[];
};

type SupplierGroup = {
  supplier: Supplier;
  rows: DemandRow[];
  soldQuantity: number;
  purchaseValue: number;
};

type ProductionDecision = "PRODUCE" | "DO_NOT_PRODUCE";

const excludedStatuses = new Set(["Concept", "Geannuleerd"]);

function money(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

const sizeOrder = [
  "XXXS",
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
];

function sortSizes(values: string[]) {
  return [...values].sort((a, b) => {
    const aIndex = sizeOrder.indexOf(a.toUpperCase());
    const bIndex = sizeOrder.indexOf(b.toUpperCase());

    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }

    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return a.localeCompare(b, "nl", {
      numeric: true,
    });
  });
}

export default function PurchaseDemandPage() {
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [search, setSearch] = useState("");
  const [extraByVariant, setExtraByVariant] = useState<Record<string, number>>({});
  const [decisionByProductColor, setDecisionByProductColor] =
    useState<Record<string, ProductionDecision>>({});
  const [savingDecision, setSavingDecision] = useState<string | null>(null);
  const [expandedImpacts, setExpandedImpacts] =
    useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Voorkomt dat een dubbele klik twee identieke inkooporders aanmaakt.
  const creatingPurchaseOrderRef = useRef(false);
  const [creatingPurchaseOrder, setCreatingPurchaseOrder] =
    useState<string | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([
      fetchProducts(),
      fetchSuppliers(),
      loadSalesOrders(),
      // Echte inkooporders uit de database; de oude lokale opslag
      // (getPurchaseOrders) bevat deze orders niet.
      fetch("/api/purchase-orders", { cache: "no-store" }).then(
        async (response) => {
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error ?? "Inkooporders ophalen mislukt.");
          }
          return (Array.isArray(body) ? body : []) as PurchaseOrder[];
        },
      ),
      fetch("/api/purchase-demand/decisions", { cache: "no-store" }).then(
        async (response) => {
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error ?? "Productiebeslissingen ophalen mislukt.");
          }
          return body as Array<{
            productId: string;
            color: string;
            decision: ProductionDecision;
          }>;
        },
      ),
    ])
      .then(([loadedProducts, loadedSuppliers, loadedOrders, loadedPurchaseOrders, loadedDecisions]) => {
        if (!active) return;
        setProducts(loadedProducts);
        setSuppliers(loadedSuppliers);
        setSalesOrders(loadedOrders);
        setPurchaseOrders(loadedPurchaseOrders);
        setDecisionByProductColor(
          Object.fromEntries(
            loadedDecisions.map((item) => [
              `${item.productId}__${item.color}`,
              item.decision,
            ]),
          ),
        );
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Inkoopbehoefte ophalen mislukt.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function setProductionDecision(
    productId: string,
    color: string,
    decision: ProductionDecision,
  ) {
    const decisionKey = `${productId}__${color}`;
    setSavingDecision(decisionKey);
    setError("");

    try {
      const response = await fetch(
        "/api/purchase-demand/decisions",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            productId,
            color,
            decision,
          }),
        },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ?? "Productiebeslissing opslaan mislukt.",
        );
      }

      setDecisionByProductColor((current) => ({
        ...current,
        [decisionKey]: decision,
      }));

      if (decision === "DO_NOT_PRODUCE") {
        const product = products.find(
          (item) => item.id === productId,
        );

        if (product) {
          const variantIds = new Set(
            product.variants
              .filter((variant) => variant.color === color)
              .map((variant) => variant.id),
          );

          setExtraByVariant((current) => {
            const next = { ...current };

            for (const variantId of variantIds) {
              delete next[variantId];
            }

            return next;
          });
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Productiebeslissing opslaan mislukt.",
      );
    } finally {
      setSavingDecision(null);
    }
  }

  function affectedOrders(
    productId: string,
    color: string,
  ) {
    const product = products.find(
      (item) => item.id === productId,
    );

    if (!product) return [];

    const variantIds = new Set(
      product.variants
        .filter((variant) => variant.color === color)
        .map((variant) => variant.id),
    );

    return salesOrders
      .filter((order) => !excludedStatuses.has(order.status))
      .map((order) => {
        const affectedQuantity = order.lines.reduce(
          (total, line) =>
            total +
            (variantIds.has(line.variantId)
              ? line.quantity
              : 0),
          0,
        );

        return {
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          status: order.status,
          affectedQuantity,
        };
      })
      .filter((order) => order.affectedQuantity > 0);
  }

  const groups = useMemo<SupplierGroup[]>(() => {
    const productById = new Map(products.map((product) => [product.id, product]));
    const productByVariantId = new Map<string, Product>();

    for (const product of products) {
      for (const variant of product.variants) {
        productByVariantId.set(variant.id, product);
      }
    }

    const alreadyOrderedByVariant = new Map<string, number>();

    for (const purchaseOrder of purchaseOrders) {
      if (purchaseOrder.status === "Geannuleerd") continue;

      for (const line of purchaseOrder.lines ?? []) {
        alreadyOrderedByVariant.set(
          line.variantId,
          (alreadyOrderedByVariant.get(line.variantId) ?? 0) +
            line.orderedQuantity,
        );
      }
    }

    const demand = new Map<
      string,
      {
        product: Product;
        color: string;
        variantQuantities: Map<string, DemandVariant>;
      }
    >();

    for (const order of salesOrders) {
      if (excludedStatuses.has(order.status)) continue;

      for (const line of order.lines) {
        const product =
          productById.get(line.productId) ??
          productByVariantId.get(line.variantId);

        if (!product) continue;

        const key = `${product.id}__${line.color}`;
        const current =
          demand.get(key) ?? {
            product,
            color: line.color,
            variantQuantities: new Map<string, DemandVariant>(),
          };

        const existing = current.variantQuantities.get(line.variantId);

        current.variantQuantities.set(line.variantId, {
          variantId: line.variantId,
          size: line.size,
          quantity: (existing?.quantity ?? 0) + line.quantity,
          alreadyOrdered:
            alreadyOrderedByVariant.get(line.variantId) ?? 0,
        });

        demand.set(key, current);
      }
    }

    const supplierById = new Map(
      suppliers.map((supplier) => [supplier.id, supplier]),
    );

    const grouped = new Map<string, SupplierGroup>();

    for (const item of demand.values()) {
      const supplier = supplierById.get(item.product.supplierId);

      if (!supplier) continue;

      const variants = [...item.variantQuantities.values()];
      const soldQuantity = variants.reduce(
        (total, variant) => total + variant.quantity,
        0,
      );

      const row: DemandRow = {
        productId: item.product.id,
        productCode: item.product.code,
        productName: item.product.name,
        supplierName: supplier.companyName,
        purchasePrice: item.product.purchasePrice,
        color: item.color,
        variants,
      };

      const current =
        grouped.get(supplier.id) ?? {
          supplier,
          rows: [],
          soldQuantity: 0,
          purchaseValue: 0,
        };

      current.rows.push(row);
      current.soldQuantity += soldQuantity;
      current.purchaseValue += soldQuantity * item.product.purchasePrice;
      grouped.set(supplier.id, current);
    }

    return [...grouped.values()]
      .filter((group) => !supplierFilter || group.supplier.id === supplierFilter)
      .map((group) => ({
        ...group,
        rows: group.rows
          .filter((row) => {
            const query = search.trim().toLowerCase();
            if (!query) return true;

            return (
              row.productCode.toLowerCase().includes(query) ||
              row.productName.toLowerCase().includes(query) ||
              row.color.toLowerCase().includes(query)
            );
          })
          .sort(
            (a, b) =>
              a.productName.localeCompare(b.productName, "nl") ||
              a.color.localeCompare(b.color, "nl"),
          ),
      }))
      .filter((group) => group.rows.length > 0)
      .sort((a, b) =>
        a.supplier.companyName.localeCompare(b.supplier.companyName),
      );
  }, [products, suppliers, salesOrders, purchaseOrders, supplierFilter, search]);

  async function createPurchaseOrder(
    group: SupplierGroup,
  ) {
    const lines = group.rows.flatMap((row) => {
      const excluded =
        decisionByProductColor[
          `${row.productId}__${row.color}`
        ] === "DO_NOT_PRODUCE";

      if (excluded) return [];

      return row.variants
        .map((variant) => ({
          variantId: variant.variantId,
          orderedQuantity: netVariantQuantity(
            variant,
            extraByVariant[variant.variantId] ?? 0,
          ),
          purchasePrice: row.purchasePrice,
        }))
        .filter(
          (line) => line.orderedQuantity > 0,
        );
    });

    if (lines.length === 0) {
      setError(
        "Er zijn geen aantallen om te bestellen.",
      );
      return;
    }

    if (creatingPurchaseOrderRef.current) {
      return;
    }

    creatingPurchaseOrderRef.current = true;
    setCreatingPurchaseOrder(group.supplier.id);
    setError("");

    try {
      const response = await fetch(
        "/api/purchase-orders",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            supplierId: group.supplier.id,
            currency:
              group.supplier.currency || "EUR",
            paymentDays:
              group.supplier.paymentDays || 30,
            status: "Concept",
            lines,
          }),
        },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ??
            "Inkooporder aanmaken mislukt.",
        );
      }

      if (!body.id) {
        throw new Error(
          "Inkooporder is aangemaakt, maar het order-ID ontbreekt.",
        );
      }

      // De knop blijft uitgeschakeld tot de navigatie klaar is; anders
      // kan een tweede klik nog een identieke inkooporder aanmaken.
      router.push(`/inkoop/${body.id}`);
    } catch (cause) {
      creatingPurchaseOrderRef.current = false;
      setCreatingPurchaseOrder(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Inkooporder aanmaken mislukt.",
      );
    }
  }

  if (loading) {
    return <main style={{ padding: 32 }}>Inkoopbehoefte laden...</main>;
  }

  return (
    <main style={{ padding: 32, maxWidth: 1600, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ color: "#6b7280", marginBottom: 8 }}>
          Inkoop / Inkoopbehoefte
        </div>
        <h1 style={{ margin: 0 }}>Inkoopbehoefte</h1>
        <p style={{ color: "#6b7280" }}>
          Gebaseerd op bevestigde en verdere verkooporders. Concept en geannuleerd
          tellen niet mee. Aantallen die al op een bestaande (niet-geannuleerde)
          inkooporder staan worden automatisch afgetrokken van "Te bestellen".
        </p>
      </div>

      {error && (
        <div style={{ padding: 16, background: "#fee2e2", marginBottom: 20 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <select
          value={supplierFilter}
          onChange={(event) => setSupplierFilter(event.target.value)}
          style={{ padding: "10px 12px", minWidth: 240 }}
        >
          <option value="">Alle leveranciers</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.companyName}
            </option>
          ))}
        </select>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Zoek artikel, code of kleur..."
          style={{ padding: "10px 12px", minWidth: 300 }}
        />
      </div>

      {groups.length === 0 && (
        <div style={{ padding: 24, border: "1px solid #e5e7eb" }}>
          Geen inkoopbehoefte gevonden.
        </div>
      )}

      {groups.map((group) => {
        const sizes = sortSizes(Array.from(
          new Set(
            group.rows.flatMap((row) =>
              row.variants.map((variant) => variant.size),
            ),
          ),
        ));

        const visibleSold = group.rows.reduce(
          (total, row) =>
            total +
            row.variants.reduce(
              (sum, variant) => sum + variant.quantity,
              0,
            ),
          0,
        );

        const visibleExtra = group.rows.reduce(
          (total, row) => {
            if (
              decisionByProductColor[
                `${row.productId}__${row.color}`
              ] === "DO_NOT_PRODUCE"
            ) {
              return total;
            }

            return (
              total +
              row.variants.reduce(
                (sum, variant) =>
                  sum +
                  (extraByVariant[variant.variantId] ?? 0),
                0,
              )
            );
          },
          0,
        );

        const alreadyOrderedTotal = group.rows.reduce(
          (total, row) => {
            if (
              decisionByProductColor[
                `${row.productId}__${row.color}`
              ] === "DO_NOT_PRODUCE"
            ) {
              return total;
            }

            return (
              total +
              row.variants.reduce(
                (sum, variant) => sum + variant.alreadyOrdered,
                0,
              )
            );
          },
          0,
        );

        const totalToOrder = group.rows.reduce((total, row) => {
          if (
            decisionByProductColor[
              `${row.productId}__${row.color}`
            ] === "DO_NOT_PRODUCE"
          ) {
            return total;
          }

          return (
            total +
            row.variants.reduce(
              (sum, variant) =>
                sum +
                netVariantQuantity(
                  variant,
                  extraByVariant[variant.variantId] ?? 0,
                ),
              0,
            )
          );
        }, 0);

        const moq = group.supplier.minimumOrderQuantity ?? 0;
        const remaining = Math.max(0, moq - totalToOrder);

        return (
          <section
            key={group.supplier.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              marginBottom: 24,
              overflow: "hidden",
              background: "white",
            }}
          >
            <div
              style={{
                padding: 20,
                display: "flex",
                justifyContent: "space-between",
                gap: 24,
                background: "#eff6ff",
                borderBottom: "2px solid #bfdbfe",
              }}
            >
              <div>
                <div
                  style={{
                    color: "#1d4ed8",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  Leverancier
                  {group.supplier.supplierNumber
                    ? ` · ${group.supplier.supplierNumber}`
                    : ""}
                </div>
                <h2
                  style={{
                    margin: "0 0 6px",
                    fontSize: 22,
                    color: "#111827",
                  }}
                >
                  {group.supplier.companyName}
                </h2>
                <Link href="/leveranciers">Naar leverancierskaart</Link>
              </div>

              <div style={{ display: "flex", gap: 32 }}>
                <div>
                  <div style={{ color: "#6b7280" }}>MOQ</div>
                  <strong>{moq ? `${moq} stuks` : "Geen MOQ"}</strong>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Verkocht</div>
                  <strong>{visibleSold} stuks</strong>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Extra inkoop</div>
                  <strong>{visibleExtra} stuks</strong>
                </div>
                {alreadyOrderedTotal > 0 && (
                  <div>
                    <div style={{ color: "#6b7280" }}>Al besteld</div>
                    <strong>{alreadyOrderedTotal} stuks</strong>
                  </div>
                )}
                <div>
                  <div style={{ color: "#6b7280" }}>Te bestellen</div>
                  <strong>{totalToOrder} stuks</strong>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Status</div>
                  <strong>
                    {!moq
                      ? "Geen MOQ"
                      : remaining === 0
                        ? "MOQ bereikt"
                        : `${remaining} onder MOQ`}
                  </strong>
                </div>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 900,
                }}
              >
                <thead>
                  <tr>
                    <th style={th}>Artikel</th>
                    <th style={th}>Kleur</th>
                    <th style={th}>Productie</th>
                    <th style={th}>Type</th>
                    <th style={thRight}>Inkoop p/st</th>
                    {sizes.map((size) => (
                      <th key={size} style={thCenter}>
                        {size}
                      </th>
                    ))}
                    <th style={thCenter}>Aantal</th>
                    <th style={thRight}>Totaal</th>
                  </tr>
                </thead>

                <tbody>
                  {group.rows.map((row) => {
                    const quantity = row.variants.reduce(
                      (total, variant) => total + variant.quantity,
                      0,
                    );

                    const extraQuantity = row.variants.reduce(
                      (total, variant) =>
                        total + (extraByVariant[variant.variantId] ?? 0),
                      0,
                    );

                    const excluded =
                      decisionByProductColor[
                        `${row.productId}__${row.color}`
                      ] === "DO_NOT_PRODUCE";

                    const effectiveExtraQuantity = excluded
                      ? 0
                      : extraQuantity;

                    const alreadyOrderedQuantity = row.variants.reduce(
                      (total, variant) => total + variant.alreadyOrdered,
                      0,
                    );

                    const orderQuantity = excluded
                      ? 0
                      : row.variants.reduce(
                          (total, variant) =>
                            total +
                            netVariantQuantity(
                              variant,
                              extraByVariant[variant.variantId] ?? 0,
                            ),
                          0,
                        );

                    const rowSpan =
                      alreadyOrderedQuantity > 0 ? 4 : 3;

                    const impactedOrders =
                      affectedOrders(
                        row.productId,
                        row.color,
                      );

                    const impactKey =
                      `${row.productId}__${row.color}`;

                    const impactsExpanded =
                      expandedImpacts[impactKey] ?? false;

                    return (
                      <Fragment key={`${row.productId}-${row.color}`}>
                        <tr key={`${row.productId}-${row.color}-sold`}>
                          <td style={td} rowSpan={rowSpan}>
                            <strong>{row.productName}</strong>
                            <div style={{ color: "#6b7280", fontSize: 12 }}>
                              {row.productCode}
                            </div>
                          </td>
                          <td style={td} rowSpan={rowSpan}>{row.color}</td>
                          <td style={td} rowSpan={rowSpan}>
                            <div
                              style={{
                                fontWeight: 700,
                                marginBottom: 8,
                                color: excluded ? "#b91c1c" : "#166534",
                              }}
                            >
                              {excluded
                                ? "Niet produceren"
                                : "Produceren"}
                            </div>

                            <button
                              type="button"
                              disabled={
                                savingDecision ===
                                `${row.productId}__${row.color}`
                              }
                              onClick={() =>
                                setProductionDecision(
                                  row.productId,
                                  row.color,
                                  excluded
                                    ? "PRODUCE"
                                    : "DO_NOT_PRODUCE",
                                )
                              }
                              style={{
                                padding: "7px 10px",
                                cursor: "pointer",
                              }}
                            >
                              {savingDecision ===
                              `${row.productId}__${row.color}`
                                ? "Opslaan..."
                                : excluded
                                  ? "Toch produceren"
                                  : "Niet produceren"}
                            </button>

                            {excluded && impactedOrders.length > 0 && (
                              <div
                                style={{
                                  marginTop: 8,
                                  maxWidth: 260,
                                  whiteSpace: "normal",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedImpacts((current) => ({
                                      ...current,
                                      [impactKey]: !impactsExpanded,
                                    }))
                                  }
                                  aria-expanded={impactsExpanded}
                                  style={{
                                    border: 0,
                                    background: "transparent",
                                    padding: 0,
                                    color: "#b91c1c",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    textDecoration: "underline",
                                  }}
                                >
                                  {impactedOrders.length} verkooporder
                                  {impactedOrders.length === 1 ? "" : "s"} geraakt
                                  {impactsExpanded ? " ▲" : " ▼"}
                                </button>

                                {impactsExpanded && (
                                  <div
                                    style={{
                                      marginTop: 8,
                                      display: "grid",
                                      gap: 8,
                                    }}
                                  >
                                    {impactedOrders.map((order) => (
                                      <div
                                        key={order.id}
                                        style={{
                                          border: "1px solid #fecaca",
                                          borderRadius: 6,
                                          padding: 8,
                                          fontSize: 12,
                                          color: "#111827",
                                          background: "#fff",
                                        }}
                                      >
                                        <div style={{ fontWeight: 700 }}>
                                          {order.orderNumber}
                                        </div>
                                        <div>{order.customerName}</div>
                                        <div>
                                          {order.affectedQuantity} stuk
                                          {order.affectedQuantity === 1 ? "" : "s"} geraakt
                                        </div>
                                        <div style={{ color: "#6b7280" }}>
                                          {order.status}
                                        </div>
                                        <a
                                          href={`/verkoop/${order.id}`}
                                          style={{
                                            display: "inline-block",
                                            marginTop: 5,
                                            fontWeight: 700,
                                          }}
                                        >
                                          Open verkooporder
                                        </a>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td style={td}>
                            <strong>Verkocht</strong>
                          </td>
                          <td style={tdRight} rowSpan={rowSpan}>
                            {money(row.purchasePrice)}
                          </td>

                          {sizes.map((size) => {
                            const variant = row.variants.find(
                              (item) => item.size === size,
                            );

                            return (
                              <td key={size} style={tdCenter}>
                                {variant?.quantity ?? 0}
                              </td>
                            );
                          })}

                          <td style={tdCenter}>
                            <strong>{quantity}</strong>
                          </td>
                          <td style={tdRight}>
                            <strong>{money(quantity * row.purchasePrice)}</strong>
                          </td>
                        </tr>

                        <tr key={`${row.productId}-${row.color}-extra`}>
                          <td style={td}>
                            Extra inkoop
                          </td>

                          {sizes.map((size) => {
                            const variant = row.variants.find(
                              (item) => item.size === size,
                            );

                            if (!variant) {
                              return <td key={size} style={tdCenter}>-</td>;
                            }

                            return (
                              <td key={size} style={tdCenter}>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  disabled={excluded}
                                  value={
                                    excluded
                                      ? 0
                                      : extraByVariant[variant.variantId] ?? 0
                                  }
                                  onChange={(event) => {
                                    const value = Math.max(
                                      0,
                                      Number.parseInt(event.target.value || "0", 10) || 0,
                                    );

                                    setExtraByVariant((current) => ({
                                      ...current,
                                      [variant.variantId]: value,
                                    }));
                                  }}
                                  style={{
                                    width: 58,
                                    padding: "6px 4px",
                                    textAlign: "center",
                                  }}
                                />
                              </td>
                            );
                          })}

                          <td style={tdCenter}>
                            <strong>{effectiveExtraQuantity}</strong>
                          </td>
                          <td style={tdRight}>
                            <strong>
                              {money(
                                effectiveExtraQuantity *
                                  row.purchasePrice,
                              )}
                            </strong>
                          </td>
                        </tr>

                        {alreadyOrderedQuantity > 0 && (
                          <tr key={`${row.productId}-${row.color}-already-ordered`}>
                            <td style={td}>
                              Al besteld
                            </td>

                            {sizes.map((size) => {
                              const variant = row.variants.find(
                                (item) => item.size === size,
                              );

                              return (
                                <td key={size} style={tdCenter}>
                                  {variant?.alreadyOrdered ?? 0}
                                </td>
                              );
                            })}

                            <td style={tdCenter}>
                              <strong>{alreadyOrderedQuantity}</strong>
                            </td>
                            <td style={tdRight}>
                              <strong>
                                {money(
                                  alreadyOrderedQuantity *
                                    row.purchasePrice,
                                )}
                              </strong>
                            </td>
                          </tr>
                        )}

                        <tr key={`${row.productId}-${row.color}-total`}>
                          <td style={{ ...td, fontWeight: 700 }}>
                            Te bestellen
                          </td>

                          {sizes.map((size) => {
                            const variant = row.variants.find(
                              (item) => item.size === size,
                            );

                            const net =
                              !excluded && variant
                                ? netVariantQuantity(
                                    variant,
                                    extraByVariant[variant.variantId] ?? 0,
                                  )
                                : 0;

                            return (
                              <td key={size} style={{ ...tdCenter, fontWeight: 700 }}>
                                {net}
                              </td>
                            );
                          })}

                          <td style={{ ...tdCenter, fontWeight: 700 }}>
                            {orderQuantity}
                          </td>
                          <td style={{ ...tdRight, fontWeight: 700 }}>
                            {money(orderQuantity * row.purchasePrice)}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div
              style={{
                padding: "16px 20px",
                borderTop: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 16,
              }}
            >
              {moq > 0 && totalToOrder < moq && (
                <span
                  style={{
                    color: "#92400e",
                    fontSize: 13,
                  }}
                >
                  Let op: {moq - totalToOrder} stuks onder MOQ.
                  Bestellen blijft mogelijk.
                </span>
              )}

              <button
                type="button"
                className="button button-primary"
                disabled={
                  totalToOrder === 0 ||
                  creatingPurchaseOrder ===
                    group.supplier.id
                }
                onClick={() =>
                  void createPurchaseOrder(group)
                }
              >
                {creatingPurchaseOrder ===
                group.supplier.id
                  ? "Inkooporder maken..."
                  : `Inkooporder maken · ${totalToOrder} stuks`}
              </button>
            </div>
          </section>
        );
      })}
    </main>
  );
}

const th = {
  textAlign: "left" as const,
  padding: "12px 14px",
  background: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap" as const,
};

const thCenter = { ...th, textAlign: "center" as const };
const thRight = { ...th, textAlign: "right" as const };

const td = {
  padding: "13px 14px",
  borderBottom: "1px solid #f0f0f0",
  whiteSpace: "nowrap" as const,
};

const tdCenter = { ...td, textAlign: "center" as const };
const tdRight = { ...td, textAlign: "right" as const };
