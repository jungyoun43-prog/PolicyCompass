import { MEDICATION_DECISION_CHOICES } from "../../src/medication-review-decision.js";

export function MedicationDecisionResult({ review }) {
  const selected = MEDICATION_DECISION_CHOICES[review.verdict];
  return (
    <section className="coverage-decision" aria-label="Jev 판정과 선택지별 확률">
      <h5 className="rx-review__heading">Jev 판정 · {selected.symbol} {selected.label}</h5>
      <ul className="coverage-decision__options" aria-label="선택지별 확률">
        {Object.entries(MEDICATION_DECISION_CHOICES).map(([key, choice]) => {
          const percent = review.probabilities[key] * 100;
          return (
            <li key={key} data-verdict={key} data-selected={key === review.verdict ? "true" : undefined}>
              <div><span>{choice.symbol} {choice.label}{key === review.verdict ? " · 선택됨" : ""}</span><strong>{percent.toFixed(1)}%</strong></div>
              <meter min="0" max="1" value={review.probabilities[key]} aria-label={`${choice.symbol} ${choice.label} 확률`} />
            </li>
          );
        })}
      </ul>
      <p className="rx-review__boundary">확률은 입력 자료에 대한 모델의 선택 확률이며 실제 삭감률을 의미하지 않습니다.</p>
    </section>
  );
}
