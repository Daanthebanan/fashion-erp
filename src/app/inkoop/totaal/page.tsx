"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/ui/page-header";
import type {
  PurchaseOrder,
  PurchaseOrderStatus,
} from "@/lib/purchasing";
import styles from "./purchase-totals.module.css";

type StatusFilter =
  | "Alle behalve geannuleerd"
  | PurchaseOrderStatus;

const statusFilters: StatusFilter[] = [
  "Alle behalve geannuleerd",
  "Concept",
  "Besteld",
  "Deels ontvangen",
  "Ontvangen",
  "Geannuleerd",
];

const preferredSizeOrder = [
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

function sortSizes(sizes: string[]) {
  return [...sizes].sort((a, b) => {
    const aIndex = preferredSizeOrder.indexOf(a.toUpperCase());
    const bIndex = preferredSizeOrder.indexOf(b.toUpperCase());

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

function percent(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 1000) / 10}%` : "0%";
}

type TotalsRow = {
  key: string;
  label: string;
  detail: string;
  productCode?: string;
  color?: string;
  bySize: Record<string, number>;
  quantity: number;
  value: number;
};

function emptyRow(key: string, label: string, detail = ""): TotalsRow {
  return { key, label, detail, bySize: {}, quantity: 0, value: 0 };
}

export default function PurchaseTotalsPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<StatusFilter>(
    "Alle behalve geannuleerd",
  );
  const [collection, setCollection] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [showArticles, setShowArticles] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/purchase-orders", {
          cache: "no-store",
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Inkooporders ophalen mislukt.");
        }

        setOrders(Array.isArray(data) ? data : []);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Inkooporders ophalen mislukt.",
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  // Regels uit Inkoopbehoefte hebben geen collectie op de order;
  // daarom valt de collectie terug op die van het artikel.
  const allLines = useMemo(
    () =>
      orders.flatMap((order) =>
        (order.lines ?? []).map((line) => ({
          ...line,
          order,
          collection: line.collectionCode || order.collectionCode || "",
        })),
      ),
    [orders],
  );

  const collections = useMemo(
    () =>
      [...new Set(allLines.map((line) => line.collection).filter(Boolean))].sort(),
    [allLines],
  );

  const supplierNames = useMemo(
    () =>
      [...new Set(orders.map((order) => order.supplierName).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "nl"),
      ),
    [orders],
  );

  const lines = useMemo(
    () =>
      allLines.filter(
        (line) =>
          (status === "Alle behalve geannuleerd"
            ? line.order.status !== "Geannuleerd"
            : line.order.status === status) &&
          (!collection || line.collection === collection) &&
          (!supplierFilter || line.order.supplierName === supplierFilter),
      ),
    [allLines, status, collection, supplierFilter],
  );

  const sizes = useMemo(
    () => sortSizes([...new Set(lines.map((line) => line.size))]),
    [lines],
  );

  const { total, suppliers } = useMemo(() => {
    const totalRow = emptyRow("total", "Totaal");
    const bySupplier = new Map<
      string,
      { row: TotalsRow; orders: Set<string>; articles: Map<string, TotalsRow> }
    >();

    for (const line of lines) {
      const supplierName = line.order.supplierName || "Onbekende leverancier";
      const quantity = line.orderedQuantity;
      const value = line.orderedQuantity * line.purchasePrice;

      const supplier =
        bySupplier.get(supplierName) ?? {
          row: emptyRow(supplierName, supplierName),
          orders: new Set<string>(),
          articles: new Map<string, TotalsRow>(),
        };
      bySupplier.set(supplierName, supplier);
      supplier.orders.add(line.order.orderNumber);

      const articleKey = `${line.productCode}__${line.color}`;
      const article = supplier.articles.get(articleKey) ?? {
        ...emptyRow(
          `${supplierName}__${articleKey}`,
          line.productName,
          `${line.productCode} · ${line.color}`,
        ),
        productCode: line.productCode,
        color: line.color,
      };
      supplier.articles.set(articleKey, article);

      for (const row of [totalRow, supplier.row, article]) {
        row.bySize[line.size] = (row.bySize[line.size] ?? 0) + quantity;
        row.quantity += quantity;
        row.value += value;
      }
    }

    return {
      total: totalRow,
      suppliers: [...bySupplier.values()]
        .map((entry) => ({
          ...entry,
          row: {
            ...entry.row,
            detail: `${entry.orders.size} ${entry.orders.size === 1 ? "order" : "orders"}: ${[...entry.orders].sort().join(", ")}`,
          },
          articles: [...entry.articles.values()].sort((a, b) =>
            a.label.localeCompare(b.label, "nl"),
          ),
        }))
        .sort((a, b) => a.row.label.localeCompare(b.row.label, "nl")),
    };
  }, [lines]);

  const orderCount = new Set(lines.map((line) => line.order.id)).size;

  function exportExcel() {
    const header = [
      "Leverancier",
      "Artikel",
      "Kleur",
      ...sizes,
      "Totaal stuks",
      "Inkoopwaarde",
    ];
    const rows: (string | number)[][] = [];

    for (const supplier of suppliers) {
      for (const article of supplier.articles) {
        rows.push([
          supplier.row.label,
          `${article.productCode} ${article.label}`,
          article.color ?? "",
          ...sizes.map((size) => article.bySize[size] ?? 0),
          article.quantity,
          Math.round(article.value * 100) / 100,
        ]);
      }
      rows.push([
        `Totaal ${supplier.row.label}`,
        "",
        "",
        ...sizes.map((size) => supplier.row.bySize[size] ?? 0),
        supplier.row.quantity,
        Math.round(supplier.row.value * 100) / 100,
      ]);
    }

    rows.push([
      "Totaal alle leveranciers",
      "",
      "",
      ...sizes.map((size) => total.bySize[size] ?? 0),
      total.quantity,
      Math.round(total.value * 100) / 100,
    ]);
    rows.push([
      "Maatboog %",
      "",
      "",
      ...sizes.map(
        (size) =>
          total.quantity > 0
            ? Math.round(((total.bySize[size] ?? 0) / total.quantity) * 1000) / 10
            : 0,
      ),
      100,
      "",
    ]);

    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Inkooptotalen");
    XLSX.writeFile(
      workbook,
      `inkooptotalen${collection ? `-${collection}` : ""}.xlsx`,
    );
  }

  function renderRow(row: TotalsRow, variant: "supplier" | "article" | "total") {
    return (
      <tr
        key={row.key}
        className={
          variant === "total"
            ? styles.totalRow
            : variant === "supplier"
              ? styles.supplierRow
              : styles.articleRow
        }
      >
        <td>
          <div className={variant === "article" ? "" : "table-primary"}>
            {row.label}
          </div>
          {row.detail && <div className={styles.meta}>{row.detail}</div>}
        </td>
        {sizes.map((size) => (
          <td key={size} className="table-number">
            <strong>{row.bySize[size] ?? 0}</strong>
            {variant !== "article" && (
              <div className={styles.meta}>
                {percent(row.bySize[size] ?? 0, row.quantity)}
              </div>
            )}
          </td>
        ))}
        <td className="table-number">
          <strong>{row.quantity}</strong>
          {variant === "supplier" && (
            <div className={styles.meta}>
              {percent(row.quantity, total.quantity)} van totaal
            </div>
          )}
        </td>
        <td className="table-number table-primary">{money(row.value)}</td>
      </tr>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link href="/inkoop">Inkooporders</Link>
        <span>›</span>
        <span>Totaaloverzicht</span>
      </div>

      <PageHeader
        eyebrow="Procurement"
        title="Totaaloverzicht inkoop"
        description="Totale aantallen, maatboog en inkoopwaarde van alle inkooporders, per leverancier."
        action={
          <div className={styles.actions}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => window.print()}
              disabled={lines.length === 0}
            >
              Printen / PDF
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={exportExcel}
              disabled={lines.length === 0}
            >
              Exporteren naar Excel
            </button>
          </div>
        }
      />

      <section className={`content-card ${styles.filters}`}>
        <label>
          <span>Collectie / seizoen</span>
          <select value={collection} onChange={(e) => setCollection(e.target.value)}>
            <option value="">Alle collecties</option>
            {collections.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Leverancier</span>
          <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">Alle leveranciers</option>
            {supplierNames.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            {statusFilters.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showArticles}
            onChange={(e) => setShowArticles(e.target.checked)}
          />
          Toon artikelen per leverancier
        </label>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className="article-summary-grid">
        <article className="metric-card">
          <div className="metric-label">Totaal ingekocht</div>
          <div className="metric-value">{total.quantity}</div>
          <div className="metric-detail">stuks</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Inkoopwaarde</div>
          <div className="metric-value">{money(total.value)}</div>
          <div className="metric-detail">exclusief btw</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Inkooporders</div>
          <div className="metric-value">{orderCount}</div>
          <div className="metric-detail">{suppliers.length} leveranciers</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Gem. inkoopprijs</div>
          <div className="metric-value">
            {money(total.quantity ? total.value / total.quantity : 0)}
          </div>
          <div className="metric-detail">per stuk</div>
        </article>
      </section>

      <section className="content-card">
        <div className="content-card-header">
          <div>
            <h2 className="content-card-title">Maatboog</h2>
            <p className="content-card-description">
              Verdeling van alle ingekochte stuks over de maten
              {collection ? ` in ${collection}` : ""}.
            </p>
          </div>
        </div>
        {loading ? (
          <div className={styles.empty}>Inkooporders laden...</div>
        ) : lines.length === 0 ? (
          <div className={styles.empty}>Geen inkoopregels gevonden met deze filters.</div>
        ) : (
          <div className={styles.sizeCurve}>
            {sizes.map((size) => {
              const quantity = total.bySize[size] ?? 0;
              const share = total.quantity ? quantity / total.quantity : 0;
              return (
                <div key={size} className={styles.sizeBar}>
                  <span className={styles.sizePercent}>{percent(quantity, total.quantity)}</span>
                  <div className={styles.sizeTrack}>
                    <div className={styles.sizeFill} style={{ height: `${Math.max(2, share * 100)}%` }} />
                  </div>
                  <strong>{size}</strong>
                  <span className={styles.meta}>{quantity} st.</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="content-card">
          <div className="content-card-header">
            <div>
              <h2 className="content-card-title">Per leverancier</h2>
              <p className="content-card-description">
                Aantallen per maat met het percentage binnen de leverancier.
              </p>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Leverancier</th>
                  {sizes.map((size) => (
                    <th key={size} className="table-number">{size}</th>
                  ))}
                  <th className="table-number">Totaal</th>
                  <th className="table-number">Inkoopwaarde</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <Fragment key={supplier.row.key}>
                    {renderRow(supplier.row, "supplier")}
                    {showArticles &&
                      supplier.articles.map((article) => renderRow(article, "article"))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>{renderRow(total, "total")}</tfoot>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
