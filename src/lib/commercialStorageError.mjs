// An access or connection error is not evidence of a missing migration.
export function commercialStorageError(error) {
  const code = String(error?.code || '');
  if (['42P01', 'PGRST205', 'PGRST204', '42703'].includes(code)) {
    return 'Shared storage is unavailable. The operator must apply the commercial database migration.';
  }
  if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code) || error?.status === 401) {
    return 'Your session could not be verified. Sign in again to use shared documents.';
  }
  if (code === '42501' || error?.status === 403) {
    return 'Shared document access was denied. Sign in again or ask the project owner to check your access.';
  }
  return 'Shared documents could not be loaded. Check your connection and try again. Your browser draft is unchanged.';
}
