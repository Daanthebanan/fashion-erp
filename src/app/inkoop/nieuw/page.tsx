"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
 
import {
  getCollections,
  type Supplier,
} from "@/lib/master-data";
import { fetchSuppliers } from "@/lib/suppliers";
import {
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
} from "@/lib/purchasing";
import styles from "./new-purchase-order.module.css";

type SelectableLine = Omit<
  PurchaseOrderLine,
  "id" | "receivedQuantity"
>;

const SIZE_ORDER = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "34",
  "36",
  "38",
  "40",
  "42",
  "44",
];

export default function NewPurchaseOrderPage() {
  const router = useRouter();

  const [suppliers, setSuppliers] = useState<
    Supplier[]
  >([]);
  const [collections, setCollections] = useState<
    string[]
  >([]);

  const [supplierId, setSupplierId] =
    useState("");
  const [collectionCode, setCollectionCode] =
    useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] =
    useState("");
  const [status, setStatus] =
    useState<PurchaseOrderStatus>("Concept");
  const [notes, setNotes] = useState("");

  const [allLines, setAllLines] = useState<
    SelectableLine[]
  >([]);
  const [quantities, setQuantities] = useState<
    Record<string, number>
  >({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Voorkomt dat een dubbele klik twee identieke inkooporders aanmaakt.
  const savingRef = useRef(false);

  useEffect(() => {
    async function loadMasterData() {
      const supplierValues = (await fetchSuppliers()).filter(
        (item) => item.status === "Actief",
      );

      const collectionValues = getCollections()
        .filter((item) => item.status !== "Gearchiveerd")
        .map((item) => item.code);

      setSuppliers(supplierValues);
      setCollections(collectionValues);

      setSupplierId("");
      setCollectionCode(
        collectionValues[0] ?? "",
      );
    }

    loadMasterData();
  }, []);

  useEffect(() => {
    console.log("SUPPLIER EFFECT TRIGGER", {
      supplierId,
      suppliersCount: suppliers.length,
    });

    async function loadProducts() {
      if (!supplierId) {
        setAllLines([]);
        return;
      }

      const supplier =
        suppliers.find(
          (item) => item.id === supplierId,
        );

      const response =
        await fetch("/api/articles");

      const products =
        (await response.json()) as Array<{
          id: string;
          code: string;
          name: string;
          supplierId: string;
          variants: Array<{
            id: string;
            sku: string;
            color: string;
            size: string;
            purchasePrice: number;
          }>;
        }>;

      const supplierProducts =
        (Array.isArray(products)
          ? products
          : []
        ).filter(
          (product) =>
            product.supplierId === supplier?.id,
        );

      const lines =
        supplierProducts.flatMap((product) =>
          product.variants.map((variant) => ({
            productId: product.id,
            productCode: product.code,
            productName: product.name,
            variantId: variant.id,
            sku: variant.sku,
            color: variant.color,
            size: variant.size,
            orderedQuantity: 0,
            purchasePrice: variant.purchasePrice,
          })),
        );

      console.log("INKOOP LINES DEBUG", {
        selectedSupplier: supplier?.companyName,
        productsFound: supplierProducts.length,
        linesFound: lines.length,
        products: supplierProducts.slice(0, 5).map((p) => ({
          name: p.name,
          supplierId: p.supplierId,
          variants: p.variants.length,
        })),
      });

      setAllLines(lines);
    }

    loadProducts();
  }, [
    supplierId,
    suppliers,
  ]);

  const filteredLines = useMemo(() => {
    const query = search.trim().toLowerCase();

    return allLines.filter((line) => {
      const matchesSearch =
        !query ||
        line.productName
          .toLowerCase()
          .includes(query) ||
        line.productCode
          .toLowerCase()
          .includes(query) ||
        line.sku.toLowerCase().includes(query);

      const matchesCollection =
        !collectionCode;

      const selectedSupplier =
        suppliers.find(
          (supplier) =>
            supplier.id === supplierId,
        )?.companyName ?? "";

      const normalizeSupplier = (value: string) =>
        value
          .toLowerCase()
          .replace(
            /s\.r\.l\.|srl|abbigliamento|group|\.|\s/g,
            "",
          );

      const matchesSupplier = true;

      return matchesSearch;
    });
  }, [
    allLines,
    search,
    collectionCode,
    supplierId,
    suppliers,
  ]);

  const groupedLines = useMemo(() => {
    const groups = new Map<
      string,
      {
        productId: string;
        productName: string;
        productCode: string;
        color: string;
        variants: SelectableLine[];
        sizes: string[];
      }
    >();

    filteredLines.forEach((line) => {
      const key = `${line.productId}-${line.color}`;

      const existing = groups.get(key);

      if (existing) {
        existing.variants.push(line);
      } else {
        groups.set(key, {
          productId: line.productId,
          productName: line.productName,
          productCode: line.productCode,
          color: line.color,
          variants: [line],
          sizes: [],
        });
      }
    });

    return Array.from(groups.values()).map((group) => ({
      ...group,
      sizes: Array.from(
        new Set(
          group.variants.map(
            (variant) => variant.size,
          ),
        ),
      ).sort((a, b) => {
        const aIndex = SIZE_ORDER.indexOf(a);
        const bIndex = SIZE_ORDER.indexOf(b);

        if (aIndex === -1 && bIndex === -1) {
          return a.localeCompare(b);
        }

        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;

        return aIndex - bIndex;
      }),
    }));
  }, [filteredLines]);

  const availableSizes = useMemo(() => {
    const sizes = Array.from(
      new Set(
        groupedLines.flatMap((group) =>
          group.variants.map(
            (variant) => variant.size,
          ),
        ),
      ),
    );

    return sizes.sort((a, b) => {
      const aIndex = SIZE_ORDER.indexOf(a);
      const bIndex = SIZE_ORDER.indexOf(b);

      if (aIndex === -1 && bIndex === -1) {
        return a.localeCompare(b);
      }

      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;

      return aIndex - bIndex;
    });
  }, [groupedLines]);

  const selectedLines = allLines
    .filter(
      (line) =>
        (quantities[line.variantId] ?? 0) > 0,
    )
    .map((line) => ({
      ...line,
      orderedQuantity:
        quantities[line.variantId] ?? 0,
    }));

  const totalQuantity = selectedLines.reduce(
    (total, line) =>
      total + line.orderedQuantity,
    0,
  );

  const totalValue = selectedLines.reduce(
    (total, line) =>
      total +
      line.orderedQuantity * line.purchasePrice,
    0,
  );

  function setQuantity(
    variantId: string,
    value: string,
  ) {
    setQuantities((current) => ({
      ...current,
      [variantId]: Math.max(
        0,
        Number.parseInt(value || "0", 10) || 0,
      ),
    }));
  }

  async function handleSave() {
    if (savingRef.current) {
      return;
    }

    setError("");

    const supplier = suppliers.find(
      (item) => item.id === supplierId,
    );

    if (!supplier) {
      setError("Selecteer een leverancier.");
      return;
    }

    if (!collectionCode) {
      setError("Selecteer een collectie.");
      return;
    }

    if (selectedLines.length === 0) {
      setError(
        "Vul bij minimaal één variant een bestelaantal in.",
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);

    try {
      const response =
        await fetch(
          "/api/purchase-orders",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              supplierId,
              collectionCode,
              expectedDeliveryDate,
              status,
              notes,
              lines: selectedLines.map(
                (line) => ({
                  variantId:
                    line.variantId,
                  orderedQuantity:
                    line.orderedQuantity,
                  purchasePrice:
                    line.purchasePrice,
                }),
              ),
            }),
          },
        );

      const order =
        await response.json().catch(() => ({}));

      if (!response.ok || !order.id) {
        throw new Error(
          order.error ||
            "Inkooporder maken mislukt.",
        );
      }

      // De knop blijft uitgeschakeld tot de navigatie klaar is.
      router.push(`/inkoop/${order.id}`);
    } catch (cause) {
      savingRef.current = false;
      setSaving(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "Inkooporder maken mislukt.",
      );
    }
  }

  return (
    <div>
      <div className={styles.breadcrumb}>
        <Link href="/inkoop">Inkooporders</Link>
        <span>›</span>
        <span>Nieuwe inkooporder</span>
      </div>

      <PageHeader
        eyebrow="Inkoop"
        title="Nieuwe inkooporder"
        description="Selecteer een leverancier en vul bestelaantallen per maat en kleur in."
      />

      <section className={styles.layout}>
        <div className={styles.mainColumn}>
          <article className="content-card">
            <div className="content-card-header">
              <div>
                <h2 className="content-card-title">
                  Ordergegevens
                </h2>
              </div>
            </div>

            <div className={styles.formGrid}>
              <label>
                <span>Leverancier</span>
                <select
                  value={supplierId}
                  onChange={(event) => {
                    console.log(
                      "SUPPLIER SELECT CHANGE",
                      event.target.value,
                    );
                    setSupplierId(
                      event.target.value,
                    );
                  }}
                >
                  {suppliers.map((supplier) => (
                    <option
                      key={supplier.id}
                      value={supplier.id}
                    >
                      {supplier.companyName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Collectie</span>
                <select
                  value={collectionCode}
                  onChange={(event) =>
                    setCollectionCode(
                      event.target.value,
                    )
                  }
                >
                  {collections.map((collection) => (
                    <option key={collection}>
                      {collection}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Verwachte leverdatum</span>
                <input
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(event) =>
                    setExpectedDeliveryDate(
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                <span>Status</span>
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(
                      event.target
                        .value as PurchaseOrderStatus,
                    )
                  }
                >
                  <option>Concept</option>
                  <option>Besteld</option>
                </select>
              </label>

              <label className={styles.fullWidth}>
                <span>Interne notitie</span>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(event) =>
                    setNotes(event.target.value)
                  }
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
                  placeholder="Zoek op artikel, code of SKU..."
                />
              </div>
            </div>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Artikel</th>
                    <th>Kleur</th>

                    {groupedLines[0]?.sizes.map((size) => (
                      <th
                        key={size}
                        className="table-number"
                      >
                        {size}
                      </th>
                    ))}

                    <th className="table-number">
                      Inkoopprijs
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {groupedLines.map((group) => (
                    <tr key={`${group.productId}-${group.color}`}>
                      <td className="table-primary">
                        {group.productName}
                      </td>

                      <td>{group.color}</td>

                      {group.sizes.map((size) => {
                        const variant =
                          group.variants.find(
                            (item) =>
                              item.size === size,
                          );

                        if (!variant) {
                          return (
                            <td
                              key={size}
                              className="table-number"
                            >
                              <input
                                className={styles.quantityInput}
                                type="number"
                                min="0"
                                disabled
                                value=""
                                placeholder="-"
                              />
                            </td>
                          );
                        }

                        return (
                          <td
                            key={variant.variantId}
                            className="table-number"
                          >
                            <input
                              className={styles.quantityInput}
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
                            />
                          </td>
                        );
                      })}

                      <td className="table-number">
                        €{" "}
                        {group.variants[0].purchasePrice.toLocaleString(
                          "nl-NL",
                          {
                            minimumFractionDigits: 2,
                          },
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <aside className={styles.sideColumn}>
          <article className="content-card">
            <div className="content-card-header">
              <div>
                <h2 className="content-card-title">
                  Ordersamenvatting
                </h2>
              </div>
            </div>

            <dl className={styles.summaryList}>
              <div>
                <dt>Orderregels</dt>
                <dd>{selectedLines.length}</dd>
              </div>
              <div>
                <dt>Totaal aantal</dt>
                <dd>{totalQuantity}</dd>
              </div>
              <div>
                <dt>Inkoopwaarde</dt>
                <dd>
                  €{" "}
                  {totalValue.toLocaleString(
                    "nl-NL",
                    {
                      minimumFractionDigits: 2,
                    },
                  )}
                </dd>
              </div>
            </dl>
          </article>
        </aside>
      </section>

      {error && (
        <div className={styles.error}>{error}</div>
      )}

      <div className={styles.actions}>
        <Link
          href="/inkoop"
          className="button button-secondary"
        >
          Annuleren
        </Link>

        <button
          className="button button-primary"
          type="button"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Inkooporder opslaan..." : "Inkooporder opslaan"}
        </button>
      </div>
    </div>
  );
}
