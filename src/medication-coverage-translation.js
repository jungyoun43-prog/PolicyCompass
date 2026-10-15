export const COVERAGE_TRANSLATION_MODEL = "anthropic/claude-haiku-5.5";
export const COVERAGE_TRANSLATION_FIELDS = ["dataText", "noticeText", "promptText", "reportText", "summaryText", "criteriaText"];
const LANGUAGES = {
  US: { code: "en", locale: "en-US", label: "영어", instruction: "English (United States)" },
  GB: { code: "en", locale: "en-GB", label: "영어", instruction: "English (United Kingdom)" },
  AU: { code: "en", locale: "en-AU", label: "영어", instruction: "English (Australia)" },
};

export function coverageTranslationLanguage(countryCode) { return LANGUAGES[countryCode] ?? null; }

export function coverageTranslationFields(preview, review, policy) {
  return {
    dataText: preview.dataText, noticeText: preview.noticeText, promptText: preview.promptText,
    reportText: review?.markdown || "", summaryText: review?.summary || "",
    criteriaText: JSON.stringify(policy.criteria || []),
  };
}

/** Originals stay editable and intact; a translation is a separate, read-only view. */
export function coverageTranslationView(preview, review, translation) {
  const active = Boolean(preview && translation?.show && translation.medicationId === preview.medicationId
    && translation.policyId === preview.policyId
    && ["dataText", "noticeText", "promptText"].every(key => translation.source[key] === preview[key]));
  if (!active) return { preview, review, active: false };
  const metadata = { language: translation.language, model: translation.model, sourceNotice: preview.noticeText };
  const translatedPreview = { ...preview, dataText: translation.fields.dataText, noticeText: translation.fields.noticeText,
    promptText: translation.fields.promptText, translation: metadata, translatedCriteria: JSON.parse(translation.fields.criteriaText) };
  const sameReport = review && translation.source.reportText === (review.markdown || "") && translation.source.summaryText === (review.summary || "");
  return {
    active: true, preview: translatedPreview,
    review: sameReport ? { ...review, markdown: translation.fields.reportText, summary: translation.fields.summaryText,
      coveragePolicy: { ...review.coveragePolicy, noticeText: translation.fields.noticeText,
        criteria: translatedPreview.translatedCriteria, translation: metadata } } : review,
  };
}
