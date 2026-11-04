import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimNextNumberServer } from "@/lib/number-series-server";

class ApiError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

function mapPurchaseOrder(row: any) {
  return {
    ...row,
    orderNumber: row.order_number,
    orderDate: row.order_date,
    expectedDeliveryDate: row.expected_delivery_date,
    collectionCode: row.collection_code,
    currency: row.currency ?? "EUR",
    paymentDays: row.payment_days ?? 30,
    supplierReference: row.supplier_reference ?? "",
    supplierId: row.supplier_id,
    supplierName: row.suppliers?.company_name ?? "",
    lines: (row.purchase_order_lines ?? []).map((line: any) => ({
      id: line.id,
      variantId: line.variant_id,
      productName:
        line.product_variants?.products?.name ?? "",
      productCode:
        line.product_variants?.products?.product_code ?? "",
      sku:
        line.product_variants?.sku ?? "",
      color:
        line.product_variants?.color ?? "",
      size:
        line.product_variants?.size ?? "",
      collectionCode:
        line.product_variants?.products?.season ?? "",
      orderedQuantity: Number(line.ordered_quantity ?? 0),
      receivedQuantity: Number(line.received_quantity ?? 0),
      purchasePrice: Number(line.unit_price ?? 0),
    })),
  };
}


async function context() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new ApiError(
      "Je sessie is verlopen.",
      401,
    );
  }

  const { data: membership } =
    await supabase
      .from("organization_members")
      .select("organization_id")
      .eq(
        "user_id",
        user.id,
      )
      .eq(
        "active",
        true,
      )
      .limit(1)
      .single();

  if (!membership?.organization_id) {
    throw new ApiError(
      "Geen organisatie gevonden.",
      403,
    );
  }

  return {
    supabase,
    organizationId:
      membership.organization_id,
    user,
  };
}


export async function GET() {
  try {
    const {
      supabase,
      organizationId,
    } = await context();

    const { data, error } =
      await supabase
        .from("purchase_orders")
        .select(`
          *,
          suppliers(*),
          purchase_order_lines(
            *,
            product_variants(
              sku,
              color,
              size,
              products(
                product_code,
                name,
                season
              )
            )
          )
        `)
        .eq(
          "organization_id",
          organizationId,
        )
        .order(
          "created_at",
          {
            ascending: false,
          },
        );

    if (error) {
      throw new ApiError(
        error.message,
      );
    }

    return NextResponse.json(
      (data ?? []).map(mapPurchaseOrder),
    );

  } catch (error) {
    const e =
      error instanceof ApiError
        ? error
        : new ApiError(
            "Inkooporders ophalen mislukt.",
          );

    return NextResponse.json(
      {
        error: e.message,
      },
      {
        status: e.status,
      },
    );
  }
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json();

    const {
      supabase,
      organizationId,
      user,
    } = await context();

    const orderNumber =
      await claimNextNumberServer(
        "purchase_order",
      );

    const lines =
      body.lines ?? [];

    const subtotal =
      lines.reduce(
        (
          sum: number,
          line: {
            orderedQuantity: number;
            purchasePrice: number;
          },
        ) =>
          sum +
          line.orderedQuantity *
            line.purchasePrice,
        0,
      );

    const vat =
      subtotal * 0.21;

    const { data: order, error } =
      await supabase
        .from("purchase_orders")
        .insert({
          organization_id:
            organizationId,
          order_number:
            orderNumber,
          supplier_id:
            body.supplierId,
          collection_code:
            body.collectionCode || null,
          currency:
            body.currency || "EUR",
          payment_days:
            body.paymentDays || 30,
          supplier_reference:
            body.supplierReference || null,
          order_date:
            new Date()
              .toISOString()
              .slice(0, 10),
          expected_delivery_date:
            body.expectedDeliveryDate ||
            null,
          status:
            body.status || "Concept",
          notes:
            body.notes || "",
          subtotal,
          vat,
          total:
            subtotal + vat,
          created_by:
            user.id,
        })
        .select("*")
        .single();

    if (error) {
      throw new ApiError(
        error.message,
      );
    }

    const { error: linesError } = await supabase
      .from("purchase_order_lines")
      .insert(
        lines.map(
          (
            line: {
              variantId: string;
              orderedQuantity: number;
              purchasePrice: number;
            },
          ) => ({
            organization_id:
              organizationId,
            purchase_order_id:
              order.id,
            variant_id:
              line.variantId,
            ordered_quantity:
              line.orderedQuantity,
            received_quantity:
              0,
            unit_price:
              line.purchasePrice,
            line_total:
              line.orderedQuantity *
              line.purchasePrice,
          }),
        ),
      );

    if (linesError) {
      await supabase
        .from("purchase_orders")
        .delete()
        .eq("id", order.id);

      throw new ApiError(linesError.message);
    }

    return NextResponse.json(
      order,
      {
        status: 201,
      },
    );

  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Inkooporder maken mislukt.",
      },
      {
        status: 500,
      },
    );
  }
}
