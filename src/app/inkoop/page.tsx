"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchSuppliers, type Supplier } from "@/lib/suppliers";
import {
  filterPurchaseOrders,
  getPurchaseOrderTotals,
  isPurchaseOrderOverdue,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from "@/lib/purchasing";
import styles from "./purchase-orders.module.css";

const statuses: Array<PurchaseOrderStatus | "Alle statussen"> = [
  "Alle statussen",
  "Concept",
  "Besteld",
  "Deels ontvangen",
  "Ontvangen",
  "Geannuleerd",
];

function tone(status: PurchaseOrderStatus) {
  if (status === "Ontvangen") return "success" as const;
  if (status === "Deels ontvangen") return "warning" as const;
  if (status === "Besteld") return "info" as const;
  if (status === "Geannuleerd") return "danger" as const;
  return "neutral" as const;
}

function money(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
}

function date(value: string) {
  return value ? new Intl.DateTimeFormat("nl-NL").format(new Date(`${value}T12:00:00`)) : "—";
}

export default function PurchasingPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PurchaseOrderStatus | "Alle statussen">("Alle statussen");
  const [supplierId, setSupplierId] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  useEffect(() => {
    async function loadOrders() {
      const response =
        await fetch("/api/purchase-orders");

      const contentType =
        response.headers.get(
          "content-type",
        ) || "";

      if (!contentType.includes("application/json")) {
        throw new Error(
          "Sessie verlopen. Log opnieuw in.",
        );
      }

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Inkooporders ophalen mislukt.",
        );
      }

      if (Array.isArray(data)) {
        setOrders(
          data.map((order) => ({
            ...order,
            lines: order.lines ?? [],
          })),
        );
      }
    }

    loadOrders();

    // Echte leveranciers (zelfde id's als op de inkooporders), niet de
    // stamgegevenslijst met demo-namen.
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  const filtered = useMemo(
    () => filterPurchaseOrders(orders, { search, status, supplierId, overdueOnly }),
    [orders, search, status, supplierId, overdueOnly],
  );

  const open = orders.filter((order) => !["Ontvangen", "Geannuleerd"].includes(order.status));
  const overdue = open.filter(isPurchaseOrderOverdue);
  const openValue = open.reduce((sum, order) => sum + getPurchaseOrderTotals(order).subtotal, 0);
  const incoming = open.reduce((sum, order) => sum + getPurchaseOrderTotals(order).remainingQuantity, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Inkooporders"
        description="Plan bestellingen, bewaak leverdata en verwerk goederenontvangsten."
        action={<div className="button-group"><Link href="/inkoop/totaal" className="button button-secondary">Totaaloverzicht</Link><Link href="/inkoop/nieuw" className="button button-primary"><span className="button-plus">+</span>Nieuwe inkooporder</Link></div>}
      />

      <section className="article-summary-grid">
        <article className="metric-card"><div className="metric-label">Openstaande orders</div><div className="metric-value">{open.length}</div><div className="metric-detail">{overdue.length} te laat</div></article>
        <article className="metric-card"><div className="metric-label">Nog te ontvangen</div><div className="metric-value">{incoming}</div><div className="metric-detail">stuks over alle orders</div></article>
        <article className="metric-card"><div className="metric-label">Openstaande inkoopwaarde</div><div className="metric-value">{money(openValue)}</div><div className="metric-detail">exclusief btw</div></article>
        <article className="metric-card"><div className="metric-label">Leverbetrouwbaarheid</div><div className="metric-value">{open.length ? Math.max(0, Math.round(((open.length - overdue.length) / open.length) * 100)) : 100}%</div><div className="metric-detail">op basis van leverdatum</div></article>
      </section>

      <section className="content-card">
        <div className="content-card-toolbar">
          <div className="table-search"><span>⌕</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek op order, leverancier, collectie of referentie..." /></div>
          <div className={styles.filterRow}>
            <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus | "Alle statussen")}>{statuses.map((item) => <option key={item}>{item}</option>)}</select>
            <select className={styles.select} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Alle leveranciers</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.companyName}</option>)}</select>
            <label className={styles.toggle}><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />Alleen te laat</label>
          </div>
          <div className={styles.toolbarRight}>{filtered.length} resultaten</div>
        </div>

        {filtered.length === 0 ? <div className={styles.empty}>Geen inkooporders gevonden met deze filters.</div> : (
          <div className="table-wrapper"><table className="data-table"><thead><tr><th>Ordernummer</th><th>Leverancier</th><th>Collectie</th><th>Orderdatum</th><th>Leverdatum</th><th>Status</th><th>Voortgang</th><th className="table-number">Waarde</th></tr></thead><tbody>
            {filtered.map((order) => { const totals = getPurchaseOrderTotals(order); const late = isPurchaseOrderOverdue(order); return (
              <tr
                key={order.id}
                className={styles.clickableRow}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) return;
                  router.push(`/inkoop/${order.id}`);
                }}
              >
                <td><Link className={styles.rowLink} href={`/inkoop/${order.id}`}>{order.orderNumber}</Link><div className={styles.meta}>{"reference" in order ? ((order as PurchaseOrder & { reference?: string }).reference || "Geen referentie") : "Geen referentie"}</div></td>
                <td className="table-primary">{order.supplierName}</td><td>{order.collectionCode}</td><td>{date(order.orderDate)}</td><td className={late ? styles.overdue : ""}>{date(order.expectedDeliveryDate)}{late && <div className={styles.meta}>Te laat</div>}</td>
                <td><StatusBadge label={order.status} tone={tone(order.status)} /></td>
                <td><div className={styles.progress}><div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: `${totals.receiptProgress}%` }} /></div><span>{totals.receiptProgress}%</span></div><div className={styles.meta}>{totals.receivedQuantity}/{totals.orderedQuantity} ontvangen</div></td>
                <td className="table-number table-primary">{money(totals.subtotal)}</td>
              </tr> ); })}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}
