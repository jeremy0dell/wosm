import type { SetupPlan } from "./model.js";
import { SetupPlanSchema } from "./model.js";

export function setupPlanJson(plan: SetupPlan): string {
  return `${JSON.stringify(SetupPlanSchema.parse(plan), null, 2)}\n`;
}
