"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  companySettingsChangedEvent,
  defaultCompanySettings,
  getCompanySettings,
} from "@/lib/company-settings";
import {
  getStitchModuleSettings,
  type StitchModuleSettings,
} from "@/lib/module-settings";
import styles from "./sidebar.module.css";
import {
  AppIcon,
  type AppIconName,
} from "@/components/ui/app-icon";

type NavigationItem = {
  label: string;
  href: string;
  icon: AppIconName;
  module?: keyof StitchModuleSettings;
};

type NavigationGroup = {
  id: string;
  label: string;
  icon: AppIconName;
  items: NavigationItem[];
};

const groups: NavigationGroup[] = [
  {
    id: "verkoop",
    label: "Verkoop",
    icon: "sales",
    items: [
      {
        label: "Orders",
        href: "/verkoop",
        icon: "document",
      },
      {
        label: "Retouren",
        href: "/retouren",
        icon: "clock",
      },
      {
        label: "Klanten",
        href: "/klanten",
        icon: "customers",
      },
    ],
  },
  {
    id: "inkoop",
    label: "Inkoop",
    icon: "purchasing",
    items: [
      {
        label: "Inkoopbehoefte",
        href: "/inkoop/behoefte",
        icon: "sales",
      },
      {
        label: "Inkooporders",
        href: "/inkoop",
        icon: "document",
      },
      {
        label: "Totaaloverzicht",
        href: "/inkoop/totaal",
        icon: "document",
      },
      {
        label: "Ontvangsten",
        href: "/inkoop/ontvangsten",
        icon: "check",
      },
      {
        label: "Leveranciers",
        href: "/leveranciers",
        icon: "suppliers",
      },
      {
        label: "Supply Intelligence",
        href: "/supply-intelligence",
        icon: "sales",
      },
      {
        label: "Productie",
        href: "/productie",
        icon: "box",
        module: "production",
      },
    ],
  },
  {
    id: "producten",
    label: "Producten",
    icon: "products",
    items: [
      { label: "Artikelen", href: "/artikelen", icon: "products" },
      { label: "Collecties", href: "/collecties", icon: "document" },
      { label: "Stamgegevens", href: "/instellingen/stamgegevens", icon: "settings" },
    ],
  },
  {
    id: "voorraad",
    label: "Voorraad",
    icon: "inventory",
    items: [
      {
        label: "Warehouse",
        href: "/warehouse",
        icon: "inventory",
      },
      {
        label: "Voorraadoverzicht",
        href: "/voorraad",
        icon: "inventory",
      },
      {
        label: "Voorraadlocaties",
        href: "/instellingen/voorraadlocaties",
        icon: "inventory",
      },
      {
        label: "Voorraadtellingen",
        href: "/warehouse/tellingen",
        icon: "document",
      },
    ],
  },
  {
    id: "financieel",
    label: "Financieel",
    icon: "finance",
    items: [
      {
        label: "Facturen",
        href: "/facturen",
        icon: "document",
      },
      {
        label: "Creditfacturen",
        href: "/creditfacturen",
        icon: "document",
      },
      {
        label: "Debiteuren",
        href: "/debiteuren",
        icon: "wallet",
      },
      {
        label: "Exact Online",
        href: "/instellingen/exact-online",
        icon: "finance",
      },
    ],
  },
  {
    id: "rapportages",
    label: "Rapportages",
    icon: "inventory",
    items: [
      {
        label: "Rapportages",
        href: "/rapportages",
        icon: "sales",
      },
    ],
  },
  {
    id: "ai-studio",
    label: "AI Studio",
    icon: "products",
    items: [
      {
        label: "Overzicht",
        href: "/ai-studio",
        icon: "dashboard",
      },
      {
        label: "Workspace",
        href: "/ai-studio/workspace",
        icon: "products",
      },
      {
        label: "Model Studio",
        href: "/ai-studio/model-studio",
        icon: "customers",
      },
      {
        label: "Referenties",
        href: "/ai-studio/referenties",
        icon: "document",
      },
      {
        label: "Bibliotheek",
        href: "/ai-studio/bibliotheek",
        icon: "inventory",
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] =
    useState<string[]>([]);
  const [moduleSettings, setModuleSettings] =
    useState<StitchModuleSettings>({
      production: false,
    });
  const [company, setCompany] = useState(
    defaultCompanySettings.company,
  );

  useEffect(() => {
    function reloadCompany() {
      setCompany(getCompanySettings().company);
    }

    function reloadModules() {
      setModuleSettings(
        getStitchModuleSettings(),
      );
    }

    reloadCompany();
    reloadModules();

    window.addEventListener(
      companySettingsChangedEvent,
      reloadCompany,
    );
    window.addEventListener(
      "stitch-module-settings-changed",
      reloadModules,
    );
    window.addEventListener(
      "storage",
      reloadModules,
    );

    return () => {
      window.removeEventListener(
        companySettingsChangedEvent,
        reloadCompany,
      );
      window.removeEventListener(
        "stitch-module-settings-changed",
        reloadModules,
      );
      window.removeEventListener(
        "storage",
        reloadModules,
      );
    };
  }, []);

  const visibleGroups = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            !item.module ||
            moduleSettings[item.module],
        ),
      })),
    [moduleSettings],
  );

  useEffect(() => {
    const activeGroup = visibleGroups.find(
      (group) =>
        group.items.some((item) =>
          pathname.startsWith(item.href),
        ),
    )?.id;

    if (!activeGroup) {
      return;
    }

    setOpenGroups((current) =>
      current.includes(activeGroup)
        ? current
        : [...current, activeGroup],
    );
  }, [pathname, visibleGroups]);

  function isActive(href: string) {
    return pathname === href ||
      pathname.startsWith(`${href}/`);
  }

  function toggleGroup(id: string) {
    setOpenGroups((current) =>
      current.includes(id)
        ? current.filter(
            (item) => item !== id,
          )
        : [...current, id],
    );
  }

  const companyName =
    company.tradeName ||
    company.name ||
    "Bedrijfsaccount";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Image
          src="/stitch-logo.png"
          alt="STiTch Fashion ERP"
          width={52}
          height={52}
          priority
          className="sidebar-brand-logo"
        />

        <div>
          <div className="sidebar-brand-name">
            STiTch
          </div>
          <div className="sidebar-brand-subtitle">
            Fashion ERP
          </div>
        </div>
      </div>

      <nav
        className={styles.navigation}
        aria-label="Hoofdnavigatie"
      >
        <Link
          href="/"
          className={`${styles.groupButton} ${
            pathname === "/"
              ? styles.groupButtonActive
              : ""
          }`}
        >
          <span className={styles.groupIcon}>
            <AppIcon
              name="dashboard"
              size={18}
            />
          </span>
          <span>Dashboard</span>
          <span />
        </Link>

        {visibleGroups.map((group) => {
          const isOpen =
            openGroups.includes(group.id);
          const hasActiveItem =
            group.items.some((item) =>
              isActive(item.href),
            );

          return (
            <section
              key={group.id}
              className={styles.group}
            >
              <button
                type="button"
                className={`${styles.groupButton} ${
                  hasActiveItem
                    ? styles.groupButtonActive
                    : ""
                }`}
                onClick={() =>
                  toggleGroup(group.id)
                }
                aria-expanded={isOpen}
              >
                <span className={styles.groupIcon}>
                  <AppIcon
                    name={group.icon}
                    size={18}
                  />
                </span>
                <span>{group.label}</span>
                <span
                  className={`${styles.chevron} ${
                    isOpen
                      ? styles.chevronOpen
                      : ""
                  }`}
                >
                  ›
                </span>
              </button>

              {isOpen && (
                <div className={styles.children}>
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`${styles.childLink} ${
                        isActive(item.href)
                          ? styles.childLinkActive
                          : ""
                      }`}
                    >
                      <span className={styles.childIcon}>
                        <AppIcon
                          name={item.icon}
                          size={16}
                        />
                      </span>
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <Link
          href="/instellingen"
          className={`sidebar-link ${
            pathname === "/instellingen" ||
            pathname.startsWith(
              "/instellingen/bedrijf",
            ) ||
            pathname.startsWith(
              "/instellingen/modules",
            ) ||
            pathname.startsWith(
              "/instellingen/stamgegevens",
            ) ||
            pathname.startsWith(
              "/instellingen/gebruikers",
            ) ||
            pathname.startsWith(
              "/instellingen/huisstijl",
            ) ||
            pathname.startsWith(
              "/instellingen/backup",
            )
              ? "sidebar-link-active"
              : ""
          }`}
        >
          <span className="sidebar-link-icon">
            <AppIcon
              name="settings"
              size={18}
            />
          </span>
          <span>Instellingen</span>
        </Link>

        <Link
          href="/instellingen/bedrijf"
          className="sidebar-company"
          title="Bedrijfsinstellingen openen"
        >
          {company.logoDataUrl ? (
            <img
              src={company.logoDataUrl}
              alt={companyName}
              className="sidebar-company-avatar"
            />
          ) : (
            <div className="sidebar-company-avatar">
              {companyName
                .slice(0, 2)
                .toUpperCase()}
            </div>
          )}

          <div className="sidebar-company-details">
            <span className="sidebar-company-name">
              {companyName}
            </span>
            <span className="sidebar-company-plan">
              Bedrijfsaccount
            </span>
          </div>

          <span className="sidebar-company-menu">
            ›
          </span>
        </Link>
      </div>
    </aside>
  );
}
