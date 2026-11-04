"use client";

import { createClient } from "@/lib/supabase/client";

export type PriceMode =
  | "automatic"
  | "semi-automatic"
  | "manual";

export type PriceRounding =
  | "none"
  | "0.50"
  | "0.95"
  | "1.00";

export type CompanySettings = {
  company: {
    name: string;
    tradeName: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
    email: string;
    phone: string;
    website: string;
    emailFromName: string;
    emailFromAddress: string;
    emailReplyTo: string;
    emailBcc: string;
    chamberOfCommerceNumber: string;
    vatNumber: string;
    iban: string;
    bic: string;
    logoDataUrl: string;
  };
  pricing: {
    brandMarkup: number;
    retailerMarkup: number;
    vatPercentage: number;
    rounding: PriceRounding;
    mode: PriceMode;
  };
  numbering: {
    articlePrefix: string;
    salesOrderPrefix: string;
    purchaseOrderPrefix: string;
    invoicePrefix: string;
    receiptPrefix: string;
  };
  documents: {
    showCompanyDetails: boolean;
    showBankDetails: boolean;
    showVatNumber: boolean;
    footerText: string;
    paymentText: string;
  };
  sales: {
    defaultPaymentDays: number;
    reserveStockOnConfirmation: boolean;
    automaticallyCreateInvoice: boolean;
  };
  purchasing: {
    defaultPaymentDays: number;
    defaultCurrency: string;
  };
};

export type PricingDefaults = CompanySettings["pricing"];

type CompanySettingsRow = {
  organization_id: string;
  settings: unknown;
};

export const companySettingsChangedEvent =
  "fashion-erp-company-settings-changed";

export const defaultCompanySettings: CompanySettings = {
  company: {
    name: "",
    tradeName: "",
    address: "",
    postalCode: "",
    city: "",
    country: "Nederland",
    email: "",
    phone: "",
    website: "",
    emailFromName: "",
    emailFromAddress: "",
    emailReplyTo: "",
    emailBcc: "",
    chamberOfCommerceNumber: "",
    vatNumber: "",
    iban: "",
    bic: "",
    logoDataUrl: "",
  },
  pricing: {
    brandMarkup: 2.1,
    retailerMarkup: 2.8,
    vatPercentage: 21,
    rounding: "0.95",
    mode: "semi-automatic",
  },
  numbering: {
    articlePrefix: "ART",
    salesOrderPrefix: "V",
    purchaseOrderPrefix: "I",
    invoicePrefix: "F",
    receiptPrefix: "IO",
  },
  documents: {
    showCompanyDetails: true,
    showBankDetails: true,
    showVatNumber: true,
    footerText:
      "Dit document is gegenereerd vanuit STITCH ERP Fashion Management.",
    paymentText:
      "Gelieve het factuurbedrag binnen de afgesproken betalingstermijn te voldoen.",
  },
  sales: {
    defaultPaymentDays: 30,
    reserveStockOnConfirmation: false,
    automaticallyCreateInvoice: false,
  },
  purchasing: {
    defaultPaymentDays: 30,
    defaultCurrency: "EUR",
  },
};

let cachedSettings: CompanySettings = defaultCompanySettings;
let cachedOrganizationId = "";

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function percentage(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(parsed, 100)
    : fallback;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function mergeSettings(
  stored: Partial<CompanySettings>,
): CompanySettings {
  const pricing: Partial<CompanySettings["pricing"]> =
    stored.pricing ?? {};

  return {
    company: {
      ...defaultCompanySettings.company,
      ...(stored.company ?? {}),
    },
    pricing: {
      ...defaultCompanySettings.pricing,
      ...pricing,
      brandMarkup: positiveNumber(
        pricing.brandMarkup,
        defaultCompanySettings.pricing.brandMarkup,
      ),
      retailerMarkup: positiveNumber(
        pricing.retailerMarkup,
        defaultCompanySettings.pricing.retailerMarkup,
      ),
      vatPercentage: percentage(
        pricing.vatPercentage,
        defaultCompanySettings.pricing.vatPercentage,
      ),
    },
    numbering: {
      ...defaultCompanySettings.numbering,
      ...(stored.numbering ?? {}),
    },
    documents: {
      ...defaultCompanySettings.documents,
      ...(stored.documents ?? {}),
    },
    sales: {
      ...defaultCompanySettings.sales,
      ...(stored.sales ?? {}),
    },
    purchasing: {
      ...defaultCompanySettings.purchasing,
      ...(stored.purchasing ?? {}),
    },
  };
}

function parseSettings(value: unknown): CompanySettings {
  return mergeSettings(
    isRecord(value)
      ? (value as Partial<CompanySettings>)
      : {},
  );
}

function dispatchSettingsChanged(settings: CompanySettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(companySettingsChangedEvent, {
      detail: settings,
    }),
  );
}

async function getActiveOrganizationId(): Promise<string> {
  if (cachedOrganizationId) {
    return cachedOrganizationId;
  }

  const supabase = createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("Je bent niet ingelogd.");
  }

  const {
    data: preferences,
    error: preferencesError,
  } = await supabase
    .from("user_preferences")
    .select("active_organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (preferencesError) {
    throw preferencesError;
  }

  let organizationId =
    preferences?.active_organization_id ?? "";

  if (!organizationId) {
    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    organizationId = membership?.organization_id ?? "";
  }

  if (!organizationId) {
    throw new Error("Geen actieve organisatie gevonden.");
  }

  cachedOrganizationId = organizationId;
  return organizationId;
}

export function getCompanySettings(): CompanySettings {
  return cachedSettings;
}

export function getPricingDefaults(): PricingDefaults {
  return cachedSettings.pricing;
}

export async function loadCompanySettings(): Promise<CompanySettings> {
  const supabase = createClient();
  const organizationId = await getActiveOrganizationId();

  const { data, error } = await supabase
    .from("company_settings")
    .select("organization_id, settings")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = data as CompanySettingsRow | null;

  if (row?.settings) {
    cachedSettings = parseSettings(row.settings);
    dispatchSettingsChanged(cachedSettings);
    return cachedSettings;
  }

  const initialSettings = defaultCompanySettings;

  const { error: insertError } = await supabase
    .from("company_settings")
    .upsert(
      {
        organization_id: organizationId,
        settings: initialSettings,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "organization_id",
      },
    );

  if (insertError) {
    throw insertError;
  }

  cachedSettings = mergeSettings(initialSettings);
  dispatchSettingsChanged(cachedSettings);

  return cachedSettings;
}

export async function saveCompanySettings(
  settings: CompanySettings,
): Promise<CompanySettings> {
  const normalized = mergeSettings(settings);
  const supabase = createClient();
  const organizationId = await getActiveOrganizationId();

  const { error } = await supabase
    .from("company_settings")
    .upsert(
      {
        organization_id: organizationId,
        settings: normalized,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "organization_id",
      },
    );

  if (error) {
    throw error;
  }

  cachedSettings = normalized;
  dispatchSettingsChanged(normalized);

  return normalized;
}

export async function resetCompanySettings(): Promise<CompanySettings> {
  return saveCompanySettings(defaultCompanySettings);
}

export function roundCommercialPrice(
  value: number,
  rounding: PriceRounding,
) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  // Eerst op centen afronden: een opslagfactor met 4 decimalen geeft
  // bijv. 44,10 × 3,1735 = 139,95135. Zonder deze stap werd dat
  // 140,95 in plaats van 139,95.
  const cents = Math.round(value * 100);

  if (rounding === "none") {
    return cents / 100;
  }

  if (rounding === "1.00") {
    return Math.ceil(cents / 100);
  }

  const endingCents = rounding === "0.50" ? 50 : 95;
  const baseCents = Math.floor(cents / 100) * 100;
  const candidateCents = baseCents + endingCents;

  return (
    (candidateCents >= cents
      ? candidateCents
      : baseCents + 100 + endingCents) / 100
  );
}
