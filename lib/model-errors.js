export class ModelContextError extends Error {
  constructor() {
    super("입력이 선택한 모델 또는 제공자의 처리 한도를 초과했습니다. 내용을 자동으로 자르지 않았습니다. 더 큰 입력을 지원하는 모델을 선택하거나 입력을 직접 조정하세요.");
    this.name = "ModelContextError";
  }
}

/** Recognize provider limits without exposing source data from their error text. */
export function assertModelContextAccepted(status, payload) {
  const detail = [payload, payload?.error, payload?.choices?.[0]?.error].map((error) => {
    if (typeof error === "string") return error;
    return `${error?.code ?? ""} ${error?.message ?? ""} ${error?.error_type ?? ""} ${error?.metadata?.error_type ?? ""} ${JSON.stringify(error?.metadata?.raw) ?? ""}`;
  }).join(" ");
  if (status === 413 || /context[_ -]?(?:length|window|limit)|string_too_long|too many tokens|(?:prompt|input) (?:is )?too long/i.test(detail)) {
    throw new ModelContextError();
  }
}
