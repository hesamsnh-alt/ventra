"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
    href: "#estimator",
  },
  {
    label: "BOQ Generator",
    href: "#boq",
  },
  {
    label: "Resources",
    href: "#resources",
  },
  {
    label: "Contact",
    href: "#contact",
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
          result ||
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
      <header
        className={`vt-header ${
          scrolled
            ? "vt-header--scrolled"
            : ""
        }`}
      >
        <div className="vt-header__bar">
          <Link
            href="/"
            className="vt-header__brand"
            aria-label="Ventra home"
          >
            <span className="vt-header__mark">
              V
            </span>

            <span className="vt-header__brand-text">
              <span className="vt-header__name">
                Ventra
              </span>

              <span className="vt-header__tagline">
                AI Construction Intelligence
              </span>
            </span>
          </Link>

          <nav
            className="vt-header__nav"
            aria-label="Primary navigation"
          >
            {mainMenu.map((item) => (
              <Link
                key={item.label}
                href={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="vt-header__actions">
            {!loadingUser && user && (
              <Link
                href="/dashboard"
                className="vt-header__login"
              >
                Hello, {userName}
              </Link>
            )}

            {!loadingUser && !user && (
              <>
                <Link
                  href="/login"
                  className="vt-header__login"
                >
                  Login
                </Link>

                <Link
                  href="/register"
                  className="vt-header__start"
                >
                  Get Started

                  <ArrowUpRight size={17} />
                </Link>
              </>
            )}

            <button
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
            </button>
          </div>
        </div>
      </header>

      <button
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

      <aside
        id="ventra-side-menu"
        className={`vt-side-menu ${
          menuOpen
            ? "vt-side-menu--open"
            : ""
        }`}
        aria-hidden={!menuOpen}
      >
        <div className="vt-side-menu__top">
          <span>Menu</span>

          <button
            type="button"
            className="vt-side-menu__close"
            onClick={closeMenu}
            aria-label="Close navigation menu"
          >
            <X size={22} />
          </button>
        </div>

        <nav
          className="vt-side-menu__links"
          aria-label="Mobile navigation"
        >
          {publicSideMenu.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={closeMenu}
            >
              {item.label}
            </Link>
          ))}

          {!loadingUser && !user && (
            <>
              <Link
                href="/login"
                onClick={closeMenu}
              >
                Login
              </Link>

              <Link
                href="/register"
                onClick={closeMenu}
              >
                Register
              </Link>
            </>
          )}

          {!loadingUser && user && (
            <>
              <Link
                href="/dashboard"
                onClick={closeMenu}
              >
                Dashboard
              </Link>

              <Link
                href="/profile"
                onClick={closeMenu}
              >
                My Profile
              </Link>

              <a
                href="/"
                onClick={handleLogout}
                aria-disabled={loggingOut}
              >
                {loggingOut
                  ? "Logging out..."
                  : "Logout"}
              </a>
            </>
          )}
        </nav>

        {!loadingUser && !user && (
          <Link
            href="/register"
            className="vt-side-menu__cta"
            onClick={closeMenu}
          >
            Start with Ventra

            <ArrowUpRight size={18} />
          </Link>
        )}
      </aside>
    </>
  );
}