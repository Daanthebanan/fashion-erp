"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  getInvoiceOutstandingAmount,
  getInvoices,
  type Invoice,
} from "@/lib/invoices";
import {
  type InventoryVariantRow,
} from "@/lib/inventory";
import {
  fetchPurchaseOrders,
  type PurchaseOrder,
} from "@/lib/purchasing";
import {
  getSalesOrders,
  loadSalesOrders,
  getSalesOrderTotals,
  type SalesOrder,
} from "@/lib/sales";
import styles from "./dashboard.module.css";
import {
  AppIcon,
  type AppIconName,
} from "@/components/ui/app-icon";

type CustomerRevenue = {
  customerId: string;
  customerNumber: string;
  customerName: string;
  revenue: number;
  invoiceCount: number;
};

function money(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function parseDashboardDate(
  value?: string | null,
) {
  if (!value) {
    return null;
  }

  const normalized = value.includes("T")
    ? value
    : `${value}T12:00:00`;

  const parsed = new Date(normalized);

  return Number.isFinite(parsed.getTime())
    ? parsed
    : null;
}

function date(value?: string | null) {
  const parsed = parseDashboardDate(value);

  if (!parsed) {
    return "—";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function day(value?: string | null) {
  const parsed = parseDashboardDate(value);

  return parsed
    ? String(parsed.getDate())
    : "—";
}

function month(value?: string | null) {
  const parsed = parseDashboardDate(value);

  if (!parsed) {
    return "";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    month: "short",
  }).format(parsed);
}

function orderTone(status: string) {
  if (
    status === "Verzonden" ||
    status === "Gereed"
  ) {
    return "success" as const;
  }

  if (
    status === "Geannuleerd" ||
    status === "Aandacht"
  ) {
    return "danger" as const;
  }

  if (
    status === "Concept" ||
    status === "In behandeling"
  ) {
    return "warning" as const;
  }

  return "info" as const;
}

function isBookedInvoice(invoice: Invoice) {
  return ![
    "Concept",
    "Gecrediteerd",
  ].includes(invoice.status);
}

export default function DashboardPage() {
  const [salesOrders, setSalesOrders] = useState<
    SalesOrder[]
  >([]);
  const [purchaseOrders, setPurchaseOrders] =
    useState<PurchaseOrder[]>([]);
  const [invoices, setInvoices] = useState<
    Invoice[]
  >([]);
  const [inventoryRows, setInventoryRows] = useState<
    InventoryVariantRow[]
  >([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadDashboardData() {
      const [orders, loadedPurchaseOrders] = await Promise.all([
        loadSalesOrders(),
        // Echte inkooporders uit de database (niet de oude lokale opslag).
        fetchPurchaseOrders().catch(() => [] as PurchaseOrder[]),
      ]);

      setSalesOrders(orders);
      setPurchaseOrders(loadedPurchaseOrders);
      setInvoices(getInvoices());
      setLoaded(true);

      fetch("/api/inventory")
        .then((response) => response.json())
        .then((inventory) => {
          setInventoryRows(
            Array.isArray(inventory)
              ? inventory
              : [],
          );
        })
        .catch(() => {
          setInventoryRows([]);
        });
    }

    void loadDashboardData();
  }, []);

  const dashboard = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const bookedInvoices =
      invoices.filter(isBookedInvoice);

    const revenueThisMonth =
      bookedInvoices
        .filter((invoice) => {
          const invoiceDate = new Date(
            `${invoice.invoiceDate}T12:00:00`,
          );

          return (
            invoiceDate.getFullYear() ===
              currentYear &&
            invoiceDate.getMonth() ===
              currentMonth
          );
        })
        .reduce(
          (total, invoice) =>
            total + invoice.subtotal,
          0,
        );

    const openInvoices = invoices.filter(
      (invoice) =>
        getInvoiceOutstandingAmount(invoice) >
        0,
    );

    const openInvoiceAmount =
      openInvoices.reduce(
        (total, invoice) =>
          total +
          getInvoiceOutstandingAmount(invoice),
        0,
      );

    const overdueInvoices =
      openInvoices.filter(
        (invoice) =>
          invoice.dueDate <
            now.toISOString().slice(0, 10) &&
          invoice.status !== "Betaald",
      );

    const openSalesOrders =
      salesOrders.filter(
        (order) =>
          ![
            "Verzonden",
            "Geannuleerd",
          ].includes(order.status),
      );

    const lowStockVariants =
      inventoryRows.filter(
        (variant) =>
          variant.physicalStock <=
          ((variant as any).minimumStock ?? 0),
      ).length;

    const ytdInvoices =
      bookedInvoices.filter((invoice) => {
        const invoiceDate = new Date(
          `${invoice.invoiceDate}T12:00:00`,
        );

        return (
          invoiceDate.getFullYear() ===
          currentYear
        );
      });

    const revenueByCustomer = new Map<
      string,
      CustomerRevenue
    >();

    ytdInvoices.forEach((invoice) => {
      const key =
        invoice.customerId ||
        invoice.customerNumber ||
        invoice.customerName;

      const current =
        revenueByCustomer.get(key) || {
          customerId: invoice.customerId,
          customerNumber:
            invoice.customerNumber,
          customerName:
            invoice.customerName,
          revenue: 0,
          invoiceCount: 0,
        };

      current.revenue += invoice.subtotal;
      current.invoiceCount += 1;
      revenueByCustomer.set(key, current);
    });

    const topCustomers = [
      ...revenueByCustomer.values(),
    ]
      .sort(
        (first, second) =>
          second.revenue - first.revenue,
      )
      .slice(0, 10);

    return {
      revenueThisMonth,
      openInvoiceAmount,
      openInvoiceCount:
        openInvoices.length,
      overdueInvoiceCount:
        overdueInvoices.length,
      openSalesOrderCount:
        openSalesOrders.length,
      lowStockVariants,
      topCustomers,
    };
  }, [invoices, salesOrders, inventoryRows]);

  const recentSalesOrders = useMemo(
    () =>
      [...salesOrders]
        .sort((first, second) =>
          second.updatedAt.localeCompare(
            first.updatedAt,
          ),
        )
        .slice(0, 5),
    [salesOrders],
  );

  const incomingPurchases = useMemo(
    () =>
      purchaseOrders
        .filter(
          // Alleen bestelde orders worden verwacht; concepten nog niet.
          (order) =>
            order.status === "Besteld" ||
            order.status === "Deels ontvangen",
        )
        .sort((first, second) => {
          const firstDate =
            parseDashboardDate(
              first.expectedDeliveryDate,
            )?.getTime() ??
            Number.MAX_SAFE_INTEGER;
          const secondDate =
            parseDashboardDate(
              second.expectedDeliveryDate,
            )?.getTime() ??
            Number.MAX_SAFE_INTEGER;

          return firstDate - secondDate;
        })
        .slice(0, 4),
    [purchaseOrders],
  );

  if (!loaded) {
    return null;
  }

  const metrics = [
    {
      label: "Omzet deze maand",
      value: money(
        dashboard.revenueThisMonth,
      ),
      change: "Rapportage",
      detail: "geboekte omzet excl. btw",
      href: "/rapportages",
      tone: "positive",
      icon: "trend" as AppIconName,
    },
    {
      label: "Openstaande facturen",
      value: money(
        dashboard.openInvoiceAmount,
      ),
      change: `${dashboard.openInvoiceCount} facturen`,
      detail: `${dashboard.overdueInvoiceCount} vervallen`,
      href: "/facturen",
      tone:
        dashboard.overdueInvoiceCount > 0
          ? "warning"
          : "neutral",
      icon: "wallet" as AppIconName,
    },
    {
      label: "Open verkooporders",
      value: String(
        dashboard.openSalesOrderCount,
      ),
      change: "Bekijk orders",
      detail: "nog niet verzonden",
      href: "/verkoop",
      tone: "positive",
      icon: "clipboard" as AppIconName,
    },
    {
      label: "Lage voorraad",
      value: String(
        dashboard.lowStockVariants,
      ),
      change: "Voorraad",
      detail: "varianten op of onder minimum",
      href: "/voorraad",
      tone:
        dashboard.lowStockVariants > 0
          ? "warning"
          : "positive",
      icon: "box" as AppIconName,
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Overzicht"
        title="Dashboard"
        description="De belangrijkste actuele informatie uit STITCH ERP."
        action={
          <div className="button-group">
            <Link
              href="/rapportages"
              className="button button-secondary"
            >
              Rapport bekijken
            </Link>

            <Link
              href="/verkoop/nieuw"
              className="button button-primary"
            >
              <span className="button-plus">
                +
              </span>
              Nieuwe verkooporder
            </Link>
          </div>
        }
      />

      <section className="metric-grid">
        {metrics.map((metric) => (
          <Link
            key={metric.label}
            href={metric.href}
            className={`${styles.metricLink} metric-card`}
          >
            <div className={styles.metricTop}>
              <div>
                <div className="metric-label">
                  {metric.label}
                </div>
                <div className="metric-value">
                  {metric.value}
                </div>
              </div>

              <div className={styles.metricIcon}>
                <AppIcon
                  name={metric.icon}
                  size={24}
                />
              </div>
            </div>

            <div className="metric-footer">
              <span
                className={`metric-change metric-${metric.tone}`}
              >
                {metric.change}
              </span>
              <span className="metric-detail">
                {metric.detail}
              </span>
            </div>
          </Link>
        ))}
      </section>

      <section className={styles.mainGrid}>
        <article className="content-card">
          <div className="content-card-header">
            <div>
              <h2 className="content-card-title">
                Recente verkooporders
              </h2>
              <p className="content-card-description">
                De laatst aangemaakte en gewijzigde
                orders.
              </p>
            </div>

            <Link
              href="/verkoop"
              className="text-button"
            >
              Alle verkooporders →
            </Link>
          </div>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ordernummer</th>
                  <th>Klant</th>
                  <th>Orderdatum</th>
                  <th>Leverdatum</th>
                  <th>Status</th>
                  <th className="table-number">
                    Bedrag
                  </th>
                </tr>
              </thead>

              <tbody>
                {recentSalesOrders.map(
                  (order) => (
                    <tr key={order.id}>
                      <td>
                        <Link
                          className="table-link"
                          href={`/verkoop/${order.id}`}
                        >
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className="table-primary">
                        <Link
                          className={styles.rowLink}
                          href={`/verkoop/${order.id}`}
                        >
                          {order.customerName}
                        </Link>
                      </td>
                      <td>
                        {date(order.orderDate)}
                      </td>
                      <td>
                        {date(
                          order.requestedDeliveryDate,
                        )}
                      </td>
                      <td>
                        <StatusBadge
                          label={order.status}
                          tone={orderTone(
                            order.status,
                          )}
                        />
                      </td>
                      <td className="table-number table-primary">
                        {money(
                          getSalesOrderTotals(
                            order,
                          ).total,
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          {recentSalesOrders.length === 0 && (
            <div className={styles.empty}>
              Nog geen verkooporders.
            </div>
          )}
        </article>

        <aside className={styles.sideColumn}>
          <article className="content-card">
            <div className="content-card-header">
              <div>
                <h2 className="content-card-title">
                  Top 10 klanten YTD
                </h2>
                <p className="content-card-description">
                  Op basis van geboekte omzet
                  exclusief btw.
                </p>
              </div>

              <Link
                href="/rapportages"
                className="text-button"
              >
                Rapport →
              </Link>
            </div>

            <div className={styles.customerList}>
              {dashboard.topCustomers.map(
                (customer, index) => (
                  <Link
                    key={
                      customer.customerId ||
                      customer.customerNumber
                    }
                    href="/klanten"
                    className={
                      styles.customerRow
                    }
                  >
                    <span
                      className={
                        styles.rank
                      }
                    >
                      {index + 1}
                    </span>

                    <span
                      className={
                        styles.customerInfo
                      }
                    >
                      <strong>
                        {customer.customerName}
                      </strong>
                      <small>
                        {customer.invoiceCount}{" "}
                        {customer.invoiceCount ===
                        1
                          ? "factuur"
                          : "facturen"}
                      </small>
                    </span>

                    <strong
                      className={
                        styles.customerRevenue
                      }
                    >
                      {money(customer.revenue)}
                    </strong>
                  </Link>
                ),
              )}
            </div>

            {dashboard.topCustomers.length ===
              0 && (
              <div className={styles.empty}>
                Nog geen geboekte omzet in dit
                kalenderjaar.
              </div>
            )}
          </article>

          <article className="content-card">
            <div className="content-card-header">
              <div>
                <h2 className="content-card-title">
                  Verwachte leveringen
                </h2>
                <p className="content-card-description">
                  Eerstvolgende open
                  inkooporders.
                </p>
              </div>
            </div>

            <div className="delivery-list">
              {incomingPurchases.map(
                (order) => {
                  const quantity =
                    order.lines.reduce(
                      (total, line) =>
                        total +
                        Math.max(
                          0,
                          line.orderedQuantity -
                            line.receivedQuantity,
                        ),
                      0,
                    );

                  return (
                    <Link
                      key={order.id}
                      href={`/inkoop/${order.id}`}
                      className={`delivery-item ${styles.deliveryLink}`}
                    >
                      <div className="delivery-date">
                        <span>
                          {day(
                            order.expectedDeliveryDate,
                          )}
                        </span>
                        <small>
                          {month(
                            order.expectedDeliveryDate,
                          )}
                        </small>
                      </div>

                      <div className="delivery-content">
                        <strong>
                          {order.supplierName}
                        </strong>
                        <span>
                          {order.orderNumber} ·{" "}
                          {quantity} stuks
                        </span>
                      </div>

                      <span className="delivery-arrow">
                        ›
                      </span>
                    </Link>
                  );
                },
              )}
            </div>

            {incomingPurchases.length ===
              0 && (
              <div className={styles.empty}>
                Geen open inkooporders.
              </div>
            )}

            <Link
              href="/inkoop"
              className="secondary-full-button"
            >
              Bekijk alle inkooporders
            </Link>
          </article>

        </aside>
      </section>

      <section className="dashboard-quicklinks-section">
        <h2 className="dashboard-quicklinks-title">
          Snelkoppelingen
        </h2>

        <div className="dashboard-quicklinks-row">
          <Link
            href="/verkoop/nieuw"
            className="dashboard-quicklink"
          >
            <AppIcon
              name="document"
              size={26}
            />
            <span>
              Nieuwe
              <br />
              verkooporder
            </span>
          </Link>

          <Link
            href="/inkoop/nieuw"
            className="dashboard-quicklink"
          >
            <AppIcon
              name="sales"
              size={26}
            />
            <span>
              Nieuwe
              <br />
              inkooporder
            </span>
          </Link>

          <Link
            href="/artikelen/nieuw"
            className="dashboard-quicklink"
          >
            <AppIcon
              name="shirt"
              size={26}
            />
            <span>Nieuw artikel</span>
          </Link>

          <Link
            href="/klanten"
            className="dashboard-quicklink"
          >
            <AppIcon
              name="userPlus"
              size={26}
            />
            <span>Nieuwe klant</span>
          </Link>

          <Link
            href="/voorraad"
            className="dashboard-quicklink"
          >
            <AppIcon
              name="box"
              size={26}
            />
            <span>
              Voorraad
              <br />
              overzicht
            </span>
          </Link>

          <Link
            href="/debiteuren"
            className="dashboard-quicklink"
          >
            <AppIcon
              name="wallet"
              size={26}
            />
            <span>
              Openstaande
              <br />
              posten
            </span>
          </Link>

          <Link
            href="/rapportages"
            className="dashboard-quicklink"
          >
            <AppIcon
              name="chart"
              size={26}
            />
            <span>Rapportages</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
