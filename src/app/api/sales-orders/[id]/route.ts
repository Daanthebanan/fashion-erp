import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDefaultStockLocation } from "@/lib/stock-location";
import {
  releaseBatch,
  reserveBatchForOrder,
} from "@/lib/fulfillment/allocate-stock";
type Row = Record<string, unknown>;
class ApiError extends Error { constructor(message: string, public status = 500) { super(message); } }
const rec = (v: unknown): Row => v && typeof v === "object" ? v as Row : {};
const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
async function context() { const supabase = await createClient(); const { data:{user} } = await supabase.auth.getUser(); if(!user) throw new ApiError("Je sessie is verlopen. Log opnieuw in.",401); const {data,error}=await supabase.from("organization_members").select("organization_id").eq("user_id",user.id).eq("active",true); if(error) throw new ApiError(error.message); const ids=(data??[]).map((m:Row)=>String(m.organization_id??"")).filter(Boolean); if(!ids.length) throw new ApiError("Er is geen actieve organisatie gekoppeld.",403); return {supabase,organizationId:ids[0]}; }
function line(row:Row){
  const p = rec(row.profile);

  return {
    ...p,
    id: String(row.id ?? ""),
    variantId: String(row.variant_id ?? p.variantId ?? ""),
    productId: String(row.product_id ?? p.productId ?? ""),
    sku: String(row.sku ?? p.sku ?? ""),
    color: String(row.color ?? p.color ?? ""),
    size: String(row.size ?? p.size ?? ""),
    quantity: num(row.quantity),
    deliveredQuantity: num(row.delivered_quantity),
    reservedQuantity: num(row.reserved_quantity),
    unitPrice: num(row.unit_price),
    discountPercentage: num(row.discount_percentage),
  };
}
function order(row:Row){const p=rec(row.profile);return {...p,id:String(row.id??""),orderNumber:String(row.order_number??""),orderDate:String(row.order_date??""),requestedDeliveryDate:String(row.requested_delivery_date??""),status:String(row.status??"Concept"),notes:String(row.notes??""),lines:Array.isArray(row.sales_order_lines)?(row.sales_order_lines as Row[]).map(line):[],createdAt:String(row.created_at??""),updatedAt:String(row.updated_at??"")};}
function response(e:unknown){const x=e instanceof ApiError?e:new ApiError(e instanceof Error?e.message:"De verkooporderbewerking is mislukt.");return NextResponse.json({error:x.message},{status:x.status});}
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;const {supabase,organizationId}=await context();const {data,error}=await supabase.from("sales_orders").select("*, sales_order_lines(*)").eq("organization_id",organizationId).eq("id",id).maybeSingle();if(error)throw new ApiError(error.message);if(!data)throw new ApiError("Verkooporder niet gevonden.",404);return NextResponse.json(order(data as Row));}catch(e){return response(e);}}
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){try{
  const {id}=await params;
  const input=await request.json() as Row;
  const lines=Array.isArray(input.lines)?input.lines as Row[]:[];
  const {supabase,organizationId}=await context();

  const { data: existingOrder } = await supabase
    .from("sales_orders")
    .select("status, profile")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();

  const previousStatus = String(existingOrder?.status ?? "");
  const nextStatus = String(input.status ?? "Concept");
  const isConfirming = previousStatus === "Concept" && nextStatus === "Bevestigd";
  const isCancelling = previousStatus !== "Geannuleerd" && nextStatus === "Geannuleerd";
  // Een bevestigde order mag worden aangevuld of aangepast zolang er nog
  // niets gereedgemeld of verzonden is. Reserveringen worden dan bijgewerkt
  // en de order krijgt de melding dat de bevestiging opnieuw moet.
  const isEditingConfirmed =
    ["Bevestigd", "Gereserveerd"].includes(previousStatus) &&
    nextStatus === previousStatus;
  let stockLocationId = "";

  if (isConfirming || isCancelling || isEditingConfirmed) {
    const location = await getDefaultStockLocation(organizationId);
    stockLocationId = location.id;
  }

  const subtotalBefore = lines.reduce((t,l)=>t+num(l.quantity)*num(l.unitPrice),0);
  const discount = lines.reduce((t,l)=>t+num(l.quantity)*num(l.unitPrice)*num(l.discountPercentage)/100,0);
  const subtotal = subtotalBefore-discount;
  const updatedAt = new Date().toISOString();

  const existingLinesInput = lines.filter((l) => l.id);
  const newLinesInput = lines.filter((l) => !l.id);
  const existingLineIds = existingLinesInput.map((l) => String(l.id));

  // One query for every existing line's current DB state, instead of one
  // SELECT per line — this is the single biggest win for large orders.
  const { data: currentLinesData, error: currentLinesError } =
    existingLineIds.length > 0
      ? await supabase
          .from("sales_order_lines")
          .select("id, sales_order_id, variant_id, quantity, delivered_quantity, reserved_quantity, profile")
          .eq("organization_id", organizationId)
          .in("id", existingLineIds)
      : { data: [], error: null };

  if (currentLinesError) throw new ApiError(currentLinesError.message);

  const currentById = new Map(
    (currentLinesData ?? []).map((row) => [String(row.id), row]),
  );

  const linesChanged =
    newLinesInput.some((l) => num(l.quantity) > 0) ||
    existingLinesInput.some((l) => {
      const current = currentById.get(String(l.id));
      return current !== undefined && num(current.quantity) !== num(l.quantity);
    });

  const previousProfile = rec(existingOrder?.profile);
  const changedAfterConfirmationAt =
    isEditingConfirmed && linesChanged
      ? updatedAt
      : "changedAfterConfirmationAt" in input
        ? input.changedAfterConfirmationAt ?? null
        : previousProfile.changedAfterConfirmationAt ?? null;

  const {error}=await supabase.from("sales_orders").update({status:nextStatus,requested_delivery_date:String(input.requestedDeliveryDate??"")||null,notes:String(input.notes??"")||null,subtotal,vat:subtotal*.21,total:subtotal*1.21,profile:{...input,changedAfterConfirmationAt,updatedAt},updated_at:updatedAt}).eq("organization_id",organizationId).eq("id",id);
  if(error)throw new ApiError(error.message);

  // Bij een verlaagd aantal op een bevestigde order geven we de
  // reservering boven het nieuwe aantal vrij.
  const reservedByLine = new Map<string, number>();

  if (isEditingConfirmed) {
    const releases = existingLinesInput.flatMap((l) => {
      const current = currentById.get(String(l.id));
      if (!current) return [];

      const reserved = num(current.reserved_quantity);
      const maxReserved = Math.max(
        0,
        num(l.quantity) - num(current.delivered_quantity),
      );
      const keep = Math.min(reserved, maxReserved);
      reservedByLine.set(String(l.id), keep);

      return reserved > keep
        ? [{ variantId: String(current.variant_id), quantity: reserved - keep }]
        : [];
    });

    await releaseBatch(supabase, organizationId, stockLocationId, releases);
  }

  if (isCancelling) {
    const releases = existingLinesInput.map((l) => {
      const current = currentById.get(String(l.id));
      return {
        variantId: current ? String(current.variant_id) : "",
        quantity: current ? num(current.reserved_quantity) : 0,
      };
    });

    await releaseBatch(supabase, organizationId, stockLocationId, releases);
  }

  const lineUpserts = existingLinesInput.map((l) => {
    const current = currentById.get(String(l.id));
    const existingProfile = rec(current?.profile);
    const quantityChanged =
      current !== undefined &&
      current !== null &&
      num(current.quantity) !== num(l.quantity);

    const mergedProfile: Row = { ...existingProfile, ...l };
    if (quantityChanged) delete mergedProfile.productionNote;

    return {
      id: String(l.id),
      organization_id: organizationId,
      sales_order_id: current ? current.sales_order_id : id,
      variant_id: current ? current.variant_id : String(l.variantId ?? ""),
      quantity: num(l.quantity),
      delivered_quantity: num(l.deliveredQuantity),
      // Cancelling zeroes reservations via releaseBatch above and the
      // client already sends 0 here; any other save keeps the client's
      // value as before.
      reserved_quantity:
        reservedByLine.get(String(l.id)) ?? num(l.reservedQuantity),
      unit_price: num(l.unitPrice),
      discount_percentage: num(l.discountPercentage),
      line_total: num(l.quantity)*num(l.unitPrice)*(1-num(l.discountPercentage)/100),
      profile: mergedProfile,
    };
  });

  if (lineUpserts.length > 0) {
    const { error: upsertError } = await supabase
      .from("sales_order_lines")
      .upsert(lineUpserts);
    if (upsertError) throw new ApiError(upsertError.message);
  }

  if (newLinesInput.length > 0) {
    const inserts = newLinesInput.map((l) => {
      const variantId = String(l.variantId ?? "");
      if (!variantId) {
        throw new ApiError("Nieuwe orderregel heeft geen variant.",400);
      }

      return {
        organization_id: organizationId,
        sales_order_id: id,
        variant_id: variantId,
        quantity:num(l.quantity),
        delivered_quantity:0,
        reserved_quantity:0,
        unit_price:num(l.unitPrice),
        discount_percentage:num(l.discountPercentage),
        line_total:num(l.quantity)*num(l.unitPrice)*(1-num(l.discountPercentage)/100),
        profile:l,
      };
    });

    const { error: insertError } = await supabase
      .from("sales_order_lines")
      .insert(inserts);
    if(insertError) throw new ApiError(insertError.message);
  }

  if (isConfirming || isEditingConfirmed) {
    await reserveBatchForOrder(supabase, organizationId, stockLocationId, id);
  }

  const {data,error:readError}=await supabase.from("sales_orders").select("*, sales_order_lines(*)").eq("id",id).single();if(readError)throw new ApiError(readError.message);return NextResponse.json(order(data as Row));}catch(e){return response(e);}}
export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;const {supabase,organizationId}=await context();const {data}=await supabase.from("sales_orders").select("status").eq("organization_id",organizationId).eq("id",id).maybeSingle();if(!data)throw new ApiError("Verkooporder niet gevonden.",404);if(data.status!=="Concept")throw new ApiError("Alleen conceptorders kunnen worden verwijderd.",400);const {error}=await supabase.from("sales_orders").delete().eq("organization_id",organizationId).eq("id",id);if(error)throw new ApiError(error.message);return NextResponse.json({ok:true});}catch(e){return response(e);}}
