export type MasterDataEntity =
  | "brands"
  | "suppliers"
  | "collections"
  | "productTypes"
  | "categories"
  | "materials"
  | "fits"
  | "colorFamilies"
  | "sizes"
  | "seasons"
  | "countries";

export type MasterDataItem = {

  id: string;
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};




export type SupplierStatus = "Actief" | "Inactief";

export type Supplier = {
  id: string;
  supplierNumber: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  country: string;
  customerType: import("@/lib/vat-engine").CustomerType;
  vatNumber: string;
  vatNumberStatus: import("@/lib/vat-engine").VatNumberStatus;
  vatNumberCheckedAt: string;
  transactionNature: "Goederen" | "Diensten";
  language: import("@/lib/language").RelationLanguage;
  paymentDays: number;
  status: SupplierStatus;
};

export type NamedMasterData = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};
export type CollectionStatus = "Concept" | "Actief" | "Gearchiveerd";

export type Collection = MasterDataItem & {
  season: string;
  year: number;
  status: CollectionStatus;
  startDate: string;
  endDate: string;
};

export const masterDataLabels: Record<MasterDataEntity, string> = {
  brands: "Merken",
  suppliers: "Leveranciers",
  collections: "Collecties",
  productTypes: "Producttypes",
  categories: "Categorieën",
  materials: "Materialen",
  fits: "Pasvormen",
  colorFamilies: "Kleurgroepen",
  sizes: "Maten",
  seasons: "Seizoenen",
  countries: "Landen",
};

const STORAGE_KEY = "stitch-master-data-v1";
const CHANGE_EVENT = "stitch-master-data-change";
let masterDataCache: Record<MasterDataEntity, MasterDataItem[]> | null = null;
let customerCache: Customer[] = [];

const initialNames: Record<MasterDataEntity, string[]> = {
  brands: ["Demo Fashion"],
  suppliers: [
    "Nordic Fashion Supply",
    "Milano Textile Group",
    "Porto Garments",
    "Noir",
    "Mode Sofia",
    "Wolf",
    "LUMA s.r.l",
    "Luma",
    "Mode Sofia srl",
    "Fashion",
    "arnanknit",
  ],
  collections: ["Core", "AW27", "SS27"],
  productTypes: ["T-shirt", "Blouse", "Jas", "Broek", "Jurk", "Trui"],
  categories: ["T-shirts", "Blouses", "Jassen", "Broeken", "Jurken", "Truien"],
  materials: [
    "100% katoen",
    "Biologisch katoen",
    "Linnen",
    "Wol",
    "Merinowol",
    "Viscose",
    "Polyester",
    "Denim",
    "Leer",
  ],
  fits: ["Slim fit", "Regular fit", "Relaxed fit", "Oversized", "Tailored fit"],
  colorFamilies: [
    "Zwart",
    "Wit",
    "Grijs",
    "Blauw",
    "Groen",
    "Rood",
    "Roze",
    "Paars",
    "Geel",
    "Oranje",
    "Bruin",
    "Beige",
    "Army light green",
  ],
  sizes: ["XXS","XS","S","M","L","XL","XXL","34","36","38","40","42","44"],
  seasons: ["Voorjaar/Zomer", "Herfst/Winter", "Doorlopend"],
  countries: [
    "Nederland",
    "België",
    "Duitsland",
    "Portugal",
    "Italië",
    "Spanje",
    "Turkije",
    "China",
    "India",
    "Bangladesh",
  ],
};

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function createMasterId(prefix: string, value: string) {
  return `${prefix}-${slug(value)}-${Date.now()}`;
}

function createInitialStore(): Record<MasterDataEntity, MasterDataItem[]> {
  const now = new Date().toISOString();

  return Object.fromEntries(
    Object.entries(initialNames).map(([entity, names]) => [
      entity,
      names.map((name, index) => ({
        id: `${entity}-${slug(name)}`,
        code: slug(name).toUpperCase().replace(/-/g, "_"),
        name,
        active: true,
        sortOrder: index + 1,
        notes: "",
        createdAt: now,
        updatedAt: now,
      })),
    ]),
  ) as Record<MasterDataEntity, MasterDataItem[]>;
}

function isBrowser() {
  return typeof window !== "undefined";
}

function normalizeMasterDataStore(
  value: unknown,
): Record<MasterDataEntity, MasterDataItem[]> {
  const fallback = createInitialStore();
  const parsed =
    value && typeof value === "object"
      ? (value as Partial<Record<MasterDataEntity, MasterDataItem[]>>)
      : {};

  return Object.fromEntries(
    (Object.keys(initialNames) as MasterDataEntity[]).map((entity) => [
      entity,
      Array.isArray(parsed[entity]) ? parsed[entity] : fallback[entity],
    ]),
  ) as Record<MasterDataEntity, MasterDataItem[]>;
}

export function getMasterDataStore(): Record<MasterDataEntity, MasterDataItem[]> {
  if (!masterDataCache) {
    console.warn(
      "[master-data] requested before hydration, using temporary defaults",
    );
    masterDataCache = createInitialStore();
  }

  return masterDataCache;
}

async function persistMasterDataStore(
  store: Record<MasterDataEntity, MasterDataItem[]>,
) {
  const response = await fetch("/api/shared-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: STORAGE_KEY, value: JSON.stringify(store) }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? "Stamgegevens konden niet worden opgeslagen.");
  }
}

export async function hydrateMasterData(): Promise<void> {
  const response = await fetch("/api/shared-state", {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Stamgegevens konden niet uit Supabase worden geladen.");
  }

  const payload = (await response.json()) as {
    items?: Array<{ key?: string; value?: string }>;
  };
  const entry = payload.items?.find((item) => item.key === STORAGE_KEY);

  if (entry?.value) {
    try {
      masterDataCache = normalizeMasterDataStore(JSON.parse(entry.value));
    } catch {
      masterDataCache = createInitialStore();
    }
  } else {
    masterDataCache = createInitialStore();
    await persistMasterDataStore(masterDataCache);
  }

  const suppliers =
    masterDataCache.suppliers;

  const requiredSuppliers = [
    "Nordic Fashion Supply",
    "Milano Textile Group",
    "Porto Garments",
    "Aranknit srl",
    "LUMA s.r.l",
    "MIM'S Moda srl",
    "Mode Sofia srl",
    "Noir Abbigliamento",
    "Pullover srl",
    "Wolf Group s.r.l.",
  ];

  const now =
    new Date().toISOString();

  const requiredColorFamilies = [
    "Army light green",
    "Navy",
  ];

  const colorFamilies =
    masterDataCache.colorFamilies;

  let colorFamiliesChanged = false;

  requiredColorFamilies.forEach((name) => {
    const exists =
      colorFamilies.some(
        (item) =>
          item.name.toLowerCase() ===
          name.toLowerCase(),
      );

    if (!exists) {
      colorFamilies.push({
        id: `colorFamilies-${slug(name)}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        code: slug(name)
          .toUpperCase()
          .replace(/-/g, "_"),
        name,
        active: true,
        sortOrder:
          colorFamilies.length + 1,
        notes: "",
        createdAt: now,
        updatedAt: now,
      });

      colorFamiliesChanged = true;
    }
  });

  let suppliersChanged = false;

  requiredSuppliers.forEach((name) => {
    const exists =
      suppliers.some(
        (item) =>
          item.name.toLowerCase() ===
          name.toLowerCase(),
      );

    if (!exists) {
      suppliers.push({
        id: `suppliers-${name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")}`,
        code: name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_"),
        name,
        active: true,
        sortOrder: suppliers.length + 1,
        notes: "",
        createdAt: now,
        updatedAt: now,
      });

      suppliersChanged = true;
    }
  });

  masterDataCache.suppliers = suppliers;

  // Alleen terugschrijven als er echt iets is toegevoegd. Een
  // onvoorwaardelijke schrijfactie bij iedere paginalaad overschreef
  // wijzigingen die intussen in een ander tabblad waren opgeslagen.
  if (colorFamiliesChanged || suppliersChanged) {
    await persistMasterDataStore(
      masterDataCache,
    );
  }

  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

let persistInFlight: Promise<void> | null = null;
let persistQueued = false;

// Stamgegevens worden als één geheel opgeslagen. Gelijktijdige
// schrijfacties konden in willekeurige volgorde aankomen, waardoor een
// oudere versie (bijv. van vóór een hernoeming) als laatste won. We
// schrijven daarom één voor één en altijd de nieuwste stand.
function schedulePersistMasterData() {
  if (persistInFlight) {
    persistQueued = true;
    return;
  }

  persistInFlight = (async () => {
    try {
      do {
        persistQueued = false;
        if (masterDataCache) {
          await persistMasterDataStore(masterDataCache);
        }
      } while (persistQueued);
    } catch (error) {
      console.error("Stamgegevens konden niet in Supabase worden opgeslagen.", error);
    } finally {
      persistInFlight = null;
    }
  })();
}

function saveMasterDataStore(
  store: Record<MasterDataEntity, MasterDataItem[]>,
) {
  masterDataCache = store;

  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }

  schedulePersistMasterData();
}

async function propagateColorRename(from: string, to: string) {
  const response = await fetch("/api/master-data/rename-color", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? "Kleur hernoemen op artikelen mislukt.");
  }

  const { fetchProducts } = await import("@/lib/articles");
  await fetchProducts();
}

export function getMasterDataItems(
  entity: MasterDataEntity,
  includeInactive = false,
) {
  return getMasterDataStore()[entity]
    .filter((item) => includeInactive || item.active)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.name.localeCompare(right.name, "nl"),
    );
}

export function addMasterDataItem(
  entity: MasterDataEntity,
  name: string,
  code?: string,
) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Naam is verplicht.");

  const store = getMasterDataStore();
  const existing = store[entity].find(
    (item) => item.name.toLowerCase() === cleanName.toLowerCase(),
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const item: MasterDataItem = {
    id: `${entity}-${slug(cleanName)}-${Date.now()}`,
    code: code?.trim() || slug(cleanName).toUpperCase().replace(/-/g, "_"),
    name: cleanName,
    active: true,
    sortOrder: store[entity].length + 1,
    notes: "",
    createdAt: now,
    updatedAt: now,
  };

  saveMasterDataStore({ ...store, [entity]: [...store[entity], item] });
  return item;
}

export function updateMasterDataItem(
  entity: MasterDataEntity,
  id: string,
  changes: Partial<
    Pick<MasterDataItem, "code" | "name" | "active" | "sortOrder" | "notes">
  >,
) {
  const store = getMasterDataStore();
  const previous = store[entity].find((item) => item.id === id);

  saveMasterDataStore({
    ...store,
    [entity]: store[entity].map((item) =>
      item.id === id
        ? { ...item, ...changes, updatedAt: new Date().toISOString() }
        : item,
    ),
  });

  const nextName = changes.name?.trim();

  if (
    entity === "colorFamilies" &&
    previous &&
    nextName &&
    nextName !== previous.name
  ) {
    void propagateColorRename(previous.name, nextName).catch((error) => {
      console.error(error);
      if (isBrowser()) {
        window.alert(
          `De kleur is hernoemd, maar niet op alle artikelen doorgevoerd: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
  }
}

export function deleteMasterDataItem(
  entity: MasterDataEntity,
  id: string,
) {
  const store = getMasterDataStore();
  saveMasterDataStore({
    ...store,
    [entity]: store[entity].filter((item) => item.id !== id),
  });
}

export function subscribeToMasterData(callback: () => void) {
  if (!isBrowser()) return () => undefined;
  const listener = () => callback();
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export type CustomerStatus = "Actief" | "Inactief";

export type Customer = {
  id: string;
  customerNumber: string;
  companyName: string;
  contactPerson: string;
  email: string;

  invoiceEmail: string;
  invoiceCc: string;
  orderEmail: string;
  orderCc: string;
  deliveryEmail: string;
  deliveryCc: string;

  phone: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  chamberOfCommerceNumber: string;
  customerType: import("@/lib/vat-engine").CustomerType;
  vatNumber: string;
  vatNumberStatus: import("@/lib/vat-engine").VatNumberStatus;
  vatNumberCheckedAt: string;
  transactionNature: "Goederen" | "Diensten";
  language: import("@/lib/language").RelationLanguage;
  paymentDays: number;
  paymentDiscountPercentage: number;
  paymentDiscountDays: number;
  discountPercentage: number;
  priceListId: string;
  status: CustomerStatus;
};

export type CustomerMasterData = Customer;

function normalizeCustomer(
  value: Partial<Customer> & Record<string, unknown>,
  index: number,
): Customer {
  return {
    id: typeof value.id === "string" ? value.id : `customer-${index + 1}`,
    customerNumber:
      typeof value.customerNumber === "string"
        ? value.customerNumber
        : `KLT-${String(index + 1).padStart(4, "0")}`,
    companyName:
      typeof value.companyName === "string"
        ? value.companyName
        : typeof value.name === "string"
          ? value.name
          : "Onbekende klant",
    contactPerson:
      typeof value.contactPerson === "string" ? value.contactPerson : "",
    email: typeof value.email === "string" ? value.email : "",

    invoiceEmail:
      typeof value.invoiceEmail === "string"
        ? value.invoiceEmail
        : "",
    invoiceCc:
      typeof value.invoiceCc === "string"
        ? value.invoiceCc
        : "",
    orderEmail:
      typeof value.orderEmail === "string"
        ? value.orderEmail
        : "",
    orderCc:
      typeof value.orderCc === "string"
        ? value.orderCc
        : "",
    deliveryEmail:
      typeof value.deliveryEmail === "string"
        ? value.deliveryEmail
        : "",
    deliveryCc:
      typeof value.deliveryCc === "string"
        ? value.deliveryCc
        : "",

    phone: typeof value.phone === "string" ? value.phone : "",
    address: typeof value.address === "string" ? value.address : "",
    postalCode: typeof value.postalCode === "string" ? value.postalCode : "",
    city: typeof value.city === "string" ? value.city : "",
    country: typeof value.country === "string" ? value.country : "Nederland",
    chamberOfCommerceNumber:
      typeof value.chamberOfCommerceNumber === "string"
        ? value.chamberOfCommerceNumber
        : "",
    customerType: value.customerType ?? "Zakelijk",
    vatNumber: typeof value.vatNumber === "string" ? value.vatNumber : "",
    vatNumberStatus: value.vatNumberStatus ?? "Niet gecontroleerd",
    vatNumberCheckedAt:
      typeof value.vatNumberCheckedAt === "string" ? value.vatNumberCheckedAt : "",
    transactionNature: value.transactionNature ?? "Goederen",
    language: value.language ?? "Nederlands",
    paymentDays: typeof value.paymentDays === "number" ? value.paymentDays : 30,
    paymentDiscountPercentage:
      typeof value.paymentDiscountPercentage === "number"
        ? value.paymentDiscountPercentage
        : 0,
    paymentDiscountDays:
      typeof value.paymentDiscountDays === "number" ? value.paymentDiscountDays : 0,
    discountPercentage:
      typeof value.discountPercentage === "number" ? value.discountPercentage : 0,
    priceListId:
      typeof value.priceListId === "string"
        ? value.priceListId
        : "price-list-standard",
    status: value.status === "Inactief" ? "Inactief" : "Actief",
  };
}

export function getCustomers(): Customer[] {
  return customerCache;
}

export function setCustomerCache(customers: Customer[]) {
  customerCache = customers.map((customer, index) =>
    normalizeCustomer(
      customer as Partial<Customer> & Record<string, unknown>,
      index,
    ),
  );
}

export async function hydrateCustomers(): Promise<void> {
  const response = await fetch("/api/customers", {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Klanten konden niet uit Supabase worden geladen.");
  }
  setCustomerCache((await response.json()) as Customer[]);
}

export function saveCustomers(customers: Customer[]) {
  setCustomerCache(customers);
  void Promise.all(
    customerCache.map(async (customer) => {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Klant kon niet worden opgeslagen.");
      }
    }),
  ).catch((error) => {
    console.error("Klanten konden niet in Supabase worden opgeslagen.", error);
  });
}


function toNamedMasterData(item: MasterDataItem): NamedMasterData {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    isActive: item.active,
  };
}


export const getBrands = () => getMasterDataItems("brands").map(toNamedMasterData);

export const getSuppliers = (): Supplier[] =>
  getMasterDataItems("suppliers", true).map((item, index) => {
    const stored = item as MasterDataItem & Partial<Supplier>;

    return {
      id: item.id,
      supplierNumber:
        stored.supplierNumber ?? `LEV-${String(index + 1).padStart(4, "0")}`,
      companyName: stored.companyName ?? item.name,
      contactPerson: stored.contactPerson ?? "",
      email: stored.email ?? "",
      phone: stored.phone ?? "",
      country: stored.country ?? "Nederland",
      customerType: stored.customerType ?? "Zakelijk",
      vatNumber: stored.vatNumber ?? "",
      vatNumberStatus: stored.vatNumberStatus ?? "Niet gecontroleerd",
      vatNumberCheckedAt: stored.vatNumberCheckedAt ?? "",
      transactionNature: stored.transactionNature ?? "Goederen",
      language: stored.language ?? "Nederlands",
      paymentDays: stored.paymentDays ?? 30,
      status: stored.status ?? (item.active ? "Actief" : "Inactief"),
    };
  });

export function saveSuppliers(suppliers: Supplier[]) {
  const store = getMasterDataStore();
  const now = new Date().toISOString();

  store.suppliers = suppliers.map((supplier, index) => ({
    ...supplier,
    code: supplier.supplierNumber,
    name: supplier.companyName,
    active: supplier.status === "Actief",
    sortOrder: index + 1,
    notes: "",
    createdAt:
      (supplier as Supplier & Partial<MasterDataItem>).createdAt ?? now,
    updatedAt: now,
  }));

  saveMasterDataStore(store);
}

export function getCollections(): Collection[] {
  const currentYear = new Date().getFullYear();

  return getMasterDataItems("collections", true).map((item) => {
    const stored = item as Partial<Collection>;

    return {
      ...item,
      season: stored.season ?? "Doorlopend",
      year: stored.year ?? currentYear,
      status: stored.status ?? (item.active ? "Actief" : "Gearchiveerd"),
      startDate: stored.startDate ?? "",
      endDate: stored.endDate ?? "",
    };
  });
}

export function saveCollections(collections: Collection[]) {
  const store = getMasterDataStore();
  const now = new Date().toISOString();

  store.collections = collections.map((collection, index) => ({
    ...collection,
    active: collection.status !== "Gearchiveerd",
    sortOrder: collection.sortOrder || index + 1,
    notes: collection.notes || "",
    createdAt: collection.createdAt || now,
    updatedAt: now,
  }));

  saveMasterDataStore(store);
}

export const getProductTypes = () => getMasterDataItems("productTypes").map(toNamedMasterData);

export const getCategories = () => getMasterDataItems("categories", true).map(toNamedMasterData);

export const getMaterials = () => getMasterDataItems("materials").map(toNamedMasterData);

export const getFits = () => getMasterDataItems("fits").map(toNamedMasterData);

export const getCountries = () => getMasterDataItems("countries").map(toNamedMasterData);

export const getColors = () => getMasterDataItems("colorFamilies", true).map(toNamedMasterData);


export function resolveColor(
  colorName: string,
): NamedMasterData | undefined {
  const normalized = colorName
    .trim()
    .toLowerCase();

  return getColors().find(
    (color) =>
      color.name
        .trim()
        .toLowerCase() === normalized,
  );
}

export const getSizes = () => getMasterDataItems("sizes", true).map(toNamedMasterData);