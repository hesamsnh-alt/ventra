// Server-only callers must supply process.env; identity comes from verified auth.
export function isOperator(owner, env) {
 return !!env.VENTRA_FREE_USER_ID && owner === env.VENTRA_FREE_USER_ID;
}
export function operatorAllowance(owner, baseLimit, env) {
 return isOperator(owner,env) ? 2147483647 : baseLimit;
}
