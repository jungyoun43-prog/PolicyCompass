export function usesInfusionRate(route) {
  return route === "정맥주입";
}

export function prescriptionEntryInstructions(form) {
  const rate = usesInfusionRate(form.route) ? String(form.infusionRate || "").trim() : "";
  return [form.instructions, rate ? `주입속도: ${rate}` : ""].filter(Boolean).join("\n");
}
