/**
 * 每日摄入计划计算（减脂/控重默认公式）
 * 男：热量 = 25 × 体重(kg)；女：热量 = 22 × 体重(kg)
 * 蛋白质 = 1.6 × 体重(增肌 2.0)
 * 脂肪热量占比按体重分段 → 脂肪克数 = 热量×占比÷9
 * 碳水 = (热量 - 蛋白质×4 - 脂肪×9) ÷ 4
 */

export type Gender = 'male' | 'female';
export type FitnessGoal = 'fat_loss' | 'maintain' | 'muscle';

export interface DailyPlanResult {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberMinG: number;
  vegetablesMinG: number;
  fruitMinG: number;
  fruitMaxG: number;
  fatCalorieRatio: number;
}

/** 按体重取脂肪占「总热量」的比例 */
export function fatCalorieRatioForWeight(weightKg: number): number {
  if (weightKg <= 70) return 0.25;
  if (weightKg <= 85) return 0.22;
  if (weightKg <= 100) return 0.18;
  return 0.15;
}

export function computeBmi(heightCm: number, weightKg: number): number {
  const h = heightCm / 100;
  if (h <= 0) return 0;
  return Math.round((weightKg / (h * h)) * 10) / 10;
}

/** BMI 评价文案 */
export function bmiCategoryLabel(bmi: number): string {
  if (bmi < 18.5) return '偏瘦';
  if (bmi < 24) return '标准体重';
  if (bmi < 28) return '超重';
  return '肥胖';
}

/** 目标对热量的系数 */
export function goalCalorieMultiplier(goal: FitnessGoal): number {
  if (goal === 'maintain') return 1.05;
  if (goal === 'muscle') return 1.12;
  return 1;
}

export function baseCaloriesFromWeight(
  weightKg: number,
  gender: Gender,
): number {
  const k = gender === 'male' ? 25 : 22;
  return Math.round(k * weightKg);
}

export function proteinPerKg(goal: FitnessGoal): number {
  return goal === 'muscle' ? 2.0 : 1.6;
}

/**
 * 计算每日宏量计划
 * @param overrideFatRatio 可选：用户微调脂肪热量占比（0.15~0.30）
 */
export function computeDailyPlan(
  weightKg: number,
  gender: Gender,
  goal: FitnessGoal,
  overrideFatRatio?: number,
): DailyPlanResult {
  const calories = Math.round(
    baseCaloriesFromWeight(weightKg, gender) * goalCalorieMultiplier(goal),
  );
  const pPerKg = proteinPerKg(goal);
  const proteinG = Math.round(pPerKg * weightKg * 10) / 10;

  let fatRatio =
    overrideFatRatio !== undefined && overrideFatRatio > 0
      ? Math.min(0.35, Math.max(0.12, overrideFatRatio))
      : fatCalorieRatioForWeight(weightKg);

  let fatKcal = calories * fatRatio;
  let fatG = Math.round((fatKcal / 9) * 10) / 10;

  let carbKcal = calories - proteinG * 4 - fatG * 9;
  if (carbKcal < 0) {
    // 兜底：略降脂肪占比
    fatRatio = Math.max(0.12, fatRatio - 0.02);
    fatKcal = calories * fatRatio;
    fatG = Math.round((fatKcal / 9) * 10) / 10;
    carbKcal = calories - proteinG * 4 - fatG * 9;
  }
  const carbsG = Math.max(0, Math.round((carbKcal / 4) * 10) / 10);

  return {
    calories,
    proteinG,
    fatG,
    carbsG,
    fiberMinG: 25,
    vegetablesMinG: 500,
    fruitMinG: 200,
    fruitMaxG: 350,
    fatCalorieRatio: fatRatio,
  };
}

/** 用户指定脂肪克数，反推占比并重新分配碳水 */
export function recomputeWithFatGrams(
  weightKg: number,
  gender: Gender,
  goal: FitnessGoal,
  fatGrams: number,
): DailyPlanResult {
  const calories = Math.round(
    baseCaloriesFromWeight(weightKg, gender) * goalCalorieMultiplier(goal),
  );
  const pPerKg = proteinPerKg(goal);
  const proteinG = Math.round(pPerKg * weightKg * 10) / 10;
  const fatG = Math.round(fatGrams * 10) / 10;
  const fatKcal = fatG * 9;
  const fatRatio = calories > 0 ? fatKcal / calories : 0.22;
  const carbKcal = calories - proteinG * 4 - fatKcal;
  const carbsG = Math.max(0, Math.round((carbKcal / 4) * 10) / 10);

  return {
    calories,
    proteinG,
    fatG,
    carbsG,
    fiberMinG: 25,
    vegetablesMinG: 500,
    fruitMinG: 200,
    fruitMaxG: 350,
    fatCalorieRatio: Math.round(fatRatio * 1000) / 1000,
  };
}
