"use client";

export type SalesOrderStatus = "Concept" | "Bevestigd" | "Gereserveerd" | "Gereed" | "Verzonden" | "Geannuleerd";
export type SalesOrderLine = { id:string; productId:string; productCode:string; productName:string; variantId:string; sku:string; color:string; size:string; quantity:number; deliveredQuantity:number; reservedQuantity:number; unitPrice:number; recommendedRetailPrice:number; discountPercentage:number; productionNote?:string; originalQuantity?:number; };
export type SalesOrder = { id:string; orderNumber:string; customerId:string; customerNumber:string; customerName:string; contactPerson:string; email:string; invoiceEmail:string; invoiceCc:string; orderEmail:string; orderCc:string; deliveryEmail:string; deliveryCc:string; city:string; orderDate:string; requestedDeliveryDate:string; status:SalesOrderStatus; paymentDays:number; paymentDiscountPercentage:number; paymentDiscountDays:number; discountPercentage:number; notes:string; lines:SalesOrderLine[]; createdAt:string; updatedAt:string; changedAfterConfirmationAt?:string|null; };
export type SalesOrderInput = Omit<SalesOrder,"id"|"orderNumber"|"orderDate"|"createdAt"|"updatedAt"|"lines"|"changedAfterConfirmationAt"> & { lines:Omit<SalesOrderLine,"id"|"deliveredQuantity"|"reservedQuantity">[] };
export type SalesOrderAvailability = { orderedQuantity:number; deliveredQuantity:number; openQuantity:number; reservedQuantity:number; backorderQuantity:number; allocationPercentage:number; fullyAllocated:boolean; };

let cache: SalesOrder[] = [];
const parse = async <T>(response:Response):Promise<T> => { const body=await response.json().catch(()=>({})); if(!response.ok) throw new Error(String(body.error??"De verkooporderbewerking is mislukt.")); return body as T; };
const put = async (order:SalesOrder) => { const updated=await parse<SalesOrder>(await fetch(`/api/sales-orders/${order.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(order)})); cache=cache.map(o=>o.id===updated.id?updated:o); return updated; };
export function getSalesOrders(){ return cache; }
export async function loadSalesOrders(){ cache=await parse<SalesOrder[]>(await fetch("/api/sales-orders",{cache:"no-store"})); return cache; }
export function saveSalesOrders(orders:SalesOrder[]){ cache=orders; }
export function getSalesOrderById(id:string){ return cache.find(o=>o.id===id)??null; }
export async function loadSalesOrderById(id:string){ 
  const order=await parse<SalesOrder>(await fetch(`/api/sales-orders/${id}`,{cache:"no-store"})); 
  console.log("LOADED SALES ORDER EMAIL DATA", {
    id: order.id,
    email: order.email,
    orderEmail: order.orderEmail,
    orderCc: order.orderCc,
    deliveryEmail: order.deliveryEmail,
    invoiceEmail: order.invoiceEmail,
  });
  cache=[...cache.filter(o=>o.id!==id),order]; 
  return order; 
}
export async function createSalesOrder(input:SalesOrderInput){ const order=await parse<SalesOrder>(await fetch("/api/sales-orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)})); cache=[order,...cache]; return order; }
export function getSalesOrderAvailability(order:SalesOrder):SalesOrderAvailability { const orderedQuantity=order.lines.reduce((t,l)=>t+l.quantity,0); const deliveredQuantity=order.lines.reduce((t,l)=>t+l.deliveredQuantity,0); const openQuantity=Math.max(0,orderedQuantity-deliveredQuantity); const reservedQuantity=order.lines.reduce((t,l)=>t+Math.min(l.reservedQuantity,Math.max(0,l.quantity-l.deliveredQuantity)),0); const backorderQuantity=Math.max(0,openQuantity-reservedQuantity); return {orderedQuantity,deliveredQuantity,openQuantity,reservedQuantity,backorderQuantity,allocationPercentage:openQuantity?Math.round(reservedQuantity/openQuantity*100):100,fullyAllocated:backorderQuantity===0}; }
export async function confirmSalesOrder(id:string){
  const o = await loadSalesOrderById(id);

  if (!o) {
    throw new Error(
      "Verkooporder niet gevonden.",
    );
  }

  if (o.status !== "Concept") {
    return o;
  }

  return put({
    ...o,
    status: "Bevestigd",
    updatedAt: new Date().toISOString(),
  });
}
export async function allocateSalesOrderStock(id:string){ await parse(await fetch(`/api/sales-orders/${id}/allocate`,{method:"POST"})); return loadSalesOrderById(id); }
export async function declineOrderLineProduction(id:string, productId:string, color:string){ await parse(await fetch(`/api/sales-orders/${id}/decline-production`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId,color})})); return loadSalesOrderById(id); }
export async function allocateOpenSalesOrders(){ const result=[] as SalesOrder[]; for(const o of cache.filter(x=>["Bevestigd","Gereserveerd"].includes(x.status))) result.push(await allocateSalesOrderStock(o.id)); return result; }
export async function markSalesOrderReady(id:string){ const o=getSalesOrderById(id); if(!o) throw new Error("Verkooporder niet gevonden."); if(o.status!=="Gereserveerd") throw new Error("Alleen volledig gereserveerde orders kunnen gereedgemeld worden."); if(!getSalesOrderAvailability(o).fullyAllocated) throw new Error("De order is nog niet volledig gereserveerd."); return put({...o,status:"Gereed",updatedAt:new Date().toISOString()}); }
export async function cancelSalesOrder(id:string){ const o=getSalesOrderById(id); if(!o) throw new Error("Verkooporder niet gevonden."); return put({...o,status:"Geannuleerd",lines:o.lines.map(l=>({...l,reservedQuantity:0})),updatedAt:new Date().toISOString()}); }
// Na het opnieuw versturen van de orderbevestiging vervalt de melding "gewijzigd na bevestiging".
export async function clearSalesOrderChangeNotice(id:string){ const o=getSalesOrderById(id)??await loadSalesOrderById(id); return put({...o,changedAfterConfirmationAt:null}); }
export async function deleteSalesOrder(id:string){ await parse(await fetch(`/api/sales-orders/${id}`,{method:"DELETE"})); cache=cache.filter(o=>o.id!==id); }
export function getSalesOrderTotals(order:SalesOrder){ const subtotalBeforeDiscount=order.lines.reduce((t,l)=>t+l.quantity*l.unitPrice,0); const discountAmount=order.lines.reduce((t,l)=>t+l.quantity*l.unitPrice*(l.discountPercentage/100),0); const subtotal=subtotalBeforeDiscount-discountAmount; const vat=subtotal*.21; const quantity=order.lines.reduce((t,l)=>t+l.quantity,0); const deliveredQuantity=order.lines.reduce((t,l)=>t+l.deliveredQuantity,0); const reservedQuantity=order.lines.reduce((t,l)=>t+l.reservedQuantity,0); return {subtotalBeforeDiscount,discountAmount,subtotal,vat,total:subtotal+vat,quantity,deliveredQuantity,reservedQuantity,backorderQuantity:Math.max(0,quantity-deliveredQuantity-reservedQuantity)}; }
