// Automatic same-origin clinical/personal synchronization was retired.
// The only supported clinical-to-personal path is the explicit
// policycompass-patient-transfer v1 file and its separately delivered code.

export const CARE_BRIDGE_STORAGE_KEY = "policycompass-care-bridge-v1";
export const PERSONAL_SYNC_SUSPENDED_KEY = "policycompass-personal-sync-suspended-v1";

function localStorageOrNull(storageProvided, storage) {
  if (storageProvided) return storage ?? null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function retireLegacyCareBridge(storage) {
  const target = localStorageOrNull(arguments.length > 0, storage);
  if (!target || typeof target.removeItem !== "function") return false;
  try {
    target.removeItem(CARE_BRIDGE_STORAGE_KEY);
    target.removeItem(PERSONAL_SYNC_SUSPENDED_KEY);
    return true;
  } catch {
    // Storage may be unavailable under browser privacy policy or sandboxing.
    // Retirement is best-effort and must never prevent either app from loading.
    return false;
  }
}
