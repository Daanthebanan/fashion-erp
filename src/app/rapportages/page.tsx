"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { PageHeader } from "@/components/ui/page-header";
import {
  getStoredProducts,
} from "@/lib/articles";
import {
  getInvoices,
  getInvoiceOutstandingAmount,
} from "@/lib/invoices";
import {
  fetchPurchaseOrders,
  type PurchaseOrder,
} from "@/lib/purchasing";
import {
  getSalesOrders,
  getSalesOrderTotals,
} from "@/lib/sales";
import styles from "./reports.module.css";

function money(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export default function ReportsPage() {
  const [loaded, setLoaded] = useState(false);
  const [purchaseOrders, setPurchaseOrders] = useState<
    PurchaseOrder[]
  >([]);

  useEffect(() => {
    let active = true;

    // Echte inkooporders uit de database (niet de oude lokale opslag).
    fetchPurchaseOrders()
      .catch(() => [] as PurchaseOrder[])
      .then((orders) => {
        if (!active) return;
        setPurchaseOrders(orders);
        setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const report = useMemo(() => {
    if (!loaded) return null;

    const invoices = getInvoices();
    const salesOrders = getSalesOrders();
    const products = getStoredProducts();

    const revenue = invoices
      .filter(
        (invoice) =>
          invoice.status !== "Concept" &&
          invoice.status !== "Gecrediteerd",
      )
      .reduce(
        (total, invoice) =>
          total + invoice.subtotal,
        0,
      );

    const outstanding = invoices.reduce(
      (total, invoice) =>
        total +
        getInvoiceOutstandingAmount(invoice),
      0,
    );

    const stockValue = products.reduce(
      (total, product) =>
        total +
        product.variants.reduce(
          (variantTotal, variant) =>
            variantTotal +
            variant.physicalStock *
              variant.purchasePrice,
          0,
        ),
      0,
    );

    const customerRevenue = new Map<
      string,
      number
    >();

    salesOrders.forEach((order) => {
      customerRevenue.set(
        order.customerName,
        (customerRevenue.get(
          order.customerName,
        ) || 0) +
          getSalesOrderTotals(order).total,
      );
    });

    const productSales = new Map<
      string,
      number
    >();

    salesOrders.forEach((order) =>
      order.lines.forEach((line) =>
        productSales.set(
          line.productName,
          (productSales.get(
            line.productName,
          ) || 0) + line.quantity,
        ),
      ),
    );

    return {
      revenue,
      outstanding,
      stockValue,
      openSales: salesOrders.filter(
        (order) =>
          ![
            "Verzonden",
            "Geannuleerd",
          ].includes(order.status),
      ).length,
      openPurchases:
        purchaseOrders.filter(
          (order) =>
            ![
              "Ontvangen",
              "Geannuleerd",
            ].includes(order.status),
        ).length,
      topCustomers: [...customerRevenue]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      topProducts: [...productSales]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
    };
  }, [loaded, purchaseOrders]);

  if (!report) return null;

  return (
    <div>
      <PageHeader
        eyebrow="Inzicht"
        title="Rapportages"
        description="Een compact overzicht van omzet, orders, debiteuren en voorraad."
      />

      <section className={styles.metricGrid}>
        <article className="metric-card">
          <div className="metric-label">
            Omzet
          </div>
          <div className="metric-value">
            {money(report.revenue)}
          </div>
          <div className="metric-detail">
            definitieve facturen excl. btw
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Openstaand
          </div>
          <div className="metric-value">
            {money(report.outstanding)}
          </div>
          <div className="metric-detail">
            debiteuren
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Voorraadwaarde
          </div>
          <div className="metric-value">
            {money(report.stockValue)}
          </div>
          <div className="metric-detail">
            tegen inkoopprijs
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Open orders
          </div>
          <div className="metric-value">
            {report.openSales}
          </div>
          <div className="metric-detail">
            inkoop: {report.openPurchases}
          </div>
        </article>
      </section>

      <section className={styles.grid}>
        <article className="content-card">
          <div className="content-card-header">
            <h2 className="content-card-title">
              Topklanten
            </h2>
          </div>
          <div className={styles.list}>
            {report.topCustomers.map(
              ([name, value], index) => (
                <div key={name}>
                  <span>
                    {index + 1}. {name}
                  </span>
                  <strong>{money(value)}</strong>
                </div>
              ),
            )}
          </div>
        </article>

        <article className="content-card">
          <div className="content-card-header">
            <h2 className="content-card-title">
              Bestverkopende artikelen
            </h2>
          </div>
          <div className={styles.list}>
            {report.topProducts.map(
              ([name, quantity], index) => (
                <div key={name}>
                  <span>
                    {index + 1}. {name}
                  </span>
                  <strong>{quantity} stuks</strong>
                </div>
              ),
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
