"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowUpRight } from "lucide-react";
import "./Header.css";

const mainMenu = [
  { label: "Products", href: "#products" },
  { label: "Pricing", href: "#pricing" },
];

const sideMenu = [
  { label: "Home", href: "/" },
  { label: "AI Estimator", href: "#estimator" },
  { label: "BOQ Generator", href: "#boq" },
  { label: "Dashboard", href: "#dashboard" },
  { label: "Resources", href: "#resources" },
  { label: "Contact", href: "#contact" },
  { label: "Login", href: "/login" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 40);
    }

    handleScroll();

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <>
      <header
        className={`vt-header ${
          scrolled ? "vt-header--scrolled" : ""
        }`}
      >
        <div className="vt-header__bar">
          <Link
            href="/"
            className="vt-header__brand"
            aria-label="Ventra home"
          >
            <span className="vt-header__mark">V</span>

            <span className="vt-header__brand-text">
              <span className="vt-header__name">Ventra</span>
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
              <Link key={item.label} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="vt-header__actions">
            <Link href="/login" className="vt-header__login">
              Login
            </Link>

            <Link href="/register" className="vt-header__start">
              Get Started
              <ArrowUpRight size={17} />
            </Link>

            <button
              type="button"
              className="vt-header__menu-button"
              onClick={() => setMenuOpen(true)}
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
          menuOpen ? "vt-menu-overlay--open" : ""
        }`}
        onClick={closeMenu}
        aria-label="Close navigation menu"
        tabIndex={menuOpen ? 0 : -1}
      />

      <aside
        id="ventra-side-menu"
        className={`vt-side-menu ${
          menuOpen ? "vt-side-menu--open" : ""
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

        <nav className="vt-side-menu__links">
          {sideMenu.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={closeMenu}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/register"
          className="vt-side-menu__cta"
          onClick={closeMenu}
        >
          Start with Ventra
          <ArrowUpRight size={18} />
        </Link>
      </aside>
    </>
  );
}