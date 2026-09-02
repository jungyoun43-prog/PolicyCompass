/**
 * The synthetic five-patient chart that `/emr?demo=1` and a first visit load.
 * It is never persisted; it exists so an empty workspace has something to
 * teach with. Kept apart from the model so the model file reads as rules,
 * not as fixture data.
 */
import { DEFAULT_CLAIM_RULES, KCD_SYSTEM, normalizeClaimRule } from "./claim-rules.js";
import { KIM_CASE_DATASET } from "./kim-case-dataset.js";
import {
  audit,
  createPatient,
  EMR_SCHEMA,
  EMR_VERSION,
  normalizePatientEvent,
  validTimestamp,
} from "./emr-model.js";

const KIM_CASE_DOCUMENTS = [
  [
    "2025-11-17",
    "외래 재진기록지_호흡기내과",
    "검사(Lab)결과",
    "베트남 병원 ) 응급실 약 aspilets ec 80mg efferegaln 500mg ventolin 100mcg nexium mumps 40mg crestor pyme azi 500mg curam preednisolon familty hospital international clinic pnuemonia COPD, p family general hospital esophageal tumor - post -sutfgery ; susepcted thoracic and abdominal aortica aneurysm , enteritis cimplication 번역본) 70세 남자가 고열과 급성 호흡곤란으로 병원에 입원했습니다. 치료과정은 부준적으로 호전되었고 열은 사라졌고 생체지표는 안정적이였습니다. 환자에게 치료를 지속적으로 해야한다고 했으나 퇴원을 요청하였다."
  ],
  [
    "2025-11-17",
    "외래 재진기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u #COPD # Asthma"
  ],
  [
    "2026-02-09",
    "외래 재진기록지_호흡기내과",
    "검사(Lab)결과",
    "베트남 병원 ) 응급실 약 aspilets ec 80mg efferegaln 500mg ventolin 100mcg nexium mumps 40mg crestor pyme azi 500mg curam preednisolon familty hospital international clinic pnuemonia COPD, p family general hospital esophageal tumor - post -sutfgery ; susepcted thoracic and abdominal aortica aneurysm , enteritis cimplication 번역본) 70세 남자가 고열과 급성 호흡곤란으로 병원에 입원했습니다. 치료과정은 부준적으로 호전되었고 열은 사라졌고 생체지표는 안정적이였습니다. 환자에게 치료를 지속적으로 해야한다고 했으나 퇴원을 요청하였다."
  ],
  [
    "2026-02-09",
    "외래 재진기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u #COPD # Asthma"
  ],
  [
    "2026-02-25",
    "협의진료기록지[의뢰]",
    "진단",
    "Chronic obstructive pulmonary disease, unspecified, unspecified {J4499} Asthma, unspecified {J459}"
  ],
  [
    "2026-02-25",
    "협의진료기록지[의뢰]",
    "의뢰내용",
    "<Consultatoin for abdominal artery anerusym, intramural thrombus> # eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u #COPD # Asthma 교수님께 교수님 안녕하세요 상환은 COPD 치료 중인 분입니다. APCT 에서 No change of fusiform aneurysm of infrarenal abdominal aorta (about 4.7cm in diameter) with intramural thrombus. 소견 보여 진료 의뢰드리오니 바쁘신 중 고진선처 부탁드립니다. 감사합니다. 호흡기내과 000 올림."
  ],
  [
    "2026-02-25",
    "외래 재진기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u #COPD # Asthma"
  ],
  [
    "2026-04-30",
    "응급센터 전문의 기록지",
    "Plan",
    "Dyspnea & Fever origin WU"
  ],
  [
    "2026-04-30",
    "응급센터 전문의 기록지",
    "C.C",
    "Dyspnea"
  ],
  [
    "2026-04-30",
    "응급센터기록지",
    "현병력",
    "Underlying>> #1. AAA on 콩코르정 (2026) #2. COPD #3. asthma #4 Rt. BG-CR infarction (2023/11/27) #5 Rt. pICA near-complete occlusion #6. terminal BPH #7. s/p Lewis op d/t eophageal cancer c lung metz (2020, 0000병원) - 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. open f/u ==================== Current problem>> #A. Dyspnea PI> 택시기사로 평소 일하면서 일상생활 및 일하는 데 dyspnea 없던 분으로 4일 전부터 택시기사 일 하기 힘들 정도로 mMRC2의 dyspnea 발생하여, 4일간 점점 악화됨 뚜렷한 유발, 악화, 완화요인 - (보호자에 의하면 4일 전 회 먹은 후부터 힘들어했다고 함) 3일 전부터 열이 났다고 하나 체온 측정 - ER 내원 하루 전까지 흡입기 사용, 최근 약 변경 없음 allergy - Orthopnea : - F / C / M : + / + / - Chest pain / Palpitation / Syncope : - / - / - C / S / R : + / + / - Dizziness / Diaphoresis : - / - PE> Symmetrical chest expansion Clear breathing sound without weezing and crackle Regular heart beat PTPE : -"
  ],
  [
    "2026-04-30",
    "응급센터 전문의 기록지",
    "P.I",
    "Underlying>> #1. AAA on 콩코르정 (2026) #2. COPD #3. asthma #4 Rt. BG-CR infarction (2023/11/27) #5 Rt. pICA near-complete occlusion #6. terminal BPH #7. s/p Lewis op d/t eophageal cancer c lung metz (2020, 0000병원) - 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. open f/u ================================================== COPD (조터나+포스터) 사용중 Pf 000 선생님 추적중. 1달전 객혈 1회 있다가 호전. 3-4일전부터 기운이 없고 식욕저하 발생. 이후 발열동반. 기침 가래 있고 가래는 노란색. 호흡곤란 심해져 내원함."
  ],
  [
    "2026-04-30",
    "응급센터 전문의 기록지",
    "Progress",
    "#1 혈압저하로 ICU adm 항생제 dual cover W 없으므로 steroid 투여 안합니다. saline loading 후에도 혈압오르지 않으면 C-line 삽입 NE 투여 부탁드립니다. MICU 000 교수님 입원합니다."
  ],
  [
    "2026-04-30",
    "응급센터 전문의 기록지",
    "C.C",
    "4일전부터 발생한 호흡곤란"
  ],
  [
    "2026-04-30",
    "입원기록지_공통",
    "현병력",
    "(집에서 거주, home O2 2L/min, 의사소통가능, 거동가능, 운전가능) Underlying> # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH # s/p Ivor Lewis op ((transthoracic espohagectomy, proximal gastrectomy, intrathoracic esophagogastrostomy, pyloromymectomy, 2-field LN dissection) d/t eophageal cancer c lung metz (2020, 0000병원) -> adjuvant FP -> 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. # nueropathic pain : r/o PPN Current> # pneumonia (Rt) sepsis 택시기사로 평소 일하면서 일상생활 및 일하는 데 dyspnea 없던 분. 4일 전부터 택시기사 일 하기 힘들 정도로 mMRC2의 dyspnea 발생 4일간 점점 악화 (보호자에 의하면 4일 전 회 먹은 후부터 힘들어했다고 하나, 뚜렷한 유발, 악화, 완화요인 -) 3일 전부터 열이 났다고 하나 체온 측정은 하지 않았음. @ Orthopnea : - F / C / M : + / + / - Chest pain / Palpitation / Syncope : - / - / - C / S / R : + / + / - : 누런 가래가 생겼다고 함. Dizziness / Diaphoresis : - / - @ lung sound : Wheezing(-) PTPE : - @ ER 내원 하루 전까지 흡입기 사용, 최근 약 변경 없음 allergy -"
  ],
  [
    "2026-04-30",
    "입원기록지_공통",
    "진단명",
    "Pneumonia, unspecified Chronic obstructive pulmonary disease, unspecified, unspecified Asthma, unspecified"
  ],
  [
    "2026-04-30",
    "경과기록지_공통",
    "Plan",
    "# pn > W sound 는 없어서 steroid IV는 투여하지 않음. / nebulizer 적용 항생제 FEP+LVX투여 == culture 결과 확인 필요"
  ],
  [
    "2026-04-30",
    "경과기록지_공통",
    "Assessment",
    "(집에서 거주, home O2 2L/min, 의사소통가능, 거동가능, 운전가능) Underlying> # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH # s/p Ivor Lewis op ((transthoracic espohagectomy, proximal gastrectomy, intrathoracic esophagogastrostomy, pyloromymectomy, 2-field LN dissection) d/t eophageal cancer c lung metz (2020, 0000병원) -> adjuvant FP -> 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. # nueropathic pain : r/o PPN Current> # pneumonia (Rt) sepsis"
  ],
  [
    "2026-05-01",
    "협의진료기록지[의뢰]",
    "의뢰내용",
    "Pneumonia, unspecified {J189} Chronic obstructive pulmonary disease, unspecified, unspecified {J4499} Asthma, unspecified {J459}"
  ],
  [
    "2026-05-03",
    "Off duty note_공통",
    "경과요약 및 특이소견",
    "집에서 거주하며 home O2 적용하는 분. COPD, asthma로 호흡기내과에서 조터나, 포스터넥스트할러 사용중인 분. dyspnea 주소로 내원함. wheezing sound는 없었음. pneumonia(Rt) sepsis 진단하에 FEP+LVX 투약 시작함. 이후 주말간 MRSA cover를 위해 TEC 추가했고, severe CAP, septic shock 진단하에 steroid 추가함. 현재 nepi 중단했고 nasal prong 2L/min 적용중인 상태"
  ],
  [
    "2026-05-03",
    "Off duty note_공통",
    "진단명",
    "Pneumonia, unspecified Chronic obstructive pulmonary disease, unspecified, unspecified Asthma, unspecified"
  ],
  [
    "2026-05-03",
    "Off duty note_공통",
    "치료계획",
    "- culture 결과 확인 및 결과에 따라 항생제 de-escalation 부탁드립니다 - 현재 Nepi 중단한 상태로, pneumonia 호전 소견 보이면 steroid도 감량 부탁드립니다."
  ],
  [
    "2026-05-03",
    "Off duty note_공통",
    "병력",
    "(집에서 거주, home O2 2L/min, 의사소통가능, 거동가능, 운전가능) Underlying> # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH # s/p Ivor Lewis op ((transthoracic espohagectomy, proximal gastrectomy, intrathoracic esophagogastrostomy, pyloromymectomy, 2-field LN dissection) d/t eophageal cancer c lung metz (2020, 0000병원) -> adjuvant FP -> 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. # nueropathic pain : r/o PPN"
  ],
  [
    "2026-05-04",
    "경과기록지_공통",
    "Plan",
    "#. CRO+LVX (4/30) FEP+LVX #4 (5/1-) : FEP 2g q8h, LVX 750mg q24h TEC (5/1-4) NE 중단 스테로이드 감량고려 == culture 결과 확인 필요"
  ],
  [
    "2026-05-04",
    "경과기록지_공통",
    "Assessment",
    "(집에서 거주, home O2 2L/min, 의사소통가능, 거동가능, 운전가능) Underlying> # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH # s/p Ivor Lewis op ((transthoracic espohagectomy, proximal gastrectomy, intrathoracic esophagogastrostomy, pyloromymectomy, 2-field LN dissection) d/t eophageal cancer c lung metz (2020, 0000병원) -> adjuvant FP -> 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. # nueropathic pain : r/o PPN Current> # pneumonia (Rt) sepsis"
  ],
  [
    "2026-05-04",
    "On duty note_공통",
    "치료계획",
    "#A FEP/LVO steroid bid tapering"
  ],
  [
    "2026-05-04",
    "On duty note_공통",
    "병력",
    "Underlying> # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH # s/p Ivor Lewis op ((transthoracic espohagectomy, proximal gastrectomy, intrathoracic esophagogastrostomy, pyloromymectomy, 2-field LN dissection) d/t eophageal cancer c lung metz (2020, 0000병원) -> adjuvant FP -> 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. # nueropathic pain : r/o PPN current> #A pneumonia sepsis"
  ],
  [
    "2026-05-04",
    "On duty note_공통",
    "진단명",
    "Pneumonia, unspecified Chronic obstructive pulmonary disease, unspecified, unspecified Asthma, unspecified"
  ],
  [
    "2026-05-04",
    "경과기록지_공통",
    "Plan",
    "#A FEP/LVO steroid bid tapering"
  ],
  [
    "2026-05-04",
    "경과기록지_공통",
    "Assessment",
    "Underlying> # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH # s/p Ivor Lewis op ((transthoracic espohagectomy, proximal gastrectomy, intrathoracic esophagogastrostomy, pyloromymectomy, 2-field LN dissection) d/t eophageal cancer c lung metz (2020, 0000병원) -> adjuvant FP -> 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. # nueropathic pain : r/o PPN Current> # pneumonia (Rt) sepsis"
  ],
  [
    "2026-05-06",
    "경과기록지_공통",
    "Plan",
    "#A FEP/LVO steroid bid tapering 내일 lab 확인 후 5/8 퇴원 고려"
  ],
  [
    "2026-05-06",
    "경과기록지_공통",
    "Assessment",
    "Underlying> # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH # s/p Ivor Lewis op ((transthoracic espohagectomy, proximal gastrectomy, intrathoracic esophagogastrostomy, pyloromymectomy, 2-field LN dissection) d/t eophageal cancer c lung metz (2020, 0000병원) -> adjuvant FP -> 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. # nueropathic pain : r/o PPN Current> # pneumonia (Rt) sepsis"
  ],
  [
    "2026-05-08",
    "진단서 국문",
    "치료 내용 및 향후 치료에 대한 소견",
    "4/30 ct chest 1. 1) Newly seen air space consolidation in RUL and RLL, -> Air space pneumonia. 2) Small right pleural effusion. 2. 1) No remarkable change of multiple nodules in both lungs (less than 8 mm), indetermiante. 2) No change of probable sequelae of previous chronic inflammation in LUL. 3) Confluent emphysema and substantial paraseptal emphysema in both lungs with diffuse bronchial wall thickening. -> Mixed phenotype COPD. 호흡곤란으로 응급실 입원하여 시행한 검사에서 폐렴 소견 보였으며, 중환자실 입실함. 상태 호전되어 일반병실로 이실하여 치료하였고 금일 퇴원함. COPD, Asthma overlap 으로 지속적인 외래 추적관찰 요함."
  ],
  [
    "2026-05-13",
    "외래 재진기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u #COPD # Asthma"
  ],
  [
    "2026-06-04",
    "퇴원요약지_호흡기내과",
    "진단명",
    "Pneumonia, unspecified Chronic obstructive pulmonary disease, unspecified, unspecified Asthma, unspecified"
  ],
  [
    "2026-06-04",
    "퇴원요약지_호흡기내과",
    "입원사유",
    "(집에서 거주, home O2 2L/min, 의사소통가능, 거동가능, 운전가능) Underlying> # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH # s/p Ivor Lewis op ((transthoracic espohagectomy, proximal gastrectomy, intrathoracic esophagogastrostomy, pyloromymectomy, 2-field LN dissection) d/t eophageal cancer c lung metz (2020, 0000병원) -> adjuvant FP -> 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. # nueropathic pain : r/o PPN Current> # pneumonia (Rt) sepsis 택시기사로 평소 일하면서 일상생활 및 일하는 데 dyspnea 없던 분. 4일 전부터 택시기사 일 하기 힘들 정도로 mMRC2의 dyspnea 발생 4일간 점점 악화 (보호자에 의하면 4일 전 회 먹은 후부터 힘들어했다고 하나, 뚜렷한 유발, 악화, 완화요인 -) 3일 전부터 열이 났다고 하나 체온 측정은 하지 않았음. @ Orthopnea : - F / C / M : + / + / - Chest pain / Palpitation / Syncope : - / - / - C / S / R : + / + / - : 누런 가래가 생겼다고 함. Dizziness / Diaphoresis : - / - @ lung sound : Wheezing(-) PTPE : - @ ER 내원 하루 전까지 흡입기 사용, 최근 약 변경 없음 allergy -"
  ],
  [
    "2026-06-11",
    "외래 재진기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u #COPD # Asthma"
  ],
  [
    "2026-06-11",
    "입원기록지_호흡기내과",
    "진단명",
    "Sepsis, unspecified Chronic obstructive pulmonary disease, unspecified, unspecified Asthma, unspecified Pneumonia, unspecified Cerebral infarction, unspecified Other hyperlipidaemia Septic shock"
  ],
  [
    "2026-06-11",
    "입원기록지_호흡기내과",
    "기타",
    "식도암('20), COPD, Asthma, Stroke ('23), AAA, BPH, HTN(no Tx 식도암 수술이후 저혈압와서 중단)"
  ],
  [
    "2026-06-11",
    "경과기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH current problem > #A. pleual effusion"
  ],
  [
    "2026-06-12",
    "경과기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH current problem > #A. pleual effusion"
  ],
  [
    "2026-06-15",
    "경과기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH current problem > #A. pleual effusion"
  ],
  [
    "2026-06-17",
    "경과기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH current problem > #A. pleual effusion"
  ],
  [
    "2026-06-19",
    "경과기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH current problem > #A. pleual effusion"
  ],
  [
    "2026-06-22",
    "협의진료기록지[의뢰]",
    "진단",
    "Sepsis, unspecified {A419} Chronic obstructive pulmonary disease, unspecified, unspecified {J4499} Asthma, unspecified {J459} Pneumonia, unspecified {J189} Cerebral infarction, unspecified {I639} Other hyperlipidaemia {E784} Septic shock {R572}"
  ],
  [
    "2026-06-22",
    "경과기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH current problem > #A. pleual effusion"
  ],
  [
    "2026-06-24",
    "경과기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH current problem > #A. pleual effusion"
  ],
  [
    "2026-06-26",
    "협의진료기록지[의뢰]",
    "진단",
    "Sepsis, unspecified {A419} Chronic obstructive pulmonary disease, unspecified, unspecified {J4499} Asthma, unspecified {J459} Pneumonia, unspecified {J189} Cerebral infarction, unspecified {I639} Other hyperlipidaemia {E784} Septic shock {R572}"
  ],
  [
    "2026-06-26",
    "경과기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH current problem > #A. pleual effusion"
  ],
  [
    "2026-06-29",
    "경과기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH current problem > #A. pleual effusion"
  ],
  [
    "2026-07-03",
    "퇴원요약지_호흡기내과",
    "진단명",
    "Sepsis, unspecified Chronic obstructive pulmonary disease, unspecified, unspecified Asthma, unspecified Pneumonia, unspecified Cerebral infarction, unspecified Other hyperlipidaemia Septic shock"
  ],
  [
    "2026-07-06",
    "외래 재진기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u #COPD # Asthma"
  ],
  [
    "2026-07-11",
    "경과기록지_공통",
    "Plan",
    "# pn > W sound 는 없어서 steroid IV는 투여하지 않음. / nebulizer 적용 > 항생제 FEP+LVX투여 > steroid, TEC 추가한 상태 == culture 결과 확인 필요"
  ],
  [
    "2026-07-11",
    "경과기록지_공통",
    "Assessment",
    "(집에서 거주, home O2 2L/min, 의사소통가능, 거동가능, 운전가능) Underlying> # Rt. BG-CR infarction (2023/11/27) Rt. pICA near-complete occlusion # AAA on 콩코르정 (2026) # COPD # asthma # terminal BPH # s/p Ivor Lewis op ((transthoracic espohagectomy, proximal gastrectomy, intrathoracic esophagogastrostomy, pyloromymectomy, 2-field LN dissection) d/t eophageal cancer c lung metz (2020, 0000병원) -> adjuvant FP -> 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음. # nueropathic pain : r/o PPN Current> # pneumonia (Rt) sepsis"
  ],
  [
    "2026-08-06",
    "외래 재진기록지_호흡기내과",
    "Assessment",
    "# eophageal cancer - 0000병원 Lewis op. 폐전이 의심되는 소견 있었으나 호전양상으로 전이가능성 낮음/ open f/u #COPD # Asthma"
  ]
];

function dateBefore(asOf, days) {
  const timestamp = new Date(`${asOf}T00:00:00.000Z`).valueOf();
  return new Date(timestamp - days * 86_400_000).toISOString().slice(0, 10);
}

function demoEvent(id, type, code, label, date, extras = {}) {
  return normalizePatientEvent({ id, type, code, label, date, source: { kind: "demo", label: "PolicyCompass 예시 환자 기록" }, ...extras });
}

export function createDemoEmrState(now = new Date().toISOString()) {
  const timestamp = validTimestamp(now);
  const asOf = timestamp.slice(0, 10);
  const arrivedAt = new Date(new Date(timestamp).valueOf() - 12 * 60_000).toISOString();
  const startedAt = new Date(new Date(timestamp).valueOf() - 7 * 60_000).toISOString();
  const first = createPatient({
    id: "demo-patient-kim",
    mrn: "PC-1001",
    name: "김비타",
    birthDate: "1955-06-15",
    sex: "male",
    sourceDataset: KIM_CASE_DATASET,
    phone: "010-0000-1001",
    address: "서울시 한빛구",
    bloodType: "A+",
    insuranceType: "national-health",
    emergencyContact: { name: "김보호", relation: "가족", phone: "010-0000-9001" },
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("kim-visit-today", "encounter", "AMB", "호흡기내과 외래", asOf, {
        recordStatus: "draft",
        status: "in-progress",
        arrivedAt,
        startedAt,
        department: "호흡기내과",
        clinician: "이선우",
        room: "3진료실",
        chiefComplaint: "반복되는 호흡곤란·천식 악화 추적, 생물학적 제제(benralizumab) 검토",
        soap: {
          subjective: "\"숨이 차서 택시 일을 오래 못 해요. 올해만 폐렴으로 두 번 입원했어요.\" 조터나·포스터 흡입 유지, home O₂ 2L/min. 4-5월·6월 입원 후 회복 중이나 노작성 호흡곤란 지속.",
          objective: "청진상 천명 없음 · SpO₂ 94% (home O₂ 2L/min) · 6/15 Eosinophil(EM) 6.1% · WBC 8.2×10³/µL · BP 148/94 mmHg · HbA1c 7.1%.",
          assessment: "1. COPD-천식 중복(J44.9·J45.9) - 흡입제 유지에도 반복 악화: 4/30 폐렴·패혈증 입원(ICU), 6/11 재입원. 입원 중 전신 스테로이드(hydrocortisone IV) 투여 2회. 생물학적 제제(benralizumab) 급여기준 검토 대상.\n2. 본태성 고혈압(I10) - ARB 유지 중.\n3. 제2형 당뇨병(E11) - HbA1c 7.1%, 목표 근접.",
          plan: "1. 천식: benralizumab 급여기준 AI 사전검토 후 투여 여부 결정 - 호산구 추이·급성악화 횟수 재확인.\n2. 혈압: ARB 유지, 4주 뒤 재측정.\n3. 당뇨: 식사·운동 요법 재교육, 3개월 뒤 HbA1c 재검.",
        },
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("kim-visit-dx", "condition", "I10", "고혈압", asOf, {
        recordStatus: "draft",
        encounterId: "kim-visit-today",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
      demoEvent("kim-visit-order", "service-request", "DEMO-A1C-FOLLOWUP", "당화혈색소 추적검사", asOf, {
        recordStatus: "draft",
        encounterId: "kim-visit-today",
        system: "urn:policycompass:demo:service",
        status: "active",
        intent: "order",
        order: { kind: "laboratory", priority: "routine", instructions: "다음 내원 전 시행" },
      }),
      demoEvent("kim-encounter", "encounter", "AMB", "내분비내과 외래", dateBefore(asOf, 4), {
        chiefComplaint: "당뇨·고혈압 정기 추적",
        note: "혈압과 당화혈색소 추적",
        soap: {
          subjective: "복약 잘 유지 중이라고 함. 저혈당 증상, 다음·다뇨 없음. 가정혈압 아침 평균 138/88. 최근 저녁 발 부종감 호소, 아침이면 호전.",
          objective: "BP 148/94 mmHg(좌측 상완). HbA1c 7.1% (5월 7.8% → 금회 7.1%, 개선 추세). LDL 156 mg/dL. 양측 족부 감각 정상, 함요부종 없음.",
          assessment: "1. 제2형 당뇨병(E11) - HbA1c 8.2→7.8→7.1%로 호전 추세이나 목표(7.0% 미만) 근접 미달.\n2. 본태성 고혈압(I10) - 진료실·가정혈압 모두 목표(130/80) 상회, 조절 미흡.\n3. 이상지질혈증 의증 - LDL 156 mg/dL, 스타틴 미복용 상태.",
          plan: "1. 당뇨: 메트포르민 현 용량 유지, 식사·운동 요법 재교육. 3개월 뒤 HbA1c 재검.\n2. 혈압: ARB 증량 검토, 2주 가정혈압 기록 후 재평가. 저염식 교육.\n3. 지질: 공복 지질 재검 후 스타틴 시작 여부 결정.\n4. 다음 외래 4주 후.",
        },
      }),
      demoEvent("kim-bp", "observation", "85354-9", "혈압", dateBefore(asOf, 9), { system: "http://loinc.org", value: "148/94", unit: "mmHg" }),
      demoEvent("kim-a1c", "observation", "4548-4", "당화혈색소", dateBefore(asOf, 12), { system: "http://loinc.org", value: 7.1, unit: "%" }),
      demoEvent("kim-ldl", "observation", "2089-1", "LDL 콜레스테롤", dateBefore(asOf, 12), { system: "http://loinc.org", value: 156, unit: "mg/dL" }),
      demoEvent("kim-a1c-prev", "observation", "4548-4", "당화혈색소", dateBefore(asOf, 100), { system: "http://loinc.org", value: 7.8, unit: "%" }),
      demoEvent("kim-a1c-prev2", "observation", "4548-4", "당화혈색소", dateBefore(asOf, 190), { system: "http://loinc.org", value: 8.2, unit: "%" }),
      demoEvent("kim-ldl-prev", "observation", "2089-1", "LDL 콜레스테롤", dateBefore(asOf, 190), { system: "http://loinc.org", value: 171, unit: "mg/dL" }),
      demoEvent("kim-wbc", "observation", "6690-2", "백혈구", dateBefore(asOf, 12), { system: "http://loinc.org", value: 7.2, unit: "10³/µL" }),
      demoEvent("kim-hb", "observation", "718-7", "혈색소", dateBefore(asOf, 12), { system: "http://loinc.org", value: 11.8, unit: "g/dL" }),
      demoEvent("kim-plt", "observation", "777-3", "혈소판", dateBefore(asOf, 12), { system: "http://loinc.org", value: 233, unit: "10³/µL" }),
      demoEvent("kim-med", "medication", "MED-ARB", "로사르탄정 50mg", dateBefore(asOf, 28), { status: "active", note: "1일 1회" }),
      demoEvent("kim-procedure", "procedure", "DEMO-BP-FOLLOWUP", "고혈압 추적검사", dateBefore(asOf, 55), { system: "urn:policycompass:demo:service", status: "completed" }),
      demoEvent("kim-diabetes", "condition", "E11", "제2형 당뇨병", dateBefore(asOf, 940), { system: KCD_SYSTEM, status: "active" }),
      demoEvent("kim-hypertension", "condition", "I10", "고혈압", dateBefore(asOf, 1_460), { system: KCD_SYSTEM, status: "active" }),
      demoEvent("kim-allergy", "allergy", "ALG-PEN", "페니실린 알레르기", dateBefore(asOf, 2_100), { status: "active", note: "발진" }),
      demoEvent("kim-pneumonia-encounter", "encounter", "IMP", "호흡기내과 입원", dateBefore(asOf, 150), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "발열·기침·호흡곤란을 동반한 지역사회획득 폐렴 입원",
        note: "7차 폐렴 적정성 평가 흐름을 설명하기 위한 예시 과거 입원",
        soap: {
          subjective: "\"사흘 전부터 열이 나고 누런 가래가 나오는 기침이 심해졌어요. 조금만 걸어도 숨이 차요.\" 오한 동반, 흉통은 없음.",
          objective: "BT 38.6 ℃ · RR 24회/분 · SpO₂ 92% (실내공기) · BP 118/72 mmHg · HR 104회/분. 우하폐야 수포음 청진됨. 흉부 X-ray 우하엽 폐침윤.",
          assessment: "지역사회획득 폐렴(J18.9), 우하엽. 저산소혈증과 빈호흡 동반으로 입원 치료 대상으로 판단함.",
          plan: "1. 정맥 항생제 투여 시작, 경험적 요법.\n2. 산소 투여로 SpO₂ 94% 이상 유지.\n3. 객담 배양·혈액 배양 시행 후 결과에 따라 항생제 조정.\n4. 발열·호흡수·산소포화도 일 2회 추적, 퇴원 후 외래 경과 확인.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 150)}T12:00:00.000Z` },
      }),
      demoEvent("kim-pneumonia", "condition", "J18.9", "상세불명 병원체의 폐렴", dateBefore(asOf, 150), {
        encounterId: "kim-pneumonia-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
      // 실제 사례 기반 시드: 반복 천식 진단, Eos%/WBC 검사, 전신 스테로이드 정주.
      demoEvent("kim-case-cond-1", "condition", "J45.9", "천식, 상세불명 (Asthma, unspecified)", "2025-11-17", {
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
      }),
      demoEvent("kim-case-cond-2", "condition", "J45.9", "천식, 상세불명 (Asthma, unspecified)", "2026-02-09", {
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
      }),
      demoEvent("kim-case-cond-3", "condition", "J45.9", "천식, 상세불명 (Asthma, unspecified)", "2026-02-25", {
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
      }),
      demoEvent("kim-case-cond-4", "condition", "J45.9", "천식, 상세불명 (Asthma, unspecified)", "2026-04-30", {
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
      }),
      demoEvent("kim-case-cond-5", "condition", "J45.9", "천식, 상세불명 (Asthma, unspecified)", "2026-05-13", {
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
      }),
      demoEvent("kim-case-cond-6", "condition", "J45.9", "천식, 상세불명 (Asthma, unspecified)", "2026-06-11", {
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
      }),
      demoEvent("kim-case-cond-7", "condition", "J45.9", "천식, 상세불명 (Asthma, unspecified)", "2026-07-06", {
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
      }),
      demoEvent("kim-case-cond-8", "condition", "J45.9", "천식, 상세불명 (Asthma, unspecified)", "2026-08-06", {
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
      }),
      demoEvent("kim-case-lab-1", "observation", "", "Eosinophil", "2026-02-19", { value: 3.4, unit: "%" }),
      demoEvent("kim-case-lab-2", "observation", "", "WBC", "2026-02-19", { value: 6.4, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-3", "observation", "", "WBC (EM)", "2026-04-30", { value: 20.4, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-4", "observation", "", "WBC", "2026-04-30", { value: "0-1" }),
      demoEvent("kim-case-lab-5", "observation", "", "Eosinophil (EM)", "2026-04-30", { value: 0.3, unit: "%" }),
      demoEvent("kim-case-lab-6", "observation", "", "Eosinophil (EM)", "2026-05-01", { value: 0.1, unit: "%" }),
      demoEvent("kim-case-lab-7", "observation", "", "WBC (EM)", "2026-05-01", { value: 23, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-8", "observation", "", "Eosinophil (EM)", "2026-05-02", { value: "", unit: "%" }),
      demoEvent("kim-case-lab-9", "observation", "", "WBC (EM)", "2026-05-02", { value: 16.6, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-10", "observation", "", "Eosinophil (EM)", "2026-05-03", { value: "", unit: "%" }),
      demoEvent("kim-case-lab-11", "observation", "", "WBC (EM)", "2026-05-03", { value: 17.5, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-12", "observation", "", "Eosinophil (EM)", "2026-05-04", { value: "", unit: "%" }),
      demoEvent("kim-case-lab-13", "observation", "", "WBC (EM)", "2026-05-04", { value: 12.9, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-14", "observation", "", "Eosinophil (EM)", "2026-05-07", { value: 0.1, unit: "%" }),
      demoEvent("kim-case-lab-15", "observation", "", "WBC (EM)", "2026-05-07", { value: 19.3, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-16", "observation", "", "Eosinophil (CSF \uc774\uc678)", "2026-06-11", { value: 1, unit: "%" }),
      demoEvent("kim-case-lab-17", "observation", "", "WBC", "2026-06-11", { value: 4000, unit: "/uL" }),
      demoEvent("kim-case-lab-18", "observation", "", "Eosinophil (EM)", "2026-06-11", { value: 2.8, unit: "%" }),
      demoEvent("kim-case-lab-19", "observation", "", "WBC (EM)", "2026-06-11", { value: 9.2, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-20", "observation", "", "WBC", "2026-06-12", { value: "1-4" }),
      demoEvent("kim-case-lab-21", "observation", "", "Eosinophil (EM)", "2026-06-15", { value: 6.1, unit: "%" }),
      demoEvent("kim-case-lab-22", "observation", "", "WBC (EM)", "2026-06-15", { value: 8.2, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-23", "observation", "", "Eosinophil (EM)", "2026-06-18", { value: 6, unit: "%" }),
      demoEvent("kim-case-lab-24", "observation", "", "WBC (EM)", "2026-06-18", { value: 10.1, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-25", "observation", "", "Eosinophil (EM)", "2026-06-22", { value: 5, unit: "%" }),
      demoEvent("kim-case-lab-26", "observation", "", "WBC (EM)", "2026-06-22", { value: 8.6, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-27", "observation", "", "Eosinophil (EM)", "2026-06-25", { value: 3.7, unit: "%" }),
      demoEvent("kim-case-lab-28", "observation", "", "WBC (EM)", "2026-06-25", { value: 12.7, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-29", "observation", "", "Eosinophil (EM)", "2026-06-29", { value: 4.7, unit: "%" }),
      demoEvent("kim-case-lab-30", "observation", "", "WBC (EM)", "2026-06-29", { value: 8.1, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-31", "observation", "", "WBC (EM)", "2026-07-06", { value: 9, unit: "\u00d710\u00b3/\u3395" }),
      demoEvent("kim-case-lab-32", "observation", "", "Eosinophil (EM)", "2026-07-06", { value: 2.9, unit: "%" }),
      demoEvent("kim-hcort-1", "medication", "MED-HCORT", "hydrocortisone sodium succinate 100mg (코티소루주 100mg(한올))", "2026-05-01", {
        status: "active",
        prescription: { dose: 100, doseUnit: "mg", route: "정맥주사", frequency: "1일 1회", durationDays: 1 },
      }),
      demoEvent("kim-hcort-2", "medication", "MED-HCORT", "hydrocortisone sodium succinate 100mg (코티소루주 100mg(한올))", "2026-05-05", {
        status: "active",
        prescription: { dose: 100, doseUnit: "mg", route: "정맥주사", frequency: "1일 1회", durationDays: 1 },
      }),
      demoEvent("kim-icslaba", "medication", "MED-ICSLABA", "포스터 넥스트할러 흡입제 (ICS-LABA)", dateBefore(asOf, 400), {
        status: "active",
        prescription: { dose: 1, doseUnit: "회", route: "흡입", frequency: "1일 2회", durationDays: 90 },
      }),
      demoEvent("kim-lama", "medication", "DEMO-LAMA", "조터나 흡입제 (LAMA)", dateBefore(asOf, 330), {
        status: "active",
        prescription: { dose: 1, doseUnit: "캡슐", route: "흡입", frequency: "1일 1회", durationDays: 90 },
      }),
      demoEvent("kim-dyspnea", "symptom", "SYM-DYSPNEA", "호흡곤란 — 야간·운동 시 악화, 흡입제 유지에도 조절 불충분", dateBefore(asOf, 38), { status: "active" }),
      ...KIM_CASE_DOCUMENTS.map(([date, title, section, text], index) => demoEvent(
        `kim-case-doc-${index + 1}`, "note", "", `${title} · ${section}`, date, { note: text },
      )),
    ],
  }, timestamp);
  const second = createPatient({
    id: "demo-patient-park",
    mrn: "PC-1002",
    name: "박여정",
    birthDate: "1958-11-03",
    sex: "male",
    bloodType: "unknown",
    insuranceType: "national-health",
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("park-visit-today", "encounter", "AMB", "신경과 외래", asOf, {
        recordStatus: "draft",
        status: "arrived",
        arrivedAt: timestamp,
        department: "신경과",
        clinician: "박지안",
        room: "5진료실",
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("park-encounter", "encounter", "AMB", "신경과 외래", dateBefore(asOf, 2), {
        department: "신경과",
        clinician: "정민호",
        chiefComplaint: "편두통 추적 관찰",
        note: "두통 빈도와 약물 사용 확인",
        soap: {
          subjective: "지난 4주간 두통 3회, 이전(월 6회)보다 감소. 트립탄 복용 시 2시간 내 호전. 전조 증상 없음. 수면은 하루 6시간 정도.",
          objective: "신경학적 진찰 정상. 경부 강직 없음. BP 132/80 mmHg.",
          assessment: "1. 편두통(G43) - 예방요법 반응 양호, 발작 빈도 50% 이상 감소. 약물과용두통 소견 없음(급성기 약물 월 3회).",
          plan: "1. 현 예방요법 유지, 두통 일기 지속.\n2. 급성기 트립탄 월 8회 이하 유지 교육.\n3. 8주 후 재평가, 빈도 재증가 시 용량 조정.",
        },
      }),
      demoEvent("park-symptom", "symptom", "SYM-HEADACHE", "반복되는 두통", dateBefore(asOf, 2), { note: "월 5회, 빛에 민감" }),
      demoEvent("park-migraine", "condition", "G43", "편두통", dateBefore(asOf, 460), { status: "active" }),
      demoEvent("park-med", "medication", "MED-TRIPTAN", "예시 편두통 약", dateBefore(asOf, 35), { status: "active", note: "증상 시 복용" }),
      demoEvent("park-bmd-indication", "condition", "DEMO-BMD-INDICATION", "골밀도검사 적응증 확인 기록", dateBefore(asOf, 40), { system: "urn:policycompass:demo:condition", status: "active" }),
      demoEvent("park-bmd", "procedure", "DEMO-BMD", "골밀도검사", dateBefore(asOf, 350), { system: "urn:policycompass:demo:service", status: "completed" }),
      demoEvent("park-copd-encounter", "encounter", "AMB", "호흡기내과 외래", dateBefore(asOf, 90), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "반복 COPD 상병과 처방 근거 재확인",
        note: "진단 근거 보완이 필요한 COPD 예시 사례",
        soap: {
          subjective: "\"계단 오를 때 숨이 차고 아침에 가래가 끓어요. 벌써 몇 년 됐어요.\" 흡연력은 본인도 정확히 기억하지 못함. mMRC 2단계 수준.",
          objective: "RR 18회/분 · SpO₂ 96% (실내공기). 호기 연장, 양측 폐야 천명음 경도. 폐기능검사 시행 코드(F6002)는 있으나 기관지확장제 투여 후 FEV₁/FVC 수치가 판독지에 없음.",
          assessment: "만성폐쇄성폐질환 의증(J44.9). 증상은 부합하나 post-BD FEV₁/FVC 0.70 미만을 확인할 구조화된 폐기능 결과가 없어 진단을 확정하지 못함.",
          plan: "1. 기관지확장제 전후 폐활량검사 재시행, post-BD FEV₁/FVC 수치 기록.\n2. 흡연 갑년과 직업·환경 노출력 문진 보완.\n3. 결과 확인 전까지 현재 처방 유지, 확진 시 흡입제 단계 재조정.\n4. 4주 뒤 결과 확인 외래.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 90)}T12:00:00.000Z` },
      }),
      demoEvent("park-copd", "condition", "J44.9", "만성폐쇄성폐질환", dateBefore(asOf, 90), {
        encounterId: "park-copd-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
      demoEvent("park-copd-pft-procedure", "procedure", "F6002", "폐기능검사 시행 기록", dateBefore(asOf, 88), {
        encounterId: "park-copd-encounter",
        system: "urn:hira:fee-code",
        status: "completed",
        note: "시행 코드는 확인되지만 post-BD 구조화 결과는 없는 예시 기록",
      }),
    ],
  }, timestamp);
  const third = createPatient({
    id: "demo-patient-lee",
    mrn: "PC-1003",
    name: "이준호",
    birthDate: "1959-02-18",
    sex: "male",
    bloodType: "B+",
    insuranceType: "national-health",
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("lee-visit-today", "encounter", "AMB", "순환기내과 외래", asOf, {
        recordStatus: "draft",
        status: "arrived",
        arrivedAt: new Date(new Date(timestamp).valueOf() - 25 * 60_000).toISOString(),
        department: "순환기내과",
        clinician: "이선우",
        room: "2진료실",
        chiefComplaint: "혈압약 복용 후 시작된 야간 기침 상담",
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("lee-cough", "symptom", "SYM-COUGH", "지난 2주 동안 심해진 야간 기침", dateBefore(asOf, 1), {
        note: "밤에 누우면 마른기침이 잦아짐",
      }),
      demoEvent("lee-ace", "medication", "C09AA03", "리시노프릴 예시 처방", dateBefore(asOf, 18), {
        system: "http://www.whocc.no/atc",
        status: "active",
        note: "1일 1회 아침 복용",
      }),
      demoEvent("lee-bp", "observation", "85354-9", "혈압", dateBefore(asOf, 3), {
        system: "http://loinc.org",
        value: "142/88",
        unit: "mmHg",
      }),
      demoEvent("lee-hypertension", "condition", "I10", "고혈압", dateBefore(asOf, 1_825), {
        system: KCD_SYSTEM,
        status: "active",
      }),
      demoEvent("lee-copd-encounter", "encounter", "AMB", "호흡기내과 외래", dateBefore(asOf, 92), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        room: "8진료실",
        chiefComplaint: "만성 운동 시 호흡곤란·기침·객담 추적",
        note: "COPD 예시의 이전 확정 진료",
        soap: {
          subjective: "평지 보행은 무난하나 오르막·계단에서 호흡곤란(mMRC 1-2). 아침 기침·소량 백색 객담 지속. 흡연 30갑년, 현재 금연 6개월째 유지.",
          objective: "SpO₂ 96% (실내공기). 호기 연장, 우측 하부 경도 천명. 6월 1일 기관지확장제 후 폐활량검사 시행 - 판독 대기.",
          assessment: "1. 만성폐쇄성폐질환 의증(J44.9) - 증상·노출력은 부합. post-BD FEV₁/FVC 결과 확인 전으로 확정 진단 보류.\n2. 비소세포폐암(C34.1, stage IIIA) - 절제 불가 국소 진행성. 백금 기반 CCRT(파클리탁셀·카보플라틴) 진행 중, 종양내과 병행 추적.",
          plan: "1. 폐활량검사 결과 확인 후 진단 확정 및 GOLD 단계 평가.\n2. CCRT 종료 후 반응 평가 및 공고요법(durvalumab) 급여기준 검토 예정 - PD-L1 결과 참조.\n3. 금연 유지 지지, 인플루엔자 예방접종 안내.\n4. 증상 악화(객담 화농성 변화·호흡곤란 급증) 시 조기 내원 교육.",
        },
      }),
      demoEvent("lee-copd", "condition", "J44.9", "만성폐쇄성폐질환", dateBefore(asOf, 92), {
        encounterId: "lee-copd-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
      demoEvent("lee-copd-symptom", "symptom", "SYM-COPD-CONTEXT", "만성 운동 시 호흡곤란·기침·객담", dateBefore(asOf, 92), {
        encounterId: "lee-copd-encounter",
        note: "40갑년 흡연력과 함께 기록된 예시 임상 맥락",
      }),
      demoEvent("lee-copd-pft", "procedure", "F6002", "기관지확장제 전후 폐활량검사", dateBefore(asOf, 90), {
        encounterId: "lee-copd-encounter",
        system: "urn:hira:fee-code",
        status: "completed",
        note: "post-BD FEV₁/FVC 0.64 · 구조화 상세는 COPD 평가 상세 참조",
      }),
      demoEvent("lee-copd-lama", "medication", "DEMO-LAMA", "LAMA 흡입제", dateBefore(asOf, 89), {
        encounterId: "lee-copd-encounter",
        system: "urn:policycompass:demo:drug",
        status: "active",
        note: "흡입기 사용법과 증상 변화를 추적한 예시 기록",
      }),
      // Durvalumab 관해공고요법 시연: stage III · PD-L1 ≥1% · CCRT 2주기 후 42일 내.
      demoEvent("lee-nsclc", "condition", "C34.1", "비소세포폐암, 좌상엽 (편평상피세포암)", dateBefore(asOf, 130), {
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
      }),
      demoEvent("lee-petct", "procedure", "DEMO-PETCT", "PET-CT 판독: 절제 불가능한 국소 진행성 stage IIIA, 원격전이 없음", dateBefore(asOf, 120), {
        status: "completed",
        value: "stage IIIA",
      }),
      demoEvent("lee-pdl1", "observation", "PDL1-SP263", "병리조직검사 PD-L1 발현율 (SP263)", dateBefore(asOf, 115), { value: 0, unit: "%" }),
      demoEvent("lee-taxol-1", "medication", "MED-TAXOL", "파클리탁셀(탁솔) 주 — CCRT 1주기", dateBefore(asOf, 95), {
        status: "active",
        prescription: { dose: 50, doseUnit: "mg/m²", route: "정맥주입", frequency: "주 1회", durationDays: 21 },
      }),
      demoEvent("lee-carbo-1", "medication", "MED-CARBO", "카보플라틴(네오플라틴) 주 — CCRT 1주기", dateBefore(asOf, 95), {
        status: "active",
        prescription: { dose: 2, doseUnit: "AUC", route: "정맥주입", frequency: "주 1회", durationDays: 21 },
      }),
      demoEvent("lee-taxol-2", "medication", "MED-TAXOL", "파클리탁셀(탁솔) 주 — CCRT 2주기 (투약 종료)", dateBefore(asOf, 60), {
        status: "active",
        prescription: { dose: 50, doseUnit: "mg/m²", route: "정맥주입", frequency: "주 1회", durationDays: 21 },
      }),
      demoEvent("lee-carbo-2", "medication", "MED-CARBO", "카보플라틴(네오플라틴) 주 — CCRT 2주기 (투약 종료)", dateBefore(asOf, 60), {
        status: "active",
        prescription: { dose: 2, doseUnit: "AUC", route: "정맥주입", frequency: "주 1회", durationDays: 21 },
      }),
      demoEvent("lee-ccrt", "procedure", "DEMO-CCRT", "백금 기반 동시적 항암화학방사선요법(CCRT) 2주기 완료 — 질병진행 없음(안정병변)", dateBefore(asOf, 60), {
        status: "completed",
      }),
    ],
  }, timestamp);
  const fourth = createPatient({
    id: "demo-patient-choi",
    mrn: "PC-1004",
    name: "최민아",
    birthDate: "1985-09-27",
    sex: "female",
    bloodType: "O+",
    insuranceType: "national-health",
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("choi-visit-today", "encounter", "AMB", "소화기내과 외래", asOf, {
        recordStatus: "draft",
        status: "arrived",
        arrivedAt: new Date(new Date(timestamp).valueOf() - 18 * 60_000).toISOString(),
        department: "소화기내과",
        clinician: "정다온",
        room: "6진료실",
        chiefComplaint: "야식 뒤 속쓰림과 식사 조절 상담",
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("choi-reflux-symptom", "symptom", "SYM-HEARTBURN", "늦은 식사 뒤 반복되는 속쓰림", dateBefore(asOf, 2), {
        note: "주 3회 정도, 취침 전 악화",
      }),
      demoEvent("choi-reflux", "condition", "K21", "위식도역류", dateBefore(asOf, 210), {
        system: KCD_SYSTEM,
        status: "active",
      }),
      demoEvent("choi-med", "medication", "MED-PPI", "예시 위산 억제제", dateBefore(asOf, 30), {
        status: "active",
        note: "아침 식전 복용",
      }),
      demoEvent("choi-weight", "observation", "29463-7", "체중", dateBefore(asOf, 7), {
        system: "http://loinc.org",
        value: 62.4,
        unit: "kg",
      }),
      demoEvent("choi-pneumonia-encounter", "encounter", "IMP", "호흡기내과 입원", dateBefore(asOf, 175), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "발열·기침을 동반한 지역사회획득 폐렴 입원",
        note: "혈액배양 채혈 순서를 확인하는 예시 혼합 사례",
        soap: {
          subjective: "\"나흘째 열이 안 떨어지고 누런 가래가 계속 나와요. 밤에 기침 때문에 잠을 못 자요.\" 식욕 저하 동반, 구토·설사는 없음.",
          objective: "BT 38.9 ℃ · RR 22회/분 · SpO₂ 93% (실내공기) · HR 98회/분. 좌하폐야 호흡음 감소 및 수포음. 흉부 X-ray 좌하엽 폐침윤.",
          assessment: "지역사회획득 폐렴(J18.9), 좌하엽. 발열 지속과 저산소혈증으로 입원 항생제 치료 대상으로 판단함.",
          plan: "1. 정맥 항생제 투여 시작.\n2. 객담·혈액 배양 시행하고 채취 시각을 기록에 남김.\n3. 해열 경과와 SpO₂ 일 2회 추적.\n4. 48~72시간 내 반응 없으면 항생제 변경과 추가 영상 검토.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 175)}T12:00:00.000Z` },
      }),
      demoEvent("choi-pneumonia", "condition", "J18.9", "상세불명 병원체의 폐렴", dateBefore(asOf, 175), {
        encounterId: "choi-pneumonia-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
    ],
  }, timestamp);
  const fifth = createPatient({
    id: "demo-patient-jung",
    mrn: "PC-1005",
    name: "정수진",
    birthDate: "1959-06-08",
    sex: "female",
    bloodType: "AB+",
    insuranceType: "national-health",
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("jung-visit-today", "encounter", "AMB", "재활의학과 외래", asOf, {
        recordStatus: "draft",
        status: "arrived",
        arrivedAt: new Date(new Date(timestamp).valueOf() - 4 * 60_000).toISOString(),
        department: "재활의학과",
        clinician: "한가람",
        room: "4진료실",
        chiefComplaint: "무릎 통증에 맞는 운동 종류와 강도 상담",
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("jung-knee-pain", "symptom", "SYM-KNEE-PAIN", "계단에서 심해지는 오른쪽 무릎 통증", dateBefore(asOf, 3), {
        note: "걷기는 가능하나 오래 걸으면 통증 증가",
      }),
      demoEvent("jung-arthritis", "condition", "M17", "무릎 골관절염", dateBefore(asOf, 680), {
        system: KCD_SYSTEM,
        status: "active",
      }),
      demoEvent("jung-therapy", "procedure", "DEMO-PT", "무릎 재활운동 교육", dateBefore(asOf, 45), {
        system: "urn:policycompass:demo:service",
        status: "completed",
      }),
      demoEvent("jung-bmi", "observation", "39156-5", "체질량지수", dateBefore(asOf, 12), {
        system: "http://loinc.org",
        value: 26.1,
        unit: "kg/m2",
      }),
      demoEvent("jung-copd-encounter", "encounter", "AMB", "호흡기내과 외래", dateBefore(asOf, 53), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "타기관 폐기능검사 출처 확인과 흡입제 추적",
        soap: {
          subjective: "\"다른 병원에서 폐 검사받고 흡입기를 받아 쓰고 있어요. 숨찬 건 조금 나아졌는데 아침 가래는 여전해요.\" 흡입기 사용법은 배운 적 있다고 함.",
          objective: "RR 18회/분 · SpO₂ 95% (실내공기). 호기 연장 관찰됨. 흡입기 사용 시연에서 흡입 후 호흡 참기 미흡. 타기관 폐기능검사 결과지는 지참했으나 환자 일치 확인과 판독 시각이 확인되지 않음.",
          assessment: "만성폐쇄성폐질환(J44.9) 치료 중. 증상은 안정적이나 진단 근거가 외부 미검증 자료여서 확정 기록으로 사용하지 못함.",
          plan: "1. 타기관 폐기능검사 원본과 판독지를 발급받아 환자 일치·시행일 확인.\n2. 흡입기 사용법 재교육, 흡입 후 10초 호흡 참기 시연 확인.\n3. LAMA 흡입제 유지.\n4. 3개월 뒤 증상·악화력 추적 외래.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 53)}T12:00:00.000Z` },
      }),
      demoEvent("jung-copd", "condition", "J44.9", "만성폐쇄성폐질환", dateBefore(asOf, 53), {
        encounterId: "jung-copd-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
      demoEvent("jung-copd-lama", "medication", "DEMO-LAMA", "LAMA 흡입제", dateBefore(asOf, 53), {
        encounterId: "jung-copd-encounter",
        system: "urn:policycompass:demo:drug",
        status: "active",
        intent: "order",
        prescription: {
          dose: 1,
          doseUnit: "회",
          route: "흡입",
          frequency: "1일 1회",
          durationDays: 30,
          quantity: 30,
          instructions: "매일 같은 시간에 흡입하고 사용법을 추적 진료에서 확인",
        },
        note: "타기관 PFT는 확인 중이며 흡입제 처방 기록은 확인됨",
      }),
      demoEvent("jung-pneumonia-encounter", "encounter", "IMP", "호흡기내과 입원", dateBefore(asOf, 230), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "지역사회획득 폐렴 입원 치료",
        note: "중증도 판정도구 기록 보완이 필요한 예시 사례",
        soap: {
          subjective: "\"이틀 전부터 열이 나고 기침할 때 가슴이 결려요. 숨쉬기가 답답해요.\" 가래는 누런색, 의식은 또렷함.",
          objective: "BT 38.4 ℃ · RR 20회/분 · SpO₂ 94% (실내공기) · BP 124/78 mmHg. 우중폐야 수포음. 흉부 X-ray 우중엽 폐침윤. 중증도 평가 도구(CURB-65·PSI) 점수는 기록되지 않음.",
          assessment: "지역사회획득 폐렴(J18.9), 우중엽. 입원 치료 중이나 중증도 점수 기록이 없어 입원 판단 근거가 기록으로 남지 않음.",
          plan: "1. 정맥 항생제 투여 유지.\n2. CURB-65 항목을 확인해 점수와 산출 근거를 기록에 남김.\n3. 체온·호흡수·SpO₂ 일 2회 추적.\n4. 해열 후 경구 전환 시점 재평가.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 230)}T12:00:00.000Z` },
      }),
      demoEvent("jung-pneumonia", "condition", "J18.9", "상세불명 병원체의 폐렴", dateBefore(asOf, 230), {
        encounterId: "jung-pneumonia-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
    ],
  }, timestamp);
  return {
    schema: EMR_SCHEMA,
    version: EMR_VERSION,
    revision: 0,
    demo: true,
    selectedPatientId: first.id,
    selectedEncounterId: "kim-visit-today",
    patients: [first, second, third, fourth, fifth],
    rules: DEFAULT_CLAIM_RULES.map((rule) => normalizeClaimRule(rule)),
    claimReviews: [],
    audit: [audit("demo.loaded", timestamp, { detail: "5 patients" })],
    storageError: "",
    recoveryRaw: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
