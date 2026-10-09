import { NextResponse } from "next/server";
import { loadBoqDatabaseCatalog } from "@/services/boqCatalogService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const catalog =
      await loadBoqDatabaseCatalog();

    console.log(
      "[VENTRA BOQ CATALOG]",
      {
        sections:
          catalog.sectionCount,
        priceItems:
          catalog.priceItemCount,
        measurableCandidates:
          catalog.measurableCandidateCount,
        reviewRequired:
          catalog.reviewRequiredCount,
      }
    );

    return NextResponse.json({
      success: true,
      catalog,
    });
  } catch (error) {
    console.error(
      "[VENTRA BOQ CATALOG]",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load BOQ database catalog.",
      },
      {
        status: 500,
      }
    );
  }
}
