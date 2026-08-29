import { patientQuestionAssistantStatus } from "../../../../scripts/patient-question-assistant.mjs";
import { jsonResponse, withApiErrors } from "../../../../lib/api.js";

export const GET = withApiErrors(async () => jsonResponse(200, patientQuestionAssistantStatus()));
