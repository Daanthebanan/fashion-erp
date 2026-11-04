"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArticlePropertiesDrawer } from "@/components/articles/article-properties-drawer";
import {
  ArticlesBulkDrawer,
  type ArticlesBulkChanges,
} from "@/components/articles/articles-bulk-drawer";
import {
  ArticlesGridToolbar,
  type ArticleColumnKey,
  type ArticleSortKey,
  type SortDirection,
} from "@/components/articles/articles-grid-toolbar";
import { BulkActionToolbar } from "@/components/articles/bulk-action-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  deleteProduct,
  fetchProducts,
  getProductStock,
  getVariantKey,
  setProductStatus,
  updateProduct,
  type Product,
  type ProductInput,
  type ProductStatus,
} from "@/lib/articles";
import { getArticleHistoryCheck } from "@/lib/article-history";
import { getCollections, subscribeToMasterData } from "@/lib/master-data";

type StatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

const defaultVisibleColumns: ArticleColumnKey[] = [
  "code",
  "name",
  "collection",
  "garmentType",
  "material",
  "fit",
  "stock",
  "wholesalePrice",
  "status",
];

function getStatusTone(
  status: ProductStatus,
): StatusTone {
  if (status === "Actief") {
    return "success";
  }

  if (status === "Concept") {
    return "info";
  }

  return "neutral";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function productToInput(
  product: Product,
): ProductInput {
  return {
    code: product.code,
    name: product.name,
    collection: product.collection,
    category: product.category,
    supplier: product.supplier,
    supplierId: product.supplierId,
    supplierProductCode:
      product.supplierProductCode,
    status: product.status,
    vatCode: product.vatCode,
    brand: product.brand,
    material: product.material,
    garmentType: product.garmentType,
    fit: product.fit,
    colorFamily: product.colorFamily,
    seasonType: product.seasonType,
    countryOfOrigin: product.countryOfOrigin,
    description: product.description,
    purchasePrice: product.purchasePrice,
    wholesalePrice: product.wholesalePrice,
    shippingCosts: product.shippingCosts,
    otherCosts: product.otherCosts,
    totalCost: product.totalCost,
    brandMarkup: product.brandMarkup,
    recommendedRetailPrice:
      product.recommendedRetailPrice,
    retailerMarkup: product.retailerMarkup,
    colors: [...product.colors],
    sizes: [...product.sizes],
    stockByVariant: Object.fromEntries(
      product.variants.map((variant) => [
        getVariantKey(
          variant.color,
          variant.size,
        ),
        variant.physicalStock,
      ]),
    ),
  };
}

function getSortValue(
  product: Product,
  sortKey: ArticleSortKey,
): string | number {
  if (sortKey === "stock") {
    return getProductStock(product);
  }

  if (sortKey === "wholesalePrice") {
    return product.wholesalePrice;
  }

  if (sortKey === "garmentType") {
    return (
      product.garmentType ||
      product.category ||
      ""
    );
  }

  return String(product[sortKey] ?? "");
}

export default function ArtikelenPage() {
  const router = useRouter();
  const [products, setProducts] = useState<
    Product[]
  >([]);
  const [isLoaded, setIsLoaded] =
    useState(false);
  const [search, setSearch] = useState("");
  const [collection, setCollection] =
    useState("Alle collecties");
  const [status, setStatus] =
    useState("Actief");
  const [message, setMessage] =
    useState("");
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] =
    useState<string[]>([]);
  const [
    propertiesProduct,
    setPropertiesProduct,
  ] = useState<Product | null>(null);
  const [bulkDrawerOpen, setBulkDrawerOpen] =
    useState(false);
  const [sortKey, setSortKey] =
    useState<ArticleSortKey>("code");
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("ascending");
  const [
    visibleColumns,
    setVisibleColumns,
  ] = useState<ArticleColumnKey[]>(
    defaultVisibleColumns,
  );

  const selectAllRef =
    useRef<HTMLInputElement>(null);

  async function reload() {
    try {
      setError("");
      setProducts(await fetchProducts());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Artikelen laden is mislukt.",
      );
    } finally {
      setIsLoaded(true);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();

    const unsubscribe = subscribeToMasterData(() => {
      void reload();
    });

    return unsubscribe;
  }, []);

  const collections = useMemo(
    () => [
      "Alle collecties",
      ...new Set(
        products
          .map((product) => product.collection)
          .filter(Boolean),
      ),
    ],
    [products],
  );

  // Ook collecties zonder artikelen (bijv. een net aangemaakte HS27)
  // moeten kiesbaar zijn bij bulkbewerken.
  const bulkCollections = useMemo(
    () => [
      ...new Set([
        ...getCollections()
          .filter((item) => item.status !== "Gearchiveerd")
          .map((item) => item.code),
        ...collections.filter(
          (item) => item !== "Alle collecties",
        ),
      ]),
    ],
    [collections],
  );

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search
      .trim()
      .toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        !normalizedSearch ||
        [
          product.name,
          product.code,
          product.supplier,
          product.supplierProductCode,
          product.category,
          product.garmentType,
          product.material,
          product.fit,
          product.colorFamily,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesCollection =
        collection === "Alle collecties" ||
        product.collection === collection;

      const matchesStatus =
        status === "Alle statussen" ||
        product.status === status;

      return (
        matchesSearch &&
        matchesCollection &&
        matchesStatus
      );
    });
  }, [
    products,
    search,
    collection,
    status,
  ]);

  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort(
      (leftProduct, rightProduct) => {
        const leftValue = getSortValue(
          leftProduct,
          sortKey,
        );
        const rightValue = getSortValue(
          rightProduct,
          sortKey,
        );

        let comparison = 0;

        if (
          typeof leftValue === "number" &&
          typeof rightValue === "number"
        ) {
          comparison = leftValue - rightValue;
        } else {
          comparison = String(
            leftValue,
          ).localeCompare(
            String(rightValue),
            "nl-NL",
            {
              numeric: true,
              sensitivity: "base",
            },
          );
        }

        return sortDirection === "ascending"
          ? comparison
          : comparison * -1;
      },
    );
  }, [
    filteredProducts,
    sortKey,
    sortDirection,
  ]);

  const visibleProductIds = useMemo(
    () =>
      sortedProducts.map(
        (product) => product.id,
      ),
    [sortedProducts],
  );

  const selectedProducts = useMemo(
    () =>
      products.filter((product) =>
        selectedIds.includes(product.id),
      ),
    [products, selectedIds],
  );

  const visibleSelectedCount =
    visibleProductIds.filter((id) =>
      selectedIds.includes(id),
    ).length;

  const allVisibleSelected =
    visibleProductIds.length > 0 &&
    visibleSelectedCount ===
      visibleProductIds.length;

  const someVisibleSelected =
    visibleSelectedCount > 0 &&
    !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        someVisibleSelected;
    }
  }, [someVisibleSelected]);

  function isColumnVisible(
    column: ArticleColumnKey,
  ) {
    return visibleColumns.includes(column);
  }

  function toggleProductSelection(
    productId: string,
  ) {
    setSelectedIds((current) =>
      current.includes(productId)
        ? current.filter(
            (id) => id !== productId,
          )
        : [...current, productId],
    );
  }

  function toggleAllVisibleProducts() {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        return current.filter(
          (id) =>
            !visibleProductIds.includes(id),
        );
      }

      return Array.from(
        new Set([
          ...current,
          ...visibleProductIds,
        ]),
      );
    });
  }

  async function archiveSelectedProducts() {
    try {
      setMessage("");
      setError("");

      await Promise.all(
        selectedProducts.map((product) =>
          setProductStatus(
            product.id,
            "Inactief",
          ),
        ),
      );

      await reload();
      setSelectedIds([]);
      setMessage(
        "Geselecteerde artikelen gearchiveerd.",
      );
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "Artikelen archiveren is mislukt.",
      );
    }
  }

  async function saveBulkChanges(
    changes: ArticlesBulkChanges,
  ) {
    if (selectedProducts.length === 0) {
      setBulkDrawerOpen(false);
      return;
    }

    try {
      setMessage("");
      setError("");

      await Promise.all(
        selectedProducts.map((product) => {
          const input = productToInput(product);

          return updateProduct(product.id, {
            ...input,
            ...changes,
          });
        }),
      );

      await reload();
      setBulkDrawerOpen(false);
      setSelectedIds([]);
      setMessage(
        `${selectedProducts.length} artikel(en) bijgewerkt.`,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Bulk wijzigen is mislukt.",
      );
    }
  }

  async function deleteSelectedProducts() {
    const blocked = selectedProducts.filter(
      (product) =>
        !getArticleHistoryCheck(product.id)
          .canDelete,
    );

    const deletable =
      selectedProducts.filter(
        (product) =>
          getArticleHistoryCheck(product.id)
            .canDelete,
      );

    if (deletable.length === 0) {
      setMessage("");
      setError(
        "Geen van de geselecteerde artikelen kan definitief worden verwijderd, omdat ze al in documenten zijn gebruikt.",
      );
      return;
    }

    const confirmed = window.confirm(
      `${deletable.length} artikel(en) definitief verwijderen? Dit kan niet ongedaan worden gemaakt.${
        blocked.length
          ? `\n\n${blocked.length} gebruikt(e) artikel(en) worden overgeslagen.`
          : ""
      }`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setMessage("");
      setError("");

      await Promise.all(
        deletable.map((product) =>
          deleteProduct(product.id),
        ),
      );

      await reload();
      setSelectedIds([]);

      setError(
        blocked.length
          ? `${blocked.length} gebruikt(e) artikel(en) konden niet worden verwijderd.`
          : "",
      );

      setMessage(
        `${deletable.length} artikel(en) definitief verwijderd.`,
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Artikelen verwijderen is mislukt.",
      );
    }
  }

  function exportSelectedProducts() {
    const rows = selectedProducts.map(
      (product) => [
        product.code,
        product.name,
        product.collection,
        product.brand,
        product.wholesalePrice,
        product.status,
      ],
    );

    const csv = [
      [
        "Artikelcode",
        "Artikel",
        "Collectie",
        "Merk",
        "Wholesaleprijs",
        "Status",
      ],
      ...rows,
    ]
      .map((row) =>
        row
          .map(
            (value) =>
              `"${String(value).replace(
                /"/g,
                '""',
              )}"`,
          )
          .join(","),
      )
      .join("\n");

    const blob = new Blob(
      [`\uFEFF${csv}`],
      {
        type: "text/csv;charset=utf-8",
      },
    );

    const url =
      URL.createObjectURL(blob);
    const anchor =
      document.createElement("a");

    anchor.href = url;
    anchor.download =
      "stitch-artikelen.csv";
    anchor.click();

    URL.revokeObjectURL(url);
  }

  const totalStock = products.reduce(
    (total, product) =>
      total + getProductStock(product),
    0,
  );

  function resetFilters() {
    setSearch("");
    setCollection("Alle collecties");
    setStatus("Actief");
  }

  async function archiveProduct(
    product: Product,
  ) {
    try {
      setMessage("");
      setError("");

      await setProductStatus(
        product.id,
        product.status === "Inactief"
          ? "Actief"
          : "Inactief",
      );

      await reload();

      setMessage(
        product.status === "Inactief"
          ? "Artikel opnieuw geactiveerd."
          : "Artikel gearchiveerd.",
      );
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "Artikelstatus wijzigen is mislukt.",
      );
    }
  }

  async function removeProduct(
    product: Product,
  ) {
    const history =
      getArticleHistoryCheck(product.id);

    if (!history.canDelete) {
      setMessage("");
      setError(history.message);
      return;
    }

    const confirmed = window.confirm(
      `Artikel ${product.code} · ${product.name} definitief verwijderen?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setMessage("");
      setError("");

      await deleteProduct(product.id);
      await reload();

      if (
        propertiesProduct?.id === product.id
      ) {
        setPropertiesProduct(null);
      }

      setMessage("Artikel verwijderd.");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Artikel verwijderen is mislukt.",
      );
    }
  }

  async function saveProductProperties(
    productId: string,
    input: ProductInput,
  ) {
    try {
      setMessage("");
      setError("");

      await updateProduct(productId, input);
      await reload();

      setPropertiesProduct(null);
      setMessage(
        "Artikeleigenschappen opgeslagen.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Artikeleigenschappen opslaan is mislukt.",
      );
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Assortiment"
        title="Artikelen"
        description="Beheer artikelen, Product DNA, prijzen, varianten en voorraad."
        action={
          <Link
            href="/artikelen/nieuw"
            className="button button-primary"
          >
            + Nieuw artikel
          </Link>
        }
      />

      {message && (
        <div className="master-data-success">
          ✓ {message}
        </div>
      )}

      {error && (
        <div className="master-data-error">
          ! {error}
        </div>
      )}

      <section className="article-summary-grid">
        <article className="metric-card">
          <div className="metric-label">
            Totaal artikelen
          </div>
          <div className="metric-value">
            {isLoaded
              ? products.length
              : "—"}
          </div>
          <div className="metric-detail">
            inclusief gearchiveerd
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Actieve artikelen
          </div>
          <div className="metric-value">
            {isLoaded
              ? products.filter(
                  (product) =>
                    product.status ===
                    "Actief",
                ).length
              : "—"}
          </div>
          <div className="metric-detail">
            beschikbaar voor verkoop
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Totale voorraad
          </div>
          <div className="metric-value">
            {isLoaded
              ? totalStock
              : "—"}
          </div>
          <div className="metric-detail">
            stuks over alle varianten
          </div>
        </article>
      </section>

      <section className="content-card">
        <div className="content-card-toolbar article-toolbar">
          <div className="table-search">
            <span>⌕</span>
            <input
              type="search"
              placeholder="Zoek op artikel, DNA-kenmerk of leverancier..."
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value,
                )
              }
            />
          </div>

          <div className="article-filters">
            <select
              className="article-filter-select"
              value={collection}
              onChange={(event) =>
                setCollection(
                  event.target.value,
                )
              }
            >
              {collections.map(
                (item) => (
                  <option
                    key={item}
                    value={item}
                  >
                    {item}
                  </option>
                ),
              )}
            </select>

            <select
              className="article-filter-select"
              value={status}
              onChange={(event) =>
                setStatus(
                  event.target.value,
                )
              }
            >
              <option value="Actief">
                Actief
              </option>
              <option value="Concept">
                Concept
              </option>
              <option value="Inactief">
                Gearchiveerd
              </option>
              <option value="Alle statussen">
                Alles
              </option>
            </select>
          </div>
        </div>

        <div className="article-results-bar">
          <span>
            <strong>
              {sortedProducts.length}
            </strong>{" "}
            {sortedProducts.length === 1
              ? "artikel"
              : "artikelen"}
          </span>

          {(search ||
            collection !==
              "Alle collecties" ||
            status !== "Actief") && (
            <button
              className="text-button"
              type="button"
              onClick={resetFilters}
            >
              Filters wissen
            </button>
          )}
        </div>

        <ArticlesGridToolbar
          sortKey={sortKey}
          sortDirection={sortDirection}
          visibleColumns={visibleColumns}
          onSortKeyChange={setSortKey}
          onSortDirectionChange={
            setSortDirection
          }
          onVisibleColumnsChange={
            setVisibleColumns
          }
        />

        <BulkActionToolbar
          selectedCount={
            selectedIds.length
          }
          onOpen={() => {
            const product = selectedProducts[0];

            if (product) {
              router.push(`/artikelen/${product.id}`);
            }
          }}
          onEdit={() =>
            setBulkDrawerOpen(true)
          }
          onExport={
            exportSelectedProducts
          }
          onArchive={() => {
            void archiveSelectedProducts();
          }}
          onDelete={() => {
            void deleteSelectedProducts();
          }}
          onClear={() =>
            setSelectedIds([])
          }
        />

        <div className="table-wrapper">
          <table className="data-table article-table">
            <thead>
              <tr>
                <th
                  style={{
                    width: 42,
                    textAlign: "center",
                  }}
                >
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={
                      allVisibleSelected
                    }
                    onChange={
                      toggleAllVisibleProducts
                    }
                    aria-label="Alle zichtbare artikelen selecteren"
                  />
                </th>

                {isColumnVisible("code") && (
                  <th>Artikelcode</th>
                )}

                {isColumnVisible("name") && (
                  <th>Artikel</th>
                )}

                <th>Maten</th>

                {isColumnVisible(
                  "collection",
                ) && <th>Collectie</th>}

                {isColumnVisible(
                  "garmentType",
                ) && <th>Type</th>}

                {isColumnVisible(
                  "material",
                ) && <th>Materiaal</th>}

                {isColumnVisible("fit") && (
                  <th>Pasvorm</th>
                )}

                {isColumnVisible("stock") && (
                  <th className="table-number">
                    Voorraad
                  </th>
                )}

                {isColumnVisible(
                  "wholesalePrice",
                ) && (
                  <th className="table-number">
                    Wholesaleprijs
                  </th>
                )}

                {isColumnVisible("status") && (
                  <th>Status</th>
                )}

                <th />
              </tr>
            </thead>

            <tbody>
              {sortedProducts.map(
                (product) => {
                  const isSelected =
                    selectedIds.includes(
                      product.id,
                    );

                  return (
                    <tr
                      key={product.id}
                      style={{
                        background:
                          isSelected
                            ? "#f2f7fc"
                            : undefined,
                      }}
                    >
                      <td
                        style={{
                          textAlign:
                            "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={
                            isSelected
                          }
                          onChange={() =>
                            toggleProductSelection(
                              product.id,
                            )
                          }
                          aria-label={`${product.code} selecteren`}
                        />
                      </td>

                      {isColumnVisible(
                        "code",
                      ) && (
                        <td>
                          <Link
                            href={`/artikelen/${product.id}`}
                            className="table-link"
                          >
                            {product.code}
                          </Link>
                        </td>
                      )}

                      {isColumnVisible(
                        "name",
                      ) && (
                        <td className="table-primary">
                          <Link
                            href={`/artikelen/${product.id}`}
                            className="table-link"
                          >
                            {product.name}
                          </Link>

                          {product.supplierProductCode && (
                            <div
                              style={{
                                fontSize: 12,
                                color:
                                  "#6b7280",
                                marginTop: 3,
                              }}
                            >
                              Leverancier:{" "}
                              {
                                product.supplierProductCode
                              }
                            </div>
                          )}
                        </td>
                      )}

                      <td
                        style={{
                          whiteSpace:
                            "nowrap",
                        }}
                      >
                        {product.sizes.join(
                          " · ",
                        ) || "—"}
                      </td>

                      {isColumnVisible(
                        "collection",
                      ) && (
                        <td>
                          {product.collection ||
                            "—"}
                        </td>
                      )}

                      {isColumnVisible(
                        "garmentType",
                      ) && (
                        <td>
                          {product.garmentType ||
                            product.category ||
                            "—"}
                        </td>
                      )}

                      {isColumnVisible(
                        "material",
                      ) && (
                        <td>
                          {product.material ||
                            "—"}
                        </td>
                      )}

                      {isColumnVisible(
                        "fit",
                      ) && (
                        <td>
                          {product.fit || "—"}
                        </td>
                      )}

                      {isColumnVisible(
                        "stock",
                      ) && (
                        <td
                          className={`table-number table-primary ${
                            getProductStock(
                              product,
                            ) <= 10
                              ? "stock-warning"
                              : ""
                          }`}
                        >
                          {getProductStock(
                            product,
                          )}
                        </td>
                      )}

                      {isColumnVisible(
                        "wholesalePrice",
                      ) && (
                        <td className="table-number table-primary">
                          {formatCurrency(
                            product.wholesalePrice,
                          )}
                        </td>
                      )}

                      {isColumnVisible(
                        "status",
                      ) && (
                        <td>
                          <StatusBadge
                            label={
                              product.status ===
                              "Inactief"
                                ? "Gearchiveerd"
                                : product.status
                            }
                            tone={getStatusTone(
                              product.status,
                            )}
                          />
                        </td>
                      )}

                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>

        {isLoaded &&
          sortedProducts.length === 0 && (
            <div className="article-empty-state">
              <h2>
                Geen artikelen gevonden
              </h2>
              <p>
                Pas je zoekterm of filters
                aan.
              </p>
            </div>
          )}
      </section>

      <ArticlePropertiesDrawer
        product={propertiesProduct}
        onClose={() =>
          setPropertiesProduct(null)
        }
        onSave={(productId, input) => {
          void saveProductProperties(
            productId,
            input,
          );
        }}
      />

      <ArticlesBulkDrawer
        open={bulkDrawerOpen}
        selectedCount={
          selectedProducts.length
        }
        collections={bulkCollections}
        onClose={() =>
          setBulkDrawerOpen(false)
        }
        onSave={(changes) => {
          void saveBulkChanges(changes);
        }}
      />
    </div>
  );
}