export function needsSubscriptionManagement(status) {
  return typeof status === "string" && !["none", "canceled", "incomplete_expired"].includes(status);
}
export function isExistingSubscriptionConflict(status, result) {
  return status === 409 && result?.code === "SUBSCRIPTION_EXISTS";
}

export async function pricingIdentity(auth) {
  const {data, error} = await auth.getSession();
  if (error) throw error;
  if (!data?.session?.access_token) return null;
  const result = await auth.getUser();
  if (result.error?.name === "AuthSessionMissingError") return null;
  if (result.error) throw result.error;
  return result.data?.user ? {user: result.data.user, token: data.session.access_token} : null;
}
