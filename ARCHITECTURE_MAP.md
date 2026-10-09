# Ventra Architecture Map

این فایل از روی ساختار واقعی ZIP ساخته شده است. هیچ فایل منبعی برای تولید این نقشه تغییر نکرده است.

## Stack

- Next.js App Router
- React
- JavaScript
- Tailwind CSS
- Supabase
- Autodesk APS
- OpenAI
- Stripe

## App Pages

- `src/app/dashboard/page.js`
- `src/app/login/page.js`
- `src/app/page.js`
- `src/app/pricing/page.js`
- `src/app/pricing/success/page.js`
- `src/app/products/page.js`
- `src/app/profile/page.js`
- `src/app/projects/[id]/edit/page.js`
- `src/app/projects/[id]/page.js`
- `src/app/projects/new/page.js`
- `src/app/register/page.js`
- `src/app/test/page.js`

## API Routes

- `src/app/api/ai/analyze-drawing/route.js`
- `src/app/api/ai/generate-boq/route.js`
- `src/app/api/aps/status/[urn]/route.js`
- `src/app/api/aps/token/route.js`
- `src/app/api/aps/translate/route.js`
- `src/app/api/aps/upload/route.js`
- `src/app/api/aps/viewer-token/route.js`
- `src/app/api/stripe/create-checkout-session/route.js`
- `src/app/api/stripe/webhook/route.js`

## Services

- `src/services/ApsViewer.jsx`
- `src/services/apsClientService.js`
- `src/services/apsGeometryExtractor.js`
- `src/services/apsLayerDetector.js`
- `src/services/apsPropertyExtractor.js`
- `src/services/apsService.js`
- `src/services/apsTakeoffBuilder.js`
- `src/services/apsUnitNormalizer.js`
- `src/services/authService.js`
- `src/services/boqSchema.js`
- `src/services/boqService.js`
- `src/services/documentService.js`
- `src/services/fileValidator.js`
- `src/services/knowledgeBuilder.js`
- `src/services/largePdfAnalysisService.js`
- `src/services/object-engine/beamDetector.js`
- `src/services/object-engine/columnDetector.js`
- `src/services/object-engine/doorDetector.js`
- `src/services/object-engine/geometryUtils.js`
- `src/services/object-engine/index.js`
- `src/services/object-engine/objectEngine.js`
- `src/services/object-engine/slabDetector.js`
- `src/services/object-engine/wallDetector.js`
- `src/services/object-engine/windowDetector.js`
- `src/services/openaiClient.js`
- `src/services/pageAnalysisService.js`
- `src/services/pageClassifier.js`
- `src/services/pageWorker.js`
- `src/services/pdfService.js`
- `src/services/projectAssistant.js`
- `src/services/projectResolver.js`
- `src/services/projectService.js`
- `src/services/promptBuilder.js`
- `src/services/propertyDictionary.js`
- `src/services/queueService.js`
- `src/services/responseParser.js`
- `src/services/takeoffSchema.js`
- `src/services/takeoffServerService.js`
- `src/services/takeoffService.js`
- `src/services/unitConverter.js`

## Components and UI Files

- `src/app/components/ApsViewer.css`
- `src/app/components/ApsViewer.jsx`
- `src/app/components/ProjectOverview.css`
- `src/app/components/ProjectOverview.jsx`
- `src/app/components/Toolbox.css`
- `src/app/components/Toolbox.jsx`
- `src/app/components/Workflow.css`
- `src/app/components/Workflow.jsx`
- `src/app/components/layout/AppLayout/AppLayout.css`
- `src/app/components/layout/AppLayout/AppLayout.jsx`
- `src/app/components/layout/Footer.jsx`
- `src/app/components/layout/Header.css`
- `src/app/components/layout/Header.jsx`
- `src/app/components/layout/Header/Header.css`
- `src/app/components/layout/Header/Header.jsx`
- `src/app/components/layout/Sidebar/Sidebar.css`
- `src/app/components/layout/Sidebar/Sidebar.jsx`
- `src/app/components/layout/index.js`
- `src/app/components/sections/CTA.jsx`
- `src/app/components/sections/DashboardPreview.jsx`
- `src/app/components/sections/EngineeringToolbox.jsx`
- `src/app/components/sections/Features.jsx`
- `src/app/components/sections/Hero.css`
- `src/app/components/sections/Hero.jsx`
- `src/app/components/sections/Pricing.jsx`
- `src/app/components/sections/Quotation.jsx`
- `src/app/components/sections/Testimonials.jsx`
- `src/app/components/sections/UploadSection.css`
- `src/app/components/sections/UploadSection.jsx`
- `src/app/components/ui/Button.css`
- `src/app/components/ui/Button.jsx`
- `src/app/components/ui/Card.css`
- `src/app/components/ui/Card.jsx`
- `src/app/components/ui/Input.css`
- `src/app/components/ui/Input.jsx`
- `src/app/components/ui/Progress.css`
- `src/app/components/ui/Progress.jsx`
- `src/app/projects/[id]/ApsViewer.jsx`
- `src/app/projects/[id]/ProjectActivity.jsx`
- `src/app/projects/[id]/ProjectBOQ.jsx`
- `src/app/projects/[id]/ProjectDailyReports.jsx`
- `src/app/projects/[id]/ProjectDocuments.jsx`
- `src/app/projects/[id]/ProjectDrawingCenter.jsx`
- `src/app/projects/[id]/ProjectEstimate.jsx`
- `src/app/projects/[id]/ProjectQuotation.jsx`
- `src/app/projects/[id]/ProjectTasks.jsx`
- `src/app/projects/[id]/ProjectTimeline.jsx`
- `src/modules/boq/components/BOQRow.jsx`
- `src/modules/boq/components/BOQSummary.jsx`
- `src/modules/boq/components/BOQTable.jsx`
- `src/modules/boq/components/BOQToolbar.jsx`
- `src/modules/boq/components/EditableCell.jsx`
- `src/services/ApsViewer.jsx`

## Modules

- `src/modules/boq/components/BOQRow.jsx`
- `src/modules/boq/components/BOQSummary.jsx`
- `src/modules/boq/components/BOQTable.jsx`
- `src/modules/boq/components/BOQToolbar.jsx`
- `src/modules/boq/components/EditableCell.jsx`
- `src/modules/boq/constants/sections.js`
- `src/modules/boq/constants/units.js`
- `src/modules/boq/index.js`
- `src/modules/boq/store/boqStore.js`
- `src/modules/boq/utils/calculations.js`
- `src/modules/boq/utils/validators.js`

## Stores

- `src/modules/boq/store/boqStore.js`

## Libraries

- `src/lib/aps/apsDiagnostic.js`
- `src/lib/aps/wallHeightResolver.js`
- `src/lib/boq/engine.js`
- `src/lib/boq/formulas.js`
- `src/lib/boq/geometry.js`
- `src/lib/boq/logger.js`
- `src/lib/boq/pricing.js`
- `src/lib/boq/utils.js`
- `src/lib/boq/validator.js`
- `src/lib/database.js`
- `src/lib/helpers.js`
- `src/lib/supabase.js`

## Active High-Level Flows

### APS

`ProjectDrawingCenter → APS upload API → APS translate API → APS status API → ApsViewer → property/geometry extraction → apsTakeoffBuilder → ProjectDrawingCenter state/localStorage`

### BOQ

`ProjectDrawingCenter/ProjectBOQ → generate-boq API → BOQ engine/rules/pricing → project_boq_items → BOQ UI/Zustand module`

### Supabase

`Auth → profiles/projects → project_documents + Storage → APS/analysis metadata → BOQ persistence`

## Internal Import Dependencies

- `src/app/api/ai/analyze-drawing/route.js` → `@/services/takeoffServerService`
- `src/app/api/ai/generate-boq/route.js` → `@/lib/boq/engine`
- `src/app/api/ai/generate-boq/route.js` → `@/lib/boq/logger`
- `src/app/api/aps/status/[urn]/route.js` → `@/services/apsService`
- `src/app/api/aps/token/route.js` → `@/services/apsService`
- `src/app/api/aps/translate/route.js` → `@/services/apsService`
- `src/app/api/aps/upload/route.js` → `@/services/apsService`
- `src/app/api/aps/viewer-token/route.js` → `@/services/apsService`
- `src/app/components/ApsViewer.jsx` → `./ApsViewer.css`
- `src/app/components/ApsViewer.jsx` → `@/services/apsGeometryExtractor`
- `src/app/components/ApsViewer.jsx` → `@/services/apsPropertyExtractor`
- `src/app/components/ProjectOverview.jsx` → `./ProjectOverview.css`
- `src/app/components/Toolbox.jsx` → `./Toolbox.css`
- `src/app/components/Workflow.jsx` → `./Workflow.css`
- `src/app/components/layout/AppLayout/AppLayout.jsx` → `../Header`
- `src/app/components/layout/AppLayout/AppLayout.jsx` → `../Sidebar`
- `src/app/components/layout/AppLayout/AppLayout.jsx` → `./AppLayout.css`
- `src/app/components/layout/Header.jsx` → `./Header.css`
- `src/app/components/layout/Header.jsx` → `@/services/authService`
- `src/app/components/layout/Header/Header.jsx` → `./Header.css`
- `src/app/components/layout/Sidebar/Sidebar.jsx` → `./Sidebar.css`
- `src/app/components/sections/Hero.jsx` → `./Hero.css`
- `src/app/components/ui/Button.jsx` → `./Button.css`
- `src/app/components/ui/Card.jsx` → `./Card.css`
- `src/app/components/ui/Input.jsx` → `./Input.css`
- `src/app/components/ui/Progress.jsx` → `./Progress.css`
- `src/app/dashboard/page.js` → `./Dashboard.css`
- `src/app/dashboard/page.js` → `@/lib/supabase`
- `src/app/dashboard/page.js` → `@/services/authService`
- `src/app/layout.js` → `./globals.css`
- `src/app/login/page.js` → `@/services/authService`
- `src/app/page.js` → `./components/ProjectOverview`
- `src/app/page.js` → `./components/Toolbox`
- `src/app/page.js` → `./components/Workflow`
- `src/app/page.js` → `./components/layout/Header`
- `src/app/page.js` → `./components/sections/Features`
- `src/app/page.js` → `./components/sections/Hero`
- `src/app/page.js` → `./components/sections/Quotation`
- `src/app/pricing/PricingClient.js` → `./Pricing.css`
- `src/app/pricing/PricingClient.js` → `@/lib/supabase`
- `src/app/pricing/page.js` → `./PricingClient`
- `src/app/pricing/success/PricingSuccessClient.js` → `../Pricing.css`
- `src/app/pricing/success/page.js` → `./PricingSuccessClient`
- `src/app/products/page.js` → `./Products.css`
- `src/app/profile/page.js` → `./Profile.css`
- `src/app/profile/page.js` → `@/lib/supabase`
- `src/app/profile/page.js` → `@/services/authService`
- `src/app/projects/[id]/ApsViewer.jsx` → `./ApsViewer.css`
- `src/app/projects/[id]/ApsViewer.jsx` → `@/services/apsGeometryExtractor`
- `src/app/projects/[id]/ApsViewer.jsx` → `@/services/apsPropertyExtractor`
- `src/app/projects/[id]/ProjectActivity.jsx` → `./ProjectActivity.css`
- `src/app/projects/[id]/ProjectBOQ.jsx` → `./ProjectBOQ.css`
- `src/app/projects/[id]/ProjectBOQ.jsx` → `@/services/boqService`
- `src/app/projects/[id]/ProjectBOQ.jsx` → `@/services/takeoffService`
- `src/app/projects/[id]/ProjectDailyReports.jsx` → `./ProjectDailyReports.css`
- `src/app/projects/[id]/ProjectDocuments.jsx` → `./ProjectDocuments.css`
- `src/app/projects/[id]/ProjectDrawingCenter.jsx` → `./ProjectDrawingCenter.css`
- `src/app/projects/[id]/ProjectDrawingCenter.jsx` → `@/app/components/ApsViewer`
- `src/app/projects/[id]/ProjectDrawingCenter.jsx` → `@/modules/boq`
- `src/app/projects/[id]/ProjectDrawingCenter.jsx` → `@/services/apsTakeoffBuilder`
- `src/app/projects/[id]/ProjectDrawingCenter.jsx` → `@/services/documentService`
- `src/app/projects/[id]/ProjectDrawingCenter.jsx` → `@/services/takeoffService`
- `src/app/projects/[id]/ProjectEstimate.jsx` → `./ProjectEstimate.css`
- `src/app/projects/[id]/ProjectQuotation.jsx` → `./ProjectQuotation.css`
- `src/app/projects/[id]/ProjectTasks.jsx` → `./ProjectTasks.css`
- `src/app/projects/[id]/ProjectTimeline.jsx` → `./ProjectTimeline.css`
- `src/app/projects/[id]/edit/page.js` → `./EditProject.css`
- `src/app/projects/[id]/edit/page.js` → `@/services/projectService`
- `src/app/projects/[id]/page.js` → `./ProjectActivity`
- `src/app/projects/[id]/page.js` → `./ProjectBOQ`
- `src/app/projects/[id]/page.js` → `./ProjectDailyReports`
- `src/app/projects/[id]/page.js` → `./ProjectDocuments`
- `src/app/projects/[id]/page.js` → `./ProjectDrawingCenter`
- `src/app/projects/[id]/page.js` → `./ProjectEstimate`
- `src/app/projects/[id]/page.js` → `./ProjectQuotation`
- `src/app/projects/[id]/page.js` → `./ProjectTasks`
- `src/app/projects/[id]/page.js` → `./ProjectTimeline`
- `src/app/projects/[id]/page.js` → `./ProjectWorkspace.css`
- `src/app/projects/[id]/page.js` → `@/services/projectService`
- `src/app/projects/new/page.js` → `./CreateProject.css`
- `src/app/projects/new/page.js` → `@/services/authService`
- `src/app/projects/new/page.js` → `@/services/projectService`
- `src/app/register/page.js` → `./Register.css`
- `src/app/register/page.js` → `@/lib/supabase`
- `src/app/test/page.js` → `@/lib/supabase`
- `src/hooks/useProjects.js` → `@/services/projectService`
- `src/lib/boq/engine.js` → `./formulas`
- `src/lib/boq/engine.js` → `./geometry`
- `src/lib/boq/engine.js` → `./logger`
- `src/lib/boq/engine.js` → `./pricing`
- `src/lib/boq/engine.js` → `./utils`
- `src/lib/boq/engine.js` → `./validator`
- `src/lib/boq/formulas.js` → `./utils`
- `src/lib/boq/geometry.js` → `./utils`
- `src/lib/boq/pricing.js` → `./utils`
- `src/lib/boq/validator.js` → `./formulas`
- `src/lib/boq/validator.js` → `./geometry`
- `src/lib/boq/validator.js` → `./utils`
- `src/lib/database.js` → `./supabase`
- `src/modules/boq/components/BOQRow.jsx` → `../store/boqStore`
- `src/modules/boq/components/BOQRow.jsx` → `./EditableCell`
- `src/modules/boq/components/BOQSummary.jsx` → `../store/boqStore`
- `src/modules/boq/components/BOQSummary.jsx` → `../utils/calculations`
- `src/modules/boq/components/BOQTable.jsx` → `../store/boqStore`
- `src/modules/boq/components/BOQTable.jsx` → `../store/boqStore`
- `src/modules/boq/components/BOQTable.jsx` → `./BOQRow`
- `src/modules/boq/components/BOQToolbar.jsx` → `../store/boqStore`
- `src/modules/boq/store/boqStore.js` → `../constants/sections`
- `src/modules/boq/store/boqStore.js` → `../constants/units`
- `src/modules/boq/store/boqStore.js` → `../utils/calculations`
- `src/services/ApsViewer.jsx` → `./ApsViewer.css`
- `src/services/ApsViewer.jsx` → `@/lib/aps/apsDiagnostic`
- `src/services/ApsViewer.jsx` → `@/services/apsGeometryExtractor`
- `src/services/ApsViewer.jsx` → `@/services/apsLayerDetector`
- `src/services/apsTakeoffBuilder.js` → `@/lib/aps/wallHeightResolver`
- `src/services/authService.js` → `@/lib/supabase`
- `src/services/documentService.js` → `@/lib/supabase`
- `src/services/largePdfAnalysisService.js` → `@/services/pdfService`
- `src/services/largePdfAnalysisService.js` → `@/services/queueService`
- `src/services/object-engine/beamDetector.js` → `./geometryUtils`
- `src/services/object-engine/columnDetector.js` → `./geometryUtils`
- `src/services/object-engine/doorDetector.js` → `./geometryUtils`
- `src/services/object-engine/index.js` → `./beamDetector`
- `src/services/object-engine/index.js` → `./columnDetector`
- `src/services/object-engine/index.js` → `./doorDetector`
- `src/services/object-engine/index.js` → `./objectEngine`
- `src/services/object-engine/index.js` → `./slabDetector`
- `src/services/object-engine/index.js` → `./wallDetector`
- `src/services/object-engine/index.js` → `./windowDetector`
- `src/services/object-engine/objectEngine.js` → `./beamDetector`
- `src/services/object-engine/objectEngine.js` → `./columnDetector`
- `src/services/object-engine/objectEngine.js` → `./doorDetector`
- `src/services/object-engine/objectEngine.js` → `./slabDetector`
- `src/services/object-engine/objectEngine.js` → `./wallDetector`
- `src/services/object-engine/objectEngine.js` → `./windowDetector`
- `src/services/object-engine/slabDetector.js` → `./geometryUtils`
- `src/services/object-engine/wallDetector.js` → `./geometryUtils`
- `src/services/object-engine/windowDetector.js` → `./geometryUtils`
- `src/services/pageAnalysisService.js` → `@/services/openaiClient`
- `src/services/pageAnalysisService.js` → `@/services/promptBuilder`
- `src/services/pageAnalysisService.js` → `@/services/responseParser`
- `src/services/pageAnalysisService.js` → `@/services/takeoffSchema`
- `src/services/pageWorker.js` → `@/services/pageAnalysisService`
- `src/services/projectService.js` → `@/lib/supabase`
- `src/services/queueService.js` → `@/services/pageWorker`
- `src/services/takeoffServerService.js` → `@/services/fileValidator`
- `src/services/takeoffServerService.js` → `@/services/largePdfAnalysisService`
- `src/services/takeoffServerService.js` → `@/services/openaiClient`
- `src/services/takeoffServerService.js` → `@/services/promptBuilder`
- `src/services/takeoffServerService.js` → `@/services/responseParser`
- `src/services/takeoffServerService.js` → `@/services/takeoffSchema`

## Important Structural Findings

- سه پیاده‌سازی جداگانه از `ApsViewer` در پروژه وجود دارد؛ قبل از حذف یا ادغام باید مسیر import فعال بررسی شود.
- منطق APS هم در `ProjectDrawingCenter` و هم در سرویس‌های APS وجود دارد؛ مسیر فعال باید مبنای اصلاح باشد.
- BOQ قدیمی و ماژول حرفه‌ای Zustand هم‌زمان وجود دارند و هنوز یک Source of Truth واحد ندارند.
- `apsLayerDetector.js` شامل بخش‌های تکراری است، اما بدون اثبات نباید در اصلاح باگ فعلی تغییر کند.
- `.env.local` از بسته تمیز حذف شده است تا کلیدهای محرمانه داخل ZIP قرار نگیرند.
