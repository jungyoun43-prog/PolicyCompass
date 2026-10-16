const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const array = items => ({ type: "array", items });
const text = { type: "string" };
const number = { type: "number" };
const boolean = { type: "boolean" };
const evidence = array({ type: "string", pattern: "^E[1-9][0-9]*$" });
const empty = object({});
const dates = { startDate: text, endDate: text };

const typedFacts = {
  eosinophils: [object({ measurements: { ...array({ anyOf: [
    object({ date: text, value: number, unit: text, evidence }),
    object({ date: text, wbcValue: number, wbcUnit: text, eosPercent: number, evidence }),
  ] }), minItems: 1 } })],
  exacerbations: [
    object({ count: { type: "integer" }, windowMonths: { type: "integer", enum: [12] } }),
    object({ episodes: { ...array(object({ ...dates, episodeId: text, evidence })), minItems: 1 } }),
  ],
  oral_steroids: [object({ ...dates, prednisoloneEquivalentMgPerDay: number, continuous: boolean })],
  single_agent: [object({ regimen: { type: "string", enum: ["single-agent", "combination"] } })],
  durvalumab_dosing: [object({ weightKg: { type: ["number", "null"] }, totalMonths: number })],
  reduction: [object({ baseline: number, current: number, comparable: boolean })],
  duration: [object(dates)],
  omalizumab_trial: [object(dates)],
  biologic_course: [object({ course: { type: "string", enum: ["first-biologic", "from-omalizumab", "other-switch", "unknown"] } })],
};

/** Syntax constraints supplement, and never replace, the server's source checks. */
export function medicationCriteriaResponseSchema(profile) {
  const rows = profile.criteria.map(criterion => {
    const shapes = typedFacts[criterion.kind];
    if (!shapes && !["clinical", "adult"].includes(criterion.kind)) throw new TypeError(`알 수 없는 조건 수치 형식: ${criterion.kind}`);
    const row = (statuses, facts) => object({
      id: { type: "string", enum: [criterion.id] },
      status: { type: "string", enum: statuses },
      evidence,
      facts,
      reason: text,
    });
    return shapes ? { anyOf: [
      row(["met"], { anyOf: shapes }),
      row(["not_met", "missing", "ambiguous"], { anyOf: [empty, ...shapes] }),
    ] } : row(["met", "not_met", "missing", "ambiguous"], empty);
  });
  return object({
    schema: { type: "string", enum: [MEDICATION_CRITERIA_SCHEMA] },
    version: { type: "integer", enum: [1] },
    profileId: { type: "string", enum: [profile.id] },
    criteria: { ...array({ anyOf: rows }), minItems: rows.length, maxItems: rows.length },
  });
}
import { MEDICATION_CRITERIA_SCHEMA } from "../src/medication-policy-criteria.js";
