"use client";

import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getStoredProducts,
  getVariantKey,
  type Product,
  type ProductInput,
  type ProductStatus,
} from "@/lib/articles";
import {
  calculatePricingV2,
  defaultPricingLocks,
  type PricingLocks,
  type PricingStrategy,
} from "@/lib/pricing-engine";
import {
  PricingCalculator,
  type PricingCalculatorValue,
} from "@/components/pricing/PricingCalculator";
import {
  articleVatCodes,
  type VatCode,
} from "@/lib/vat-engine";
import { getCompanySettings } from "@/lib/company-settings";
import {
  getAvailableEans,
  isEanSelectable,
} from "@/lib/ean-center";
import {
  getCategories,
  getCollections,
  getColors,
  getSizes,
  type NamedMasterData,
} from "@/lib/master-data";
import { fetchSuppliers, type Supplier } from "@/lib/suppliers";
import {
  validateImportMasterData,
  formatMasterDataErrors,
} from "@/lib/import-validation";
import styles from "./article-form.module.css";

type EanAssignmentMode = "AUTO" | "MANUAL" | "NONE";

type ArticleFormProps = {
  initialProduct?: Product;
  submitLabel: string;
  onSubmit: (input: ProductInput) => void;
};

/*
 * Imports zonder producttype of collectie zetten daar de vulwaarden "XX" en
 * "XXXX" neer. Die staan niet in Stamgegevens, dus bij bewerken laten we ze leeg
 * in plaats van het opslaan te blokkeren met een melding over ontbrekende stamgegevens.
 */
const IMPORT_PLACEHOLDERS = new Set(["XX", "XXXX"]);

function withoutPlaceholder(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return IMPORT_PLACEHOLDERS.has(trimmed.toUpperCase()) ? "" : trimmed;
}

export function ArticleForm({
  initialProduct,
  submitLabel,
  onSubmit,
}: ArticleFormProps) {
  const [collections, setCollections] = useState<
    string[]
  >([]);
  const [categories, setCategories] = useState<
    string[]
  >([]);
  const [suppliers, setSuppliers] = useState<
    Supplier[]
  >([]);
  const [colorOptions, setColorOptions] = useState<
    NamedMasterData[]
  >([]);
  const [sizeOptions, setSizeOptions] = useState<
    NamedMasterData[]
  >([]);

  const [code, setCode] = useState(
    initialProduct?.code ?? "",
  );
  const [name, setName] = useState(
    initialProduct?.name ?? "",
  );
  const [collection, setCollection] = useState(
    withoutPlaceholder(initialProduct?.collection),
  );
  const [category, setCategory] = useState(
    withoutPlaceholder(initialProduct?.category),
  );
  const [supplierId, setSupplierId] = useState(
    initialProduct?.supplierId ?? "",
  );
  const [supplierProductCode, setSupplierProductCode] = useState(
    initialProduct?.supplierProductCode ?? "",
  );
  const [status, setStatus] =
    useState<ProductStatus>(
      initialProduct?.status ?? "Concept",
    );
  const [vatCode, setVatCode] =
    useState<VatCode>(
      initialProduct?.vatCode ?? "2V",
    );

  const [brand, setBrand] = useState(
    initialProduct?.brand ?? "Demo Fashion",
  );
  const [material, setMaterial] = useState(
    initialProduct?.material ?? "",
  );
  const [garmentType, setGarmentType] = useState(
    withoutPlaceholder(initialProduct?.garmentType),
  );
  const [fit, setFit] = useState(
    initialProduct?.fit ?? "",
  );
  const [colorFamily, setColorFamily] = useState(
    initialProduct?.colorFamily ?? "",
  );
  const [seasonType, setSeasonType] = useState<
    "Doorlopend" | "Voorjaar/Zomer" | "Herfst/Winter"
  >(
    initialProduct?.seasonType ?? "Doorlopend",
  );

  const [countryOfOrigin, setCountryOfOrigin] =
    useState(
      initialProduct?.countryOfOrigin ?? "",
    );
  const [description, setDescription] =
    useState(initialProduct?.description ?? "");

  const [purchasePrice, setPurchasePrice] =
    useState(
      initialProduct
        ? String(initialProduct.purchasePrice).replace(
            ".",
            ",",
          )
        : "",
    );

  const settings = useMemo(() => getCompanySettings(), []);

  const [pricingStrategy, setPricingStrategy] =
    useState<PricingStrategy>(
      initialProduct?.pricingStrategy ?? "automatic",
    );
  const [pricingLocks, setPricingLocks] =
    useState<PricingLocks>({
      ...defaultPricingLocks,
      ...initialProduct?.pricingLocks,
    });

  const [shippingCosts, setShippingCosts] = useState(
    initialProduct
      ? String(initialProduct.shippingCosts ?? 0).replace(".", ",")
      : "",
  );
  const [otherCosts, setOtherCosts] = useState(
    initialProduct
      ? String(initialProduct.otherCosts ?? 0).replace(".", ",")
      : "",
  );
  const [brandMarkup, setBrandMarkup] = useState(
    String(
      initialProduct?.brandMarkup ||
        settings.pricing.brandMarkup,
    ).replace(".", ","),
  );
  const [salesPrice, setSalesPrice] = useState(
    initialProduct
      ? String(initialProduct.wholesalePrice).replace(".", ",")
      : "",
  );
  const [retailerMarkup, setRetailerMarkup] = useState(
    String(
      initialProduct?.retailerMarkup ||
        settings.pricing.retailerMarkup,
    ).replace(".", ","),
  );
  const [
    recommendedRetailPrice,
    setRecommendedRetailPrice,
  ] = useState(
    initialProduct
      ? String(
          initialProduct.recommendedRetailPrice ?? 0,
        ).replace(".", ",")
      : "",
  );

  function parseNumber(value: string) {
    return Number(value.replace(",", ".")) || 0;
  }

  const pricing = useMemo(
    () =>
      calculatePricingV2(
        {
          supplierPurchasePrice: parseNumber(purchasePrice),
          shippingCosts: parseNumber(shippingCosts),
          otherCosts: parseNumber(otherCosts),
          brandMarkup: parseNumber(brandMarkup),
          salesPrice: parseNumber(salesPrice),
          retailerMarkup: parseNumber(retailerMarkup),
          recommendedRetailPrice: parseNumber(recommendedRetailPrice),
          strategy: pricingStrategy,
          locks: pricingLocks,
          changedField: null,
        },
        settings.pricing,
      ),
    [
      purchasePrice,
      shippingCosts,
      otherCosts,
      brandMarkup,
      salesPrice,
      retailerMarkup,
      recommendedRetailPrice,
      pricingStrategy,
      pricingLocks,
      settings.pricing,
    ],
  );

  const pricingCalculatorValue: PricingCalculatorValue = {
    supplierPurchasePrice: purchasePrice,
    shippingCosts,
    otherCosts,
    brandMarkup,
    salesPrice,
    retailerMarkup,
    recommendedRetailPrice,
    pricingStrategy,
    pricingLocks,
  };

  function updatePricingCalculator(next: PricingCalculatorValue) {
    setPurchasePrice(next.supplierPurchasePrice);
    setShippingCosts(next.shippingCosts);
    setOtherCosts(next.otherCosts);
    setBrandMarkup(next.brandMarkup);
    setSalesPrice(next.salesPrice);
    setRetailerMarkup(next.retailerMarkup);
    setRecommendedRetailPrice(next.recommendedRetailPrice);
    setPricingStrategy(next.pricingStrategy);
    setPricingLocks(next.pricingLocks);
  }

  const [selectedColors, setSelectedColors] =
    useState<string[]>(
      initialProduct?.colors
        ? [...new Set(initialProduct.colors)]
        : [],
    );


  useEffect(() => {
    if (initialProduct?.colors) {
      setSelectedColors(
        [...new Set(initialProduct.colors)],
      );
    }
  }, [initialProduct]);

  const [selectedSizes, setSelectedSizes] =
    useState<string[]>(
      initialProduct?.sizes ?? [],
    );

  const [stockByVariant, setStockByVariant] =
    useState<Record<string, number>>(() => {
      if (!initialProduct) {
        return {};
      }

      return Object.fromEntries(
        initialProduct.variants.map((variant) => [
          getVariantKey(
            variant.color,
            variant.size,
          ),
          variant.physicalStock,
        ]),
      );
    });

  const [eanMode, setEanMode] =
    useState<EanAssignmentMode>(() =>
      initialProduct?.variants.some((variant) => variant.ean)
        ? "MANUAL"
        : "NONE",
    );
  const [eanByVariant, setEanByVariant] =
    useState<Record<string, string>>(() =>
      Object.fromEntries(
        (initialProduct?.variants ?? [])
          .filter((variant) => variant.ean)
          .map((variant) => [
            getVariantKey(variant.color, variant.size),
            variant.ean ?? "",
          ]),
      ),
    );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const collectionValues = getCollections()
      .filter((item) => item.status !== "Gearchiveerd")
      .map((item) => item.code);

    const categoryValues = getCategories()
      .filter((item) => item.isActive)
      .map((item) => item.name);

    const activeColors = getColors().filter(
      (item) => item.isActive,
    );

    // Kleuren die al op een bestaand artikel staan, blijven zichtbaar,
    // ook wanneer ze niet (meer) als actieve stamkleur beschikbaar zijn.
    // Zo kan een opgeslagen artikelkleur niet stilzwijgend verdwijnen.
    const existingColors = initialProduct?.colors ?? [];
    const existingColorOptions = existingColors
      .filter(
        (existingColor) =>
          !activeColors.some(
            (activeColor) =>
              activeColor.name
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "") ===
              existingColor
                .toLowerCase()
                .replace(/[^a-z0-9]/g, ""),
          ),
      )
      .map((name, index) => {
        const masterColor = getColors().find(
          (color) =>
            color.name
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "") ===
            name
              .toLowerCase()
              .replace(/[^a-z0-9]/g, ""),
        );

        return {
          id: `existing-color-${index}`,
          code: masterColor?.code ?? "",
          name,
          isActive: true,
        };
      });

    const activeSizes = getSizes().filter(
      (item) => item.isActive,
    );

    setCollections(collectionValues);
    setCategories(categoryValues);
    setColorOptions([
      ...existingColorOptions,
      ...activeColors,
    ]);
    setSizeOptions(activeSizes);

    setCollection(
      (current) =>
        current || collectionValues[0] || "",
    );
    setCategory(
      (current) =>
        current || categoryValues[0] || "",
    );

    async function loadSuppliers() {
      try {
        const cloudSuppliers = await fetchSuppliers();
        if (cancelled) return;

        const activeSuppliers = cloudSuppliers.filter(
          (item) => item.status === "Actief",
        );

        // Een leverancier die al op een bestaand artikel staat, blijft zichtbaar
        // ook wanneer die inmiddels inactief is. Daardoor wordt de opgeslagen
        // koppeling niet stilzwijgend vervangen.
        const currentSupplierId = initialProduct?.supplierId ?? "";
        const currentSupplier = cloudSuppliers.find(
          (item) => item.id === currentSupplierId,
        );

        const supplierOptions =
          currentSupplier &&
          !activeSuppliers.some((item) => item.id === currentSupplier.id)
            ? [currentSupplier, ...activeSuppliers]
            : activeSuppliers;

        setSuppliers(supplierOptions);
      } catch (supplierError) {
        if (cancelled) return;
        setSuppliers([]);
        setError(
          supplierError instanceof Error
            ? supplierError.message
            : "Leveranciers ophalen is mislukt.",
        );
      }
    }

    void loadSuppliers();

    return () => {
      cancelled = true;
    };
  }, [initialProduct]);

  useEffect(() => {
    if (
      error ===
        "Selecteer een collectie, categorie en leverancier." &&
      collection &&
      category &&
      supplierId
    ) {
      setError("");
    }
  }, [collection, category, supplierId, error]);

  const variantRows = useMemo(
    () =>
      [...new Set(selectedColors)].flatMap((color) =>
        selectedSizes.map((size) => ({
          key: getVariantKey(color, size),
          color,
          size,
        })),
      ),
    [selectedColors, selectedSizes],
  );

  function sameColor(
    left: string,
    right: string,
  ) {
    return (
      left
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") ===
      right
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
    );
  }

  function toggleColor(color: string) {
    setSelectedColors((current) =>
      current.includes(color)
        ? current.filter((item) => item !== color)
        : [...new Set([...current, color])],
    );
  }

  function toggleSize(size: string) {
    setSelectedSizes((current) =>
      current.includes(size)
        ? current.filter((item) => item !== size)
        : [...current, size],
    );
  }

  function changeVariantStock(
    key: string,
    value: string,
  ) {
    const parsed = Math.max(
      0,
      Number.parseInt(value || "0", 10) || 0,
    );

    setStockByVariant((current) => ({
      ...current,
      [key]: parsed,
    }));
  }

  function changeVariantEan(key: string, ean: string) {
    setEanByVariant((current) => ({
      ...current,
      [key]: ean,
    }));
  }

  function getManualEanOptions(key: string) {
    const selectedElsewhere = new Set(
      Object.entries(eanByVariant)
        .filter(([variantKey, ean]) => variantKey !== key && ean)
        .map(([, ean]) => ean),
    );

    return getAvailableEans({
      includeAssignedToProductId: initialProduct?.id,
    }).filter((item) => !selectedElsewhere.has(item.ean));
  }

  function buildVariantEans() {
    if (eanMode === "NONE") {
      return Object.fromEntries(variantRows.map((variant) => [variant.key, ""]));
    }

    if (eanMode === "MANUAL") {
      return Object.fromEntries(
        variantRows.map((variant) => [
          variant.key,
          eanByVariant[variant.key] ?? "",
        ]),
      );
    }

    const available = getAvailableEans({
      includeAssignedToProductId: initialProduct?.id,
    });
    const used = new Set<string>();
    const result: Record<string, string> = {};

    for (const variant of variantRows) {
      const existing = eanByVariant[variant.key];
      if (existing && !used.has(existing)) {
        result[variant.key] = existing;
        used.add(existing);
        continue;
      }

      const next = available.find((item) => !used.has(item.ean));
      result[variant.key] = next?.ean ?? "";
      if (next) used.add(next.ean);
    }

    return result;
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (saving) return;

    setError("");
    setSaving(true);

    const normalizedCode = code
      .trim()
      .toUpperCase();

    if (!normalizedCode || !name.trim()) {
      setError(
        "Vul minimaal een artikelcode en artikelnaam in.",
      );
      return;
    }

    if (!collection || !category || !supplierId) {
      setError(
        "Selecteer een collectie, categorie en leverancier.",
      );
      return;
    }

    const selectedSupplier = suppliers.find(
      (item) => item.id === supplierId,
    );

    if (
      selectedColors.length === 0 ||
      selectedSizes.length === 0
    ) {
      setError(
        "Selecteer minimaal één kleur en één maat.",
      );
      return;
    }

    const masterDataValidation = validateImportMasterData({
      brand,
      color: selectedColors[0],
      size: selectedSizes[0],
      category,
      productType: garmentType,
      collection,
    });

    if (!masterDataValidation.valid) {
      setError(
        formatMasterDataErrors(
          masterDataValidation.missing,
        ).join("\n"),
      );
      setSaving(false);
      return;
    }

    const codeExists = getStoredProducts().some(
      (product) =>
        product.id !== initialProduct?.id &&
        product.code.toLowerCase() ===
          normalizedCode.toLowerCase(),
    );

    if (codeExists) {
      setError(
        "Deze artikelcode bestaat al. Gebruik een unieke artikelcode.",
      );
      return;
    }

    const variantEans = buildVariantEans();
    const selectedEans = Object.values(variantEans).filter(Boolean);

    if (new Set(selectedEans).size !== selectedEans.length) {
      setError("Elke variant moet een unieke EAN-code hebben.");
      return;
    }

    if (eanMode === "AUTO" && selectedEans.length < variantRows.length) {
      setError(
        `Er zijn ${variantRows.length} vrije EAN-codes nodig, maar er zijn er slechts ${selectedEans.length} beschikbaar. Importeer eerst extra codes of kies Geen EAN.`,
      );
      return;
    }

    if (
      eanMode === "MANUAL" &&
      selectedEans.some(
        (ean) =>
          !isEanSelectable(ean, {
            currentProductId: initialProduct?.id,
          }),
      )
    ) {
      setError(
        "Een gekozen EAN-code is niet meer vrij. Vernieuw de pagina en kies opnieuw.",
      );
      return;
    }

    try {
      await onSubmit({
      code: normalizedCode,
      name: name.trim(),
      collection,
      category,
      supplier: selectedSupplier?.companyName ?? "",
      supplierId,
      supplierProductCode: supplierProductCode.trim(),
      status,
      vatCode,
      brand: brand.trim(),
      material: material.trim(),
      garmentType: garmentType.trim(),
      fit: fit.trim(),
      colorFamily: colorFamily.trim(),
      seasonType,
      countryOfOrigin:
        countryOfOrigin.trim(),
      description: description.trim(),
      purchasePrice: parseNumber(purchasePrice),
      wholesalePrice: pricing.salesPrice,
      shippingCosts: parseNumber(shippingCosts),
      otherCosts: parseNumber(otherCosts),
      totalCost: pricing.totalCost,
      brandMarkup: pricing.brandMarkup,
      recommendedRetailPrice: pricing.recommendedRetailPrice,
      retailerMarkup: pricing.retailerMarkup,
      pricingStrategy,
      pricingLocks,
      colors: selectedColors,
      sizes: selectedSizes,
      stockByVariant,
      importedVariants: variantRows.map((variant) => {
        const existing = initialProduct?.variants.find(
          (item) =>
            getVariantKey(item.color, item.size) === variant.key,
        );

        return {
          color: variant.color,
          colorCode: existing?.colorCode,
          size: variant.size,
          stock: stockByVariant[variant.key] ?? 0,
          ean: variantEans[variant.key] || undefined,
          id: existing?.id,
          sku: existing?.sku,
        };
      }),
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Opslaan is niet gelukt.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <section className={styles.layout}>
        <div className={styles.mainColumn}>
          <article className="content-card">
            <div className="content-card-header">
              <div>
                <h2 className="content-card-title">
                  Algemene informatie
                </h2>

                <p className="content-card-description">
                  De belangrijkste gegevens van het artikel.
                </p>
              </div>
            </div>

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>
                  Artikelcode
                  <strong>*</strong>
                </span>

                <input
                  type="text"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value)
                  }
                />
              </label>

              <label className={styles.field}>
                <span>
                  Artikelnaam
                  <strong>*</strong>
                </span>

                <input
                  type="text"
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                />
              </label>

              <label className={styles.field}>
                <span>Collectie</span>

                <select
                  value={collection}
                  onChange={(event) =>
                    setCollection(
                      event.target.value,
                    )
                  }
                >
                  {collections.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Categorie</span>

                <select
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value)
                  }
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Leverancier</span>

                <select
                  value={supplierId}
                  onChange={(event) =>
                    setSupplierId(event.target.value)
                  }
                >
                  <option value="">Kies een leverancier</option>
                  {suppliers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.companyName}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Artikelnummer leverancier</span>
                <input
                  value={supplierProductCode}
                  onChange={(event) => setSupplierProductCode(event.target.value)}
                  placeholder="Exact nummer van de fabriek"
                />
              </label>

              <label className={styles.field}>
                <span>Status</span>

                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(
                      event.target
                        .value as ProductStatus,
                    )
                  }
                >
                  <option>Concept</option>
                  <option>Actief</option>
                  <option>Inactief</option>
                </select>
              </label>

              <label className={styles.field}>
                <span>BTW-code verkoop NL</span>

                <select
                  value={vatCode}
                  onChange={(event) =>
                    setVatCode(
                      event.target.value as VatCode,
                    )
                  }
                >
                  {articleVatCodes.map((item) => (
                    <option
                      key={item.code}
                      value={item.code}
                    >
                      {item.code} · {item.description}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Merk</span>

                <input
                  type="text"
                  value={brand}
                  onChange={(event) =>
                    setBrand(event.target.value)
                  }
                />
              </label>

              <label className={styles.field}>
                <span>Land van oorsprong</span>

                <input
                  type="text"
                  value={countryOfOrigin}
                  onChange={(event) =>
                    setCountryOfOrigin(
                      event.target.value,
                    )
                  }
                />
              </label>

              <label
                className={`${styles.field} ${styles.fullWidth}`}
              >
                <span>Materiaal</span>

                <input
                  type="text"
                  value={material}
                  onChange={(event) =>
                    setMaterial(event.target.value)
                  }
                />
              </label>

              <label
                className={`${styles.field} ${styles.fullWidth}`}
              >
                <span>Omschrijving</span>

                <textarea
                  value={description}
                  onChange={(event) =>
                    setDescription(
                      event.target.value,
                    )
                  }
                  rows={4}
                />
              </label>
            </div>
          </article>

          <PricingCalculator
            value={pricingCalculatorValue}
            defaults={settings.pricing}
            onChange={updatePricingCalculator}
          />

          <article className="content-card">
            <div className="content-card-header">
              <div>
                <h2 className="content-card-title">
                  Kleuren
                </h2>

                <p className="content-card-description">
                  Beheer kleuren via Instellingen → Stamgegevens.
                </p>
              </div>
            </div>

            <div className={styles.optionGrid}>
              {colorOptions.map((color) => (
                <label
                  key={color.id}
                  className={`${styles.optionCard} ${
                    selectedColors.some(
                      (selected) =>
                        sameColor(selected, color.name),
                    )
                      ? styles.optionCardSelected
                      : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedColors.some(
                      (selected) =>
                        sameColor(selected, color.name),
                    )}
                    onChange={() =>
                      toggleColor(color.name)
                    }
                  />

                  <span>{color.name}</span>
                </label>
              ))}
            </div>
          </article>

          <article className="content-card">
            <div className="content-card-header">
              <div>
                <h2 className="content-card-title">
                  Maten
                </h2>

                <p className="content-card-description">
                  Beheer maten via Instellingen → Stamgegevens.
                </p>
              </div>
            </div>

            <div className={styles.optionGrid}>
              {sizeOptions.map((size) => (
                <label
                  key={size.id}
                  className={`${styles.optionCard} ${
                    selectedSizes.includes(
                      size.name,
                    )
                      ? styles.optionCardSelected
                      : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedSizes.includes(
                      size.name,
                    )}
                    onChange={() =>
                      toggleSize(size.name)
                    }
                  />

                  <span>{size.name}</span>
                </label>
              ))}
            </div>
          </article>

          <article className="content-card">
            <div className="content-card-header">
              <div>
                <h2 className="content-card-title">
                  Varianten en beginvoorraad
                </h2>

                <p className="content-card-description">
                  Alle maat-kleurcombinaties worden automatisch gegenereerd.
                </p>
              </div>
            </div>

            <div className={styles.eanModeGrid}>
              <label className={`${styles.eanModeCard} ${eanMode === "AUTO" ? styles.eanModeCardSelected : ""}`}>
                <input type="radio" name="eanMode" checked={eanMode === "AUTO"} onChange={() => setEanMode("AUTO")} />
                <span><strong>Automatisch toewijzen</strong><small>STiTch gebruikt de eerstvolgende vrije EAN per variant.</small></span>
              </label>
              <label className={`${styles.eanModeCard} ${eanMode === "MANUAL" ? styles.eanModeCardSelected : ""}`}>
                <input type="radio" name="eanMode" checked={eanMode === "MANUAL"} onChange={() => setEanMode("MANUAL")} />
                <span><strong>Handmatig kiezen</strong><small>Kies per variant een beschikbare EAN-code.</small></span>
              </label>
              <label className={`${styles.eanModeCard} ${eanMode === "NONE" ? styles.eanModeCardSelected : ""}`}>
                <input type="radio" name="eanMode" checked={eanMode === "NONE"} onChange={() => setEanMode("NONE")} />
                <span><strong>Geen EAN</strong><small>Varianten worden zonder EAN opgeslagen. Er verschijnt geen waarschuwing.</small></span>
              </label>
            </div>

            {eanMode === "AUTO" && (
              <div className={styles.eanAvailability}>
                <strong>{getAvailableEans({ includeAssignedToProductId: initialProduct?.id }).length}</strong> vrije EAN-codes voor <strong>{variantRows.length}</strong> varianten
              </div>
            )}

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kleur</th>
                    <th>Maat</th>
                    <th>EAN</th>
                    <th className="table-number">
                      Beginvoorraad
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {variantRows.map((variant) => (
                    <tr key={variant.key}>
                      <td className="table-primary">
                        {variant.color}
                      </td>

                      <td>{variant.size}</td>

                      <td>
                        {eanMode === "NONE" ? (
                          <span className={styles.eanMuted}>Geen EAN</span>
                        ) : eanMode === "AUTO" ? (
                          <span className={styles.eanPreview}>Automatisch</span>
                        ) : (
                          <select
                            className={styles.eanSelect}
                            value={eanByVariant[variant.key] ?? ""}
                            onChange={(event) =>
                              changeVariantEan(variant.key, event.target.value)
                            }
                          >
                            <option value="">Geen EAN</option>
                            {getManualEanOptions(variant.key).map((item) => (
                              <option key={item.ean} value={item.ean}>
                                {item.ean}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>

                      <td className="table-number">
                        <input
                          className={
                            styles.stockInput
                          }
                          type="number"
                          min="0"
                          value={
                            stockByVariant[
                              variant.key
                            ] ?? 0
                          }
                          onChange={(event) =>
                            changeVariantStock(
                              variant.key,
                              event.target.value,
                            )
                          }
                        />
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
                  Samenvatting
                </h2>
              </div>
            </div>

            <dl className={styles.summaryList}>
              <div>
                <dt>Artikel</dt>
                <dd>{name || "—"}</dd>
              </div>
              <div>
                <dt>Collectie</dt>
                <dd>{collection || "—"}</dd>
              </div>
              <div>
                <dt>Kleuren</dt>
                <dd>{selectedColors.length}</dd>
              </div>
              <div>
                <dt>Maten</dt>
                <dd>{selectedSizes.length}</dd>
              </div>
              <div>
                <dt>Varianten</dt>
                <dd>{variantRows.length}</dd>
              </div>
            </dl>
          </article>
        </aside>
      </section>

      {error && (
        <div className={styles.errorMessage}>
          {error}
        </div>
      )}

      <div className={styles.formActions}>
        <Link
          href={
            initialProduct
              ? `/artikelen/${initialProduct.id}`
              : "/artikelen"
          }
          className="button button-secondary"
        >
          Annuleren
        </Link>

        <button
          className="button button-primary"
          type="submit"
          disabled={saving}
        >
          {saving ? "Opslaan…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
