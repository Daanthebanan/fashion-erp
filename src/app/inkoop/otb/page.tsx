"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/ui/page-header";
import { fetchProducts, type Product } from "@/lib/articles";
import type { PurchaseOrder } from "@/lib/purchasing";
import { loadSalesOrders, type SalesOrder } from "@/lib/sales";
import { fetchSuppliers, type Supplier } from "@/lib/suppliers";
import styles from "../totaal/purchase-totals.module.css";

// Concept en geannuleerd tellen niet mee als verkocht, net als in de
// inkoopbehoefte. Geannuleerde inkooporders tellen niet mee als ingekocht.
const excludedSalesStatuses = new Set(["Concept", "Geannuleerd"]);

type View = "free" | "short" | "all";

const sizeOrder = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

function sortSizes(values: string[]) {
  return [...values].sort((a, b) => {
    const aIndex = sizeOrder.indexOf(a.toUpperCase());
    const bIndex = sizeOrder.indexOf(b.toUpperCase());

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return a.localeCompare(b, "nl", { numeric: true });
  });
}

function money(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

type SizeFigures = { purchased: number; sold: number };

type OtbRow = {
  key: string;
  productId: string;
  productCode: string;
  productName: string;
  color: string;
  collection: string;
  supplierName: string;
  salesPrice: number;
  bySize: Record<string, SizeFigures>;
  purchased: number;
  sold: number;
  otb: number;
  freeQuantity: number;
};

function otbColor(value: number) {
  return value < 0 ? "#b91c1c" : value > 0 ? "#166534" : "#6b7280";
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export default function OpenToBuyPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("free");
  const [collection, setCollection] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;

    Promise.all([
      fetchProducts(),
      fetchSuppliers(),
      loadSalesOrders(),
      fetch("/api/purchase-orders", { cache: "no-store" }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "Inkooporders ophalen mislukt.");
        }
        return (Array.isArray(body) ? body : []) as PurchaseOrder[];
      }),
    ])
      .then(([loadedProducts, loadedSuppliers, loadedSales, loadedPurchases]) => {
        if (!active) return;
        setProducts(loadedProducts);
        setSuppliers(loadedSuppliers);
        setSalesOrders(loadedSales);
        setPurchaseOrders(loadedPurchases);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Gegevens ophalen mislukt.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const allRows = useMemo(() => {
    const supplierName = new Map(suppliers.map((item) => [item.id, item.companyName]));
    const variantInfo = new Map<string, { product: Product; color: string; size: string }>();

    for (const product of products) {
      for (const variant of product.variants) {
        variantInfo.set(variant.id, { product, color: variant.color, size: variant.size });
      }
    }

    const rows = new Map<string, OtbRow>();

    function add(variantId: string, field: keyof SizeFigures, quantity: number) {
      const info = variantInfo.get(variantId);
      if (!info || !quantity) return;

      const key = `${info.product.id}__${info.color}`;
      const row =
        rows.get(key) ??
        ({
          key,
          productId: info.product.id,
          productCode: info.product.code,
          productName: info.product.name,
          color: info.color,
          collection: info.product.collection ?? "",
          supplierName: supplierName.get(info.product.supplierId) ?? "Onbekende leverancier",
          salesPrice: info.product.wholesalePrice ?? 0,
          bySize: {},
          purchased: 0,
          sold: 0,
          otb: 0,
          freeQuantity: 0,
        } satisfies OtbRow);

      const figures = row.bySize[info.size] ?? { purchased: 0, sold: 0 };
      figures[field] += quantity;
      row.bySize[info.size] = figures;
      row[field] += quantity;
      rows.set(key, row);
    }

    for (const order of purchaseOrders) {
      if (order.status === "Geannuleerd") continue;
      for (const line of order.lines ?? []) add(line.variantId, "purchased", line.orderedQuantity);
    }

    for (const order of salesOrders) {
      if (excludedSalesStatuses.has(order.status)) continue;
      for (const line of order.lines) add(line.variantId, "sold", line.quantity);
    }

    return [...rows.values()].map((row) => ({
      ...row,
      otb: row.purchased - row.sold,
      // Vrij te verkopen per maat: een tekort in de ene maat maakt een
      // andere maat niet vrij.
      freeQuantity: Object.values(row.bySize).reduce(
        (total, size) => total + Math.max(0, size.purchased - size.sold),
        0,
      ),
    }));
  }, [products, suppliers, salesOrders, purchaseOrders]);

  const collections = useMemo(
    () => [...new Set(allRows.map((row) => row.collection).filter(Boolean))].sort(),
    [allRows],
  );

  const supplierNames = useMemo(
    () =>
      [...new Set(allRows.map((row) => row.supplierName))].sort((a, b) =>
        a.localeCompare(b, "nl"),
      ),
    [allRows],
  );

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return allRows
      .filter((row) => !collection || row.collection === collection)
      .filter((row) => !supplierFilter || row.supplierName === supplierFilter)
      .filter(
        (row) =>
          !query ||
          row.productCode.toLowerCase().includes(query) ||
          row.productName.toLowerCase().includes(query) ||
          row.color.toLowerCase().includes(query),
      )
      .filter((row) =>
        view === "free"
          ? row.freeQuantity > 0
          : view === "short"
            ? Object.values(row.bySize).some((size) => size.purchased < size.sold)
            : true,
      )
      .sort(
        (a, b) =>
          (view === "short" ? a.otb - b.otb : b.freeQuantity - a.freeQuantity) ||
          a.productName.localeCompare(b.productName, "nl") ||
          a.color.localeCompare(b.color, "nl"),
      );
  }, [allRows, collection, supplierFilter, search, view]);

  const sizes = useMemo(
    () => sortSizes([...new Set(rows.flatMap((row) => Object.keys(row.bySize)))]),
    [rows],
  );

  const totals = rows.reduce(
    (total, row) => ({
      purchased: total.purchased + row.purchased,
      sold: total.sold + row.sold,
      free: total.free + row.freeQuantity,
      freeValue: total.freeValue + row.freeQuantity * row.salesPrice,
    }),
    { purchased: 0, sold: 0, free: 0, freeValue: 0 },
  );

  function exportExcel() {
    const header = [
      "Artikelcode",
      "Artikel",
      "Kleur",
      "Collectie",
      "Leverancier",
      ...sizes.map((size) => `OTB ${size}`),
      "Ingekocht",
      "Verkocht",
      "OTB",
      "Vrij te verkopen",
    ];
    const data = rows.map((row) => [
      row.productCode,
      row.productName,
      row.color,
      row.collection,
      row.supplierName,
      ...sizes.map((size) =>
        row.bySize[size] ? row.bySize[size].purchased - row.bySize[size].sold : "",
      ),
      row.purchased,
      row.sold,
      row.otb,
      row.freeQuantity,
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...data]), "Open-to-buy");
    XLSX.writeFile(workbook, `open-to-buy${collection ? `-${collection}` : ""}.xlsx`);
  }

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link href="/inkoop">Inkoop</Link>
        <span>›</span>
        <span>Open-to-buy</span>
      </div>

      <PageHeader
        eyebrow="Procurement"
        title="Open-to-buy"
        description="Per product wat er nog vrij is: ingekocht op inkooporders min verkocht op bevestigde (en verdere) verkooporders."
        action={
          <div className={styles.actions}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => window.print()}
              disabled={rows.length === 0}
            >
              Printen / PDF
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={exportExcel}
              disabled={rows.length === 0}
            >
              Exporteren naar Excel
            </button>
          </div>
        }
      />

      <section className={`content-card ${styles.filters}`}>
        <label>
          <span>Weergave</span>
          <select value={view} onChange={(event) => setView(event.target.value as View)}>
            <option value="free">Nog vrij te verkopen</option>
            <option value="short">Tekort (nog in te kopen)</option>
            <option value="all">Alle producten</option>
          </select>
        </label>
        <label>
          <span>Collectie / seizoen</span>
          <select value={collection} onChange={(event) => setCollection(event.target.value)}>
            <option value="">Alle collecties</option>
            {collections.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Leverancier</span>
          <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
            <option value="">Alle leveranciers</option>
            {supplierNames.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Zoeken</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Artikel, code of kleur..."
            style={{ minHeight: 38, padding: "6px 10px", border: "1px solid #cbd6e4", borderRadius: 4 }}
          />
        </label>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className="article-summary-grid">
        <article className="metric-card">
          <div className="metric-label">Vrij te verkopen</div>
          <div className="metric-value">{totals.free}</div>
          <div className="metric-detail">stuks in {rows.length} producten</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Waarde vrij</div>
          <div className="metric-value">{money(totals.freeValue)}</div>
          <div className="metric-detail">tegen verkoopprijs</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Ingekocht</div>
          <div className="metric-value">{totals.purchased}</div>
          <div className="metric-detail">stuks</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Verkocht</div>
          <div className="metric-value">{totals.sold}</div>
          <div className="metric-detail">stuks</div>
        </article>
      </section>

      <section className="content-card">
        {loading ? (
          <div className={styles.empty}>Gegevens laden...</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>Geen producten gevonden met deze filters.</div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th>Kleur</th>
                  <th>Collectie</th>
                  <th>Leverancier</th>
                  {sizes.map((size) => (
                    <th key={size} className="table-number">
                      {size}
                    </th>
                  ))}
                  <th className="table-number">Ingekocht</th>
                  <th className="table-number">Verkocht</th>
                  <th className="table-number">OTB</th>
                  <th className="table-number">Vrij</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <Link href={`/artikelen/${row.productId}`} className="table-primary">
                        {row.productName}
                      </Link>
                      <div className={styles.meta}>{row.productCode}</div>
                    </td>
                    <td>{row.color}</td>
                    <td>{row.collection || "—"}</td>
                    <td>{row.supplierName}</td>
                    {sizes.map((size) => {
                      const figures = row.bySize[size];
                      if (!figures) {
                        return (
                          <td key={size} className="table-number">
                            -
                          </td>
                        );
                      }
                      const otb = figures.purchased - figures.sold;
                      return (
                        <td
                          key={size}
                          className="table-number"
                          title={`${figures.purchased} ingekocht, ${figures.sold} verkocht`}
                        >
                          <strong style={{ color: otbColor(otb) }}>{signed(otb)}</strong>
                          <div className={styles.meta}>
                            {figures.purchased}/{figures.sold}
                          </div>
                        </td>
                      );
                    })}
                    <td className="table-number">{row.purchased}</td>
                    <td className="table-number">{row.sold}</td>
                    <td className="table-number">
                      <strong style={{ color: otbColor(row.otb) }}>{signed(row.otb)}</strong>
                    </td>
                    <td className="table-number table-primary">{row.freeQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.meta} style={{ padding: "10px 16px" }}>
          Per maat: OTB groot, daaronder ingekocht/verkocht. &ldquo;Vrij&rdquo; telt
          alleen maten met een overschot; een tekort in de ene maat maakt een andere
          maat niet vrij.
        </p>
      </section>
    </div>
  );
}
