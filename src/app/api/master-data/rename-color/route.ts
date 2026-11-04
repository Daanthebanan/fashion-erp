import { NextResponse } from "next/server";
import {
  getCurrentOrganization,
  requireUser,
} from "@/lib/auth/current-context";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function rec(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}

function same(value: unknown, name: string) {
  return (
    String(value ?? "").trim().toLowerCase() ===
    name.trim().toLowerCase()
  );
}

function renameInList(items: unknown, from: string, to: string) {
  return Array.isArray(items)
    ? items.map((item) => {
        if (typeof item === "string") {
          return same(item, from) ? to : item;
        }

        const record = rec(item);
        return same(record.color, from) ? { ...record, color: to } : item;
      })
    : items;
}

/**
 * Kleurnamen staan als tekst op artikelen, varianten en orderregels.
 * Bij het hernoemen van een stamkleur voeren we de nieuwe naam overal
 * door, zodat de oude (bijv. verkeerd gespelde) naam niet blijft staan.
 */
export async function POST(request: Request) {
  try {
    await requireUser();
    const organization = await getCurrentOrganization();
    const supabase = await createClient();
    const body = rec(await request.json());
    const from = String(body.from ?? "").trim();
    const to = String(body.to ?? "").trim();

    if (!from || !to) {
      return NextResponse.json(
        { error: "Oude en nieuwe kleurnaam zijn verplicht." },
        { status: 400 },
      );
    }

    if (from === to) {
      return NextResponse.json({ variants: 0, products: 0, salesOrderLines: 0 });
    }

    const { data: variants, error: variantsError } = await supabase
      .from("product_variants")
      .select("id, color, profile")
      .eq("organization_id", organization.id)
      .ilike("color", from);

    if (variantsError) throw new Error(variantsError.message);

    for (const variant of variants ?? []) {
      const profile = rec(variant.profile);
      const { error } = await supabase
        .from("product_variants")
        .update({
          color: to,
          profile: same(profile.color, from) ? { ...profile, color: to } : profile,
        })
        .eq("id", variant.id);

      if (error) throw new Error(error.message);
    }

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, profile")
      .eq("organization_id", organization.id);

    if (productsError) throw new Error(productsError.message);

    let productCount = 0;

    for (const product of products ?? []) {
      const profile = rec(product.profile);
      const usesColor =
        (Array.isArray(profile.colors) &&
          profile.colors.some((color) => same(color, from))) ||
        (Array.isArray(profile.variants) &&
          profile.variants.some((variant) => same(rec(variant).color, from)));

      if (!usesColor) continue;

      const stockByVariant = Object.fromEntries(
        Object.entries(rec(profile.stockByVariant)).map(([key, value]) => {
          const [color, ...rest] = key.split("__");
          return [same(color, from) ? [to, ...rest].join("__") : key, value];
        }),
      );

      const { error } = await supabase
        .from("products")
        .update({
          profile: {
            ...profile,
            colors: renameInList(profile.colors, from, to),
            variants: renameInList(profile.variants, from, to),
            importedVariants: renameInList(profile.importedVariants, from, to),
            ...(profile.stockByVariant ? { stockByVariant } : {}),
          },
        })
        .eq("id", product.id);

      if (error) throw new Error(error.message);
      productCount += 1;
    }

    const { data: lines, error: linesError } = await supabase
      .from("sales_order_lines")
      .select("id, profile")
      .eq("organization_id", organization.id)
      .ilike("profile->>color", from);

    if (linesError) throw new Error(linesError.message);

    for (const line of lines ?? []) {
      const { error } = await supabase
        .from("sales_order_lines")
        .update({ profile: { ...rec(line.profile), color: to } })
        .eq("id", line.id);

      if (error) throw new Error(error.message);
    }

    return NextResponse.json({
      variants: variants?.length ?? 0,
      products: productCount,
      salesOrderLines: lines?.length ?? 0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Kleur hernoemen mislukt.",
      },
      { status: 500 },
    );
  }
}
