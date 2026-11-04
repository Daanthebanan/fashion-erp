"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useParams,
  useRouter,
} from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { DocumentActionButtons } from "@/components/documents/document-action-buttons";
import { openBusinessDocumentPdf } from "@/lib/document-pdf";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  updatePurchaseOrderStatusRemote,
  duplicatePurchaseOrder,
  fetchReceiptsForPurchaseOrder,
  getPurchaseOrderDaysOverdue,
  getPurchaseOrderTotals,
  isPurchaseOrderOverdue,
  reopenPurchaseOrder,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type PurchaseReceipt,
} from "@/lib/purchasing";
import { loadSalesOrders } from "@/lib/sales";
import styles from "./purchase-order-detail.module.css";

type Tab =
  | "overzicht"
  | "orderregels"
  | "ontvangsten"
  | "historie";

type ReceiveForm = {
  receiptDate: string;
  packingSlipNumber: string;
  receivedBy: string;
  notes: string;
};

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
    return "—";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getStatusTone(
  status: PurchaseOrderStatus,
):
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral" {
  if (status === "Ontvangen") {
    return "success";
  }

  if (status === "Deels ontvangen") {
    return "warning";
  }

  if (status === "Besteld") {
    return "info";
  }

  if (status === "Geannuleerd") {
    return "danger";
  }

  return "neutral";
}

function createReceiveValues(order: PurchaseOrder) {
  return Object.fromEntries(
    order.lines.map((line) => [
      line.id,
      Math.max(
        0,
        line.orderedQuantity -
          line.receivedQuantity,
      ),
    ]),
  );
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [order, setOrder] =
    useState<PurchaseOrder | null>(null);
  const [receipts, setReceipts] = useState<
    PurchaseReceipt[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  // Open-to-buy per variant: ingekocht op alle niet-geannuleerde
  // inkooporders min verkocht op bevestigde (en verdere) verkooporders.
  const [openToBuyByVariant, setOpenToBuyByVariant] =
    useState<Record<string, number> | null>(null);
  const [activeTab, setActiveTab] =
    useState<Tab>("orderregels");
  const [showReceiveDialog, setShowReceiveDialog] =
    useState(false);
  const [showActions, setShowActions] =
    useState(false);
  const [receiveValues, setReceiveValues] =
    useState<Record<string, number>>({});
  const [receiveForm, setReceiveForm] =
    useState<ReceiveForm>({
      receiptDate: getToday(),
      packingSlipNumber: "",
      receivedBy: "",
      notes: "",
    });
  const [notification, setNotification] =
    useState<string | null>(null);
  const [error, setError] =
    useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function reloadOrder() {
    const response = await fetch(
      "/api/purchase-orders",
    );

    const orders = await response.json();

    const selectedOrder =
      Array.isArray(orders)
        ? orders.find(
            (item) =>
              item.id === params.id,
          )
        : null;

    setOrder(selectedOrder ?? null);

    if (Array.isArray(orders)) {
      void loadOpenToBuy(orders as PurchaseOrder[]);
    }

    if (selectedOrder) {
      setReceiveValues(
        createReceiveValues(selectedOrder),
      );

      setReceipts(
        await fetchReceiptsForPurchaseOrder(params.id),
      );
    } else {
      setReceipts([]);
    }

    setLoaded(true);
  }

  async function loadOpenToBuy(
    purchaseOrders: PurchaseOrder[],
  ) {
    try {
      const salesOrders = await loadSalesOrders();
      const result: Record<string, number> = {};

      purchaseOrders
        .filter((item) => item.status !== "Geannuleerd")
        .forEach((item) => {
          item.lines.forEach((line) => {
            result[line.variantId] =
              (result[line.variantId] ?? 0) +
              line.orderedQuantity;
          });
        });

      salesOrders
        .filter(
          (item) =>
            item.status !== "Concept" &&
            item.status !== "Geannuleerd",
        )
        .forEach((item) => {
          item.lines.forEach((line) => {
            result[line.variantId] =
              (result[line.variantId] ?? 0) -
              line.quantity;
          });
        });

      setOpenToBuyByVariant(result);
    } catch {
      setOpenToBuyByVariant(null);
    }
  }

  useEffect(() => {
    reloadOrder();
  }, [params.id]);

  useEffect(() => {
    if (!notification) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotification(null);
    }, 3200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [notification]);

  useEffect(() => {
    function handleKeyboard(
      event: KeyboardEvent,
    ) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();

        if (
          order &&
          order.status !== "Ontvangen" &&
          order.status !== "Geannuleerd" &&
          order.status !== "Concept"
        ) {
          setShowReceiveDialog(true);
        }
      }

      if (event.key === "Escape") {
        setShowReceiveDialog(false);
        setShowActions(false);
      }
    }

    document.addEventListener(
      "keydown",
      handleKeyboard,
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyboard,
      );
    };
  }, [order]);

  const totals = useMemo(() => {
    if (!order) {
      return null;
    }

    return getPurchaseOrderTotals(order);
  }, [order]);

  const overdue = order
    ? isPurchaseOrderOverdue(order)
    : false;

  const daysOverdue = order
    ? getPurchaseOrderDaysOverdue(order)
    : 0;

  const canReceive =
    order &&
    (order.status === "Besteld" ||
      order.status === "Deels ontvangen");

  const totalToReceive = useMemo(() => {
    if (!order) {
      return 0;
    }

    return order.lines.reduce(
      (total, line) => {
        const remaining = Math.max(
          0,
          line.orderedQuantity -
            line.receivedQuantity,
        );

        const requested = Math.max(
          0,
          Math.floor(
            receiveValues[line.id] ?? 0,
          ),
        );

        return (
          total +
          Math.min(requested, remaining)
        );
      },
      0,
    );
  }, [order, receiveValues]);

  if (!loaded) {
    return (
      <section className="content-card">
        <div className={styles.loading}>
          <div className={styles.loadingSpinner} />
          <span>Inkooporder laden...</span>
        </div>
      </section>
    );
  }

  if (!order || !totals) {
    return (
      <section className="content-card">
        <div className={styles.notFound}>
          <div className={styles.notFoundIcon}>
            !
          </div>

          <h1>Inkooporder niet gevonden</h1>

          <p>
            De order bestaat niet meer of is
            verwijderd.
          </p>

          <Link
            href="/inkoop"
            className="button button-primary"
          >
            Terug naar inkooporders
          </Link>
        </div>
      </section>
    );
  }

  async function handleMarkOrdered() {
    const response = await fetch(
      `/api/purchase-orders/${order!.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "Besteld",
        }),
      },
    );

    if (!response.ok) {
      setError(
        "Status wijzigen mislukt.",
      );
      return;
    }

    await reloadOrder();

    setNotification(
      "De inkooporder is gemarkeerd als besteld.",
    );

    setShowActions(false);
  }

  async function handleCancel() {
    const confirmed = window.confirm(
      "Weet je zeker dat je deze inkooporder wilt annuleren?",
    );

    if (!confirmed) {
      return;
    }

    try {
      await updatePurchaseOrderStatusRemote(
        order!.id,
        "Geannuleerd",
      );

      await reloadOrder();

      setNotification(
        "De inkooporder is geannuleerd.",
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Annuleren is niet gelukt.",
      );
    }

    setShowActions(false);
  }

  async function handleReopen() {
    try {
      await reopenPurchaseOrder(order!);

      await reloadOrder();

      setNotification(
        "De inkooporder is opnieuw geopend.",
      );
      setError(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Heropenen is niet gelukt.",
      );
    }

    setShowActions(false);
  }

  async function handleDuplicate() {
    try {
      const duplicate =
        await duplicatePurchaseOrder(order!);

      router.push(`/inkoop/${duplicate.id}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Dupliceren is niet gelukt.",
      );
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      "Weet je zeker dat je deze inkooporder definitief wilt verwijderen?",
    );

    if (!confirmed) {
      return;
    }

    try {
      await fetch(
        `/api/purchase-orders/${order!.id}`,
        {
          method: "DELETE",
        },
      );

      router.push("/inkoop");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Verwijderen is niet gelukt.",
      );
    }
  }

  function openReceiveDialog() {
    setReceiveValues(
      createReceiveValues(order!),
    );

    setReceiveForm({
      receiptDate: getToday(),
      packingSlipNumber: "",
      receivedBy: "",
      notes: "",
    });

    setError(null);
    setShowReceiveDialog(true);
  }

  function handleReceiveValue(
    lineId: string,
    value: number,
  ) {
    const line = order!.lines.find(
      (item) => item.id === lineId,
    );

    if (!line) {
      return;
    }

    const remaining = Math.max(
      0,
      line.orderedQuantity -
        line.receivedQuantity,
    );

    setReceiveValues((current) => ({
      ...current,
      [lineId]: Math.min(
        Math.max(0, Math.floor(value || 0)),
        remaining,
      ),
    }));
  }

  function receiveAllRemaining() {
    setReceiveValues(
      Object.fromEntries(
        order!.lines.map((line) => [
          line.id,
          Math.max(
            0,
            line.orderedQuantity -
              line.receivedQuantity,
          ),
        ]),
      ),
    );
  }

  function clearReceiveValues() {
    setReceiveValues(
      Object.fromEntries(
        order!.lines.map((line) => [
          line.id,
          0,
        ]),
      ),
    );
  }

  async function handleReceive() {
    if (totalToReceive <= 0) {
      setError(
        "Vul minimaal één te ontvangen aantal in.",
      );
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response =
        await fetch(
          `/api/purchase-orders/${order!.id}/receive`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              receivedByLine:
                receiveValues,
              receiptDate:
                receiveForm.receiptDate,
              packingSlipNumber:
                receiveForm.packingSlipNumber,
              receivedBy:
                receiveForm.receivedBy,
              notes:
                receiveForm.notes,
            }),
          },
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "Ontvangst mislukt.",
        );
      }

      window.location.reload();
      setShowReceiveDialog(false);
      setActiveTab("ontvangsten");
      setNotification(
        `${result.receipt.receiptNumber} is verwerkt. De voorraad is bijgewerkt.`,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "De ontvangst kon niet worden verwerkt.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    try {
      openBusinessDocumentPdf(
        "PURCHASE_ORDER",
        order!.id,
      );
      setError(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "De inkooporder-PDF kon niet worden geopend.",
      );
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link href="/inkoop">
          Inkooporders
        </Link>
        <span>›</span>
        <span>{order.orderNumber}</span>
      </div>

      {notification && (
        <div className={styles.notification}>
          <span
            className={
              styles.notificationIcon
            }
          >
            ✓
          </span>
          <span>{notification}</span>
        </div>
      )}

      {error && !showReceiveDialog && (
        <div className={styles.errorBanner}>
          <span>!</span>
          <div>{error}</div>

          <button
            type="button"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      <PageHeader
        eyebrow="Procurement"
        title={order.orderNumber}
        description={`${order.supplierName} · ${
          order.collectionCode ||
          "Geen collectie"
        }`}
        action={
          <div className={styles.headerActions}>
            <DocumentActionButtons
              referenceId={order.id}
              documentType="PURCHASE_ORDER"
              printLabel="Inkooporder PDF"
              showEnglishPdf
              emailLabel="Versturen naar leverancier"
              onSent={() => {
                void (async () => {
                  try {
                    await updatePurchaseOrderStatusRemote(
                      order.id,
                      "Besteld",
                    );

                    await reloadOrder();
                  } catch (caughtError) {
                    setError(
                      caughtError instanceof Error
                        ? caughtError.message
                        : "Status wijzigen mislukt.",
                    );

                    return;
                  }
                })();

                setNotification(
                  "De inkooporder is per e-mail verstuurd.",
                );
              }}
            />

            {order.status === "Concept" && (
              <button
                type="button"
                className="button button-primary"
                onClick={handleMarkOrdered}
              >
                Markeer als besteld
              </button>
            )}

            {canReceive && (
              <button
                type="button"
                className="button button-primary"
                onClick={openReceiveDialog}
              >
                Ontvangst boeken
              </button>
            )}

            <div
              className={
                styles.actionMenuWrapper
              }
            >
              <button
                type="button"
                className={styles.moreButton}
                onClick={() =>
                  setShowActions(
                    (current) => !current,
                  )
                }
              >
                Meer
                <span>⌄</span>
              </button>

              {showActions && (
                <div
                  className={
                    styles.actionMenu
                  }
                >
                  <button
                    type="button"
                    onClick={handleDuplicate}
                  >
                    <span>⧉</span>
                    Dupliceren
                  </button>

                  <button
                    type="button"
                    onClick={handlePrint}
                  >
                    <span>⌑</span>
                    Afdrukken
                  </button>

                  {order.status ===
                    "Geannuleerd" && (
                    <button
                      type="button"
                      onClick={handleReopen}
                    >
                      <span>↻</span>
                      Opnieuw openen
                    </button>
                  )}

                  {order.status !==
                    "Ontvangen" &&
                    order.status !==
                      "Geannuleerd" && (
                      <>
                        <div
                          className={
                            styles.menuDivider
                          }
                        />

                        <button
                          type="button"
                          className={
                            styles.dangerAction
                          }
                          onClick={handleCancel}
                        >
                          <span>×</span>
                          Annuleren
                        </button>
                      </>
                    )}
                </div>
              )}
            </div>
          </div>
        }
      />

      <section
        className={styles.statusBar}
      >
        <div className={styles.statusMain}>
          <StatusBadge
            label={order.status}
            tone={getStatusTone(
              order.status,
            )}
          />

          <span
            className={styles.statusDivider}
          />

          <span>
            Orderdatum{" "}
            <strong>
              {formatDate(order.orderDate)}
            </strong>
          </span>

          <span
            className={styles.statusDivider}
          />

          <span>
            Verwachte levering{" "}
            <strong
              className={
                overdue
                  ? styles.overdueText
                  : undefined
              }
            >
              {formatDate(
                order.expectedDeliveryDate,
              )}
            </strong>
          </span>

          {overdue && (
            <span
              className={
                styles.overdueBadge
              }
            >
              {daysOverdue} dag
              {daysOverdue === 1 ? "" : "en"}{" "}
              te laat
            </span>
          )}
        </div>

        <div className={styles.statusMeta}>
          Laatst bijgewerkt{" "}
          {formatDateTime(order.updatedAt)}
        </div>
      </section>

      <section className={styles.metricGrid}>
        <article className="metric-card">
          <div className="metric-label">
            Besteld
          </div>
          <div className="metric-value">
            {totals.orderedQuantity.toLocaleString(
              "nl-NL",
            )}
          </div>
          <div className="metric-detail">
            stuks
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Ontvangen
          </div>
          <div className="metric-value">
            {totals.receivedQuantity.toLocaleString(
              "nl-NL",
            )}
          </div>
          <div className="metric-detail">
            {totals.receiptProgress}% van de
            order
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Nog te ontvangen
          </div>
          <div className="metric-value">
            {totals.remainingQuantity.toLocaleString(
              "nl-NL",
            )}
          </div>
          <div className="metric-detail">
            {formatCurrency(
              totals.remainingValue,
              order.currency,
            )}{" "}
            openstaand
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Totale inkoopwaarde
          </div>
          <div className="metric-value">
            {formatCurrency(
              totals.subtotal,
              order.currency,
            )}
          </div>
          <div className="metric-detail">
            exclusief btw
          </div>
        </article>
      </section>

      <section className={styles.workspace}>
        <main className={styles.mainColumn}>
          <div className="content-card">
            <nav className={styles.tabs}>
              <button
                type="button"
                className={
                  activeTab === "overzicht"
                    ? styles.activeTab
                    : undefined
                }
                onClick={() =>
                  setActiveTab("overzicht")
                }
              >
                Overzicht
              </button>

              <button
                type="button"
                className={
                  activeTab === "orderregels"
                    ? styles.activeTab
                    : undefined
                }
                onClick={() =>
                  setActiveTab("orderregels")
                }
              >
                Orderregels
                <span>
                  {order.lines.length}
                </span>
              </button>

              <button
                type="button"
                className={
                  activeTab === "ontvangsten"
                    ? styles.activeTab
                    : undefined
                }
                onClick={() =>
                  setActiveTab("ontvangsten")
                }
              >
                Ontvangsten
                <span>{receipts.length}</span>
              </button>

              <button
                type="button"
                className={
                  activeTab === "historie"
                    ? styles.activeTab
                    : undefined
                }
                onClick={() =>
                  setActiveTab("historie")
                }
              >
                Historie
              </button>
            </nav>

            {activeTab === "overzicht" && (
              <div
                className={
                  styles.overviewContent
                }
              >
                <section
                  className={
                    styles.sectionBlock
                  }
                >
                  <div
                    className={
                      styles.sectionHeader
                    }
                  >
                    <div>
                      <h2>
                        Ontvangstvoortgang
                      </h2>
                      <p>
                        Voortgang van de volledige
                        inkooporder.
                      </p>
                    </div>

                    <strong>
                      {totals.receiptProgress}%
                    </strong>
                  </div>

                  <div
                    className={
                      styles.largeProgressTrack
                    }
                  >
                    <div
                      className={
                        styles.largeProgressBar
                      }
                      style={{
                        width: `${Math.min(
                          totals.receiptProgress,
                          100,
                        )}%`,
                      }}
                    />
                  </div>

                  <div
                    className={
                      styles.progressLegend
                    }
                  >
                    <span>
                      {totals.receivedQuantity}{" "}
                      ontvangen
                    </span>
                    <span>
                      {totals.remainingQuantity}{" "}
                      openstaand
                    </span>
                  </div>
                </section>

                <section
                  className={
                    styles.summaryGrid
                  }
                >
                  <article
                    className={
                      styles.summaryCard
                    }
                  >
                    <h3>Leverancier</h3>

                    <dl>
                      <div>
                        <dt>Naam</dt>
                        <dd>
                          {order.supplierName}
                        </dd>
                      </div>

                      <div>
                        <dt>
                          Leveranciersreferentie
                        </dt>
                        <dd>
                          {order.supplierReference ||
                            "—"}
                        </dd>
                      </div>

                      <div>
                        <dt>Valuta</dt>
                        <dd>{order.currency}</dd>
                      </div>

                      <div>
                        <dt>
                          Betalingstermijn
                        </dt>
                        <dd>
                          {order.paymentDays} dagen
                        </dd>
                      </div>
                    </dl>
                  </article>

                  <article
                    className={
                      styles.summaryCard
                    }
                  >
                    <h3>Levering</h3>

                    <dl>
                      <div>
                        <dt>Orderdatum</dt>
                        <dd>
                          {formatDate(
                            order.orderDate,
                          )}
                        </dd>
                      </div>

                      <div>
                        <dt>
                          Verwachte leverdatum
                        </dt>
                        <dd>
                          {formatDate(
                            order.expectedDeliveryDate,
                          )}
                        </dd>
                      </div>

                      <div>
                        <dt>Collectie</dt>
                        <dd>
                          {order.collectionCode ||
                            "—"}
                        </dd>
                      </div>

                      <div>
                        <dt>Afleveradres</dt>
                        <dd>
                          {order.deliveryAddress ||
                            "—"}
                        </dd>
                      </div>
                    </dl>
                  </article>
                </section>

                <section
                  className={
                    styles.sectionBlock
                  }
                >
                  <div
                    className={
                      styles.sectionHeader
                    }
                  >
                    <div>
                      <h2>Notities</h2>
                      <p>
                        Interne informatie bij deze
                        order.
                      </p>
                    </div>
                  </div>

                  <div
                    className={
                      styles.notesContent
                    }
                  >
                    {order.notes ||
                      "Er zijn geen notities toegevoegd."}
                  </div>
                </section>
              </div>
            )}

            {activeTab === "orderregels" && (
              <div>
                <div
                  className={
                    styles.tableToolbar
                  }
                >
                  <div>
                    <strong>
                      {order.lines.length}
                    </strong>{" "}
                    orderregels
                  </div>

                  {canReceive && (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={
                        openReceiveDialog
                      }
                    >
                      Ontvangst boeken
                    </button>
                  )}
                </div>

                {(() => {
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

                  const sizes = Array.from(
                    new Set(
                      order.lines.map((line) => line.size),
                    ),
                  ).sort((a, b) => {
                    const aIndex =
                      preferredSizeOrder.indexOf(
                        a.toUpperCase(),
                      );
                    const bIndex =
                      preferredSizeOrder.indexOf(
                        b.toUpperCase(),
                      );

                    if (aIndex !== -1 && bIndex !== -1) {
                      return aIndex - bIndex;
                    }

                    if (aIndex !== -1) return -1;
                    if (bIndex !== -1) return 1;

                    return a.localeCompare(b, "nl", {
                      numeric: true,
                    });
                  });

                  const groups = Array.from(
                    order.lines.reduce(
                      (map, line) => {
                        const key =
                          `${line.productCode}__${line.color}`;

                        const existing = map.get(key);

                        if (existing) {
                          existing.lines.push(line);
                        } else {
                          map.set(key, {
                            productName: line.productName,
                            productCode: line.productCode,
                            color: line.color,
                            lines: [line],
                          });
                        }

                        return map;
                      },
                      new Map<
                        string,
                        {
                          productName: string;
                          productCode: string;
                          color: string;
                          lines: typeof order.lines;
                        }
                      >(),
                    ).values(),
                  );

                  return (
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Artikel</th>
                            <th>Kleur</th>

                            {sizes.map((size) => (
                              <th
                                key={size}
                                className="table-number"
                              >
                                {size}
                              </th>
                            ))}

                            <th className="table-number">
                              Besteld
                            </th>
                            <th className="table-number">
                              Ontvangen
                            </th>
                            <th className="table-number">
                              Open
                            </th>
                            <th
                              className="table-number"
                              title="Open-to-buy: ingekocht op alle inkooporders min verkocht op bevestigde verkooporders"
                            >
                              OTB
                            </th>
                            <th className="table-number">
                              Inkoopprijs
                            </th>
                            <th className="table-number">
                              Waarde
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {groups.map((group) => {
                            const ordered =
                              group.lines.reduce(
                                (total, line) =>
                                  total +
                                  line.orderedQuantity,
                                0,
                              );

                            const received =
                              group.lines.reduce(
                                (total, line) =>
                                  total +
                                  line.receivedQuantity,
                                0,
                              );

                            const remaining = Math.max(
                              0,
                              ordered - received,
                            );

                            const value =
                              group.lines.reduce(
                                (total, line) =>
                                  total +
                                  line.orderedQuantity *
                                    line.purchasePrice,
                                0,
                              );

                            const prices = Array.from(
                              new Set(
                                group.lines.map(
                                  (line) =>
                                    line.purchasePrice,
                                ),
                              ),
                            );

                            const groupOpenToBuy =
                              openToBuyByVariant
                                ? group.lines.reduce(
                                    (total, line) =>
                                      total +
                                      (openToBuyByVariant[
                                        line.variantId
                                      ] ?? 0),
                                    0,
                                  )
                                : null;

                            return (
                              <tr
                                key={`${group.productCode}-${group.color}`}
                              >
                                <td>
                                  <div className="table-primary">
                                    {group.productName}
                                  </div>

                                  <div
                                    className={
                                      styles.secondaryText
                                    }
                                  >
                                    {group.productCode}
                                  </div>
                                </td>

                                <td>{group.color}</td>

                                {sizes.map((size) => {
                                  const line =
                                    group.lines.find(
                                      (item) =>
                                        item.size === size,
                                    );

                                  if (!line) {
                                    return (
                                      <td
                                        key={size}
                                        className="table-number"
                                      >
                                        -
                                      </td>
                                    );
                                  }

                                  return (
                                    <td
                                      key={size}
                                      className="table-number"
                                      title={`${line.receivedQuantity} ontvangen`}
                                    >
                                      <strong>
                                        {
                                          line.orderedQuantity
                                        }
                                      </strong>

                                      {line.receivedQuantity >
                                        0 && (
                                        <div
                                          className={
                                            styles.secondaryText
                                          }
                                        >
                                          {
                                            line.receivedQuantity
                                          }{" "}
                                          ontv.
                                        </div>
                                      )}

                                      {openToBuyByVariant && (
                                        <div
                                          className={
                                            styles.secondaryText
                                          }
                                          title="Open-to-buy"
                                        >
                                          OTB{" "}
                                          {openToBuyByVariant[
                                            line.variantId
                                          ] ?? 0}
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}

                                <td className="table-number">
                                  <strong>{ordered}</strong>
                                </td>

                                <td className="table-number">
                                  {received}
                                </td>

                                <td className="table-number">
                                  <strong
                                    className={
                                      remaining > 0
                                        ? styles.openQuantity
                                        : styles.completeQuantity
                                    }
                                  >
                                    {remaining}
                                  </strong>
                                </td>

                                <td className="table-number">
                                  {groupOpenToBuy === null
                                    ? "—"
                                    : groupOpenToBuy}
                                </td>

                                <td className="table-number">
                                  {prices.length === 1
                                    ? formatCurrency(
                                        prices[0],
                                        order.currency,
                                      )
                                    : "Variabel"}
                                </td>

                                <td className="table-number table-primary">
                                  {formatCurrency(
                                    value,
                                    order.currency,
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>

                        <tfoot>
                          <tr>
                            <td colSpan={2}>
                              <strong>Totaal</strong>
                            </td>

                            {sizes.map((size) => (
                              <td
                                key={size}
                                className="table-number"
                              >
                                <strong>
                                  {order.lines
                                    .filter(
                                      (line) =>
                                        line.size === size,
                                    )
                                    .reduce(
                                      (total, line) =>
                                        total +
                                        line.orderedQuantity,
                                      0,
                                    )}
                                </strong>
                              </td>
                            ))}

                            <td className="table-number">
                              <strong>
                                {totals.orderedQuantity}
                              </strong>
                            </td>

                            <td className="table-number">
                              <strong>
                                {totals.receivedQuantity}
                              </strong>
                            </td>

                            <td className="table-number">
                              <strong>
                                {totals.remainingQuantity}
                              </strong>
                            </td>

                            <td className="table-number">
                              <strong>
                                {openToBuyByVariant
                                  ? Array.from(
                                      new Set(
                                        order.lines.map(
                                          (line) =>
                                            line.variantId,
                                        ),
                                      ),
                                    ).reduce(
                                      (total, variantId) =>
                                        total +
                                        (openToBuyByVariant[
                                          variantId
                                        ] ?? 0),
                                      0,
                                    )
                                  : "—"}
                              </strong>
                            </td>

                            <td />

                            <td className="table-number">
                              <strong>
                                {formatCurrency(
                                  totals.subtotal,
                                  order.currency,
                                )}
                              </strong>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}

            {activeTab === "ontvangsten" && (
              <div>
                <div
                  className={
                    styles.tableToolbar
                  }
                >
                  <div>
                    <strong>
                      {receipts.length}
                    </strong>{" "}
                    ontvangst
                    {receipts.length === 1
                      ? ""
                      : "en"}
                  </div>

                  {canReceive && (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={
                        openReceiveDialog
                      }
                    >
                      Nieuwe ontvangst
                    </button>
                  )}
                </div>

                {receipts.length === 0 ? (
                  <div
                    className={
                      styles.emptyState
                    }
                  >
                    <div
                      className={
                        styles.emptyIcon
                      }
                    >
                      ↓
                    </div>

                    <h2>
                      Nog geen ontvangsten
                    </h2>

                    <p>
                      Er zijn voor deze
                      inkooporder nog geen goederen
                      ontvangen.
                    </p>

                    {canReceive && (
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={
                          openReceiveDialog
                        }
                      >
                        Eerste ontvangst boeken
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    className={
                      styles.receiptList
                    }
                  >
                    {receipts.map((receipt) => {
                      const receiptQuantity =
                        receipt.lines.reduce(
                          (total, line) =>
                            total +
                            line.quantity,
                          0,
                        );

                      return (
                        <article
                          key={receipt.id}
                          className={
                            styles.receiptCard
                          }
                        >
                          <div
                            className={
                              styles.receiptHeader
                            }
                          >
                            <div>
                              <div
                                className={
                                  styles.receiptTitle
                                }
                              >
                                {
                                  receipt.receiptNumber
                                }
                              </div>

                              <div
                                className={
                                  styles.receiptMeta
                                }
                              >
                                {formatDate(
                                  receipt.receiptDate,
                                )}{" "}
                                · {receiptQuantity}{" "}
                                stuks
                              </div>
                            </div>

                            <div
                              className={
                                styles.receiptHeaderRight
                              }
                            >
                              <StatusBadge
                                label="Verwerkt"
                                tone="success"
                              />
                            </div>
                          </div>

                          <div
                            className={
                              styles.receiptDetails
                            }
                          >
                            <div>
                              <span>Pakbon</span>
                              <strong>
                                {receipt.packingSlipNumber ||
                                  "—"}
                              </strong>
                            </div>

                            <div>
                              <span>
                                Ontvangen door
                              </span>
                              <strong>
                                {receipt.receivedBy ||
                                  "—"}
                              </strong>
                            </div>

                            <div>
                              <span>
                                Verwerkt op
                              </span>
                              <strong>
                                {formatDateTime(
                                  receipt.createdAt,
                                )}
                              </strong>
                            </div>
                          </div>

                          <div
                            className={
                              styles.receiptLines
                            }
                          >
                            {receipt.lines.map(
                              (line) => (
                                <div
                                  key={line.id}
                                  className={
                                    styles.receiptLine
                                  }
                                >
                                  <div>
                                    <strong>
                                      {
                                        line.productName
                                      }
                                    </strong>

                                    <span>
                                      {line.sku} ·{" "}
                                      {line.color} ·{" "}
                                      {line.size}
                                    </span>
                                  </div>

                                  <strong>
                                    +{line.quantity}
                                  </strong>
                                </div>
                              ),
                            )}
                          </div>

                          {receipt.notes && (
                            <div
                              className={
                                styles.receiptNotes
                              }
                            >
                              {receipt.notes}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "historie" && (
              <div
                className={
                  styles.timeline
                }
              >
                <article
                  className={
                    styles.timelineItem
                  }
                >
                  <div
                    className={
                      styles.timelineMarker
                    }
                  >
                    +
                  </div>

                  <div
                    className={
                      styles.timelineContent
                    }
                  >
                    <strong>
                      Inkooporder aangemaakt
                    </strong>
                    <span>
                      {formatDateTime(
                        order.createdAt,
                      )}
                    </span>
                    <p>
                      {order.orderNumber} is
                      aangemaakt voor{" "}
                      {order.supplierName}.
                    </p>
                  </div>
                </article>

                {order.status !== "Concept" && (
                  <article
                    className={
                      styles.timelineItem
                    }
                  >
                    <div
                      className={
                        styles.timelineMarker
                      }
                    >
                      ✓
                    </div>

                    <div
                      className={
                        styles.timelineContent
                      }
                    >
                      <strong>
                        Orderstatus:{" "}
                        {order.status}
                      </strong>
                      <span>
                        Laatst bijgewerkt{" "}
                        {formatDateTime(
                          order.updatedAt,
                        )}
                      </span>
                      <p>
                        De huidige orderstatus is{" "}
                        {order.status.toLowerCase()}.
                      </p>
                    </div>
                  </article>
                )}

                {receipts.map((receipt) => (
                  <article
                    key={receipt.id}
                    className={
                      styles.timelineItem
                    }
                  >
                    <div
                      className={
                        styles.timelineMarker
                      }
                    >
                      ↓
                    </div>

                    <div
                      className={
                        styles.timelineContent
                      }
                    >
                      <strong>
                        Ontvangst{" "}
                        {receipt.receiptNumber}
                      </strong>
                      <span>
                        {formatDateTime(
                          receipt.createdAt,
                        )}
                      </span>
                      <p>
                        {receipt.lines.reduce(
                          (total, line) =>
                            total +
                            line.quantity,
                          0,
                        )}{" "}
                        stuks ontvangen
                        {receipt.packingSlipNumber
                          ? ` op pakbon ${receipt.packingSlipNumber}`
                          : ""}
                        .
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </main>

        <aside className={styles.sideColumn}>
          <section className="content-card">
            <div className="content-card-header">
              <h2 className="content-card-title">
                Orderinformatie
              </h2>
            </div>

            <dl className={styles.detailList}>
              <div>
                <dt>Ordernummer</dt>
                <dd>{order.orderNumber}</dd>
              </div>

              <div>
                <dt>Leverancier</dt>
                <dd>{order.supplierName}</dd>
              </div>

              <div>
                <dt>Collectie</dt>
                <dd>
                  {order.collectionCode || "—"}
                </dd>
              </div>

              <div>
                <dt>Valuta</dt>
                <dd>{order.currency}</dd>
              </div>

              <div>
                <dt>Betalingstermijn</dt>
                <dd>
                  {order.paymentDays} dagen
                </dd>
              </div>

              <div>
                <dt>Referentie</dt>
                <dd>
                  {order.supplierReference ||
                    "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="content-card">
            <div className="content-card-header">
              <h2 className="content-card-title">
                Financieel
              </h2>
            </div>

            <dl className={styles.financialList}>
              <div>
                <dt>Orderwaarde</dt>
                <dd>
                  {formatCurrency(
                    totals.subtotal,
                    order.currency,
                  )}
                </dd>
              </div>

              <div>
                <dt>Ontvangen waarde</dt>
                <dd>
                  {formatCurrency(
                    totals.receivedValue,
                    order.currency,
                  )}
                </dd>
              </div>

              <div>
                <dt>Openstaande waarde</dt>
                <dd
                  className={
                    totals.remainingValue > 0
                      ? styles.openValue
                      : undefined
                  }
                >
                  {formatCurrency(
                    totals.remainingValue,
                    order.currency,
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="content-card">
            <div className="content-card-header">
              <h2 className="content-card-title">
                Snelle acties
              </h2>
            </div>

            <div
              className={
                styles.quickActions
              }
            >
              {canReceive && (
                <button
                  type="button"
                  onClick={openReceiveDialog}
                >
                  <span>↓</span>
                  Ontvangst boeken
                </button>
              )}

              <button
                type="button"
                onClick={handleDuplicate}
              >
                <span>⧉</span>
                Order dupliceren
              </button>

              <button
                type="button"
                onClick={handlePrint}
              >
                <span>⌑</span>
                Afdrukken
              </button>
            </div>
          </section>

          {(order.status === "Concept" ||
            order.status === "Geannuleerd") && (
            <section
              className={
                styles.dangerZone
              }
            >
              <h2>Inkooporder verwijderen</h2>

              <p>
                Verwijder deze conceptorder
                definitief.
              </p>

              <button
                type="button"
                onClick={handleDelete}
              >
                Verwijderen
              </button>
            </section>
          )}
        </aside>
      </section>

      {showReceiveDialog && (
        <div
          className={styles.dialogBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowReceiveDialog(false);
            }
          }}
        >
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="receive-title"
          >
            <header
              className={
                styles.dialogHeader
              }
            >
              <div>
                <span>
                  {order.orderNumber}
                </span>
                <h2 id="receive-title">
                  Ontvangst boeken
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowReceiveDialog(false)
                }
                aria-label="Sluiten"
              >
                ×
              </button>
            </header>

            <div className={styles.dialogBody}>
              {error && (
                <div
                  className={
                    styles.dialogError
                  }
                >
                  <span>!</span>
                  {error}
                </div>
              )}

              <div
                className={
                  styles.receiveMetaGrid
                }
              >
                <label>
                  <span>Ontvangstdatum</span>
                  <input
                    type="date"
                    value={
                      receiveForm.receiptDate
                    }
                    onChange={(event) =>
                      setReceiveForm(
                        (current) => ({
                          ...current,
                          receiptDate:
                            event.target.value,
                        }),
                      )
                    }
                  />
                </label>

                <label>
                  <span>Pakbonnummer</span>
                  <input
                    type="text"
                    value={
                      receiveForm.packingSlipNumber
                    }
                    onChange={(event) =>
                      setReceiveForm(
                        (current) => ({
                          ...current,
                          packingSlipNumber:
                            event.target.value,
                        }),
                      )
                    }
                    placeholder="Bijv. PB-2026-184"
                  />
                </label>

                <label>
                  <span>Ontvangen door</span>
                  <input
                    type="text"
                    value={
                      receiveForm.receivedBy
                    }
                    onChange={(event) =>
                      setReceiveForm(
                        (current) => ({
                          ...current,
                          receivedBy:
                            event.target.value,
                        }),
                      )
                    }
                    placeholder="Naam medewerker"
                  />
                </label>
              </div>

              <div
                className={
                  styles.receiveToolbar
                }
              >
                <div>
                  <strong>
                    Te ontvangen artikelen
                  </strong>
                  <span>
                    Controleer de werkelijk
                    ontvangen aantallen.
                  </span>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={clearReceiveValues}
                  >
                    Alles op 0
                  </button>

                  <button
                    type="button"
                    onClick={
                      receiveAllRemaining
                    }
                  >
                    Alles ontvangen
                  </button>
                </div>
              </div>

              <div
                className={
                  styles.receiveTableWrapper
                }
              >
                <table
                  className={
                    styles.receiveTable
                  }
                >
                  <thead>
                    <tr>
                      <th>Artikel</th>
                      <th>Variant</th>
                      <th>Besteld</th>
                      <th>Eerder ontvangen</th>
                      <th>Open</th>
                      <th>Nu ontvangen</th>
                    </tr>
                  </thead>

                  <tbody>
                    {order.lines.map((line) => {
                      const remaining =
                        Math.max(
                          0,
                          line.orderedQuantity -
                            line.receivedQuantity,
                        );

                      return (
                        <tr key={line.id}>
                          <td>
                            <strong>
                              {line.productName}
                            </strong>
                            <span>
                              {line.productCode}
                            </span>
                          </td>

                          <td>
                            <strong>
                              {line.sku}
                            </strong>
                            <span>
                              {line.color} ·{" "}
                              {line.size}
                            </span>
                          </td>

                          <td>
                            {
                              line.orderedQuantity
                            }
                          </td>

                          <td>
                            {
                              line.receivedQuantity
                            }
                          </td>

                          <td>
                            <strong>
                              {remaining}
                            </strong>
                          </td>

                          <td>
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={
                                receiveValues[
                                  line.id
                                ] ?? 0
                              }
                              disabled={
                                remaining === 0
                              }
                              onChange={(
                                event,
                              ) =>
                                handleReceiveValue(
                                  line.id,
                                  Number(
                                    event.target
                                      .value,
                                  ),
                                )
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label
                className={
                  styles.notesField
                }
              >
                <span>Ontvangstnotitie</span>

                <textarea
                  value={receiveForm.notes}
                  onChange={(event) =>
                    setReceiveForm(
                      (current) => ({
                        ...current,
                        notes:
                          event.target.value,
                      }),
                    )
                  }
                  placeholder="Bijzonderheden, schade of afwijkingen..."
                />
              </label>
            </div>

            <footer
              className={
                styles.dialogFooter
              }
            >
              <div>
                <span>
                  Totaal te verwerken
                </span>
                <strong>
                  {totalToReceive} stuks
                </strong>
              </div>

              <div
                className={
                  styles.dialogActions
                }
              >
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() =>
                    setShowReceiveDialog(false)
                  }
                >
                  Annuleren
                </button>

                <button
                  type="button"
                  className="button button-primary"
                  disabled={
                    saving ||
                    totalToReceive <= 0
                  }
                  onClick={handleReceive}
                >
                  {saving
                    ? "Verwerken..."
                    : "Ontvangst verwerken"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}