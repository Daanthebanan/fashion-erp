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
import { StatusBadge } from "@/components/ui/status-badge";
import { DocumentActionButtons } from "@/components/documents/document-action-buttons";
import {
  allocateSalesOrderStock,
  cancelSalesOrder,
  clearSalesOrderChangeNotice,
  confirmSalesOrder,
  declineOrderLineProduction,
  deleteSalesOrder,
  getSalesOrderAvailability,
  loadSalesOrderById,
  getSalesOrderTotals,
  markSalesOrderReady,
  type SalesOrder,
} from "@/lib/sales";
import styles from "./sales-order-detail.module.css";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value: string) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("nl-NL").format(
    new Date(`${value}T12:00:00`),
  );
}

export default function SalesOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [order, setOrder] =
    useState<SalesOrder | null>(null);
  const [loaded, setLoaded] =
    useState(false);
  const [error, setError] = useState("");
  const [notification, setNotification] =
    useState("");
  const [decliningKey, setDecliningKey] =
    useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadOrder() {
      setLoaded(false);
      setError("");

      try {
        const loadedOrder = await loadSalesOrderById(params.id);

        if (active) {
          setOrder(loadedOrder);
        }
      } catch (caughtError) {
        if (active) {
          setOrder(null);
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "De verkooporder kon niet worden geladen.",
          );
        }
      } finally {
        if (active) {
          setLoaded(true);
        }
      }
    }

    void loadOrder();

    return () => {
      active = false;
    };
  }, [params.id]);


  useEffect(() => {
    if (!notification) {
      return;
    }

    const timeout = window.setTimeout(
      () => setNotification(""),
      3200,
    );

    return () =>
      window.clearTimeout(timeout);
  }, [notification]);

  const totals = useMemo(
    () =>
      order
        ? getSalesOrderTotals(order)
        : null,
    [order],
  );

  const availability = useMemo(
    () =>
      order
        ? getSalesOrderAvailability(order)
        : null,
    [order],
  );

  if (!loaded) {
    return (
      <section className="content-card">
        <div className={styles.loading}>
          Verkooporder laden...
        </div>
      </section>
    );
  }

  if (!order || !totals || !availability) {
    return (
      <section className="content-card">
        <div className={styles.notFound}>
          <h1>
            Verkooporder niet gevonden
          </h1>

          <Link
            href="/verkoop"
            className="button button-primary"
          >
            Terug naar verkoop
          </Link>
        </div>
      </section>
    );
  }

  const affectedLines = order.lines.filter(
    (line) => line.productionNote,
  );

  async function execute(
    action: () => Promise<SalesOrder>,
    successMessage?: string,
  ) {
    setError("");

    try {
      const updated = await action();
      setOrder(updated);

      if (successMessage) {
        setNotification(successMessage);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "De actie kon niet worden uitgevoerd.",
      );
    }
  }

  async function handleDeclineProduction(
    productId: string,
    color: string,
  ) {
    if (!order) return;

    const key = `${productId}__${color}`;
    setDecliningKey(key);

    await execute(
      () =>
        declineOrderLineProduction(
          order.id,
          productId,
          color,
        ),
      "Aantallen op 0 gezet en voorraad vrijgegeven.",
    );

    setDecliningKey(null);
  }

  async function handleDelete() {
    if (!order) {
      setError("Verkooporder niet gevonden.");
      return;
    }

    if (
      !window.confirm(
        "Weet je zeker dat je deze conceptorder wilt verwijderen?",
      )
    ) {
      return;
    }

    try {
      await deleteSalesOrder(order.id);
      router.push("/verkoop");
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "De order kon niet worden verwijderd.",
      );
    }
  }

  function handleCancel() {
    if (!order) {
      setError("Verkooporder niet gevonden.");
      return;
    }

    if (
      !window.confirm(
        "Weet je zeker dat je deze order wilt annuleren?",
      )
    ) {
      return;
    }

    void execute(
      () => cancelSalesOrder(order.id),
      "De verkooporder is geannuleerd.",
    );
  }

  function handleAllocate() {
    if (!order) {
      setError("Verkooporder niet gevonden.");
      return;
    }

    void execute(
      () =>
        allocateSalesOrderStock(order.id),
      "De beschikbare voorraad is opnieuw over de order verdeeld.",
    );
  }

  return (
    <div>
      <div className={styles.breadcrumb}>
        <Link href="/verkoop">
          Verkooporders
        </Link>
        <span>›</span>
        <span>{order.orderNumber}</span>
      </div>

      {notification && (
        <div className={styles.error}>
          {notification}
        </div>
      )}

      {affectedLines.length > 0 && (
        <div className={styles.error}>
          {affectedLines.length === 1
            ? "1 orderregel wordt niet meer geproduceerd en moet worden aangepast."
            : `${affectedLines.length} orderregels worden niet meer geproduceerd en moeten worden aangepast.`}
        </div>
      )}

      <PageHeader
        eyebrow="Verkooporder"
        title={order.orderNumber}
        description={`${order.customerName} · ${
          order.city || "Geen plaats"
        }`}
        action={
          <div className="button-group">
            {(["Concept", "Bevestigd", "Gereserveerd"].includes(
              order.status,
            ) ||
              affectedLines.length > 0) && (
              <Link
                href={`/verkoop/${order.id}/bewerken`}
                className="button button-secondary"
              >
                Order bewerken
              </Link>
            )}

            <DocumentActionButtons
              referenceId={order.id}
              documentType="SALES_ORDER_CONFIRMATION"
              printLabel="Orderbevestiging PDF"
              emailLabel="Orderbevestiging mailen"
              onSent={() => {
                if (
                  order.status === "Concept"
                ) {
                  void execute(
                    () =>
                      confirmSalesOrder(
                        order.id,
                      ),
                    "De orderbevestiging is verstuurd en de order is bevestigd.",
                  );
                } else if (
                  order.changedAfterConfirmationAt
                ) {
                  void execute(
                    () =>
                      clearSalesOrderChangeNotice(
                        order.id,
                      ),
                    "De aangepaste orderbevestiging is verstuurd.",
                  );
                } else {
                  setNotification(
                    "De orderbevestiging is verstuurd.",
                  );
                }
              }}
            />


            <DocumentActionButtons
              referenceId={order.id}
              documentType="PACKING_SLIP"
              printLabel="Pakbon PDF"
              emailLabel="Pakbon mailen"
              onSent={() =>
                setNotification(
                  "De pakbon is verstuurd.",
                )
              }
            />

            {order.status === "Concept" && (
              <button
                className="button button-primary"
                type="button"
                onClick={() =>
                  void execute(
                    () =>
                      confirmSalesOrder(
                        order.id,
                      ),
                    "De verkooporder is bevestigd. Voorraad is nog niet verplicht.",
                  )
                }
              >
                Order bevestigen
              </button>
            )}

            {order.status === "Bevestigd" && (
              <button
                className="button button-primary"
                type="button"
                onClick={handleAllocate}
              >
                Voorraad alloceren
              </button>
            )}

            {order.status ===
              "Gereserveerd" && (
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  void execute(
                    () =>
                      markSalesOrderReady(
                        order.id,
                      ),
                    "De verkooporder is gereedgemeld.",
                  )
                }
              >
                Gereedmelden
              </button>
            )}

            {!["Concept", "Verzonden", "Geannuleerd"].includes(
              order.status,
            ) &&
              order.lines.some(
                (line) => line.reservedQuantity > 0,
              ) && (
              <Link
                href={`/verkoop/${order.id}/leveren`}
                className="button button-primary"
              >
                Leveren
              </Link>
            )}
          </div>
        }
      />

      {error && (
        <div className={styles.error}>
          {error}
        </div>
      )}

      {order.changedAfterConfirmationAt &&
        order.status !== "Concept" && (
          <div className={styles.changeNotice}>
            <strong>Gewijzigd na bevestiging</strong>
            <span>
              Deze order is aangepast op{" "}
              {new Intl.DateTimeFormat("nl-NL", {
                dateStyle: "short",
                timeStyle: "short",
              }).format(
                new Date(order.changedAfterConfirmationAt),
              )}
              . Verstuur de orderbevestiging opnieuw naar de klant.
            </span>
          </div>
        )}

      {order.status === "Bevestigd" &&
        availability.backorderQuantity >
          0 && (
          <section className="content-card">
            <div className="content-card-header">
              <div>
                <h2 className="content-card-title">
                  Voororder / backorder
                </h2>

                <p className="content-card-description">
                  Deze order is bevestigd, maar
                  nog niet volledig op voorraad.
                  De orderbevestiging mag wel
                  direct naar de klant.
                </p>
              </div>

              <button
                type="button"
                className="button button-primary"
                onClick={handleAllocate}
              >
                Beschikbare voorraad alloceren
              </button>
            </div>
          </section>
        )}

      <section className={styles.metricGrid}>
        <article className="metric-card">
          <div className="metric-label">
            Besteld
          </div>
          <div className="metric-value">
            {totals.quantity}
          </div>
          <div className="metric-detail">
            stuks
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Gereserveerd
          </div>
          <div className="metric-value">
            {availability.reservedQuantity}
          </div>
          <div className="metric-detail">
            {availability.allocationPercentage}%
            van openstaand
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Voororder / tekort
          </div>
          <div className="metric-value">
            {availability.backorderQuantity}
          </div>
          <div className="metric-detail">
            nog te alloceren
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Orderwaarde
          </div>
          <div className="metric-value">
            {formatCurrency(totals.total)}
          </div>
          <div className="metric-detail">
            inclusief btw
          </div>
        </article>
      </section>

      <section className={styles.overviewGrid}>
        <article className="content-card">
          <div className="content-card-header">
            <div>
              <h2 className="content-card-title">
                Klant en order
              </h2>
            </div>

            <StatusBadge
              label={order.status}
              tone={
                order.status ===
                  "Verzonden" ||
                order.status === "Gereed"
                  ? "success"
                  : order.status ===
                      "Gereserveerd" ||
                    order.status ===
                      "Bevestigd"
                    ? "info"
                    : order.status ===
                        "Geannuleerd"
                      ? "danger"
                      : "neutral"
              }
            />
          </div>

          <dl className={styles.detailList}>
            <div>
              <dt>Klantnummer</dt>
              <dd>{order.customerNumber}</dd>
            </div>

            <div>
              <dt>Klant</dt>
              <dd>{order.customerName}</dd>
            </div>

            <div>
              <dt>Contactpersoon</dt>
              <dd>
                {order.contactPerson || "—"}
              </dd>
            </div>

            <div>
              <dt>E-mailadres</dt>
              <dd>{order.email || "—"}</dd>
            </div>

            <div>
              <dt>Orderdatum</dt>
              <dd>
                {formatDate(order.orderDate)}
              </dd>
            </div>

            <div>
              <dt>Gewenste levering</dt>
              <dd>
                {formatDate(
                  order.requestedDeliveryDate,
                )}
              </dd>
            </div>

            <div>
              <dt>Betaaltermijn</dt>
              <dd>
                {order.paymentDays} dagen
              </dd>
            </div>

            <div>
              <dt>Klantkorting</dt>
              <dd>
                {(order.discountPercentage ?? 0).toLocaleString(
                  "nl-NL",
                )}
                %
              </dd>
            </div>
          </dl>
        </article>

        <article className="content-card">
          <div className="content-card-header">
            <div>
              <h2 className="content-card-title">
                Voorraadallocatie
              </h2>
            </div>
          </div>

          <dl className={styles.detailList}>
            <div>
              <dt>Openstaand</dt>
              <dd>
                {availability.openQuantity}
              </dd>
            </div>

            <div>
              <dt>Gereserveerd</dt>
              <dd>
                {
                  availability.reservedQuantity
                }
              </dd>
            </div>

            <div>
              <dt>Voororder / tekort</dt>
              <dd>
                {
                  availability.backorderQuantity
                }
              </dd>
            </div>

            <div>
              <dt>Allocatiegraad</dt>
              <dd>
                {
                  availability.allocationPercentage
                }
                %
              </dd>
            </div>

            <div>
              <dt>Totaal</dt>
              <dd>
                {formatCurrency(totals.total)}
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="content-card">
        <div className="content-card-header">
          <div>
            <h2 className="content-card-title">
              Orderregels
            </h2>

            <p className="content-card-description">
              Bestelde, gereserveerde en nog
              te alloceren aantallen per variant.
            </p>
          </div>
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
            new Set(order.lines.map((line) => line.size)),
          ).sort((a, b) => {
            const aIndex = preferredSizeOrder.indexOf(
              a.toUpperCase(),
            );
            const bIndex = preferredSizeOrder.indexOf(
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
                const key = `${line.productId}__${line.color}`;
                const existing = map.get(key);

                if (existing) {
                  existing.lines.push(line);
                } else {
                  map.set(key, {
                    productId: line.productId,
                    productName: line.productName,
                    color: line.color,
                    unitPrice: line.unitPrice,
                    discountPercentage:
                      line.discountPercentage,
                    productionNote: line.productionNote,
                    lines: [line],
                  });
                }

                return map;
              },
              new Map<
                string,
                {
                  productId: string;
                  productName: string;
                  color: string;
                  unitPrice: number;
                  discountPercentage: number;
                  productionNote?: string;
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
                      Aantal
                    </th>
                    <th className="table-number">
                      Prijs
                    </th>
                    <th className="table-number">
                      Regelbedrag
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {groups.map((group) => {
                    const quantityBySize = new Map<
                      string,
                      number
                    >();

                    group.lines.forEach((line) => {
                      quantityBySize.set(
                        line.size,
                        (quantityBySize.get(line.size) ??
                          0) + line.quantity,
                      );
                    });

                    const totalQuantity = Array.from(
                      quantityBySize.values(),
                    ).reduce(
                      (sum, value) => sum + value,
                      0,
                    );

                    const lineTotal =
                      totalQuantity *
                      group.unitPrice *
                      (1 -
                        group.discountPercentage / 100);

                    const reducedQuantity =
                      group.lines.reduce(
                        (sum, line) =>
                          sum +
                          Math.max(
                            0,
                            (line.originalQuantity ??
                              line.quantity) -
                              line.quantity,
                          ),
                        0,
                      );

                    const isDeclined =
                      reducedQuantity > 0;

                    const groupKey = `${group.productId}__${group.color}`;

                    return (
                      <tr
                        key={groupKey}
                        className={
                          isDeclined
                            ? styles.declinedRow
                            : undefined
                        }
                      >
                        <td className="table-primary">
                          {group.productName}

                          {group.productionNote && (
                            <div
                              className={
                                styles.productionWarning
                              }
                            >
                              {group.productionNote}
                            </div>
                          )}

                          {isDeclined ? (
                            <div
                              className={
                                styles.declinedNote
                              }
                            >
                              -{reducedQuantity} stuks
                              niet geproduceerd
                            </div>
                          ) : (
                            group.productionNote && (
                              <button
                                type="button"
                                className={
                                  styles.declineButton
                                }
                                disabled={
                                  decliningKey ===
                                  groupKey
                                }
                                onClick={() =>
                                  handleDeclineProduction(
                                    group.productId,
                                    group.color,
                                  )
                                }
                              >
                                {decliningKey ===
                                groupKey
                                  ? "Bezig..."
                                  : "Zet op 0"}
                              </button>
                            )
                          )}
                        </td>

                        <td>{group.color}</td>

                        {sizes.map((size) => (
                          <td
                            key={size}
                            className="table-number"
                          >
                            {quantityBySize.get(size) ?? 0}
                          </td>
                        ))}

                        <td className="table-number">
                          <strong>{totalQuantity}</strong>
                        </td>

                        <td className="table-number">
                          {formatCurrency(group.unitPrice)}
                        </td>

                        <td className="table-number table-primary">
                          {formatCurrency(lineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </section>

      {order.notes && (
        <section
          className={`content-card ${styles.notesCard}`}
        >
          <h2>Interne notitie</h2>
          <p>{order.notes}</p>
        </section>
      )}

      {(order.status === "Concept" ||
        order.status === "Bevestigd" ||
        order.status === "Gereserveerd" ||
        order.status === "Gereed") && (
        <section className={styles.dangerZone}>
          <div>
            <h2>
              {order.status === "Concept"
                ? "Conceptorder verwijderen"
                : "Order annuleren"}
            </h2>

            <p>
              {order.status === "Concept"
                ? "Deze order heeft nog geen invloed op de voorraad."
                : "Eventueel gereserveerde voorraad wordt automatisch vrijgegeven."}
            </p>
          </div>

          <button
            type="button"
            onClick={
              order.status === "Concept"
                ? handleDelete
                : handleCancel
            }
          >
            {order.status === "Concept"
              ? "Order verwijderen"
              : "Order annuleren"}
          </button>
        </section>
      )}
    </div>
  );
}
