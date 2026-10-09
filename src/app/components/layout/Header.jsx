"use client";
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";


import { useEffect, useState } from "react";
import Link from "next/link";
import SignOutButton from "../SignOutButton";
import { useRouter } from "next/navigation";
import {
  Menu,
  X,
  ArrowUpRight,
} from "lucide-react";

import {
  getCurrentUser,
  signOutUser,
} from "@/services/authService";

import "./Header.css";

const mainMenu = [
  {label:"Demo",href:"/demo"},
  {label:"Billing",href:"/billing"},
  {label:"Help",href:"/support"},
  { label: "Tools", href: "/tools" },
  {
    label: "Products",
    href: "/products",
  },
  {
    label: "Pricing",
    href: "/pricing",
  },
];
const publicSideMenu = [
  {
    label: "Home",
    href: "/",
  },
  {
    label: "AI Estimator",
    href: "/tools/estimate",
  },
  {
    label: "BOQ Generator",
    href: "/tools/boq",
  },
  {
    label: "Resources",
    href: "/resources",
  },
  {
    label: "Help & Support",
    href: "/support",
  },
  {
    label: "Product Demo",
    href: "/demo",
  },
];

export default function Header() {
  const router = useRouter();

  const [menuOpen, setMenuOpen] =
    useState(false);

  const [scrolled, setScrolled] =
    useState(false);

  const [user, setUser] =
    useState(null);

  const [loadingUser, setLoadingUser] =
    useState(true);

  const [loggingOut, setLoggingOut] =
    useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 40);
    }

    handleScroll();

    window.addEventListener(
      "scroll",
      handleScroll
    );

    return () => {
      window.removeEventListener(
        "scroll",
        handleScroll
      );
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow =
      menuOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    let active = true;

    async function loadCurrentUser() {
      try {
        setLoadingUser(true);

        const result =
          await getCurrentUser();

        const currentUser =
          result?.user ||
          result?.data?.user ||
          null;

        if (active) {
          setUser(currentUser);
        }
      } catch (error) {
        console.error(
          "Header user error:",
          error
        );

        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setLoadingUser(false);
        }
      }
    }

    loadCurrentUser();

    return () => {
      active = false;
    };
  }, []);

  function closeMenu() {
    setMenuOpen(false);
  }

  function getUserName() {
    if (!user) {
      return "User";
    }

    const metadata =
      user.user_metadata || {};

    const fullName =
      metadata.full_name ||
      metadata.name ||
      metadata.display_name ||
      metadata.username;

    if (fullName) {
      return fullName;
    }

    if (user.email) {
      return user.email.split("@")[0];
    }

    return "User";
  }

  async function handleLogout(event) {
    event?.preventDefault();

    if (loggingOut) {
      return;
    }

    try {
      setLoggingOut(true);

      const result =
        await signOutUser();

      if (result?.error) {
        console.error(
          "Logout error:",
          result.error
        );

        return;
      }

      setUser(null);
      setMenuOpen(false);

      router.push("/");
      router.refresh();
    } catch (error) {
      console.error(
        "Logout error:",
        error
      );
    } finally {
      setLoggingOut(false);
    }
  }

  const userName = getUserName();

  return (
    <>
      <LocalizedElement as="header"
        className={`vt-header ${
          scrolled
            ? "vt-header--scrolled"
            : ""
        }`}
      >
        <LocalizedElement as="div" className="vt-header__bar">
          <LocalizedLink 
            href="/"
            className="vt-header__brand"
            aria-label="Ventra home"
          >
            <LocalizedElement as="span" className="vt-header__mark">
              V
            </LocalizedElement>

            <LocalizedElement as="span" className="vt-header__brand-text">
              <LocalizedElement as="span" className="vt-header__name">
                Ventra
              </LocalizedElement>

              <LocalizedElement as="span" className="vt-header__tagline">
                AI Construction Intelligence
              </LocalizedElement>
            </LocalizedElement>
          </LocalizedLink>

          <LocalizedElement as="nav"
            className="vt-header__nav"
            aria-label="Primary navigation"
          >
            {mainMenu.map((item) => (
              <LocalizedLink 
                key={item.label}
                href={item.href}
              >
                {item.label}
              </LocalizedLink>
            ))}
          </LocalizedElement>

          <LocalizedElement as="div" className="vt-header__actions">
            {!loadingUser && user && <SignOutButton />}
            <OriginalText>{!loadingUser && user && (
              <LocalizedLink 
                href="/dashboard"
                className="vt-header__login"
              >
                Hello, {userName}
              </LocalizedLink>
            )}</OriginalText>

            {!loadingUser && !user && (
              <>
                <LocalizedLink 
                  href="/login"
                  className="vt-header__login"
                >
                  Login
                </LocalizedLink>

                <LocalizedLink 
                  href="/register"
                  className="vt-header__start"
                >
                  Get Started

                  <ArrowUpRight size={17} />
                </LocalizedLink>
              </>
            )}

            <LocalizedElement as="button"
              type="button"
              className="vt-header__menu-button"
              onClick={() =>
                setMenuOpen(true)
              }
              aria-label="Open navigation menu"
              aria-expanded={menuOpen}
              aria-controls="ventra-side-menu"
            >
              <Menu size={22} />
            </LocalizedElement>
          </LocalizedElement>
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="button"
        type="button"
        className={`vt-menu-overlay ${
          menuOpen
            ? "vt-menu-overlay--open"
            : ""
        }`}
        onClick={closeMenu}
        aria-label="Close navigation menu"
        tabIndex={menuOpen ? 0 : -1}
      />

      <LocalizedElement as="aside"
        id="ventra-side-menu"
        className={`vt-side-menu ${
          menuOpen
            ? "vt-side-menu--open"
            : ""
        }`}
        aria-hidden={!menuOpen}
      >
        <LocalizedElement as="div" className="vt-side-menu__top">
          <LocalizedElement as="span">Menu</LocalizedElement>

          <LocalizedElement as="button"
            type="button"
            className="vt-side-menu__close"
            onClick={closeMenu}
            aria-label="Close navigation menu"
          >
            <X size={22} />
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="nav"
          className="vt-side-menu__links"
          aria-label="Mobile navigation"
        >
          {publicSideMenu.map((item) => (
            <LocalizedLink 
              key={item.label}
              href={item.href}
              onClick={closeMenu}
            >
              {item.label}
            </LocalizedLink>
          ))}

          {!loadingUser && !user && (
            <>
              <LocalizedLink 
                href="/login"
                onClick={closeMenu}
              >
                Login
              </LocalizedLink>

              <LocalizedLink 
                href="/register"
                onClick={closeMenu}
              >
                Register
              </LocalizedLink>
            </>
          )}

          {!loadingUser && user && (
            <>
              <LocalizedLink 
                href="/dashboard"
                onClick={closeMenu}
              >
                Dashboard
              </LocalizedLink>

              <LocalizedLink 
                href="/profile"
                onClick={closeMenu}
              >
                My Profile
              </LocalizedLink>
              <LocalizedLink  href="/join" onClick={closeMenu}>Join / Shared projects</LocalizedLink>
              <LocalizedLink  href="/billing" onClick={closeMenu}>Billing</LocalizedLink>
              <LocalizedLink  href="/tools" onClick={closeMenu}>Engineering Tools</LocalizedLink>

              <LocalizedElement as="button"
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut
                  ? "Logging out..."
                  : "Logout"}
              </LocalizedElement>
            </>
          )}
        </LocalizedElement>

        {!loadingUser && !user && (
          <LocalizedLink 
            href="/register"
            className="vt-side-menu__cta"
            onClick={closeMenu}
          >
            Start with Ventra

            <ArrowUpRight size={18} />
          </LocalizedLink>
        )}
      </LocalizedElement>
    </>
  );
}
