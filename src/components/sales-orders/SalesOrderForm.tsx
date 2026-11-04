"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getStoredProducts, getColorArticleCode } from "@/lib/articles";
import {
  getColors,
} from "@/lib/master-data";

import {
  getCustomers,
  type Customer,
} from "@/lib/customers";
import { resolveSalesPrice } from "@/lib/price-lists";
import {
  createSalesOrder,
  loadSalesOrderById,
  type SalesOrderStatus,
} from "@/lib/sales";
import styles from "@/app/verkoop/nieuw/new-sales-order.module.css";

type MatrixVariant = {
  id?: string;
  productId: string;
  productName: string;
  productCode: string;
  color: string;
  colorCode: string;
  articleCode: string;
  imageUrl: string;
  variantId: string;
  sku: string;
  size: string;
  availableStock: number;
  unitPrice: number;
  recommendedRetailPrice: number;
};

type MatrixRow = {
  key: string;
  productId: string;
  productName: string;
  articleCode: string;
  color: string;
  imageUrl: string;
  variants: MatrixVariant[];
};

const sizeOrder = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "3XL",
  "32",
  "34",
  "36",
  "38",
  "40",
  "42",
  "44",
  "46",
  "48",
  "50",
  "52",
  "OS",
];

function rankSize(value: string) {
  const index = sizeOrder.indexOf(value.toUpperCase());

  return index >= 0
    ? index
    : 1000 + (Number(value) || 0);
}

type SalesOrderFormProps = {
  mode?: "create" | "edit";
  orderId?: string;
};

export function SalesOrderForm({
  mode = "create",
  orderId,
}: SalesOrderFormProps) {
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [status, setStatus] =
    useState<SalesOrderStatus>("Concept");
  // Een al bevestigde order wordt aangevuld met behoud van status;
  // terugzetten naar Concept zou reserveringen laten hangen.
  const [statusLocked, setStatusLocked] = useState(false);
  const [notes, setNotes] = useState("");
  const [variants, setVariants] = useState<MatrixVariant[]>([]);
  const [quantities, setQuantities] = useState<
    Record<string, number>
  >({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);
      setError("");

      try {
        const existingOrder =
          mode === "edit" && orderId
            ? await loadSalesOrderById(orderId)
            : null;

        const [customerResult, productResult] = await Promise.all([
          getCustomers(),
          getStoredProducts(),
        ]);

        if (!active) {
          return;
        }

        const activeCustomers = customerResult.filter(
          (customer) => customer.status === "Actief",
        );

        setCustomers(activeCustomers);
        setCustomerId(activeCustomers[0]?.id ?? "");

        const colors = getColors();
        const colorMap = new Map(
          colors.map((color) => [
            color.name.toLowerCase(),
            color.code,
          ]),
        );

        const productIds = productResult.map((product) => product.id);

        const mediaResponse = await fetch(
          "/api/media/products/primary",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              productIds,
            }),
          },
        );

        const mediaByProduct = mediaResponse.ok
          ? ((await mediaResponse.json()) as Record<
              string,
              {
                imageUrl?: string;
              }
            >)
          : {};

        console.log(
          "DEBUG PRODUCT RESULT VARIANT",
          productResult
            .flatMap((p) => p.variants)
            .slice(0,10)
            .map((v) => ({
              color: v.color,
              colorCode: v.colorCode,
              sku: v.sku,
            })),
        );

        const loadedVariants: MatrixVariant[] =
          productResult.flatMap((product) => {
          const primaryImageUrl =
            mediaByProduct[product.id]?.imageUrl ?? "";

          return product.variants.map((variant) => {
            const colorCode =
              variant.colorCode?.trim() ||
              colorMap.get(variant.color.toLowerCase()) ||
              variant.color.slice(0, 3).toUpperCase();

            console.log("COLOR DEBUG", {
              color: variant.color,
              variantColorCode: variant.colorCode,
              resolved: colorCode,
            });

            const masterColor =
              colors.find(
                (color) => color.code === colorCode,
              )?.name ??
              variant.color;

            return {
              productId: product.id,
              productName: product.name,
              productCode: product.code,
              color: masterColor,
              colorCode,
              articleCode: getColorArticleCode(
                product.code,
                colorCode,
              ),
              imageUrl: primaryImageUrl,
              variantId: variant.id,
              sku: variant.sku,
              size: variant.size,
              availableStock:
                variant.physicalStock - variant.reservedStock,
              unitPrice: variant.wholesalePrice,
              recommendedRetailPrice:
                variant.recommendedRetailPrice ||
                product.recommendedRetailPrice ||
                0,
            };
          });
        });

        const mergedVariants = [...loadedVariants];

        if (mode === "edit" && existingOrder) {
          existingOrder.lines.forEach((line) => {
            const exists = mergedVariants.some(
              (variant) =>
                variant.variantId === line.variantId ||
                variant.sku === line.sku,
            );

            if (!exists) {
              mergedVariants.push({
                id: String(line.id ?? ""),
                productId: line.productId,
                productName: line.productName,
                productCode: line.productCode ?? "",
                color: line.color,
                colorCode: "",
                articleCode: line.productCode ?? "",
                imageUrl: "",
                variantId: line.variantId,
                sku: line.sku,
                size: line.size,
                availableStock: 0,
                unitPrice: line.unitPrice,
                recommendedRetailPrice:
                  line.recommendedRetailPrice ?? 0,
              });
            }
          });
        }

        setVariants(mergedVariants);

        console.log("EDIT ORDER:", existingOrder);

        if (
          mode === "edit" &&
          existingOrder
        ) {
          const existingQuantities =
            existingOrder.lines.reduce(
              (
                result,
                line,
              ) => {
                const matchingVariant =
                  mergedVariants.find(
                    (variant) =>
                      variant.variantId === line.variantId ||
                      variant.sku === line.sku ||
                      (
                        variant.productId === line.productId &&
                        variant.color === line.color &&
                        variant.size === line.size
                      ),
                  );

                if (matchingVariant) {
                  matchingVariant.id = String(line.id ?? "");
                  result[matchingVariant.variantId] =
                    line.quantity;
                }

                return result;
              },
              {} as Record<string, number>,
            );

          console.log(
            "LOADED QUANTITIES",
            existingQuantities,
          );

          setQuantities(existingQuantities);

          setRequestedDeliveryDate(
            existingOrder.requestedDeliveryDate ?? "",
          );

          setNotes(existingOrder.notes ?? "");

          setStatus(existingOrder.status);
          setStatusLocked(existingOrder.status !== "Concept");

          const existingCustomer =
            activeCustomers.find(
              (customer) =>
                customer.id === existingOrder.customerId,
            );

          if (existingCustomer) {
            setCustomerId(existingCustomer.id);
          }
        }
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "De gegevens voor de verkooporder konden niet worden geladen.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, []);

  const customer = customers.find(
    (item) => item.id === customerId,
  );

  const rows = useMemo<MatrixRow[]>(() => {
    const query = search.trim().toLowerCase();
    const rowMap = new Map<string, MatrixRow>();

    variants
      .filter((variant) => {
        if (!query) {
          // Without a search term, only show rows already part of this
          // order — the full catalog can be large, and rendering (and
          // loading images for) every product by default made opening an
          // order for editing noticeably slow. Typing a search still finds
          // anything in the catalog to add.
          return quantities[variant.variantId] !== undefined;
        }

        return [
          variant.productName,
          variant.articleCode,
          variant.color,
          variant.sku,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .forEach((variant) => {
        const key = `${variant.productId}__${variant.color}`;

        const row =
          rowMap.get(key) ??
          {
            key,
            productId: variant.productId,
            productName: variant.productName,
            articleCode: variant.articleCode,
            color: variant.color,
            imageUrl: variant.imageUrl,
            variants: [],
          };

        row.variants.push(variant);
        rowMap.set(key, row);
      });

    return [...rowMap.values()].map((row) => ({
      ...row,
      variants: row.variants.sort(
        (left, right) =>
          rankSize(left.size) - rankSize(right.size),
      ),
    }));
  }, [variants, search, quantities]);

  const allSizes = useMemo(
    () =>
      [
        ...new Set(
          rows.flatMap((row) =>
            row.variants.map((variant) => variant.size),
          ),
        ),
      ].sort((left, right) => rankSize(left) - rankSize(right)),
    [rows],
  );

  const selectedLines = variants
    .filter((variant) =>
      mode === "edit"
        ? quantities[variant.variantId] !== undefined
        : (quantities[variant.variantId] ?? 0) > 0,
    )
    .map((variant) => {
      const quantity = quantities[variant.variantId] ?? 0;

      const price = resolveSalesPrice({
        basePrice: variant.unitPrice,
        customerId: customer?.id ?? "",
        priceListId:
          customer?.priceListId ?? "price-list-standard",
        productId: variant.productId,
        variantId: variant.variantId,
        quantity,
      });

      return {
        ...variant,
        quantity,
        unitPrice: price.unitPrice,
      };
    });

  const totalQuantity = selectedLines.reduce(
    (total, line) => total + line.quantity,
    0,
  );

  const subtotalBeforeDiscount = selectedLines.reduce(
    (total, line) => total + line.quantity * line.unitPrice,
    0,
  );

  const discountPercentage = customer?.discountPercentage ?? 0;

  const subtotal =
    subtotalBeforeDiscount * (1 - discountPercentage / 100);

  function setQuantity(variantId: string, value: string) {
    setQuantities((current) => ({
      ...current,
      [variantId]: Math.max(
        0,
        Number.parseInt(value || "0", 10) || 0,
      ),
    }));
  }

  async function handleSave() {
    setError("");

    if (!customer) {
      setError("Selecteer een klant.");
      return;
    }

    if (!selectedLines.length) {
      setError("Vul bij minimaal één maat een aantal in.");
      return;
    }

    setSaving(true);

    try {
      if (mode === "edit" && orderId) {
        console.log("SAVE SALES ORDER LINES", selectedLines);

        const response = await fetch(
          `/api/sales-orders/${orderId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              customerId: customer.id,
              customerNumber: customer.customerNumber,
              customerName: customer.companyName,
              contactPerson: customer.contactPerson,
              email: customer.email,
              city: customer.city,
              requestedDeliveryDate,
              status,
              paymentDays: customer.paymentDays,
              paymentDiscountPercentage:
                customer.paymentDiscountPercentage,
              paymentDiscountDays:
                customer.paymentDiscountDays,
              discountPercentage:
                customer.discountPercentage,
              notes,
              lines: selectedLines.map((line) => ({
                id: line.id,
                productId: line.productId,
                productCode: line.articleCode,
                productName: line.productName,
                variantId: line.variantId,
                sku: line.sku,
                color: line.color,
                size: line.size,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                recommendedRetailPrice:
                  line.recommendedRetailPrice,
                discountPercentage:
                  customer.discountPercentage,
              })),
            }),
          },
        );

        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error ??
              "Order opslaan mislukt.",
          );
        }

        router.push(`/verkoop/${orderId}`);
        return;
      }

      const order = await createSalesOrder({
        customerId: customer.id,
        customerNumber: customer.customerNumber,
        customerName: customer.companyName,
        contactPerson: customer.contactPerson,
        email: customer.email,

        invoiceEmail: customer.invoiceEmail,
        invoiceCc: customer.invoiceCc,
        orderEmail: customer.orderEmail,
        orderCc: customer.orderCc,
        deliveryEmail: customer.deliveryEmail,
        deliveryCc: customer.deliveryCc,

        city: customer.city,
        requestedDeliveryDate,
        status,
        paymentDays: customer.paymentDays,
        paymentDiscountPercentage:
          customer.paymentDiscountPercentage,
        paymentDiscountDays: customer.paymentDiscountDays,
        discountPercentage: customer.discountPercentage,
        notes,
        lines: selectedLines.map((line) => ({
          productId: line.productId,
          productCode: line.articleCode,
          productName: line.productName,
          variantId: line.variantId,
          sku: line.sku,
          color: line.color,
          size: line.size,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          recommendedRetailPrice:
            line.recommendedRetailPrice,
          discountPercentage:
            customer.discountPercentage,
        })),
      });

      router.push(`/verkoop/${order.id}`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "De verkooporder kon niet worden opgeslagen.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className={styles.breadcrumb}>
        <Link href="/verkoop">Verkooporders</Link>
        <span>›</span>
        <span>Nieuwe verkooporder</span>
      </div>

      <PageHeader
        eyebrow="Verkoop"
        title="Nieuwe verkooporder"
        description="Voer aantallen per kleur en maat horizontaal in."
      />

      <section className={styles.layout}>
        <div className={styles.mainColumn}>
          <article className="content-card">
            <div className="content-card-header">
              <h2 className="content-card-title">
                Ordergegevens
              </h2>
            </div>

            <div className={styles.formGrid}>
              <label>
                <span>Klant</span>
                <select
                  value={customerId}
                  onChange={(event) =>
                    setCustomerId(event.target.value)
                  }
                  disabled={loading || saving}
                >
                  {!customers.length && (
                    <option value="">
                      Geen actieve klanten beschikbaar
                    </option>
                  )}

                  {customers.map((customerOption) => (
                    <option
                      key={customerOption.id}
                      value={customerOption.id}
                    >
                      {customerOption.companyName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Gewenste leverdatum</span>
                <input
                  type="date"
                  value={requestedDeliveryDate}
                  onChange={(event) =>
                    setRequestedDeliveryDate(event.target.value)
                  }
                  disabled={saving}
                />
              </label>

              <label>
                <span>Status</span>
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(
                      event.target.value as SalesOrderStatus,
                    )
                  }
                  disabled={saving || statusLocked}
                >
                  {statusLocked ? (
                    <option value={status}>{status}</option>
                  ) : (
                    <>
                      <option value="Concept">Concept</option>
                      <option value="Bevestigd">Bevestigd</option>
                    </>
                  )}
                </select>
              </label>

              <label>
                <span>Betaaltermijn</span>
                <input
                  value={
                    customer
                      ? `${customer.paymentDays} dagen netto`
                      : ""
                  }
                  disabled
                />
              </label>

              <label className={styles.fullWidth}>
                <span>Interne notitie</span>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(event) =>
                    setNotes(event.target.value)
                  }
                  disabled={saving}
                />
              </label>
            </div>
          </article>

          <article className="content-card">
            <div className="content-card-toolbar">
              <div className="table-search">
                <span>⌕</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Zoek op artikelnummer, naam of kleur..."
                  disabled={loading}
                />
              </div>
            </div>

            {loading ? (
              <div style={{ padding: 24 }}>
                Klanten en artikelen laden...
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Foto</th>
                      <th>Artikelnummer + kleur</th>

                      {allSizes.map((size) => (
                        <th
                          key={size}
                          className="table-number"
                        >
                          {size}
                        </th>
                      ))}

                      <th className="table-number">Totaal</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={3 + allSizes.length}
                          style={{
                            padding: 24,
                            textAlign: "center",
                            color: "#6b7280",
                          }}
                        >
                          {search.trim()
                            ? "Geen artikelen gevonden voor deze zoekopdracht."
                            : "Zoek hierboven een artikel om aan de order toe te voegen."}
                        </td>
                      </tr>
                    )}

                    {rows.map((row) => {
                      const variantsBySize = new Map(
                        row.variants.map((variant) => [
                          variant.size,
                          variant,
                        ]),
                      );

                      const rowTotal = row.variants.reduce(
                        (total, variant) =>
                          total +
                          (quantities[variant.variantId] ?? 0),
                        0,
                      );

                      return (
                        <tr key={row.key}>
                          <td>
                            {row.imageUrl ? (
                              <img
                                src={row.imageUrl}
                                alt={row.productName}
                                className={styles.orderImage}
                              />
                            ) : (
                              <div
                                className={
                                  styles.imagePlaceholder
                                }
                              >
                                Geen foto
                              </div>
                            )}
                          </td>

                          <td>
                            <strong>{row.articleCode}</strong>
                            <div>
                              {row.productName} · {row.color}
                            </div>
                          </td>

                          {allSizes.map((size) => {
                            const variant =
                              variantsBySize.get(size);

                            return (
                              <td
                                key={size}
                                className="table-number"
                              >
                                {variant ? (
                                  <div>
                                    <input
                                      aria-label={`${row.articleCode} maat ${size}`}
                                      className={
                                        styles.matrixInput
                                      }
                                      type="number"
                                      min="0"
                                      value={
                                        quantities[
                                          variant.variantId
                                        ] ?? 0
                                      }
                                      onChange={(event) =>
                                        setQuantity(
                                          variant.variantId,
                                          event.target.value,
                                        )
                                      }
                                      disabled={saving}
                                    />

                                    <small
                                      className={
                                        variant.availableStock <= 5
                                          ? styles.stockLow
                                          : styles.stockHint
                                      }
                                    >
                                      vrij{" "}
                                      {variant.availableStock}
                                    </small>
                                  </div>
                                ) : (
                                  <span
                                    className={
                                      styles.notAvailable
                                    }
                                  >
                                    —
                                  </span>
                                )}
                              </td>
                            );
                          })}

                          <td className="table-number">
                            <strong>{rowTotal}</strong>
                          </td>
                        </tr>
                      );
                    })}

                    {!rows.length && (
                      <tr>
                        <td
                          colSpan={allSizes.length + 3}
                          style={{ padding: 24 }}
                        >
                          Geen artikelen gevonden.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </div>

        <aside className={styles.sideColumn}>
          <article className="content-card">
            <div className="content-card-header">
              <h2 className="content-card-title">
                Ordersamenvatting
              </h2>
            </div>

            <dl className={styles.summaryList}>
              <div>
                <dt>Klant</dt>
                <dd>{customer?.companyName ?? "—"}</dd>
              </div>

              <div>
                <dt>Orderregels</dt>
                <dd>{selectedLines.length}</dd>
              </div>

              <div>
                <dt>Aantal stuks</dt>
                <dd>{totalQuantity}</dd>
              </div>

              <div>
                <dt>Subtotaal</dt>
                <dd>
                  €{" "}
                  {subtotalBeforeDiscount.toLocaleString(
                    "nl-NL",
                    {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    },
                  )}
                </dd>
              </div>

              <div>
                <dt>Korting</dt>
                <dd>{discountPercentage}%</dd>
              </div>

              <div>
                <dt>Na korting</dt>
                <dd>
                  €{" "}
                  {subtotal.toLocaleString("nl-NL", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </dd>
              </div>
            </dl>
          </article>
        </aside>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <Link
          href="/verkoop"
          className="button button-secondary"
        >
          Annuleren
        </Link>

        <button
          className="button button-primary"
          type="button"
          onClick={() => void handleSave()}
          disabled={
            loading ||
            saving ||
            !customer ||
            selectedLines.length === 0
          }
        >
          {saving
            ? "Verkooporder opslaan..."
            : "Verkooporder opslaan"}
        </button>
      </div>
    </div>
  );
}