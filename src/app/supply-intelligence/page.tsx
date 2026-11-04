"use client";

import {
  useEffect,
  useState,
} from "react";
import { PageHeader } from "@/components/ui/page-header";
import {
  buildSupplyAnalysis,
  getSimpleOrderAdvice,
  getSupplyDashboard,
  type SupplyDimensionRow,
} from "@/lib/supply-intelligence";
import {
  fetchPurchaseOrders,
  type PurchaseOrder,
} from "@/lib/purchasing";
import styles from "./supply-intelligence.module.css";

type Dimension =
  | "category"
  | "garmentType"
  | "material"
  | "fit"
  | "colorFamily"
  | "color"
  | "size";

const dimensions: Array<{
  value: Dimension;
  label: string;
}> = [
  {
    value: "garmentType",
    label: "Type kledingstuk",
  },
  { value: "size", label: "Maat" },
  {
    value: "colorFamily",
    label: "Kleurfamilie",
  },
  { value: "material", label: "Materiaal" },
  { value: "fit", label: "Pasvorm" },
  { value: "category", label: "Categorie" },
  { value: "color", label: "Kleur" },
];

function money(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export default function SupplyIntelligencePage() {
  const [loaded, setLoaded] = useState(false);
  const [dimension, setDimension] =
    useState<Dimension>("garmentType");
  const [rows, setRows] = useState<
    SupplyDimensionRow[]
  >([]);

  const [purchaseOrders, setPurchaseOrders] = useState<
    PurchaseOrder[]
  >([]);

  useEffect(() => {
    let active = true;

    // Echte inkooporders uit de database (niet de oude lokale opslag).
    fetchPurchaseOrders()
      .catch(() => [] as PurchaseOrder[])
      .then((orders) => {
        if (!active) return;
        setPurchaseOrders(orders);
        setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loaded) {
      setRows(
        buildSupplyAnalysis(dimension),
      );
    }
  }, [dimension, loaded]);

  if (!loaded) {
    return null;
  }

  const dashboard = getSupplyDashboard(purchaseOrders);
  const advice = getSimpleOrderAdvice();

  return (
    <div>
      <PageHeader
        eyebrow="Inkoop"
        title="Supply Intelligence"
        description="STITCH bouwt vanaf de eerste order historie op per maat, kleur, materiaal, pasvorm en type kledingstuk."
      />

      <section className={styles.metricGrid}>
        <article className="metric-card">
          <div className="metric-label">
            Verkocht
          </div>
          <div className="metric-value">
            {dashboard.sold}
          </div>
          <div className="metric-detail">
            stuks in historie
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Retourpercentage
          </div>
          <div className="metric-value">
            {dashboard.returnRate}%
          </div>
          <div className="metric-detail">
            {dashboard.returned} retour
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Huidige voorraad
          </div>
          <div className="metric-value">
            {dashboard.stock}
          </div>
          <div className="metric-detail">
            stuks
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-label">
            Onderweg
          </div>
          <div className="metric-value">
            {dashboard.incoming}
          </div>
          <div className="metric-detail">
            open inkoop
          </div>
        </article>
      </section>

      <section className={styles.grid}>
        <article className="content-card">
          <div className="content-card-header">
            <div>
              <h2 className="content-card-title">
                Historische analyse
              </h2>
              <p className="content-card-description">
                Vergelijk collecties heen op vaste
                productkenmerken.
              </p>
            </div>

            <select
              className={styles.select}
              value={dimension}
              onChange={(event) =>
                setDimension(
                  event.target
                    .value as Dimension,
                )
              }
            >
              {dimensions.map((item) => (
                <option
                  key={item.value}
                  value={item.value}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kenmerk</th>
                  <th className="table-number">
                    Verkocht
                  </th>
                  <th className="table-number">
                    Retour
                  </th>
                  <th className="table-number">
                    Netto
                  </th>
                  <th className="table-number">
                    Aandeel
                  </th>
                  <th className="table-number">
                    Retour %
                  </th>
                  <th className="table-number">
                    Omzet
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.value}>
                    <td className="table-primary">
                      {row.value}
                    </td>
                    <td className="table-number">
                      {row.soldQuantity}
                    </td>
                    <td className="table-number">
                      {row.returnedQuantity}
                    </td>
                    <td className="table-number">
                      {row.netQuantity}
                    </td>
                    <td className="table-number">
                      {row.share}%
                    </td>
                    <td className="table-number">
                      {row.returnRate}%
                    </td>
                    <td className="table-number">
                      {money(row.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length === 0 && (
            <div className={styles.empty}>
              Nog onvoldoende historische data.
              STITCH begint automatisch vanaf de
              eerste order.
            </div>
          )}
        </article>

        <aside className="content-card">
          <div className="content-card-header">
            <div>
              <h2 className="content-card-title">
                Eerste bestelrichtlijn
              </h2>
            </div>
          </div>

          <div className={styles.advice}>
            <p>{advice.message}</p>

            <strong>Maatverdeling</strong>
            {advice.sizeCurve
              .slice(0, 8)
              .map((row) => (
                <div key={row.value}>
                  <span>{row.value}</span>
                  <b>{row.share}%</b>
                </div>
              ))}

            <strong>Kleurfamilies</strong>
            {advice.colorCurve
              .slice(0, 8)
              .map((row) => (
                <div key={row.value}>
                  <span>{row.value}</span>
                  <b>{row.share}%</b>
                </div>
              ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
