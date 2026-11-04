"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { PageHeader } from "@/components/ui/page-header";
import {
  createInventoryCorrection,
  type InventoryCorrectionInput,
  type InventoryVariantRow,
} from "@/lib/inventory";
import {
  fetchPurchaseOrders,
  getPurchaseOrderTotals,
  type PurchaseOrder,
} from "@/lib/purchasing";
import styles from "./inventory.module.css";

type StockFilter =
  | "Alle voorraad"
  | "Op voorraad"
  | "Lage voorraad"
  | "Niet op voorraad"
  | "Onderweg"
  | "Gereserveerd";

type SortField =
  | "productName"
  | "sku"
  | "collection"
  | "physicalStock"
  | "reservedStock"
  | "availableStock"
  | "incomingStock"
  | "stockValue";

type SortDirection = "asc" | "desc";

type CorrectionForm = {
  quantity: number;
  type: InventoryCorrectionInput["type"];
  reason: string;
  notes: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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

function getStockStatus(row: InventoryVariantRow) {
  if (row.availableStock === 0) {
    return {
      label: "Niet op voorraad",
      className: styles.stockDanger,
    };
  }

  if (row.availableStock <= row.minimumStock) {
    return {
      label: "Lage voorraad",
      className: styles.stockWarning,
    };
  }

  return {
    label: "Op voorraad",
    className: styles.stockSuccess,
  };
}

export default function InventoryPage() {
  const [rows, setRows] = useState<
    InventoryVariantRow[]
  >([]);

  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");

  const [stockFilter, setStockFilter] =
    useState<StockFilter>("Alle voorraad");

  const [collectionFilter, setCollectionFilter] =
    useState("Alle collecties");

  const [warehouseFilter, setWarehouseFilter] =
    useState("Alle magazijnen");

  const [sortField, setSortField] =
    useState<SortField>("productName");

  const [sortDirection, setSortDirection] =
    useState<SortDirection>("asc");

  const [selectedRow, setSelectedRow] =
    useState<InventoryVariantRow | null>(null);

  const [showCorrection, setShowCorrection] =
    useState(false);

  const [notification, setNotification] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);
  const [purchaseOrders, setPurchaseOrders] =
    useState<PurchaseOrder[]>([]);

  const [correctionForm, setCorrectionForm] =
    useState<CorrectionForm>({
      quantity: 0,
      type: "Voorraadcorrectie",
      reason: "",
      notes: "",
    });

  async function reload() {
    void fetchPurchaseOrders()
      .then(setPurchaseOrders)
      .catch(() => setPurchaseOrders([]));

    const response =
      await fetch("/api/inventory");

    const inventoryRows =
      await response.json();

    if (!response.ok) {
      setError(
        (inventoryRows as { error?: string })?.error ??
          "Voorraad ophalen is mislukt.",
      );
      setRows([]);
      setLoaded(true);
      return;
    }

    setError(null);

    setRows(
      Array.isArray(inventoryRows)
        ? inventoryRows
        : [],
    );

    setLoaded(true);

    setSelectedRow((current) => {
      if (!current) {
        return null;
      }

      return (
        inventoryRows.find(
          (row: InventoryVariantRow) =>
            row.variantId === current.variantId,
        ) ?? null
      );
    });
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!notification) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotification(null);
    }, 3000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [notification]);

  const dashboard = useMemo(() => {
    const physicalStock = rows.reduce(
      (total, row) =>
        total + row.physicalStock,
      0,
    );

    const reservedStock = rows.reduce(
      (total, row) =>
        total + row.reservedStock,
      0,
    );

    const availableStock = rows.reduce(
      (total, row) =>
        total + row.availableStock,
      0,
    );

    // Onderweg en openstaande inkoopwaarde komen uit de echte
    // inkooporders (database), met de inkoopprijs van de orderregel.
    // Zo tellen ook varianten mee die nog geen voorraadregel hebben.
    const openPurchaseOrders = purchaseOrders.filter(
      (order) =>
        order.status === "Besteld" ||
        order.status === "Deels ontvangen",
    );

    const incomingStock = openPurchaseOrders.reduce(
      (total, order) =>
        total +
        getPurchaseOrderTotals(order).remainingQuantity,
      0,
    );

    const stockValue = rows.reduce(
      (total, row) =>
        total + row.stockValue,
      0,
    );

    const lowStockVariants = rows.filter(
      (row) =>
        row.availableStock > 0 &&
        row.availableStock <=
          row.minimumStock,
    ).length;

    const outOfStockVariants = rows.filter(
      (row) => row.availableStock === 0,
    ).length;

    const openPurchaseValue = openPurchaseOrders
      .reduce(
        (total, order) =>
          total +
          getPurchaseOrderTotals(order).remainingValue,
        0,
      );

    return {
      totalVariants: rows.length,
      physicalStock,
      reservedStock,
      availableStock,
      incomingStock,
      stockValue,
      lowStockVariants,
      outOfStockVariants,
      openPurchaseValue,
    };
  }, [rows, purchaseOrders]);

  const collections = useMemo(() => {
    return Array.from(
      new Set(
        rows
          .map((row) => row.collection)
          .filter(Boolean),
      ),
    ).sort((first, second) =>
      first.localeCompare(second, "nl"),
    );
  }, [rows]);

  const warehouses = useMemo(() => {
    return Array.from(
      new Set(
        rows
          .map((row) => row.warehouse)
          .filter(Boolean),
      ),
    ).sort((first, second) =>
      first.localeCompare(second, "nl"),
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search
      .trim()
      .toLowerCase();

    const filtered = rows.filter((row) => {
      const matchesSearch =
        !normalizedSearch ||
        row.productName
          .toLowerCase()
          .includes(normalizedSearch) ||
        row.productCode
          .toLowerCase()
          .includes(normalizedSearch) ||
        row.sku
          .toLowerCase()
          .includes(normalizedSearch) ||
        row.color
          .toLowerCase()
          .includes(normalizedSearch) ||
        row.size
          .toLowerCase()
          .includes(normalizedSearch) ||
        row.supplier
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesCollection =
        collectionFilter ===
          "Alle collecties" ||
        row.collection === collectionFilter;

      const matchesWarehouse =
        warehouseFilter ===
          "Alle magazijnen" ||
        row.warehouse === warehouseFilter;

      let matchesStock = true;

      if (stockFilter === "Op voorraad") {
        matchesStock =
          row.availableStock >
          row.minimumStock;
      }

      if (stockFilter === "Lage voorraad") {
        matchesStock =
          row.availableStock > 0 &&
          row.availableStock <=
            row.minimumStock;
      }

      if (
        stockFilter === "Niet op voorraad"
      ) {
        matchesStock =
          row.availableStock === 0;
      }

      if (stockFilter === "Onderweg") {
        matchesStock =
          row.incomingStock > 0;
      }

      if (stockFilter === "Gereserveerd") {
        matchesStock =
          row.reservedStock > 0;
      }

      return (
        matchesSearch &&
        matchesCollection &&
        matchesWarehouse &&
        matchesStock
      );
    });

    return filtered.sort((firstRow, secondRow) => {
      const firstValue =
        firstRow[sortField];

      const secondValue =
        secondRow[sortField];

      const comparison =
        typeof firstValue === "number" &&
        typeof secondValue === "number"
          ? firstValue - secondValue
          : String(firstValue).localeCompare(
              String(secondValue),
              "nl",
              {
                numeric: true,
                sensitivity: "base",
              },
            );

      return sortDirection === "asc"
        ? comparison
        : comparison * -1;
    });
  }, [
    rows,
    search,
    stockFilter,
    collectionFilter,
    warehouseFilter,
    sortField,
    sortDirection,
  ]);

  const activeFilters =
    Number(Boolean(search.trim())) +
    Number(
      stockFilter !== "Alle voorraad",
    ) +
    Number(
      collectionFilter !==
        "Alle collecties",
    ) +
    Number(
      warehouseFilter !==
        "Alle magazijnen",
    );

  const lastInventoryUpdate = useMemo(() => {
    const dates = rows
      .map((row) => row.lastMovementAt)
      .filter(Boolean)
      .sort();

    return dates.at(-1) ?? "";
  }, [rows]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((current) =>
        current === "asc"
          ? "desc"
          : "asc",
      );

      return;
    }

    setSortField(field);
    setSortDirection("asc");
  }

  function sortIcon(field: SortField) {
    if (sortField !== field) {
      return (
        <span
          className={styles.sortInactive}
        >
          ↕
        </span>
      );
    }

    return (
      <span className={styles.sortActive}>
        {sortDirection === "asc"
          ? "↑"
          : "↓"}
      </span>
    );
  }

  function openCorrection(
    row: InventoryVariantRow,
  ) {
    setSelectedRow(row);

    setCorrectionForm({
      quantity: 0,
      type: "Voorraadcorrectie",
      reason: "",
      notes: "",
    });

    setError(null);
    setShowCorrection(true);
  }

  function processCorrection() {
    if (!selectedRow) {
      return;
    }

    if (!correctionForm.reason.trim()) {
      setError(
        "Vul een reden voor de voorraadcorrectie in.",
      );

      return;
    }

    try {
      createInventoryCorrection({
        productId: selectedRow.productId,
        variantId: selectedRow.variantId,
        quantity: correctionForm.quantity,
        type: correctionForm.type,
        reason: correctionForm.reason,
        notes: correctionForm.notes,
        warehouse: selectedRow.warehouse,
        location: selectedRow.location,
        userName: "Daan",
      });

      reload();
      setShowCorrection(false);
      setError(null);

      setNotification(
        `Voorraad van ${selectedRow.sku} is bijgewerkt.`,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Voorraadcorrectie is niet gelukt.",
      );
    }
  }

  function resetFilters() {
    setSearch("");
    setStockFilter("Alle voorraad");
    setCollectionFilter(
      "Alle collecties",
    );
    setWarehouseFilter(
      "Alle magazijnen",
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Warehouse"
        title="Voorraad"
        description="Bekijk fysieke, gereserveerde, beschikbare en inkomende voorraad per SKU."
        action={
          <div
            className={styles.headerActions}
          >
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                reload();

                setNotification(
                  "Voorraad is vernieuwd.",
                );
              }}
            >
              ↻ Vernieuwen
            </button>

            <button
              type="button"
              className="button button-primary"
              disabled={!selectedRow}
              onClick={() => {
                if (selectedRow) {
                  openCorrection(
                    selectedRow,
                  );
                }
              }}
            >
              Voorraadcorrectie
            </button>
          </div>
        }
      />

      {notification && (
        <div
          className={styles.notification}
        >
          <span>✓</span>
          {notification}
        </div>
      )}

      <section
        className={styles.metricGrid}
      >
        <article className="metric-card">
          <div className="metric-label">
            Voorraadwaarde
          </div>

          <div className="metric-value">
            {loaded
              ? formatCurrency(
                  dashboard.stockValue,
                )
              : "—"}
          </div>

          <div className="metric-detail">
            tegen huidige inkoopprijs
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Beschikbaar
          </div>

          <div className="metric-value">
            {loaded
              ? dashboard.availableStock.toLocaleString(
                  "nl-NL",
                )
              : "—"}
          </div>

          <div className="metric-detail">
            {loaded
              ? dashboard.physicalStock.toLocaleString(
                  "nl-NL",
                )
              : "—"}{" "}
            fysiek ·{" "}
            {loaded
              ? dashboard.reservedStock.toLocaleString(
                  "nl-NL",
                )
              : "—"}{" "}
            gereserveerd
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Onderweg
          </div>

          <div className="metric-value">
            {loaded
              ? dashboard.incomingStock.toLocaleString(
                  "nl-NL",
                )
              : "—"}
          </div>

          <div className="metric-detail">
            {loaded
              ? formatCurrency(
                  dashboard.openPurchaseValue,
                )
              : "—"}{" "}
            openstaande inkoopwaarde
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Voorraadmeldingen
          </div>

          <div className="metric-value">
            {loaded
              ? dashboard.lowStockVariants +
                dashboard.outOfStockVariants
              : "—"}
          </div>

          <div className="metric-detail">
            {loaded
              ? dashboard.lowStockVariants
              : "—"}{" "}
            laag ·{" "}
            {loaded
              ? dashboard.outOfStockVariants
              : "—"}{" "}
            uitverkocht
          </div>
        </article>
      </section>

      <section className="content-card">
        <div className={styles.toolbar}>
          <div
            className={styles.toolbarMain}
          >
            <div className={styles.search}>
              <span>⌕</span>

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
                placeholder="Zoek op artikel, artikelcode, SKU, kleur of leverancier..."
              />

              {search && (
                <button
                  type="button"
                  onClick={() =>
                    setSearch("")
                  }
                  aria-label="Zoekopdracht wissen"
                >
                  ×
                </button>
              )}
            </div>

            <select
              value={stockFilter}
              onChange={(event) =>
                setStockFilter(
                  event.target
                    .value as StockFilter,
                )
              }
            >
              <option value="Alle voorraad">
                Alle voorraad
              </option>

              <option value="Op voorraad">
                Op voorraad
              </option>

              <option value="Lage voorraad">
                Lage voorraad
              </option>

              <option value="Niet op voorraad">
                Niet op voorraad
              </option>

              <option value="Onderweg">
                Onderweg
              </option>

              <option value="Gereserveerd">
                Gereserveerd
              </option>
            </select>

            <select
              value={collectionFilter}
              onChange={(event) =>
                setCollectionFilter(
                  event.target.value,
                )
              }
            >
              <option value="Alle collecties">
                Alle collecties
              </option>

              {collections.map(
                (collection) => (
                  <option
                    key={collection}
                    value={collection}
                  >
                    {collection}
                  </option>
                ),
              )}
            </select>

            <select
              value={warehouseFilter}
              onChange={(event) =>
                setWarehouseFilter(
                  event.target.value,
                )
              }
            >
              <option value="Alle magazijnen">
                Alle magazijnen
              </option>

              {warehouses.map(
                (warehouse) => (
                  <option
                    key={warehouse}
                    value={warehouse}
                  >
                    {warehouse}
                  </option>
                ),
              )}
            </select>

            {activeFilters > 0 && (
              <button
                type="button"
                className={
                  styles.resetButton
                }
                onClick={resetFilters}
              >
                Wis filters
                <span>{activeFilters}</span>
              </button>
            )}
          </div>

          <div
            className={styles.toolbarMeta}
          >
            {filteredRows.length} van{" "}
            {rows.length} varianten
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    className={
                      styles.sortButton
                    }
                    onClick={() =>
                      handleSort(
                        "productName",
                      )
                    }
                  >
                    Artikel{" "}
                    {sortIcon(
                      "productName",
                    )}
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    className={
                      styles.sortButton
                    }
                    onClick={() =>
                      handleSort("sku")
                    }
                  >
                    SKU {sortIcon("sku")}
                  </button>
                </th>

                <th>Variant</th>

                <th>
                  <button
                    type="button"
                    className={
                      styles.sortButton
                    }
                    onClick={() =>
                      handleSort(
                        "collection",
                      )
                    }
                  >
                    Collectie{" "}
                    {sortIcon(
                      "collection",
                    )}
                  </button>
                </th>

                <th>Locatie</th>

                <th className="table-number">
                  <button
                    type="button"
                    className={`${styles.sortButton} ${styles.sortRight}`}
                    onClick={() =>
                      handleSort(
                        "physicalStock",
                      )
                    }
                  >
                    Fysiek{" "}
                    {sortIcon(
                      "physicalStock",
                    )}
                  </button>
                </th>

                <th className="table-number">
                  <button
                    type="button"
                    className={`${styles.sortButton} ${styles.sortRight}`}
                    onClick={() =>
                      handleSort(
                        "reservedStock",
                      )
                    }
                  >
                    Gereserveerd{" "}
                    {sortIcon(
                      "reservedStock",
                    )}
                  </button>
                </th>

                <th className="table-number">
                  <button
                    type="button"
                    className={`${styles.sortButton} ${styles.sortRight}`}
                    onClick={() =>
                      handleSort(
                        "availableStock",
                      )
                    }
                  >
                    Beschikbaar{" "}
                    {sortIcon(
                      "availableStock",
                    )}
                  </button>
                </th>

                <th className="table-number">
                  <button
                    type="button"
                    className={`${styles.sortButton} ${styles.sortRight}`}
                    onClick={() =>
                      handleSort(
                        "incomingStock",
                      )
                    }
                  >
                    Onderweg{" "}
                    {sortIcon(
                      "incomingStock",
                    )}
                  </button>
                </th>

                <th className="table-number">
                  <button
                    type="button"
                    className={`${styles.sortButton} ${styles.sortRight}`}
                    onClick={() =>
                      handleSort(
                        "stockValue",
                      )
                    }
                  >
                    Waarde{" "}
                    {sortIcon(
                      "stockValue",
                    )}
                  </button>
                </th>

                <th>Status</th>
                <th aria-label="Acties" />
              </tr>
            </thead>

            <tbody>
              {filteredRows.map((row) => {
                const stockStatus =
                  getStockStatus(row);

                const selected =
                  selectedRow?.variantId ===
                  row.variantId;

                return (
                  <tr
                    key={row.variantId}
                    className={
                      selected
                        ? styles.selectedRow
                        : undefined
                    }
                    onClick={() =>
                      setSelectedRow(row)
                    }
                    onDoubleClick={() =>
                      openCorrection(row)
                    }
                  >
                    <td>
                      <div className="table-primary">
                        {row.productName}
                      </div>

                      <div
                        className={
                          styles.secondaryText
                        }
                      >
                        {row.productCode} ·{" "}
                        {row.supplier}
                      </div>
                    </td>

                    <td>
                      <Link
                        href={`/artikelen/${row.productId}`}
                        className="table-link"
                      >
                        {row.sku}
                      </Link>
                    </td>

                    <td>
                      <div className="table-primary">
                        {row.color}
                      </div>

                      <div
                        className={
                          styles.secondaryText
                        }
                      >
                        Maat {row.size}
                      </div>
                    </td>

                    <td>
                      {row.collection ||
                        "—"}
                    </td>

                    <td>
                      <div className="table-primary">
                        {row.warehouse}
                      </div>

                      <div
                        className={
                          styles.secondaryText
                        }
                      >
                        {row.location}
                      </div>
                    </td>

                    <td className="table-number">
                      {row.physicalStock}
                    </td>

                    <td className="table-number">
                      {row.reservedStock}
                    </td>

                    <td className="table-number">
                      <strong>
                        {row.availableStock}
                      </strong>
                    </td>

                    <td className="table-number">
                      {row.incomingStock >
                      0 ? (
                        <span
                          className={
                            styles.incoming
                          }
                        >
                          +
                          {
                            row.incomingStock
                          }
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="table-number table-primary">
                      {formatCurrency(
                        row.stockValue,
                      )}
                    </td>

                    <td>
                      <span
                        className={`${styles.stockBadge} ${stockStatus.className}`}
                      >
                        {
                          stockStatus.label
                        }
                      </span>
                    </td>

                    <td>
                      <button
                        type="button"
                        className={
                          styles.rowAction
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          openCorrection(row);
                        }}
                        aria-label={`Voorraadcorrectie voor ${row.sku}`}
                      >
                        •••
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {loaded &&
          filteredRows.length === 0 && (
            <div
              className={styles.emptyState}
            >
              <div>□</div>

              <h2>
                Geen voorraad gevonden
              </h2>

              <p>
                Pas de zoekopdracht of
                filters aan.
              </p>

              <button
                type="button"
                className="button button-secondary"
                onClick={resetFilters}
              >
                Wis alle filters
              </button>
            </div>
          )}

        {!loaded && (
          <div className={styles.emptyState}>
            <div>↻</div>

            <h2>
              Voorraad wordt geladen
            </h2>

            <p>
              De actuele voorraadgegevens
              worden opgehaald.
            </p>
          </div>
        )}

        <div className={styles.tableFooter}>
          <span>
            Laatste voorraadupdate:{" "}
            {loaded
              ? formatDateTime(
                  lastInventoryUpdate,
                )
              : "—"}
          </span>

          <span>
            Klik om te selecteren ·
            dubbelklik voor correctie
          </span>
        </div>
      </section>

      {showCorrection &&
        selectedRow && (
          <div
            className={
              styles.dialogBackdrop
            }
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                setShowCorrection(false);
              }
            }}
          >
            <section
              className={styles.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="inventory-correction-title"
            >
              <header
                className={
                  styles.dialogHeader
                }
              >
                <div>
                  <span>
                    Voorraadcorrectie
                  </span>

                  <h2 id="inventory-correction-title">
                    {selectedRow.sku}
                  </h2>

                  <p>
                    {selectedRow.productName}{" "}
                    · {selectedRow.color} ·{" "}
                    {selectedRow.size}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setShowCorrection(false)
                  }
                  aria-label="Sluiten"
                >
                  ×
                </button>
              </header>

              <div
                className={
                  styles.dialogBody
                }
              >
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
                    styles.currentStock
                  }
                >
                  <div>
                    <span>
                      Fysieke voorraad
                    </span>

                    <strong>
                      {
                        selectedRow.physicalStock
                      }
                    </strong>
                  </div>

                  <div>
                    <span>
                      Gereserveerd
                    </span>

                    <strong>
                      {
                        selectedRow.reservedStock
                      }
                    </strong>
                  </div>

                  <div>
                    <span>
                      Beschikbaar
                    </span>

                    <strong>
                      {
                        selectedRow.availableStock
                      }
                    </strong>
                  </div>
                </div>

                <div
                  className={
                    styles.formGrid
                  }
                >
                  <label>
                    <span>
                      Mutatietype
                    </span>

                    <select
                      value={
                        correctionForm.type
                      }
                      onChange={(event) =>
                        setCorrectionForm(
                          (current) => ({
                            ...current,
                            type: event
                              .target
                              .value as CorrectionForm["type"],
                          }),
                        )
                      }
                    >
                      <option value="Voorraadcorrectie">
                        Voorraadcorrectie
                      </option>

                      <option value="Retour">
                        Retour
                      </option>

                      <option value="Schade">
                        Schade
                      </option>

                      <option value="Verlies">
                        Verlies
                      </option>
                    </select>
                  </label>

                  <label>
                    <span>
                      Aantal mutatie
                    </span>

                    <input
                      type="number"
                      value={
                        correctionForm.quantity
                      }
                      onChange={(event) =>
                        setCorrectionForm(
                          (current) => ({
                            ...current,
                            quantity:
                              Number(
                                event.target
                                  .value,
                              ),
                          }),
                        )
                      }
                      placeholder="Bijv. 5 of -3"
                    />

                    <small>
                      Gebruik een negatief
                      aantal om voorraad af te
                      boeken.
                    </small>
                  </label>

                  <label
                    className={
                      styles.fullWidth
                    }
                  >
                    <span>Reden</span>

                    <input
                      type="text"
                      value={
                        correctionForm.reason
                      }
                      onChange={(event) =>
                        setCorrectionForm(
                          (current) => ({
                            ...current,
                            reason:
                              event.target
                                .value,
                          }),
                        )
                      }
                      placeholder="Bijv. verschil bij telling"
                    />
                  </label>

                  <label
                    className={
                      styles.fullWidth
                    }
                  >
                    <span>Notitie</span>

                    <textarea
                      value={
                        correctionForm.notes
                      }
                      onChange={(event) =>
                        setCorrectionForm(
                          (current) => ({
                            ...current,
                            notes:
                              event.target
                                .value,
                          }),
                        )
                      }
                      placeholder="Extra toelichting..."
                    />
                  </label>
                </div>
              </div>

              <footer
                className={
                  styles.dialogFooter
                }
              >
                <div>
                  Nieuwe fysieke voorraad

                  <strong>
                    {Math.max(
                      0,
                      selectedRow.physicalStock +
                        correctionForm.quantity,
                    )}
                  </strong>
                </div>

                <div>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      setShowCorrection(false)
                    }
                  >
                    Annuleren
                  </button>

                  <button
                    type="button"
                    className="button button-primary"
                    onClick={
                      processCorrection
                    }
                  >
                    Correctie verwerken
                  </button>
                </div>
              </footer>
            </section>
          </div>
        )}
    </div>
  );
}