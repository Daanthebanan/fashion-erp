"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMasterDataItem,
  getMasterDataItems,
  masterDataLabels,
  subscribeToMasterData,
  type MasterDataEntity,
  type MasterDataItem,
} from "@/lib/master-data";

type MasterSelectProps = {
  entity: MasterDataEntity;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  // Artikelen bewaren collecties als code (bijv. HS27), andere
  // stamgegevens als naam.
  valueField?: "name" | "code";
};

export function MasterSelect({
  entity,
  label,
  value,
  onChange,
  placeholder,
  valueField = "name",
}: MasterSelectProps) {
  const [items, setItems] = useState<MasterDataItem[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const valueOf = (item: MasterDataItem) =>
    valueField === "code" && item.code ? item.code : item.name;

  const matchesValue = (item: MasterDataItem) =>
    Boolean(value) &&
    (item.name.toLowerCase() === value.toLowerCase() ||
      (valueField === "code" &&
        item.code.toLowerCase() === value.toLowerCase()));

  const selectedItem = items.find(matchesValue);
  const selectedLabel =
    selectedItem && valueField === "code" && selectedItem.code
      ? `${selectedItem.code} – ${selectedItem.name}`
      : value;

  function reload() {
    const next = getMasterDataItems(entity);

    if (value && !next.some(matchesValue)) {
      next.push({
        id: `legacy-${entity}-${value}`,
        code: "",
        name: value,
        active: true,
        sortOrder: 9999,
        notes: "Bestaande artikelwaarde",
        createdAt: "",
        updatedAt: "",
      });
    }

    setItems(next);
  }

  useEffect(() => {
    reload();
    return subscribeToMasterData(reload);
  }, [entity, value]);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    }

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;

    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(normalized) ||
        item.code.toLowerCase().includes(normalized),
    );
  }, [items, query]);

  function addNew() {
    const proposed = query.trim() || window.prompt(`Nieuwe ${label.toLowerCase()}`);
    if (!proposed) return;

    try {
      const item = addMasterDataItem(entity, proposed);
      reload();
      onChange(valueOf(item));
      setOpen(false);
      setQuery("");
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Kon stamgegeven niet toevoegen.",
      );
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <span style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
        {label}
      </span>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          width: "100%",
          minHeight: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "8px 10px",
          border: "1px solid #cbd6e4",
          borderRadius: 4,
          background: "#fff",
          color: value ? "#10233f" : "#7a8798",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span>{selectedLabel || placeholder || `Kies ${label.toLowerCase()}`}</span>
        <span aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 120,
            overflow: "hidden",
            border: "1px solid #cbd6e4",
            borderRadius: 6,
            background: "#fff",
            boxShadow: "0 14px 34px rgba(9,30,58,.18)",
          }}
        >
          <div style={{ padding: 8, borderBottom: "1px solid #edf1f6" }}>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Zoek in ${masterDataLabels[entity].toLowerCase()}...`}
              style={{
                width: "100%",
                minHeight: 38,
                padding: "8px 10px",
                border: "1px solid #cbd6e4",
                borderRadius: 4,
              }}
            />
          </div>

          <div style={{ maxHeight: 240, overflowY: "auto", padding: 6 }}>
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChange(valueOf(item));
                  setOpen(false);
                  setQuery("");
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "9px 10px",
                  border: 0,
                  borderRadius: 4,
                  background: matchesValue(item) ? "#eef6ff" : "transparent",
                  color: "#10233f",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span>{item.name}</span>
                {item.code && (
                  <span style={{ color: "#7a8798", fontSize: 11 }}>
                    {item.code}
                  </span>
                )}
              </button>
            ))}

            {filtered.length === 0 && (
              <div style={{ padding: "12px 10px", color: "#7a8798" }}>
                Geen resultaten
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={addNew}
            style={{
              width: "100%",
              padding: "11px 14px",
              border: 0,
              borderTop: "1px solid #edf1f6",
              background: "#f7f9fc",
              color: "#0969c7",
              fontWeight: 700,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            + Nieuwe {label.toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}
