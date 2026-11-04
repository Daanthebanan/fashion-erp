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
  collection: string;
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
  const [collectionFilter, setCollectionFilter] = useState("");
  const [onlyToOrder, setOnlyToOrder] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedSuppliers, setExpandedSuppliers] =
    useState<Record<string, boolean>>({});
  const [expandedRows, setExpandedRows] =
    useState<Record<string, boolean>>({});
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

    // Ook wat al is ingekocht maar (nog) niet verkocht, zodat de OTB
    // (ingekocht min verkocht) volledig is.
    for (const purchaseOrder of purchaseOrders) {
      if (purchaseOrder.status === "Geannuleerd") continue;

      for (const line of purchaseOrder.lines ?? []) {
        const product = productByVariantId.get(line.variantId);
        if (!product) continue;

        const variant = product.variants.find(
          (item) => item.id === line.variantId,
        );
        const color = variant?.color ?? line.color;
        const key = `${product.id}__${color}`;
        const current =
          demand.get(key) ?? {
            product,
            color,
            variantQuantities: new Map<string, DemandVariant>(),
          };

        if (!current.variantQuantities.has(line.variantId)) {
          current.variantQuantities.set(line.variantId, {
            variantId: line.variantId,
            size: variant?.size ?? line.size,
            quantity: 0,
            alreadyOrdered:
              alreadyOrderedByVariant.get(line.variantId) ?? 0,
          });
        }

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
        collection: item.product.collection ?? "",
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
            if (collectionFilter && row.collection !== collectionFilter) {
              return false;
            }

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
  }, [
    products,
    suppliers,
    salesOrders,
    purchaseOrders,
    supplierFilter,
    collectionFilter,
    search,
  ]);

  const collections = useMemo(
    () =>
      [...new Set(products.map((product) => product.collection).filter(Boolean))].sort(),
    [products],
  );

  function rowMetrics(row: DemandRow) {
    const excluded =
      decisionByProductColor[`${row.productId}__${row.color}`] ===
      "DO_NOT_PRODUCE";
    const sold = row.variants.reduce((total, v) => total + v.quantity, 0);
    const ordered = row.variants.reduce(
      (total, v) => total + v.alreadyOrdered,
      0,
    );
    const extra = excluded
      ? 0
      : row.variants.reduce(
          (total, v) => total + (extraByVariant[v.variantId] ?? 0),
          0,
        );
    const toOrder = excluded
      ? 0
      : row.variants.reduce(
          (total, v) =>
            total + netVariantQuantity(v, extraByVariant[v.variantId] ?? 0),
          0,
        );

    return {
      excluded,
      sold,
      ordered,
      extra,
      toOrder,
      // Open-to-buy: ingekocht min verkocht. Negatief = nog in te kopen.
      otb: ordered - sold,
      toOrderValue: toOrder * row.purchasePrice,
    };
  }

  function sumMetrics(rows: DemandRow[]) {
    return rows.reduce(
      (total, row) => {
        const metrics = rowMetrics(row);
        return {
          sold: total.sold + metrics.sold,
          ordered: total.ordered + metrics.ordered,
          extra: total.extra + metrics.extra,
          toOrder: total.toOrder + metrics.toOrder,
          otb: total.otb + metrics.otb,
          toOrderValue: total.toOrderValue + metrics.toOrderValue,
        };
      },
      { sold: 0, ordered: 0, extra: 0, toOrder: 0, otb: 0, toOrderValue: 0 },
    );
  }

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

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      visibleRows: onlyToOrder
        ? group.rows.filter((row) => rowMetrics(row).toOrder > 0)
        : group.rows,
    }))
    .filter((group) => group.visibleRows.length > 0);

  const overall = sumMetrics(visibleGroups.flatMap((group) => group.visibleRows));
  const allExpanded =
    visibleGroups.length > 0 &&
    visibleGroups.every((group) => expandedSuppliers[group.supplier.id]);

  function otbCell(value: number, style: React.CSSProperties = tdRight) {
    return (
      <td
        style={{
          ...style,
          fontWeight: 700,
          color: value < 0 ? "#b91c1c" : value > 0 ? "#166534" : "#6b7280",
        }}
      >
        {value > 0 ? `+${value}` : value}
      </td>
    );
  }

  return (
    <main style={{ padding: 32, maxWidth: 1600, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: "#6b7280", marginBottom: 8 }}>
          Inkoop / Inkoopbehoefte
        </div>
        <h1 style={{ margin: 0 }}>Inkoopbehoefte</h1>
        <p style={{ color: "#6b7280", maxWidth: 900 }}>
          Gebaseerd op bevestigde en verdere verkooporders (concept en
          geannuleerd tellen niet mee). Wat al op een niet-geannuleerde
          inkooporder staat, gaat af van &ldquo;Te bestellen&rdquo;. OTB = ingekocht min
          verkocht: negatief is nog in te kopen, positief is nog vrij te verkopen.
          Klik op een leverancier of artikel voor meer detail.
        </p>
      </div>

      {error && (
        <div style={{ padding: 16, background: "#fee2e2", marginBottom: 20 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={supplierFilter}
          onChange={(event) => setSupplierFilter(event.target.value)}
          style={{ padding: "10px 12px", minWidth: 220 }}
        >
          <option value="">Alle leveranciers</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.companyName}
            </option>
          ))}
        </select>

        <select
          value={collectionFilter}
          onChange={(event) => setCollectionFilter(event.target.value)}
          style={{ padding: "10px 12px", minWidth: 180 }}
        >
          <option value="">Alle collecties</option>
          {collections.map((collection) => (
            <option key={collection}>{collection}</option>
          ))}
        </select>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Zoek artikel, code of kleur..."
          style={{ padding: "10px 12px", minWidth: 260 }}
        />

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={onlyToOrder}
            onChange={(event) => setOnlyToOrder(event.target.checked)}
          />
          Alleen wat nog besteld moet worden
        </label>

        <button
          type="button"
          onClick={() =>
            setExpandedSuppliers(
              allExpanded
                ? {}
                : Object.fromEntries(
                    visibleGroups.map((group) => [group.supplier.id, true]),
                  ),
            )
          }
          style={{ padding: "9px 12px", cursor: "pointer", marginLeft: "auto" }}
        >
          {allExpanded ? "Alles inklappen" : "Alles uitklappen"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[
          ["Verkocht", `${overall.sold} st.`],
          ["Al besteld", `${overall.ordered} st.`],
          ["Extra inkoop", `${overall.extra} st.`],
          ["Te bestellen", `${overall.toOrder} st.`],
          ["OTB", `${overall.otb > 0 ? "+" : ""}${overall.otb} st.`],
          ["Waarde te bestellen", money(overall.toOrderValue)],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 14px", background: "white" }}
          >
            <div style={{ color: "#6b7280", fontSize: 12 }}>{label}</div>
            <strong
              style={{
                fontSize: 20,
                color:
                  label === "OTB"
                    ? overall.otb < 0
                      ? "#b91c1c"
                      : overall.otb > 0
                        ? "#166534"
                        : undefined
                    : undefined,
              }}
            >
              {value}
            </strong>
          </div>
        ))}
      </div>

      {visibleGroups.length === 0 ? (
        <div style={{ padding: 24, border: "1px solid #e5e7eb", background: "white" }}>
          Geen inkoopbehoefte gevonden.
        </div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflowX: "auto", background: "white" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={th}>Leverancier</th>
                <th style={thRight}>Artikelen</th>
                <th style={thRight}>Verkocht</th>
                <th style={thRight}>Al besteld</th>
                <th style={thRight}>Extra</th>
                <th style={thRight}>Te bestellen</th>
                <th style={thRight} title="Ingekocht min verkocht">OTB</th>
                <th style={th}>MOQ</th>
                <th style={thRight}>Waarde</th>
                <th style={thRight} />
              </tr>
            </thead>
            <tbody>
              {visibleGroups.map((group) => {
                const supplierId = group.supplier.id;
                const totals = sumMetrics(group.visibleRows);
                // De inkooporder gebruikt alle (gefilterde) regels, niet
                // alleen de zichtbare: regels zonder aantal vallen er toch uit.
                const orderTotals = sumMetrics(group.rows);
                const expanded = expandedSuppliers[supplierId] ?? false;
                const moq = group.supplier.minimumOrderQuantity ?? 0;
                const belowMoq = Math.max(0, moq - orderTotals.toOrder);
                const sizes = sortSizes(
                  Array.from(
                    new Set(
                      group.visibleRows.flatMap((row) =>
                        row.variants.map((variant) => variant.size),
                      ),
                    ),
                  ),
                );

                return (
                  <Fragment key={supplierId}>
                    <tr
                      onClick={() =>
                        setExpandedSuppliers((current) => ({
                          ...current,
                          [supplierId]: !expanded,
                        }))
                      }
                      style={{ cursor: "pointer", background: expanded ? "#eff6ff" : undefined }}
                    >
                      <td style={{ ...td, fontWeight: 700 }}>
                        <span style={{ display: "inline-block", width: 18 }}>
                          {expanded ? "▾" : "▸"}
                        </span>
                        {group.supplier.companyName}
                        {group.supplier.supplierNumber && (
                          <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 12 }}>
                            {" "}· {group.supplier.supplierNumber}
                          </span>
                        )}
                      </td>
                      <td style={tdRight}>{group.visibleRows.length}</td>
                      <td style={tdRight}>{totals.sold}</td>
                      <td style={tdRight}>{totals.ordered}</td>
                      <td style={tdRight}>{totals.extra}</td>
                      <td style={{ ...tdRight, fontWeight: 700 }}>{totals.toOrder}</td>
                      {otbCell(totals.otb)}
                      <td style={{ ...td, color: moq && belowMoq ? "#92400e" : "#6b7280" }}>
                        {orderTotals.toOrder === 0
                          ? "Niets te bestellen"
                          : !moq
                            ? "Geen MOQ"
                            : belowMoq === 0
                              ? "MOQ bereikt"
                              : `${belowMoq} onder MOQ`}
                      </td>
                      <td style={tdRight}>{money(totals.toOrderValue)}</td>
                      <td style={tdRight} onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={
                            orderTotals.toOrder === 0 ||
                            creatingPurchaseOrder === supplierId
                          }
                          onClick={() => void createPurchaseOrder(group)}
                        >
                          {creatingPurchaseOrder === supplierId
                            ? "Inkooporder maken..."
                            : `Inkooporder maken · ${orderTotals.toOrder} st.`}
                        </button>
                      </td>
                    </tr>

                    {expanded && (
                      <tr>
                        <td colSpan={10} style={{ padding: "0 0 12px 28px", background: "#f8fafc" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <th style={th}>Artikel</th>
                                <th style={th}>Kleur</th>
                                <th style={th}>Collectie</th>
                                <th style={th}>Productie</th>
                                <th style={thRight}>Verkocht</th>
                                <th style={thRight}>Al besteld</th>
                                <th style={thRight}>Extra</th>
                                <th style={thRight}>Te bestellen</th>
                                <th style={thRight}>OTB</th>
                                <th style={thRight}>Inkoop p/st</th>
                                <th style={thRight}>Waarde</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.visibleRows.map((row) => {
                                const rowKey = `${row.productId}__${row.color}`;
                                const metrics = rowMetrics(row);
                                const rowExpanded = expandedRows[rowKey] ?? false;
                                const impactedOrders = metrics.excluded
                                  ? affectedOrders(row.productId, row.color)
                                  : [];
                                const impactsExpanded = expandedImpacts[rowKey] ?? false;

                                return (
                                  <Fragment key={rowKey}>
                                    <tr
                                      onClick={() =>
                                        setExpandedRows((current) => ({
                                          ...current,
                                          [rowKey]: !rowExpanded,
                                        }))
                                      }
                                      style={{ cursor: "pointer", background: rowExpanded ? "#eef2ff" : "white" }}
                                    >
                                      <td style={td}>
                                        <span style={{ display: "inline-block", width: 18 }}>
                                          {rowExpanded ? "▾" : "▸"}
                                        </span>
                                        <strong>{row.productName}</strong>
                                        <span style={{ color: "#6b7280", fontSize: 12 }}> · {row.productCode}</span>
                                      </td>
                                      <td style={td}>{row.color}</td>
                                      <td style={td}>{row.collection || "—"}</td>
                                      <td style={{ ...td, fontWeight: 700, color: metrics.excluded ? "#b91c1c" : "#166534" }}>
                                        {metrics.excluded ? "Niet produceren" : "Produceren"}
                                      </td>
                                      <td style={tdRight}>{metrics.sold}</td>
                                      <td style={tdRight}>{metrics.ordered}</td>
                                      <td style={tdRight}>{metrics.extra}</td>
                                      <td style={{ ...tdRight, fontWeight: 700 }}>{metrics.toOrder}</td>
                                      {otbCell(metrics.otb)}
                                      <td style={tdRight}>{money(row.purchasePrice)}</td>
                                      <td style={tdRight}>{money(metrics.toOrderValue)}</td>
                                    </tr>

                                    {rowExpanded && (
                                      <tr>
                                        <td colSpan={11} style={{ padding: "8px 0 16px 28px", background: "#fafbff" }}>
                                          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
                                            <table style={{ borderCollapse: "collapse" }}>
                                              <thead>
                                                <tr>
                                                  <th style={th} />
                                                  {sizes.map((size) => (
                                                    <th key={size} style={thCenter}>{size}</th>
                                                  ))}
                                                  <th style={thCenter}>Totaal</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {(
                                                  [
                                                    ["Verkocht", (v: DemandVariant) => v.quantity],
                                                    ["Al besteld", (v: DemandVariant) => v.alreadyOrdered],
                                                  ] as const
                                                ).map(([label, value]) => (
                                                  <tr key={label}>
                                                    <td style={td}>{label}</td>
                                                    {sizes.map((size) => {
                                                      const variant = row.variants.find((item) => item.size === size);
                                                      return (
                                                        <td key={size} style={tdCenter}>
                                                          {variant ? value(variant) : "-"}
                                                        </td>
                                                      );
                                                    })}
                                                    <td style={{ ...tdCenter, fontWeight: 700 }}>
                                                      {row.variants.reduce((total, v) => total + value(v), 0)}
                                                    </td>
                                                  </tr>
                                                ))}

                                                <tr>
                                                  <td style={td}>Extra inkoop</td>
                                                  {sizes.map((size) => {
                                                    const variant = row.variants.find((item) => item.size === size);
                                                    if (!variant) {
                                                      return <td key={size} style={tdCenter}>-</td>;
                                                    }
                                                    return (
                                                      <td key={size} style={tdCenter}>
                                                        <input
                                                          type="number"
                                                          min="0"
                                                          step="1"
                                                          disabled={metrics.excluded}
                                                          value={metrics.excluded ? 0 : extraByVariant[variant.variantId] ?? 0}
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
                                                          style={{ width: 58, padding: "6px 4px", textAlign: "center" }}
                                                        />
                                                      </td>
                                                    );
                                                  })}
                                                  <td style={{ ...tdCenter, fontWeight: 700 }}>{metrics.extra}</td>
                                                </tr>

                                                <tr>
                                                  <td style={{ ...td, fontWeight: 700 }}>Te bestellen</td>
                                                  {sizes.map((size) => {
                                                    const variant = row.variants.find((item) => item.size === size);
                                                    return (
                                                      <td key={size} style={{ ...tdCenter, fontWeight: 700 }}>
                                                        {variant && !metrics.excluded
                                                          ? netVariantQuantity(variant, extraByVariant[variant.variantId] ?? 0)
                                                          : variant
                                                            ? 0
                                                            : "-"}
                                                      </td>
                                                    );
                                                  })}
                                                  <td style={{ ...tdCenter, fontWeight: 700 }}>{metrics.toOrder}</td>
                                                </tr>

                                                <tr>
                                                  <td style={{ ...td, fontWeight: 700 }}>OTB</td>
                                                  {sizes.map((size) => {
                                                    const variant = row.variants.find((item) => item.size === size);
                                                    return variant ? (
                                                      <Fragment key={size}>
                                                        {otbCell(variant.alreadyOrdered - variant.quantity, tdCenter)}
                                                      </Fragment>
                                                    ) : (
                                                      <td key={size} style={tdCenter}>-</td>
                                                    );
                                                  })}
                                                  {otbCell(metrics.otb, tdCenter)}
                                                </tr>
                                              </tbody>
                                            </table>

                                            <div style={{ minWidth: 220, maxWidth: 300 }}>
                                              <button
                                                type="button"
                                                disabled={savingDecision === rowKey}
                                                onClick={() =>
                                                  setProductionDecision(
                                                    row.productId,
                                                    row.color,
                                                    metrics.excluded ? "PRODUCE" : "DO_NOT_PRODUCE",
                                                  )
                                                }
                                                style={{ padding: "7px 10px", cursor: "pointer" }}
                                              >
                                                {savingDecision === rowKey
                                                  ? "Opslaan..."
                                                  : metrics.excluded
                                                    ? "Toch produceren"
                                                    : "Niet produceren"}
                                              </button>

                                              {impactedOrders.length > 0 && (
                                                <div style={{ marginTop: 10 }}>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setExpandedImpacts((current) => ({
                                                        ...current,
                                                        [rowKey]: !impactsExpanded,
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
                                                    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                                                      {impactedOrders.map((order) => (
                                                        <div
                                                          key={order.id}
                                                          style={{
                                                            border: "1px solid #fecaca",
                                                            borderRadius: 6,
                                                            padding: 8,
                                                            fontSize: 12,
                                                            background: "#fff",
                                                          }}
                                                        >
                                                          <div style={{ fontWeight: 700 }}>{order.orderNumber}</div>
                                                          <div>{order.customerName}</div>
                                                          <div>
                                                            {order.affectedQuantity} stuk
                                                            {order.affectedQuantity === 1 ? "" : "s"} geraakt
                                                          </div>
                                                          <div style={{ color: "#6b7280" }}>{order.status}</div>
                                                          <Link
                                                            href={`/verkoop/${order.id}`}
                                                            style={{ display: "inline-block", marginTop: 5, fontWeight: 700 }}
                                                          >
                                                            Open verkooporder
                                                          </Link>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>

                          {moq > 0 && belowMoq > 0 && orderTotals.toOrder > 0 && (
                            <div style={{ color: "#92400e", fontSize: 13, padding: "10px 14px 0" }}>
                              Let op: {belowMoq} stuks onder MOQ. Bestellen blijft mogelijk.
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
