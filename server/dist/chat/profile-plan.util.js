"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fatCalorieRatioForWeight = fatCalorieRatioForWeight;
exports.computeBmi = computeBmi;
exports.bmiCategoryLabel = bmiCategoryLabel;
exports.goalCalorieMultiplier = goalCalorieMultiplier;
exports.baseCaloriesFromWeight = baseCaloriesFromWeight;
exports.proteinPerKg = proteinPerKg;
exports.computeDailyPlan = computeDailyPlan;
exports.recomputeWithFatGrams = recomputeWithFatGrams;
function fatCalorieRatioForWeight(weightKg) {
    if (weightKg <= 70)
        return 0.25;
    if (weightKg <= 85)
        return 0.22;
    if (weightKg <= 100)
        return 0.18;
    return 0.15;
}
function computeBmi(heightCm, weightKg) {
    const h = heightCm / 100;
    if (h <= 0)
        return 0;
    return Math.round((weightKg / (h * h)) * 10) / 10;
}
function bmiCategoryLabel(bmi) {
    if (bmi < 18.5)
        return '偏瘦';
    if (bmi < 24)
        return '标准体重';
    if (bmi < 28)
        return '超重';
    return '肥胖';
}
function goalCalorieMultiplier(goal) {
    if (goal === 'maintain')
        return 1.05;
    if (goal === 'muscle')
        return 1.12;
    return 1;
}
function baseCaloriesFromWeight(weightKg, gender) {
    const k = gender === 'male' ? 25 : 22;
    return Math.round(k * weightKg);
}
function proteinPerKg(goal) {
    return goal === 'muscle' ? 2.0 : 1.6;
}
function computeDailyPlan(weightKg, gender, goal, overrideFatRatio) {
    const calories = Math.round(baseCaloriesFromWeight(weightKg, gender) * goalCalorieMultiplier(goal));
    const pPerKg = proteinPerKg(goal);
    const proteinG = Math.round(pPerKg * weightKg * 10) / 10;
    let fatRatio = overrideFatRatio !== undefined && overrideFatRatio > 0
        ? Math.min(0.35, Math.max(0.12, overrideFatRatio))
        : fatCalorieRatioForWeight(weightKg);
    let fatKcal = calories * fatRatio;
    let fatG = Math.round((fatKcal / 9) * 10) / 10;
    let carbKcal = calories - proteinG * 4 - fatG * 9;
    if (carbKcal < 0) {
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
function recomputeWithFatGrams(weightKg, gender, goal, fatGrams) {
    const calories = Math.round(baseCaloriesFromWeight(weightKg, gender) * goalCalorieMultiplier(goal));
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
//# sourceMappingURL=profile-plan.util.js.map