"use client";

import { useEffect, useRef, useState } from "react";
import { createKitchen } from "./kitchenScene";
import { CABINET_FINISHES, FLOOR_FINISHES, STONE_FINISHES } from "./kitchenFinishes";
import { STORAGE_ACTIONS, STORAGE_GROUPS } from "./kitchenStorage";
import styles from "./KitchenDemo.module.css";

const OPTIONS = {
  stone: { label: "سنگ جزیره", items: STONE_FINISHES },
  floor: { label: "کف آشپزخانه", items: FLOOR_FINISHES },
  cabinet: { label: "رنگ کابینت", items: CABINET_FINISHES },
  view: {
    label: "زاویهٔ دید",
    items: { room: { label: "نمای کلی" }, cabinets: { label: "نمای کابینت‌ها" }, drawer: { label: "نمای کشو" }, sink: { label: "نمای نزدیک سینک" }, fridge: { label: "نمای یخچال" }, cooktop: { label: "نمای اجاق" } },
  },
};

const LIGHTS = ["آویز ۱", "آویز ۲", "آویز ۳", "نور زیر کابینت"];
const BURNERS = ["burner0", "burner1", "burner2", "burner3"];
const BURNER_LABELS = ["عقب چپ", "عقب راست", "جلو چپ", "جلو راست"];
const DEFAULT_INTERACTION = { drawer: false, fridgeLeft: false, fridgeRight: false, faucet: false, lights: [true, true, true, true] };

export default function KitchenDemo() {
  const mount = useRef(null);
  const scene = useRef(null);
  const [status, setStatus] = useState("loading");
  const [selected, setSelected] = useState({ stone: "charcoal", floor: "tile", cabinet: "walnut", view: "room" });
  const [interaction, setInteraction] = useState(DEFAULT_INTERACTION);
  const interactionRef = useRef(DEFAULT_INTERACTION);

  function toggle(action) {
    const kitchen = scene.current;
    if (!kitchen) return;
    const previous = interactionRef.current;
    const next = { ...previous };
    if (typeof action === "number" || action === "all") {
      next.lights = previous.lights.map((on, index) =>
        action === "all" ? !previous.lights.some(Boolean) : index === action ? !on : on);
      kitchen.lights(next.lights);
    } else if (BURNERS.includes(action)) {
      next[action] = !previous[action];
      kitchen.burner(BURNERS.indexOf(action), next[action]);
    } else if (STORAGE_ACTIONS.has(action)) {
      next[action] = !previous[action];
      kitchen.storage(action, next[action]);
    } else {
      next[action] = !previous[action];
      kitchen[action](next[action]);
    }
    interactionRef.current = next;
    setInteraction(next);
  }

  useEffect(() => {
    const setup = requestAnimationFrame(() => {
      try {
        scene.current = createKitchen(mount.current, toggle);
        setStatus("ready");
      } catch (error) {
        console.error("Kitchen demo setup failed", error);
        setStatus("error");
      }
    });
    return () => {
      cancelAnimationFrame(setup);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  function select(group, value) {
    const kitchen = scene.current;
    if (!kitchen) return;
    if (group === "view") kitchen.view(value);
    else kitchen.finish(group, value);
    setSelected(current => ({ ...current, [group]: value }));
  }

  const ready = status === "ready";
  const anyLightsOn = interaction.lights.some(Boolean);

  return (
    <main className={styles.page} dir="rtl" lang="fa">
      <header className={styles.header}>
        <span className={styles.brand}>VENTRA</span>
        <h1 className={styles.title}>آشپزخانهٔ تعاملی</h1>
      </header>
      <div className={styles.layout}>
        <section className={styles.viewer} aria-label="صحنهٔ سه‌بعدی آشپزخانه">
          <div className={styles.canvas} ref={mount} />
          {status === "loading" && <p className={styles.error} role="status">در حال آماده‌سازی صحنه…</p>}
          {status === "error" && <p className={styles.error} role="alert">نمای سه‌بعدی روی این مرورگر اجرا نشد. WebGL را بررسی کنید.</p>}
          {status === "ready" && <p className={styles.hint}>برای چرخاندن نما بکشید. برای باز یا بستن، روی دستگیرهٔ در یا کشو بزنید.</p>}
        </section>
        <aside className={styles.controls} aria-label="کنترل‌های آشپزخانه">
          {Object.entries(OPTIONS).map(([group, { label, items }]) => (
            <fieldset className={styles.group} key={group}>
              <legend>{label}</legend>
              <div className={styles.options}>
                {Object.entries(items).map(([value, { label: name, color }]) => (
                  <button type="button" key={value} className={styles.button}
                    disabled={status !== "ready"} aria-pressed={selected[group] === value}
                    onClick={() => select(group, value)}>
                    {color && <span className={styles.swatch} style={{ backgroundColor: color }} aria-hidden="true" />}
                    {name}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <fieldset className={styles.group}>
            <legend>کنترل‌های آشپزخانه</legend>
            <div className={styles.options}>
              {[["fridgeLeft", "درِ چپ یخچال"], ["fridgeRight", "درِ راست یخچال"]].map(([action, label]) => (
                <button type="button" key={action} className={styles.button} disabled={!ready}
                  aria-pressed={interaction[action]} onClick={() => toggle(action)}>
                  {interaction[action] ? "بستن " : "باز کردن "}{label}
                </button>
              ))}
              <button type="button" className={styles.button} disabled={!ready}
                aria-pressed={interaction.faucet} onClick={() => toggle("faucet")}>
                {interaction.faucet ? "قطع آب" : "باز کردن شیر آب"}
              </button>
            </div>
          </fieldset>
          <details className={styles.storage}>
            <summary>درها و کشوهای کابینت</summary>
            {STORAGE_GROUPS.map(group => (
              <fieldset key={group.label} className={styles.group}>
                <legend>{group.label}</legend>
                <div className={styles.options}>
                  {group.items.map(([action, label]) => (
                    <button type="button" key={action} className={styles.button} disabled={!ready}
                      aria-pressed={Boolean(interaction[action])} onClick={() => toggle(action)}>{label}</button>
                  ))}
                </div>
              </fieldset>
            ))}
          </details>
          <fieldset className={styles.group}>
            <legend>اجاق</legend>
            <div className={styles.options}>
              {BURNERS.map((action, index) => (
                <button type="button" key={action} className={styles.button} disabled={!ready}
                  aria-pressed={Boolean(interaction[action])} onClick={() => toggle(action)}>
                  {BURNER_LABELS[index]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.group}>
            <legend>چراغ‌ها</legend>
            <div className={styles.options}>
              {LIGHTS.map((name, index) => (
                <button type="button" key={name} className={styles.button} disabled={!ready}
                  aria-pressed={interaction.lights[index]} onClick={() => toggle(index)}>{name}</button>
              ))}
              <button type="button" className={styles.button} disabled={!ready} onClick={() => toggle("all")}>
                {anyLightsOn ? "خاموش کردن همه" : "روشن کردن همه"}
              </button>
            </div>
          </fieldset>
        </aside>
      </div>
    </main>
  );
}
