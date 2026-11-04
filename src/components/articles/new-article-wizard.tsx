"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addProduct, generateArticleNumber, type ProductInput } from "@/lib/articles";
import { getPricingDefaults } from "@/lib/company-settings";
import { calculatePricing } from "@/lib/pricing-engine";
import { getBrands, getCollections, getColors, getProductTypes, getSizes } from "@/lib/master-data";
import styles from "./new-article-wizard.module.css";

const steps = ["Artikel", "Indeling", "Kleuren", "Maten", "Controleren"];

function seasonCode(season: string) {
  const value = season.toLowerCase();
  if (value.includes("summer") || value.includes("zomer") || value.includes("spring")) return "S";
  if (value.includes("winter") || value.includes("autumn") || value.includes("herfst")) return "W";
  return "B";
}

export function NewArticleWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brandId, setBrandId] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [productTypeId, setProductTypeId] = useState("");
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [error, setError] = useState("");

  const brands = useMemo(() => getBrands().filter((x) => x.isActive), []);
  const collections = useMemo(() => getCollections().filter((x) => x.status !== "Gearchiveerd"), []);
  const productTypes = useMemo(() => getProductTypes().filter((x) => x.isActive), []);
  const colorOptions = useMemo(() => getColors().filter((x) => x.isActive), []);
  const sizeOptions = useMemo(() => getSizes().filter((x) => x.isActive), []);

  const brand = brands.find((x) => x.id === brandId);
  const collection = collections.find((x) => x.id === collectionId);
  const productType = productTypes.find((x) => x.id === productTypeId);
  const previewCode = brand && collection && productType
    ? `${collection.code.toUpperCase()}${productType.code.padStart(2, "0")}01-KLEUR`
    : "Wordt automatisch gegenereerd";

  function toggle(value: string, current: string[], setter: (next: string[]) => void) {
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function next() {
    setError("");
    if (step === 0 && !name.trim()) return setError("Vul een artikelnaam in.");
    if (step === 1 && (!brand || !collection || !productType)) return setError("Kies een merk, collectie en producttype.");
    if (step === 2 && colors.length === 0) return setError("Kies minimaal één kleur.");
    if (step === 3 && sizes.length === 0) return setError("Kies minimaal één maat.");
    setStep((value) => Math.min(value + 1, steps.length - 1));
  }

  async function createArticle() {
    if (!brand || !collection || !productType) return;
    const defaults = getPricingDefaults();
    const pricing = calculatePricing({ supplierPurchasePrice: 0, shippingCosts: 0, otherCosts: 0, brandMarkup: defaults.brandMarkup, retailerMarkup: defaults.retailerMarkup });
    const code = generateArticleNumber({ collectionCode: collection.code, productTypeCode: productType.code });
    const input: ProductInput = {
      code,
      name: name.trim(),
      collection: collection.code,
      category: productType.name,
      supplier: "",
      supplierId: "",
      supplierProductCode: "",
      status: "Concept",
      vatCode: "2V",
      brand: brand.name,
      material: "",
      garmentType: productType.name,
      fit: "",
      colorFamily: "",
      seasonType: seasonCode(collection.season) === "S" ? "Voorjaar/Zomer" : seasonCode(collection.season) === "W" ? "Herfst/Winter" : "Doorlopend",
      countryOfOrigin: "",
      description: description.trim(),
      purchasePrice: 0,
      wholesalePrice: pricing.salesPrice,
      shippingCosts: 0,
      otherCosts: 0,
      totalCost: pricing.totalCost,
      brandMarkup: defaults.brandMarkup,
      recommendedRetailPrice: pricing.recommendedRetailPrice,
      retailerMarkup: defaults.retailerMarkup,
      colors,
      sizes,
    };
    const product = await addProduct(input);
    router.push(`/artikelen/${product.id}`);
  }

  return (
    <section className={styles.wizard}>
      <div className={styles.steps}>{steps.map((label, index) => <div key={label} className={`${styles.step} ${index <= step ? styles.active : ""}`}><span>{index + 1}</span><strong>{label}</strong></div>)}</div>
      <div className={styles.panel}>
        {step === 0 && <><h2>Wat maak je aan?</h2><p>Begin met alleen de basis. Details kun je later op de productkaart aanvullen.</p><label>Artikelnaam<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Bijvoorbeeld Essential Hoodie" /></label><label>Omschrijving <em>optioneel</em><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} /></label></>}
        {step === 1 && <><h2>Waar hoort het artikel bij?</h2><div className={styles.formGrid}><label>Merk<select value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">Kies merk</option>{brands.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}</select></label><label>Collectie<select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}><option value="">Kies collectie</option>{collections.map((x) => <option key={x.id} value={x.id}>{x.code && x.code !== x.name ? `${x.code} – ${x.name}` : x.name}</option>)}</select></label><label>Producttype<select value={productTypeId} onChange={(e) => setProductTypeId(e.target.value)}><option value="">Kies producttype</option>{productTypes.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}</select></label></div><div className={styles.preview}><span>Voorbeeld artikelnummer</span><strong>{previewCode}</strong></div></>}
        {step === 2 && <><h2>Welke kleuren?</h2><p>Kleuren kun je later altijd toevoegen.</p><div className={styles.optionGrid}>{colorOptions.map((x) => <button type="button" key={x.id} className={colors.includes(x.name) ? styles.selected : ""} onClick={() => toggle(x.name, colors, setColors)}><span>{colors.includes(x.name) ? "✓" : "+"}</span>{x.name}<small>{x.code}</small></button>)}</div><Link className={styles.manageLink} href="/instellingen/stamgegevens">+ Nieuwe kleur toevoegen</Link></>}
        {step === 3 && <><h2>Welke maten?</h2><p>Selecteer alleen de maten die voor dit artikel gelden.</p><div className={styles.optionGrid}>{sizeOptions.map((x) => <button type="button" key={x.id} className={sizes.includes(x.name) ? styles.selected : ""} onClick={() => toggle(x.name, sizes, setSizes)}><span>{sizes.includes(x.name) ? "✓" : "+"}</span>{x.name}</button>)}</div></>}
        {step === 4 && <><h2>Klaar om aan te maken</h2><div className={styles.summary}><div><span>Artikel</span><strong>{name}</strong></div><div><span>Artikelnummer</span><strong>{previewCode.replace(/01-KLEUR$/, "[volgnummer]-[kleur]")}</strong></div><div><span>Merk</span><strong>{brand?.name}</strong></div><div><span>Collectie</span><strong>{collection?.name}</strong></div><div><span>Producttype</span><strong>{productType?.name}</strong></div><div><span>Kleuren</span><strong>{colors.join(", ")}</strong></div><div><span>Maten</span><strong>{sizes.join(", ")}</strong></div><div><span>Varianten</span><strong>{colors.length * sizes.length}</strong></div></div></>}
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}><Link href="/artikelen">Annuleren</Link><div>{step > 0 && <button type="button" className={styles.secondary} onClick={() => setStep((v) => v - 1)}>Vorige</button>}{step < 4 ? <button type="button" onClick={next}>Volgende</button> : <button type="button" onClick={createArticle}>Artikel aanmaken</button>}</div></div>
      </div>
    </section>
  );
}
