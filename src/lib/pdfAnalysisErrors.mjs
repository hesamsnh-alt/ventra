export function isPdfCreditBalanceError(error) {
  const codes = [error?.code,error?.type,error?.error?.code,error?.error?.type].join(' ');
  return /credit_balance_exhausted|insufficient_quota/.test(codes) ||
    /no credits|credits remaining|exceeded your current quota/i.test(String(error?.message || ''));
}
