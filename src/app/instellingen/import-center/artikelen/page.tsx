"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { PageHeader } from "@/components/ui/page-header";
import {
  addProduct,
  generateArticleNumber,
  getStoredProducts,
  type ProductInput,
} from "@/lib/articles";
import { getPricingDefaults } from "@/lib/company-settings";
import { calculatePricing } from "@/lib/pricing-engine";
import { resolveColor } from "@/lib/master-data";
import { fetchSuppliers } from "@/lib/suppliers";
import { validateImportMasterData, formatMasterDataErrors } from "@/lib/import-validation";
import { parseCsv, parseXlsx } from "./xlsx-parser";
import styles from "./article-import.module.css";

type Row = Record<string, string | number>;
type Step = 1 | 2 | 3 | 4;
type PreviewStatus = "ready" | "completed" | "error";

type ImportResult = {
  added: number;
  skipped: number;
  completed: number;
  errors: string[];
  completions: Record<string, number>;
};

type PreviewRow = {
  rowNumber: number;
  articleCode: string;
  productName: string;
  collection: string;
  garmentType: string;
  color: string;
  size: string;
  supplier: string;
  ean: string;
  purchasePrice: number;
  status: PreviewStatus;
  errors: string[];
  completions: string[];
};

const fields = [
  [
    "code",
    "Artikelnummer",
    false,
    ["artikelnummer", "artikelcode", "article number", "product code", "sku"],
  ],
  ["productName", "Productnaam", true, ["productnaam", "product name", "naam"]],
  ["brand", "Merk", false, ["merk", "brand"]],
  [
    "collection",
    "Collectie",
    false,
    ["collectie", "collection", "season", "seizoen"],
  ],
  [
    "garmentType",
    "Artikeltype",
    false,
    [
      "artikeltype",
      "product type",
      "garment type",
      "type",
      "categorie",
      "category",
    ],
  ],
  ["color", "Kleur", true, ["kleur", "color", "colour"]],
  ["colorCode", "Kleurcode", false, ["kleurcode", "color code"]],
  ["size", "Maat", true, ["maat", "size"]],
  ["supplier", "Leverancier", false, ["leverancier", "supplier"]],
  [
    "supplierSku",
    "Leveranciersartikelnummer",
    false,
    ["leveranciersartikelnummer", "supplier sku"],
  ],
  [
    "purchasePrice",
    "Inkoopprijs",
    false,
    ["inkoopprijs", "kostprijs", "purchase price", "cost price", "cost"],
  ],
  ["salesPrice", "Verkoopprijs", false, ["verkoopprijs", "sales price"]],
  ["markup", "Markup", false, ["markup", "factor"]],
  ["vat", "BTW-percentage", false, ["btw-percentage", "btw", "vat"]],
  ["ean", "EAN", false, ["ean", "barcode", "gtin"]],
  ["stock", "Voorraad", false, ["voorraad", "stock"]],
  [
    "stockLocation",
    "Voorraadlocatie",
    false,
    ["voorraadlocatie", "location"],
  ],
  ["active", "Actief", false, ["actief", "active", "status"]],
  ["description", "Omschrijving", false, ["omschrijving", "description"]],
  [
    "imageUrl",
    "Afbeeldings-URL",
    false,
    ["afbeeldings-url", "image url", "afbeelding"],
  ],
] as const;

const norm = (value: string) =>
  value
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const text = (
  row: Row,
  mapping: Record<string, string>,
  key: string,
) => String(row[mapping[key]] ?? "").trim();

const normalizeCode = (value: string) => value.trim().toUpperCase();
const normalizeEan = (value: string) => value.replace(/\s+/g, "");

function parseLocalizedNumber(value: string) {
  const raw = value
    .trim()
    .replace(/\s/g, "")
    .replace(/[€$£]/g, "");

  if (!raw) {
    return { value: 0, valid: true };
  }

  const commaIndex = raw.lastIndexOf(",");
  const dotIndex = raw.lastIndexOf(".");
  let normalized = raw;

  if (commaIndex >= 0 && dotIndex >= 0) {
    if (commaIndex > dotIndex) {
      normalized = raw.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = raw.replace(/,/g, "");
    }
  } else if (commaIndex >= 0) {
    const decimals = raw.length - commaIndex - 1;
    normalized =
      decimals === 3 && commaIndex > 0
        ? raw.replace(/,/g, "")
        : raw.replace(",", ".");
  } else if (dotIndex >= 0) {
    const decimals = raw.length - dotIndex - 1;
    normalized =
      decimals === 3 && dotIndex > 0
        ? raw.replace(/\./g, "")
        : raw;
  }

  const parsed = Number(normalized);

  return {
    value: Number.isFinite(parsed) ? parsed : 0,
    valid: Number.isFinite(parsed),
  };
}

function truthy(value: string) {
  return !["nee", "no", "false", "0", "inactief"].includes(norm(value));
}

function incrementCounter(
  current: Record<string, number>,
  key: string,
) {
  current[key] = (current[key] ?? 0) + 1;
}

function buildPreview(
  rows: Row[],
  mapping: Record<string, string>,
): PreviewRow[] {
  const products = getStoredProducts();

  const usedCodes = new Set(
    products.map((product) => normalizeCode(product.code)),
  );

  const usedEans = new Set(
    products.flatMap((product) =>
      product.variants
        .map((variant) => variant.ean)
        .filter((ean): ean is string => Boolean(ean))
        .map(normalizeEan),
    ),
  );

  return rows.map((row, index) => {
    const errors: string[] = [];
    const completions: string[] = [];

    const productName = text(row, mapping, "productName");
    const color = text(row, mapping, "color");
    const size = text(row, mapping, "size");
    const supplier = text(row, mapping, "supplier");
    const suppliedCollection = text(row, mapping, "collection");
    const suppliedGarmentType = text(row, mapping, "garmentType");
    const collection = suppliedCollection || "XXXX";
    const garmentType = suppliedGarmentType || "XX";
    const suppliedCode = normalizeCode(text(row, mapping, "code"));
    const ean = normalizeEan(text(row, mapping, "ean"));

    const masterDataValidation =
      validateImportMasterData({
        brand: text(row, mapping, "brand"),
        color,
        size,
        category: text(row, mapping, "category"),
        productType: text(row, mapping, "garmentType"),
        supplier,
        collection,
      });

    if (!masterDataValidation.valid) {
      errors.push(
        ...formatMasterDataErrors(
          masterDataValidation.missing,
        ),
      );
    }

    if (!productName) {
      errors.push("Productnaam ontbreekt.");
    }

    if (!color) {
      errors.push("Kleur ontbreekt.");
    }

    if (!size) {
      errors.push("Maat ontbreekt.");
    }

    const numericFields = [
      ["purchasePrice", "Inkoopprijs"],
      ["salesPrice", "Verkoopprijs"],
      ["markup", "Markup"],
      ["stock", "Voorraad"],
    ] as const;

    numericFields.forEach(([key, label]) => {
      const raw = text(row, mapping, key);

      if (raw && !parseLocalizedNumber(raw).valid) {
        errors.push(`${label} bevat geen geldig getal.`);
      }
    });

    let articleCode = suppliedCode;

    if (suppliedCode) {
      if (usedCodes.has(suppliedCode)) {
        errors.push(
          `Artikelcode ${suppliedCode} bestaat al of staat dubbel in het bestand.`,
        );
      } else {
        usedCodes.add(suppliedCode);
      }
    } else {
      articleCode = generateArticleNumber({
        collectionCode: suppliedCollection,
        productTypeCode: suppliedGarmentType,
        existingCodes: Array.from(usedCodes),
      });

      usedCodes.add(normalizeCode(articleCode));
      completions.push(`Artikelnummer automatisch aangemaakt: ${articleCode}.`);
    }

    if (!suppliedCollection) {
      completions.push("Collectie automatisch aangevuld met XXXX.");
    }

    if (!suppliedGarmentType) {
      completions.push("Artikeltype automatisch aangevuld met XX.");
    }

    if (!text(row, mapping, "brand")) {
      completions.push("Merk automatisch aangevuld met Onbekend.");
    }

    if (ean) {
      if (usedEans.has(ean)) {
        errors.push(`EAN ${ean} bestaat al of staat dubbel in het bestand.`);
      } else {
        usedEans.add(ean);
      }
    }

    return {
      rowNumber: index + 2,
      articleCode,
      productName,
      collection,
      garmentType,
      color,
      size,
      supplier,
      ean,
      purchasePrice: parseLocalizedNumber(
        text(row, mapping, "purchasePrice"),
      ).value,
      status:
        errors.length > 0
          ? "error"
          : completions.length > 0
            ? "completed"
            : "ready",
      errors,
      completions: Array.from(new Set(completions)),
    };
  });
}

export default function ArticleImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);

  const missing = useMemo(
    () =>
      fields.filter(
        ([key, , required]) => required && !mapping[key],
      ),
    [mapping],
  );

  const previewRows = useMemo(
    () => buildPreview(rows, mapping),
    [rows, mapping],
  );

  const stats = useMemo(
    () => ({
      total: previewRows.length,
      ready: previewRows.filter((row) => row.status === "ready").length,
      completed: previewRows.filter((row) => row.status === "completed").length,
      errors: previewRows.filter((row) => row.status === "error").length,
    }),
    [previewRows],
  );

  const completionSummary = useMemo(() => {
    const summary: Record<string, number> = {};

    rows.forEach((row) => {
      if (!text(row, mapping, "code")) {
        incrementCounter(summary, "Artikelnummer gegenereerd");
      }

      if (!text(row, mapping, "collection")) {
        incrementCounter(summary, "Collectie → XXXX");
      }

      if (!text(row, mapping, "garmentType")) {
        incrementCounter(summary, "Artikeltype → XX");
      }

      if (!text(row, mapping, "brand")) {
        incrementCounter(summary, "Merk → Onbekend");
      }
    });

    return summary;
  }, [rows, mapping]);

  async function handleFile(file?: File) {
    if (!file) {
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();

    if (extension !== "xlsx" && extension !== "csv") {
      setError("Gebruik een Excel-bestand (.xlsx) of CSV-bestand (.csv).");
      return;
    }

    try {
      const parsed =
        extension === "csv"
          ? parseCsv(await file.text())
          : await parseXlsx(await file.arrayBuffer());

      if (!parsed.length) {
        throw new Error("Het bestand bevat geen regels.");
      }

      const newHeaders = Object.keys(parsed[0]);
      const automaticMapping: Record<string, string> = {};

      fields.forEach(([key, , , aliases]) => {
        const match = newHeaders.find((header) =>
          aliases.some((alias) => norm(alias) === norm(header)),
        );

        if (match) {
          automaticMapping[key] = match;
        }
      });

      setFileName(file.name);
      setRows(parsed);
      setHeaders(newHeaders);
      setMapping(automaticMapping);
      setError("");
      setResult(null);
      setStep(2);
    } catch {
      setError(
        "Het bestand kon niet worden gelezen. Controleer het sjabloon en probeer opnieuw.",
      );
    }
  }

  async function runImport() {
    setImporting(true);
    setError("");
    setProgress(0);

    const errors: string[] = [];
    const completions: Record<string, number> = {};
    let added = 0;
    let skipped = 0;
    let completed = 0;

    try {
      const defaults = getPricingDefaults();
      const suppliers = await fetchSuppliers();
      const supplierByName = new Map(
        suppliers.map((item) => [
          item.companyName.trim().toLowerCase(),
          item,
        ]),
      );

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const preview = previewRows[index];

        if (preview.status === "error") {
          skipped += 1;
          errors.push(
            ...preview.errors.map(
              (message) => `Regel ${preview.rowNumber}: ${message}`,
            ),
          );
          continue;
        }

        const purchasePrice = parseLocalizedNumber(
          text(row, mapping, "purchasePrice"),
        ).value;
        const suppliedSalesPrice = parseLocalizedNumber(
          text(row, mapping, "salesPrice"),
        ).value;
        const suppliedMarkup = parseLocalizedNumber(
          text(row, mapping, "markup"),
        ).value;
        const stock = parseLocalizedNumber(
          text(row, mapping, "stock"),
        ).value;

        const pricing = calculatePricing(
          {
            supplierPurchasePrice: purchasePrice,
            brandMarkup: suppliedMarkup || defaults.brandMarkup,
            salesPrice: suppliedSalesPrice || undefined,
          },
          suppliedSalesPrice > 0 ? "sales-price" : "brand-markup",
          defaults,
        );

        const collection =
          text(row, mapping, "collection") || "XXXX";
        const garmentType =
          text(row, mapping, "garmentType") || "XX";
        const brand =
          text(row, mapping, "brand") || "Onbekend";
        const supplier = text(row, mapping, "supplier");
        const matchedSupplier = supplierByName.get(
          supplier.trim().toLowerCase(),
        );
        const importedColor = text(row, mapping, "color");

        const colorMaster = resolveColor(importedColor);

        if (!colorMaster) {
          throw new Error(
            `Kleur "${importedColor}" bestaat niet in stamgegevens.`,
          );
        }

        const color = colorMaster.name;

        const size = text(row, mapping, "size");
        const ean = normalizeEan(text(row, mapping, "ean"));

        const input: ProductInput = {
          code: preview.articleCode,
          name: text(row, mapping, "productName"),
          collection,
          category: garmentType === "XX" ? "" : garmentType,
          supplier: matchedSupplier?.companyName ?? supplier,
          supplierId: matchedSupplier?.id ?? "",
          supplierProductCode: text(row, mapping, "supplierSku"),
          status: truthy(text(row, mapping, "active"))
            ? "Actief"
            : "Inactief",
          vatCode: "2V",
          brand,
          material: "",
          garmentType: garmentType === "XX" ? "" : garmentType,
          fit: "",
          colorFamily: color,
          seasonType: "Doorlopend",
          countryOfOrigin: "",
          description: text(row, mapping, "description"),
          purchasePrice: pricing.supplierPurchasePrice,
          wholesalePrice: pricing.salesPrice,
          shippingCosts: pricing.shippingCosts,
          otherCosts: pricing.otherCosts,
          totalCost: pricing.totalCost,
          brandMarkup: pricing.brandMarkup,
          recommendedRetailPrice: pricing.recommendedRetailPrice,
          retailerMarkup: pricing.retailerMarkup,
          colors: [color],
          sizes: [size],
          importedVariants: [
            {
              color,
              size,
              stock,
              ean: ean || undefined,
              supplierVariantCode:
                text(row, mapping, "supplierSku") || undefined,
            },
          ],
        };

        await addProduct(input);
        added += 1;

        if (preview.status === "completed") {
          completed += 1;

          if (!text(row, mapping, "code")) {
            incrementCounter(completions, "Artikelnummer gegenereerd");
          }

          if (!text(row, mapping, "collection")) {
            incrementCounter(completions, "Collectie → XXXX");
          }

          if (!text(row, mapping, "garmentType")) {
            incrementCounter(completions, "Artikeltype → XX");
          }

          if (!text(row, mapping, "brand")) {
            incrementCounter(completions, "Merk → Onbekend");
          }
        }

        setProgress(
          Math.round(((index + 1) / rows.length) * 100),
        );

        if (index % 20 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const importResult: ImportResult = {
        added,
        skipped,
        completed,
        errors,
        completions,
      };

      setResult(importResult);

      const previousHistory = JSON.parse(
        window.localStorage.getItem(
          "fashion-erp-article-import-history-v1",
        ) || "[]",
      );

      window.localStorage.setItem(
        "fashion-erp-article-import-history-v1",
        JSON.stringify(
          [
            {
              id: `import-${Date.now()}`,
              fileName,
              createdAt: new Date().toISOString(),
              ...importResult,
            },
            ...previousHistory,
          ].slice(0, 100),
        ),
      );

      setProgress(100);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Importeren is mislukt.",
      );
    } finally {
      setImporting(false);
    }
  }

  function downloadLog() {
    if (!result) {
      return;
    }

    const completionLines = Object.entries(result.completions).map(
      ([label, count]) => `Automatisch aangevuld;${label};${count}`,
    );

    const lines = [
      "Resultaat;Aantal",
      `Toegevoegd;${result.added}`,
      `Automatisch aangevuld;${result.completed}`,
      `Overgeslagen;${result.skipped}`,
      "",
      "Aanvulling;Waarde;Aantal",
      ...completionLines,
      "",
      ...result.errors.map(
        (item) => `Fout;${item.replaceAll(";", ",")}`,
      ),
    ];

    const blob = new Blob(["\ufeff" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `STiTch-importlog-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    anchor.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Import Center"
        title="Artikelen importeren"
        description="Upload, koppel, controleer en importeer artikelgegevens veilig in STiTch."
      />

      <div className={styles.steps}>
        {["Bestand", "Kolommen koppelen", "Controleren", "Importeren"].map(
          (label, index) => (
            <span
              key={label}
              className={step === index + 1 ? styles.activeStep : ""}
            >
              {index + 1}. {label}
            </span>
          ),
        )}
      </div>

      {step === 1 && (
        <>
          <section className={styles.templateCard}>
            <div className={styles.iconBox}>
              <AppIcon name="document" size={22} />
            </div>

            <div className={styles.templateText}>
              <h2>Gebruik het STiTch Excel-sjabloon</h2>
              <p>
                Het artikelnummer mag leeg blijven. STiTch gebruikt dan
                automatisch dezelfde nummergenerator als bij handmatig
                aanmaken.
              </p>
              <div className={styles.requiredFields}>
                Verplicht: productnaam, kleur en maat
              </div>
            </div>

            <a
              className={styles.downloadButton}
              href="/templates/STiTch-artikelimport-template.xlsx"
              download
            >
              Excel-sjabloon downloaden
            </a>
          </section>

          <section className={styles.uploadCard}>
            <div>
              <h2>Upload het ingevulde bestand</h2>
              <p>Ondersteunde bestanden: .xlsx en .csv</p>
            </div>

            <div
              className={styles.dropZone}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleFile(event.dataTransfer.files[0]);
              }}
            >
              <input
                ref={inputRef}
                className={styles.fileInput}
                type="file"
                accept=".xlsx,.csv"
                onChange={(event) =>
                  void handleFile(event.target.files?.[0])
                }
              />
              <span className={styles.uploadIcon}>
                <AppIcon name="clipboard" size={22} />
              </span>
              <strong>Sleep het bestand hierheen</strong>
              <span>of klik om een bestand te kiezen</span>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <Link
                href="/instellingen/import-center"
                className={styles.secondaryButton}
              >
                Terug
              </Link>
            </div>
          </section>
        </>
      )}

      {step === 2 && (
        <section className={styles.uploadCard}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Kolommen koppelen</h2>
              <p>
                {fileName} · {rows.length} regels gevonden
              </p>
            </div>

            <button
              className={styles.textButton}
              onClick={() => setStep(1)}
            >
              Ander bestand
            </button>
          </div>

          <div className={styles.mappingTable}>
            <div className={styles.mappingHeader}>
              <div>STiTch-veld</div>
              <div>Kolom uit bestand</div>
              <div>Voorbeeld</div>
            </div>

            {fields.map(([key, label, required]) => {
              const selected = mapping[key] ?? "";

              return (
                <div className={styles.mappingRow} key={key}>
                  <div>
                    <strong>{label}</strong>
                    {required && (
                      <span className={styles.required}> *</span>
                    )}
                  </div>

                  <select
                    value={selected}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Niet koppelen</option>
                    {headers.map((header) => (
                      <option key={header}>{header}</option>
                    ))}
                  </select>

                  <div className={styles.example}>
                    {selected
                      ? String(rows[0]?.[selected] ?? "—")
                      : "—"}
                  </div>
                </div>
              );
            })}
          </div>

          {missing.length > 0 && (
            <p className={styles.error}>
              Koppel eerst:{" "}
              {missing.map(([, label]) => label).join(", ")}.
            </p>
          )}

          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              onClick={() => setStep(1)}
            >
              Terug
            </button>
            <button
              className={styles.primaryButton}
              disabled={missing.length > 0}
              onClick={() => setStep(3)}
            >
              Controleren <AppIcon name="arrowRight" size={15} />
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className={styles.uploadCard}>
          <div>
            <h2>Import controleren</h2>
            <p>
              De artikelcodes en ingelezen kostprijzen worden vóór de import
              getoond. Alleen echte fouten blokkeren de verwerking.
            </p>
          </div>

          <div className={styles.summary}>
            <div>
              <strong>{stats.total}</strong>
              <span>Regels</span>
            </div>
            <div>
              <strong>{stats.ready}</strong>
              <span>Volledig</span>
            </div>
            <div>
              <strong>{stats.completed}</strong>
              <span>Aangevuld</span>
            </div>
            <div>
              <strong>{stats.errors}</strong>
              <span>Echte fouten</span>
            </div>
          </div>

          {Object.keys(completionSummary).length > 0 && (
            <div className={styles.errorList}>
              <strong>Automatisch aan te vullen</strong>
              {Object.entries(completionSummary).map(([label, count]) => (
                <div key={label}>
                  {label}: {count}
                </div>
              ))}
            </div>
          )}

          <div className={styles.previewWrap}>
            <table className={styles.preview}>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Artikelnummer</th>
                  <th>Productnaam</th>
                  <th>Collectie</th>
                  <th>Type</th>
                  <th>Kleur</th>
                  <th>Maat</th>
                  <th>Kostprijs</th>
                  <th>EAN</th>
                </tr>
              </thead>

              <tbody>
                {previewRows.slice(0, 50).map((row) => (
                  <tr key={row.rowNumber}>
                    <td>
                      <span
                        className={
                          row.status === "error"
                            ? styles.bad
                            : row.status === "completed"
                              ? styles.warn
                              : styles.ok
                        }
                        title={[...row.errors, ...row.completions].join(" ")}
                      >
                        {row.status === "error"
                          ? "Fout"
                          : row.status === "completed"
                            ? "Aangevuld"
                            : "Gereed"}
                      </span>
                    </td>
                    <td>
                      <strong>{row.articleCode || "—"}</strong>
                    </td>
                    <td>{row.productName || "—"}</td>
                    <td>{row.collection}</td>
                    <td>{row.garmentType}</td>
                    <td>{row.color || "—"}</td>
                    <td>{row.size || "—"}</td>
                    <td>
                      {new Intl.NumberFormat("nl-NL", {
                        style: "currency",
                        currency: "EUR",
                      }).format(row.purchasePrice)}
                    </td>
                    <td>{row.ean || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {stats.errors > 0 && (
            <div className={styles.errorList}>
              {previewRows
                .filter((row) => row.status === "error")
                .slice(0, 12)
                .flatMap((row) =>
                  row.errors.map((message) => (
                    <div key={`${row.rowNumber}-${message}`}>
                      Regel {row.rowNumber}: {message}
                    </div>
                  )),
                )}
            </div>
          )}

          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              onClick={() => setStep(2)}
            >
              Terug
            </button>
            <button
              className={styles.primaryButton}
              disabled={stats.errors > 0}
              onClick={() => setStep(4)}
            >
              Naar importeren <AppIcon name="arrowRight" size={15} />
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className={styles.completeCard}>
          {!result ? (
            <>
              <span className={styles.completeIcon}>
                <AppIcon name="clipboard" size={28} />
              </span>
              <h2>{rows.length} artikelen klaarzetten</h2>
              <p>
                De artikelcodes uit de controle worden ongewijzigd opgeslagen.
              </p>

              {importing && (
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressBar}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}

              {importing && (
                <div className={styles.progressLabel}>
                  {progress}% voltooid
                </div>
              )}

              {error && <p className={styles.error}>{error}</p>}

              <div className={styles.actions}>
                <button
                  className={styles.secondaryButton}
                  disabled={importing}
                  onClick={() => setStep(3)}
                >
                  Terug
                </button>
                <button
                  className={styles.primaryButton}
                  disabled={importing}
                  onClick={() => void runImport()}
                >
                  {importing ? "Importeren..." : "Import uitvoeren"}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className={styles.completeIcon}>
                <AppIcon name="check" size={28} />
              </span>
              <h2>Import afgerond</h2>
              <p>
                {result.added} artikelen toegevoegd, {result.completed} regels
                automatisch aangevuld en {result.skipped} regels overgeslagen.
              </p>

              <div className={styles.summary}>
                <div>
                  <strong>{result.added}</strong>
                  <span>Toegevoegd</span>
                </div>
                <div>
                  <strong>{result.completed}</strong>
                  <span>Aangevuld</span>
                </div>
                <div>
                  <strong>{result.skipped}</strong>
                  <span>Overgeslagen</span>
                </div>
                <div>
                  <strong>{result.errors.length}</strong>
                  <span>Foutmeldingen</span>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className={styles.errorList}>
                  {result.errors.slice(0, 12).map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              )}

              <div className={styles.actions}>
                <button
                  className={styles.secondaryButton}
                  onClick={downloadLog}
                >
                  Importlog downloaden
                </button>
                <Link
                  className={styles.primaryButton}
                  href="/artikelen"
                >
                  Naar artikelen
                </Link>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
