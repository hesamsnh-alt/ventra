Ventra v63 — cumulative patch over v62

نصب: محتویات زیپ را در ریشه پروژه ventra کپی و فایل‌های هم‌نام را جایگزین کنید.
سرور را با Ctrl+C متوقف و با npm run dev دوباره اجرا کنید.
در تب 3D، بخش Interior + Facade Prompt، دکمه Repair observed geometry را بزنید.
برای مدل گزارش 9، بخش بلند کابینت L از مشاهده موجود بازیابی می‌شود.
نیازی به Analyze مجدد یا اجرای SQL نیست.

Fix: source cabinets whose parallel rear face lies on a wall centreline are fitted to the inner wall face, preserving their observed front and length. Actual cross-wall/side collisions still fail validation. Existing rejected wall-contact furniture can be restored without replacing accepted furniture or changing architecture. No inferred new cabinet.

Verified: 289 tests pass, ESLint exits 0, Next production build exits 0.
Current-report regression restores kitchen_counter_1 and retains the short L leg, all existing assets, rooms, footprint and walls.
No live browser/GPU rendering verification. Room dimension mismatches and other source interpretation errors remain unresolved; this patch does not claim complete plan accuracy or photorealism.
