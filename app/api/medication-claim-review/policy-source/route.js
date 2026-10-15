export const maxDuration = 120;

import { loadMedicationPolicySource } from "../../../../scripts/medication-policy-source.mjs";
import { medicationCoveragePolicy } from "../../../../src/medication-coverage-policies.js";
import { ApiError, assertSameOrigin, jsonResponse, withApiErrors } from "../../../../lib/api.js";

export const GET = withApiErrors(async request => {
  assertSameOrigin(request);
  const query = new URL(request.url).searchParams;
  const medicationId = query.get("medicationId"), policyId = query.get("policyId");
  const policy = medicationCoveragePolicy(medicationId, policyId);
  if (!policy || policy.countryCode === "KR") throw new ApiError(400, "INVALID_POLICY_SOURCE", "등록된 해외 보험 기준을 선택해 주세요.");
  try {
    return jsonResponse(200, await loadMedicationPolicySource(medicationId, policyId));
  } catch {
    throw new ApiError(502, "POLICY_SOURCE_UNAVAILABLE", "공식 원문을 불러오지 못했습니다. 다시 시도하거나 출처에서 원문을 직접 붙여넣어 주세요.");
  }
});
