import {commercialFetch} from '@/lib/commercialFetch';
export async function generateBoq({
  projectId,
  takeoff,
  projectName = "Untitled Project",
  priceLevel = "standard",
  vatPercentage = 5,
}) {
  if (!takeoff || typeof takeoff !== "object") {
    throw new Error("Quantity Takeoff data is required.");
  }

  console.log("[VENTRA BOQ CLIENT] request", {
    projectId,
    projectName,
    priceLevel,
    vatPercentage,
    takeoffKeys: Object.keys(takeoff || {}),
  });

  let response;

  try {
    response = await commercialFetch("/api/ai/generate-boq", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        projectId,
        takeoff,
        projectName,
        priceLevel,
        vatPercentage,
      }),
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      "[VENTRA BOQ CLIENT] fetch failed",
      error
    );

    throw new Error(
      `BOQ API request failed: ${
        error?.message ||
        "Network request could not be completed."
      }`
    );
  }

  const text =
    await response.text();

  let data = null;

  try {
    data =
      text
        ? JSON.parse(text)
        : null;
  } catch (error) {
    console.error(
      "[VENTRA BOQ CLIENT] invalid JSON response",
      {
        status:
          response.status,
        statusText:
          response.statusText,
        responseText:
          text,
        error,
      }
    );

    throw new Error(
      `BOQ API returned invalid JSON (HTTP ${response.status}).`
    );
  }

  console.log(
    "[VENTRA BOQ CLIENT] response",
    {
      ok:
        response.ok,
      status:
        response.status,
      success:
        data?.success,
      items:
        Array.isArray(
          data?.boq?.items
        )
          ? data.boq.items.length
          : 0,
      error:
        data?.error ||
        data?.message ||
        null,
    }
  );

  if (!response.ok) {
    console.error(
      "[VENTRA BOQ CLIENT] API error",
      {
        status:
          response.status,
        statusText:
          response.statusText,
        data,
      }
    );

    throw new Error(
      data?.error ||
      data?.message ||
      `BOQ API failed with HTTP ${response.status}.`
    );
  }

  if (
    data?.success !== true
  ) {
    console.error(
      "[VENTRA BOQ CLIENT] API reported failure",
      data
    );

    throw new Error(
      data?.error ||
      data?.message ||
      "BOQ API did not report success."
    );
  }

  if (
    !Array.isArray(
      data?.boq?.items
    ) ||
    data.boq.items.length === 0
  ) {
    console.error(
      "[VENTRA BOQ CLIENT] empty BOQ response",
      data
    );

    throw new Error(
      "BOQ API returned no items."
    );
  }

  return data.boq;
}
