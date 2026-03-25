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
export declare function fatCalorieRatioForWeight(weightKg: number): number;
export declare function computeBmi(heightCm: number, weightKg: number): number;
export declare function bmiCategoryLabel(bmi: number): string;
export declare function goalCalorieMultiplier(goal: FitnessGoal): number;
export declare function baseCaloriesFromWeight(weightKg: number, gender: Gender): number;
export declare function proteinPerKg(goal: FitnessGoal): number;
export declare function computeDailyPlan(weightKg: number, gender: Gender, goal: FitnessGoal, overrideFatRatio?: number): DailyPlanResult;
export declare function recomputeWithFatGrams(weightKg: number, gender: Gender, goal: FitnessGoal, fatGrams: number): DailyPlanResult;
