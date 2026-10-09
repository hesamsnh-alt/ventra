import {commercialContext,commercialError} from "@/lib/serverCommercial";
import {apsObjectKey} from "@/lib/apsObjectKey.mjs";
import {randomUUID} from "node:crypto";
import { NextResponse } from "next/server";
import { uploadToAps } from "@/services/apsService";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const projectId=String(formData.get("projectId")||"");
    const context=await commercialContext(request,projectId);
    if(file?.size>100*1024*1024)return NextResponse.json({success:false,error:"Files must be 100 MB or smaller."},{status:413});
    const bucketKey = String(
      formData.get("bucketKey") || ""
    );

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: "APS upload requires a file.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const result = await uploadToAps({
      file,
      sourceObjectKey:apsObjectKey(projectId,context.owner,randomUUID(),file.name),
    });

    return NextResponse.json(
      {
        success: true,
        result,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    if(error.status)return commercialError(error);
    console.error("[APS Upload]", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "APS upload failed.",
      },
      {
        status:
          Number(error?.status) || 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
