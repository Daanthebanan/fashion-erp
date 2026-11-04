import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Geen gebruiker." },
      { status: 401 },
    );
  }

  const { data: membership } =
    await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .single();

  if (!membership?.organization_id) {
    return NextResponse.json(
      { error: "Geen organisatie." },
      { status: 403 },
    );
  }

  const { data, error } =
    await supabase
      .from("stock_balances")
      .select(`
        quantity,
        reserved_quantity,
        updated_at,
        product_variants(
          id,
          sku,
          color,
          size,
          products(
            id,
            product_code,
            name,
            brand,
            season,
            category,
            purchase_price
          )
        ),
        stock_locations(
          name,
          code
        )
      `)
      .eq(
        "organization_id",
        membership.organization_id,
      );

  if (error) {
    console.error(
      "INVENTORY SUPABASE ERROR:",
      error,
    );

    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  const { data: purchaseLines } =
    await supabase
      .from("purchase_order_lines")
      .select(`
        variant_id,
        ordered_quantity,
        received_quantity,
        purchase_orders(
          status
        )
      `)
      .eq(
        "organization_id",
        membership.organization_id,
      );

  const incomingByVariant =
    new Map<string, number>();

  // Alleen bestelde (en deels ontvangen) inkooporders zijn onderweg;
  // concepten en geannuleerde orders tellen niet mee.
  const incomingStatuses = new Set([
    "Besteld",
    "Deels ontvangen",
  ]);

  for (const line of purchaseLines ?? []) {
    const purchaseOrder = Array.isArray(line.purchase_orders)
      ? line.purchase_orders[0]
      : line.purchase_orders;

    if (!incomingStatuses.has(purchaseOrder?.status ?? "")) {
      continue;
    }

    const open =
      Number(line.ordered_quantity ?? 0) -
      Number(line.received_quantity ?? 0);

    if (
      open > 0
    ) {
      incomingByVariant.set(
        line.variant_id,
        (incomingByVariant.get(line.variant_id) ?? 0) + open,
      );
    }
  }

  // Een variant kan op meerdere locaties voorraad hebben; ken de
  // inkomende aantallen maar één keer per variant toe.
  const variantsWithIncoming = new Set<string>();

  return NextResponse.json(
    (data ?? []).map((row: any) => {
      const variantId: string = row.product_variants?.id ?? "";
      const incomingStock = variantsWithIncoming.has(variantId)
        ? 0
        : (incomingByVariant.get(variantId) ?? 0);
      variantsWithIncoming.add(variantId);

      const quantity =
        Number(row.quantity ?? 0);

      const reserved =
        Number(row.reserved_quantity ?? 0);

      const purchasePrice =
        Number(
          row.product_variants?.products?.purchase_price ?? 0,
        );

      return {
        productId:
          row.product_variants?.products?.id ?? "",

        variantId:
          row.product_variants?.id ?? "",

        productCode:
          row.product_variants?.products?.product_code ?? "",

        productName:
          row.product_variants?.products?.name ?? "",

        collection:
          row.product_variants?.products?.season ?? "",

        category:
          row.product_variants?.products?.category ?? "",

        supplier:
          row.product_variants?.products?.brand ?? "",

        status:
          "Actief",

        sku:
          row.product_variants?.sku ?? "",

        color:
          row.product_variants?.color ?? "",

        size:
          row.product_variants?.size ?? "",

        physicalStock:
          quantity,

        reservedStock:
          reserved,

        availableStock:
          quantity - reserved,

        incomingStock,

        minimumStock:
          0,

        purchasePrice,

        stockValue:
          quantity * purchasePrice,

        warehouse:
          row.stock_locations?.name ?? "",

        location:
          row.stock_locations?.code ?? "",

        lastMovementAt:
          row.updated_at ?? "",
      };
    }),
  );
}
