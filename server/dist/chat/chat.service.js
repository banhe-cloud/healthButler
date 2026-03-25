"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const openai_1 = require("@langchain/openai");
const messages_1 = require("@langchain/core/messages");
const axios_1 = __importDefault(require("axios"));
const database_service_1 = require("../database/database.service");
const system_prompt_1 = require("./system-prompt");
const profile_plan_util_1 = require("./profile-plan.util");
let ChatService = class ChatService {
    db;
    llm;
    baiduAccessToken = null;
    tokenExpiry = 0;
    constructor(db) {
        this.db = db;
        this.llm = new openai_1.ChatOpenAI({
            apiKey: process.env.MINIMAX_API_KEY || '',
            model: process.env.MINIMAX_MODEL || 'abab6.5-chat',
            configuration: {
                baseURL: 'https://api.minimaxi.com/v1',
            },
            timeout: 30000,
        });
    }
    get baiduAk() {
        return process.env.BAIDU_AK || '';
    }
    get baiduSk() {
        return process.env.BAIDU_SK || '';
    }
    async callAI(systemPrompt, userMessage) {
        try {
            const response = await this.llm.invoke([
                new messages_1.SystemMessage(systemPrompt),
                new messages_1.HumanMessage(userMessage),
            ]);
            const content = response.content;
            return typeof content === 'string' ? content : JSON.stringify(content);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new common_1.InternalServerErrorException(`AI调用失败: ${msg}`);
        }
    }
    parseJSON(text) {
        const cleaned = text
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();
        try {
            return JSON.parse(cleaned);
        }
        catch {
            let depth = 0;
            let start = -1;
            for (let i = 0; i < cleaned.length; i++) {
                if (cleaned[i] === '{') {
                    if (depth === 0)
                        start = i;
                    depth++;
                }
                else if (cleaned[i] === '}') {
                    depth--;
                    if (depth === 0 && start !== -1) {
                        try {
                            return JSON.parse(cleaned.slice(start, i + 1));
                        }
                        catch {
                            break;
                        }
                    }
                }
            }
            return null;
        }
    }
    getMealType() {
        const hour = new Date().getHours();
        if (hour >= 5 && hour < 10)
            return '早饭';
        if (hour >= 10 && hour < 14)
            return '午饭';
        if (hour >= 14 && hour < 17)
            return '下午茶';
        if (hour >= 17 && hour < 21)
            return '晚饭';
        return '夜宵';
    }
    async extractIntent(message, currentState) {
        const stateHint = currentState === 'waiting_for_portions'
            ? '\n（注意：系统刚刚询问了用户食物的具体分量，用户现在的回复很可能是在回答分量问题）'
            : '';
        const raw = await this.callAI(system_prompt_1.INTENT_EXTRACTION_SYSTEM, `用户消息：${message}${stateHint}`);
        const result = this.parseJSON(raw);
        if (!result || !result.intent) {
            console.warn('[ChatService] extractIntent parse failed, raw=', raw);
            return { intent: 'general' };
        }
        return result;
    }
    async calculateNutrition(food, portions) {
        const raw = await this.callAI(system_prompt_1.NUTRITION_CALC_SYSTEM, `食物：${food}\n分量：${portions}`);
        const result = this.parseJSON(raw);
        if (!result) {
            console.warn('[ChatService] calculateNutrition parse failed, raw=', raw);
        }
        return result;
    }
    async generateMealFeedback(food, mealType, userProfile) {
        const profileStr = userProfile
            ? `用户信息：身高${userProfile.height || '未知'}，体重${userProfile.weight || '未知'}${userProfile.medicalHistory ? '，病史：' + userProfile.medicalHistory : ''}${userProfile.allergies ? '，过敏：' + userProfile.allergies : ''}`
            : '';
        return this.callAI(system_prompt_1.MEAL_FEEDBACK_SYSTEM, `${mealType}：${food}。${profileStr}`);
    }
    async askForPortions(food) {
        return this.callAI(system_prompt_1.ASK_PORTIONS_SYSTEM, `食物：${food}`);
    }
    async generateDailyAdvice(meals, targetCalories, userProfile) {
        const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
        const mealSummary = meals.length > 0
            ? meals
                .map((m) => `${m.mealType}-${m.foodName}(${m.calories}kcal)`)
                .join('，')
            : '暂无记录';
        const profileStr = userProfile
            ? `用户：身高${userProfile.height || '未知'}，体重${userProfile.weight || '未知'}`
            : '';
        return this.callAI(system_prompt_1.DAILY_ADVICE_SYSTEM, `今天饮食记录：${mealSummary}。总热量${totalCalories}kcal，目标${targetCalories}kcal。${profileStr}`);
    }
    async generateGeneralReply(message, userProfile) {
        const profileStr = userProfile?.weight
            ? `（用户体重${userProfile.weight}，身高${userProfile.height}）`
            : '';
        return this.callAI(system_prompt_1.GENERAL_CHAT_SYSTEM, `${message}${profileStr}`);
    }
    async generateWeeklyReport(meals, targetCalories, userProfile) {
        const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
        const days = Math.max(1, new Set(meals.map((m) => new Date(m.confirmedAt).toDateString())).size);
        const avgCalories = Math.round(totalCalories / days);
        const mealSummary = meals
            .map((m) => `${m.mealType}-${m.foodName}(${m.calories}kcal)`)
            .join('，');
        const profileStr = userProfile
            ? `用户：身高${userProfile.height || '未知'}，体重${userProfile.weight || '未知'}`
            : '';
        return this.callAI(system_prompt_1.WEEKLY_REPORT_SYSTEM, `本周${days}天饮食记录：${mealSummary || '暂无'}。总热量${totalCalories}kcal，日均${avgCalories}kcal，目标${targetCalories}kcal/天。${profileStr}`);
    }
    barPercent(current, target) {
        if (target <= 0)
            return 0;
        return Math.min(100, Math.round((current / target) * 100));
    }
    macroTargets(hp, fallbackCal) {
        if (hp) {
            return {
                cal: hp.dailyCalories,
                protein: hp.proteinG,
                carbs: hp.carbsG,
                fat: hp.fatG,
                fiber: hp.fiberMinG || 25,
            };
        }
        return {
            cal: fallbackCal,
            protein: 60,
            carbs: 200,
            fat: 60,
            fiber: 25,
        };
    }
    aggregateMeals(meals) {
        return meals.reduce((a, m) => ({
            cal: a.cal + m.calories,
            p: a.p + m.protein,
            c: a.c + m.carbs,
            f: a.f + m.fat,
            fi: a.fi + m.fiber,
        }), { cal: 0, p: 0, c: 0, f: 0, fi: 0 });
    }
    summaryProfileContext(hp) {
        if (!hp) {
            return '【档案】用户尚未在应用内完善健康档案，当前营养目标为默认估算。请提醒尽快完善档案，并在建议中避免假设具体疾病或过敏。';
        }
        const gender = hp.gender === 'male' ? '男' : '女';
        const goalLabel = {
            fat_loss: '减脂',
            maintain: '维持体重',
            muscle: '增肌',
        };
        const goal = goalLabel[hp.goal] || hp.goal;
        const bmiStr = hp.bmi != null && Number.isFinite(Number(hp.bmi))
            ? `BMI约${Number(hp.bmi).toFixed(1)}${hp.bmiCategory ? `（${hp.bmiCategory}）` : ''}`
            : '';
        const parts = [
            `【档案】${gender}`,
            hp.age != null && hp.age > 0 ? `${hp.age}岁` : '',
            `身高${hp.heightCm}cm`,
            `体重${hp.weightKg}kg`,
            bmiStr,
            `健康目标：${goal}`,
        ].filter(Boolean);
        if (hp.diseases?.trim()) {
            parts.push(`病史/慢病关注：${hp.diseases.trim()}`);
        }
        if (hp.allergies?.trim()) {
            parts.push(`过敏或需规避：${hp.allergies.trim()}`);
        }
        return parts.join('，');
    }
    summaryBehaviorToday(meals) {
        if (meals.length === 0) {
            return '【行为】今日暂无已确认的饮食记录，可肯定用户若在其他渠道进食可继续记录。';
        }
        const calByType = {};
        const countByType = {};
        for (const m of meals) {
            const t = m.mealType || '其他';
            countByType[t] = (countByType[t] || 0) + 1;
            calByType[t] = (calByType[t] || 0) + m.calories;
        }
        const totalCal = meals.reduce((s, m) => s + m.calories, 0);
        const dist = Object.entries(countByType)
            .map(([k, v]) => `${k}${v}次`)
            .join('、');
        const lines = [
            `【行为】今日已确认 ${meals.length} 餐，总热量约 ${Math.round(totalCal)} kcal。餐次分布：${dist}。`,
        ];
        const sorted = Object.entries(calByType).sort((a, b) => b[1] - a[1]);
        const top = sorted[0];
        if (top && totalCal > 0 && top[1] / totalCal >= 0.48) {
            lines.push(`热量相对集中在「${top[0]}」（约${Math.round((top[1] / totalCal) * 100)}%），可结合目标点评是否需调整分配。`);
        }
        return lines.join('');
    }
    summaryBehaviorWeek(meals, uniqueDays) {
        if (meals.length === 0) {
            return '【行为】近7天暂无已确认的饮食记录。';
        }
        const days = Math.max(1, uniqueDays);
        const avgMeals = meals.length / days;
        return `【行为】近7天有记录 ${uniqueDays} 天，共 ${meals.length} 餐，平均每天约 ${avgMeals.toFixed(1)} 餐；坚持记录值得肯定。`;
    }
    async handleDailySummary(openid, hp, fallbackCal) {
        const meals = await this.db.getTodaysMeals(openid);
        const t = this.macroTargets(hp, fallbackCal);
        const agg = this.aggregateMeals(meals);
        const metrics = [
            {
                key: 'cal',
                label: '热量',
                current: Math.round(agg.cal),
                target: Math.round(t.cal),
                unit: 'kcal',
                barPercent: this.barPercent(agg.cal, t.cal),
            },
            {
                key: 'protein',
                label: '蛋白质',
                current: Math.round(agg.p * 10) / 10,
                target: Math.round(t.protein * 10) / 10,
                unit: 'g',
                barPercent: this.barPercent(agg.p, t.protein),
            },
            {
                key: 'carbs',
                label: '碳水',
                current: Math.round(agg.c * 10) / 10,
                target: Math.round(t.carbs * 10) / 10,
                unit: 'g',
                barPercent: this.barPercent(agg.c, t.carbs),
            },
            {
                key: 'fat',
                label: '脂肪',
                current: Math.round(agg.f * 10) / 10,
                target: Math.round(t.fat * 10) / 10,
                unit: 'g',
                barPercent: this.barPercent(agg.f, t.fat),
            },
            {
                key: 'fiber',
                label: '膳食纤维',
                current: Math.round(agg.fi * 10) / 10,
                target: Math.round(t.fiber * 10) / 10,
                unit: 'g',
                barPercent: this.barPercent(agg.fi, t.fiber),
            },
        ];
        const mealLines = meals.map((m) => `${m.mealType} · ${m.foodName} · ${m.calories}kcal`);
        const subtitle = meals.length
            ? `已记录 ${meals.length} 餐`
            : '今日暂无已确认的饮食记录';
        const advicePayload = [
            this.summaryProfileContext(hp),
            this.summaryBehaviorToday(meals),
            `【数据】今日汇总（对比每日目标）。热量 ${Math.round(agg.cal)}/${Math.round(t.cal)} kcal，蛋白质 ${Math.round(agg.p * 10) / 10}/${t.protein}g，碳水 ${Math.round(agg.c * 10) / 10}/${t.carbs}g，脂肪 ${Math.round(agg.f * 10) / 10}/${t.fat}g，膳食纤维 ${Math.round(agg.fi * 10) / 10}/${t.fiber}g。餐次明细：${mealLines.join('；') || '无'}`,
        ].join('\n');
        const advice = await this.callAI(system_prompt_1.SUMMARY_ADVICE_SYSTEM, advicePayload);
        const summaryCard = {
            period: 'today',
            title: '今日汇总',
            subtitle,
            metrics,
            mealLines,
            advice,
        };
        return {
            type: 'summary',
            text: hp
                ? '结合你的健康档案与今日记录，下面是摄入与目标对比～'
                : '这是今日的摄入与目标对比，下面是各营养素进度～',
            summaryCard,
        };
    }
    async handleWeeklySummary(openid, hp, fallbackCal) {
        const meals = await this.db.getWeeklyMeals(openid);
        const t = this.macroTargets(hp, fallbackCal);
        const agg = this.aggregateMeals(meals);
        const uniqueDays = new Set(meals.map((m) => new Date(m.confirmedAt).toDateString())).size;
        const days = Math.max(1, uniqueDays);
        const avg = {
            cal: agg.cal / days,
            p: agg.p / days,
            c: agg.c / days,
            f: agg.f / days,
            fi: agg.fi / days,
        };
        const metrics = [
            {
                key: 'cal',
                label: '热量（日均）',
                current: Math.round(avg.cal),
                target: Math.round(t.cal),
                unit: 'kcal',
                barPercent: this.barPercent(avg.cal, t.cal),
            },
            {
                key: 'protein',
                label: '蛋白质（日均）',
                current: Math.round(avg.p * 10) / 10,
                target: Math.round(t.protein * 10) / 10,
                unit: 'g',
                barPercent: this.barPercent(avg.p, t.protein),
            },
            {
                key: 'carbs',
                label: '碳水（日均）',
                current: Math.round(avg.c * 10) / 10,
                target: Math.round(t.carbs * 10) / 10,
                unit: 'g',
                barPercent: this.barPercent(avg.c, t.carbs),
            },
            {
                key: 'fat',
                label: '脂肪（日均）',
                current: Math.round(avg.f * 10) / 10,
                target: Math.round(t.fat * 10) / 10,
                unit: 'g',
                barPercent: this.barPercent(avg.f, t.fat),
            },
            {
                key: 'fiber',
                label: '膳食纤维（日均）',
                current: Math.round(avg.fi * 10) / 10,
                target: Math.round(t.fiber * 10) / 10,
                unit: 'g',
                barPercent: this.barPercent(avg.fi, t.fiber),
            },
        ];
        const mealLines = meals.length <= 15
            ? meals.map((m) => `${new Date(m.confirmedAt).getMonth() + 1}/${new Date(m.confirmedAt).getDate()} ${m.mealType} · ${m.foodName} · ${m.calories}kcal`)
            : [
                ...meals.slice(0, 12).map((m) => `${new Date(m.confirmedAt).getMonth() + 1}/${new Date(m.confirmedAt).getDate()} ${m.mealType} · ${m.foodName} · ${m.calories}kcal`),
                `…共 ${meals.length} 餐`,
            ];
        const subtitle = `近7天 ${uniqueDays} 天有记录 · 共 ${meals.length} 餐`;
        const advicePayload = [
            this.summaryProfileContext(hp),
            this.summaryBehaviorWeek(meals, uniqueDays),
            `【数据】本周汇总（各指标为日均值，对比每日目标）。日均热量 ${Math.round(avg.cal)}/${Math.round(t.cal)} kcal，日均蛋白质 ${Math.round(avg.p * 10) / 10}/${t.protein}g，日均碳水 ${Math.round(avg.c * 10) / 10}/${t.carbs}g，日均脂肪 ${Math.round(avg.f * 10) / 10}/${t.fat}g，日均膳食纤维 ${Math.round(avg.fi * 10) / 10}/${t.fiber}g。本周总热量 ${Math.round(agg.cal)} kcal。餐次抽样：${mealLines.slice(0, 5).join('；')}`,
        ].join('\n');
        const advice = await this.callAI(system_prompt_1.SUMMARY_ADVICE_SYSTEM, advicePayload);
        const summaryCard = {
            period: 'week',
            title: '本周汇总',
            subtitle,
            metrics,
            mealLines,
            advice,
        };
        return {
            type: 'summary',
            text: hp
                ? '结合你的健康档案与近7天记录，下面是日均营养与目标对比～'
                : '这是近7天与每日目标的对比（日均），方便你看整体趋势～',
            summaryCard,
        };
    }
    mergeDraft(prev, patch) {
        const g = patch.gender ?? prev?.gender;
        return {
            heightCm: patch.heightCm ?? prev?.heightCm,
            weightKg: patch.weightKg ?? prev?.weightKg,
            gender: g === 'male' || g === 'female' ? g : prev?.gender,
            age: patch.age ?? prev?.age,
            diseases: patch.diseases ?? prev?.diseases,
            allergies: patch.allergies ?? prev?.allergies,
            goal: patch.goal ?? prev?.goal ?? 'fat_loss',
        };
    }
    profileMissingList(d) {
        const miss = [];
        if (!d.heightCm || d.heightCm <= 0)
            miss.push('身高(cm)');
        if (!d.weightKg || d.weightKg <= 0)
            miss.push('体重(kg)');
        if (!d.gender)
            miss.push('性别(男/女)');
        return miss;
    }
    profileDraftFromHp(hp) {
        return {
            heightCm: hp.heightCm,
            weightKg: hp.weightKg,
            gender: hp.gender,
            age: hp.age,
            diseases: hp.diseases,
            allergies: hp.allergies,
            goal: hp.goal,
        };
    }
    profilePatchHasValues(patch) {
        return (patch.heightCm != null ||
            patch.weightKg != null ||
            patch.gender != null ||
            patch.age != null ||
            patch.diseases != null ||
            patch.allergies != null ||
            patch.goal != null);
    }
    profileHpEqualsDraft(hp, d) {
        return (hp.heightCm === d.heightCm &&
            hp.weightKg === d.weightKg &&
            hp.gender === d.gender &&
            (hp.age ?? null) === (d.age ?? null) &&
            (hp.diseases || '') === (d.diseases || '') &&
            (hp.allergies || '') === (d.allergies || '') &&
            hp.goal === (d.goal || hp.goal));
    }
    async composeProfilePlanCardFromDraft(draft, mode) {
        const height = draft.heightCm;
        const weight = draft.weightKg;
        const gender = draft.gender;
        const goal = draft.goal || 'fat_loss';
        const bmi = (0, profile_plan_util_1.computeBmi)(height, weight);
        const bmiCat = (0, profile_plan_util_1.bmiCategoryLabel)(bmi);
        const plan = (0, profile_plan_util_1.computeDailyPlan)(weight, gender, goal);
        const evalPrompt = `用户：${gender === 'male' ? '男' : '女'}，${height}cm，${weight}kg，BMI约${bmi}（${bmiCat}）。请用2-3句中文给出体态评价（亲切）+ 一句饮食方向建议（不提具体数字）。`;
        const evaluationText = await this.callAI(system_prompt_1.MEAL_FEEDBACK_SYSTEM.replace('根据用户的餐食情况', '根据用户身体数据'), evalPrompt);
        const advicePrompt = mode === 'update'
            ? `目标：${goal}。BMI类别：${bmiCat}。用户正在更新健康档案，请给一条简短说明：确认后将按新数据重新计算每日营养计划（55字内）。`
            : `目标：${goal}。BMI类别：${bmiCat}。请给一条开启饮食管理前的鼓励与提醒（60字内）。`;
        const adviceText = await this.callAI(system_prompt_1.DAILY_ADVICE_SYSTEM.replace('根据今天已记录的饮食数据', '根据该用户的档案与目标'), advicePrompt);
        const planLines = [
            `每日热量约 ${plan.calories} kcal`,
            `蛋白质 ${plan.proteinG}g · 脂肪 ${plan.fatG}g · 碳水 ${plan.carbsG}g`,
            `膳食纤维 ≥ ${plan.fiberMinG}g/天；蔬菜 ≥ ${plan.vegetablesMinG}g/天；水果 ${plan.fruitMinG}～${plan.fruitMaxG}g/天`,
        ];
        return {
            cardKind: 'profile_plan',
            profilePlanMode: mode,
            heightCm: height,
            weightKg: weight,
            gender,
            age: draft.age,
            diseases: draft.diseases,
            allergies: draft.allergies,
            goal,
            bmi,
            bmiCategory: bmiCat,
            evaluationText,
            adviceText,
            dailyCalories: plan.calories,
            proteinG: plan.proteinG,
            fatG: plan.fatG,
            carbsG: plan.carbsG,
            fiberMinG: plan.fiberMinG,
            vegetablesMinG: plan.vegetablesMinG,
            fruitMinG: plan.fruitMinG,
            fruitMaxG: plan.fruitMaxG,
            planLines,
        };
    }
    buildProfileViewCard(hp) {
        const bmi = hp.bmi ?? (0, profile_plan_util_1.computeBmi)(hp.heightCm, hp.weightKg);
        const bmiCat = hp.bmiCategory ?? (0, profile_plan_util_1.bmiCategoryLabel)(bmi);
        const goalLabel = hp.goal === 'muscle' ? '增肌' : hp.goal === 'maintain' ? '维持' : '减脂';
        const planLines = [
            `每日热量约 ${hp.dailyCalories} kcal`,
            `蛋白质 ${hp.proteinG}g · 脂肪 ${hp.fatG}g · 碳水 ${hp.carbsG}g`,
            `膳食纤维 ≥ ${hp.fiberMinG}g/天；蔬菜 ≥ ${hp.vegetablesMinG}g/天；水果 ${hp.fruitMinG}～${hp.fruitMaxG}g/天`,
        ];
        const evaluationText = `当前档案：${hp.gender === 'male' ? '男' : '女'}，${hp.heightCm}cm，${hp.weightKg}kg；健康目标：${goalLabel}；BMI 约 ${bmi}（${bmiCat}）。`;
        const adviceText = '需要修改时直接说，例如「体重改成70」「过敏改成无」「目标改成增肌」，我会先让你确认再保存～';
        return {
            cardKind: 'profile_plan',
            profilePlanMode: 'view',
            heightCm: hp.heightCm,
            weightKg: hp.weightKg,
            gender: hp.gender,
            age: hp.age,
            diseases: hp.diseases,
            allergies: hp.allergies,
            goal: hp.goal,
            bmi,
            bmiCategory: bmiCat,
            evaluationText,
            adviceText,
            dailyCalories: hp.dailyCalories,
            proteinG: hp.proteinG,
            fatG: hp.fatG,
            carbsG: hp.carbsG,
            fiberMinG: hp.fiberMinG,
            vegetablesMinG: hp.vegetablesMinG,
            fruitMinG: hp.fruitMinG,
            fruitMaxG: hp.fruitMaxG,
            planLines,
        };
    }
    async handleProfileEditForUser(openid, hp, message) {
        const patch = await this.extractProfilePatch(message);
        if (!this.profilePatchHasValues(patch)) {
            return {
                type: 'chat',
                text: '请说明要修改的内容，例如：体重改成72kg、年龄30、性别女、目标改成增肌、疾病史填高血压、过敏改成无…',
            };
        }
        const draft = this.mergeDraft(this.profileDraftFromHp(hp), patch);
        const missing = this.profileMissingList(draft);
        if (missing.length > 0) {
            return {
                type: 'chat',
                text: `修改后仍缺少必填项，请补充：${missing.join('、')}`,
            };
        }
        if (this.profileHpEqualsDraft(hp, draft)) {
            return {
                type: 'chat',
                text: '这和当前档案一致，没有需要更新的内容。如需改其它项请直接说明～',
            };
        }
        const profilePlanCard = await this.composeProfilePlanCardFromDraft(draft, 'update');
        await this.db.setUserState(openid, {
            conversationState: 'pending_profile_edit_confirm',
            profileDraft: draft,
            pendingCard: profilePlanCard,
        });
        return {
            type: 'profile_plan',
            text: '请确认下方更新后的档案与每日营养计划；点「确认修改」后才会保存到云端。',
            followUp: '若有误可点取消，再重新说明要改的内容。',
            profilePlanCard,
        };
    }
    async extractProfilePatch(message) {
        const raw = await this.callAI(system_prompt_1.PROFILE_EXTRACTION_SYSTEM, `用户说：${message}`);
        return this.parseJSON(raw) || {};
    }
    async extractPlanAdjustment(message) {
        const raw = await this.callAI(system_prompt_1.PLAN_ADJUSTMENT_SYSTEM, message);
        const r = this.parseJSON(raw);
        return r?.intent ? r : { intent: 'none' };
    }
    healthToUserProfile(h) {
        return {
            height: String(h.heightCm),
            weight: String(h.weightKg),
            medicalHistory: h.diseases,
            allergies: h.allergies,
            gender: h.gender === 'male' ? '男' : '女',
            age: h.age != null ? String(h.age) : undefined,
            goal: h.goal,
        };
    }
    profileGuideResponse(guide) {
        return {
            type: 'profile_guide',
            text: '',
            profileGuide: guide,
            profileRequired: true,
        };
    }
    async handlePlanAdjustment(message, openid, hp) {
        const adj = await this.extractPlanAdjustment(message);
        if (adj.intent === 'none')
            return null;
        if (adj.intent === 'set_fat_grams' &&
            adj.fatGrams != null &&
            adj.fatGrams > 0) {
            const plan = (0, profile_plan_util_1.recomputeWithFatGrams)(hp.weightKg, hp.gender, hp.goal, adj.fatGrams);
            await this.db.patchUserHealthProfile(openid, {
                fatG: plan.fatG,
                carbsG: plan.carbsG,
                fatCalorieRatio: plan.fatCalorieRatio,
                dailyCalories: plan.calories,
            });
            const text = `已把每日脂肪目标调整为 ${plan.fatG}g，碳水已重新计算为 ${plan.carbsG}g（总热量 ${plan.calories} kcal）。`;
            return { type: 'chat', text, targetCalories: plan.calories };
        }
        if (adj.intent === 'set_calories' &&
            adj.calories != null &&
            adj.calories > 0) {
            const base = (0, profile_plan_util_1.computeDailyPlan)(hp.weightKg, hp.gender, hp.goal);
            const ratio = adj.calories / base.calories;
            const plan = {
                ...base,
                calories: adj.calories,
                proteinG: Math.round(base.proteinG * ratio * 10) / 10,
                fatG: Math.round(base.fatG * ratio * 10) / 10,
                carbsG: Math.max(0, Math.round(base.carbsG * ratio * 10) / 10),
            };
            await this.db.patchUserHealthProfile(openid, {
                dailyCalories: plan.calories,
                proteinG: plan.proteinG,
                fatG: plan.fatG,
                carbsG: plan.carbsG,
                fatCalorieRatio: plan.fatCalorieRatio,
            });
            const text = `已按你的要求把每日热量调整为 ${plan.calories} kcal，蛋白质 ${plan.proteinG}g，脂肪 ${plan.fatG}g，碳水 ${plan.carbsG}g。`;
            return { type: 'chat', text, targetCalories: plan.calories };
        }
        return null;
    }
    async handleProfileConversation(message, openid, userState) {
        const hp = await this.db.getUserHealthProfile(openid);
        if (hp)
            return null;
        const st = userState?.conversationState || 'idle';
        if (st === 'pending_profile_plan_confirm') {
            return this.profileGuideResponse({ variant: 'pending_card' });
        }
        const draft = this.mergeDraft(userState?.profileDraft, await this.extractProfilePatch(message));
        const missing = this.profileMissingList(draft);
        await this.db.setUserState(openid, {
            conversationState: 'collecting_profile',
            profileDraft: draft,
        });
        if (missing.length > 0) {
            return this.profileGuideResponse({
                variant: 'missing',
                missingFields: missing,
            });
        }
        const profilePlanCard = await this.composeProfilePlanCardFromDraft(draft, 'create');
        await this.db.setUserState(openid, {
            conversationState: 'pending_profile_plan_confirm',
            profileDraft: draft,
            pendingCard: profilePlanCard,
        });
        const bmi = profilePlanCard.bmi;
        const bmiCat = profilePlanCard.bmiCategory;
        const intro = `根据你的信息，BMI 约为 ${bmi}（${bmiCat}）。请确认下方每日营养计划；确认后才会开始记录饮食。`;
        return {
            type: 'profile_plan',
            text: intro,
            followUp: profilePlanCard.evaluationText,
            profilePlanCard,
            profileRequired: true,
        };
    }
    async processMessage(message, openid, targetCalories = 1800, userProfile) {
        const savedProfile = openid
            ? await this.db.getUserHealthProfile(openid)
            : null;
        const mergedProfile = savedProfile
            ? this.healthToUserProfile(savedProfile)
            : userProfile;
        const userState = openid ? await this.db.getUserState(openid) : null;
        const currentState = userState?.conversationState || 'idle';
        const pendingFood = userState?.pendingFoodName || '';
        console.log('[ChatService] processMessage state=', currentState, 'openid=', openid || '(none)');
        if (openid && savedProfile && currentState === 'pending_profile_edit_confirm') {
            await this.db.saveChatRecord({ openid, role: 'user', content: message });
            const guide = this.profileGuideResponse({ variant: 'pending_edit_card' });
            await this.db.saveChatRecord({
                openid,
                role: 'assistant',
                content: '【请先确认档案修改】',
                type: 'profile_guide',
                profileGuide: guide.profileGuide,
            });
            return guide;
        }
        if (openid && savedProfile) {
            const adj = await this.handlePlanAdjustment(message, openid, savedProfile);
            if (adj) {
                if (openid) {
                    await this.db.saveChatRecord({
                        openid,
                        role: 'user',
                        content: message,
                    });
                    await this.db.saveChatRecord({
                        openid,
                        role: 'assistant',
                        content: adj.text,
                        type: 'chat',
                    });
                }
                return adj;
            }
        }
        if (openid && !savedProfile) {
            const intentPre = await this.extractIntent(message, currentState);
            if (intentPre.intent === 'daily_summary' ||
                intentPre.intent === 'weekly_summary') {
                await this.db.saveChatRecord({ openid, role: 'user', content: message });
                const sumResp = intentPre.intent === 'daily_summary'
                    ? await this.handleDailySummary(openid, null, targetCalories)
                    : await this.handleWeeklySummary(openid, null, targetCalories);
                await this.db.saveChatRecord({
                    openid,
                    role: 'assistant',
                    content: sumResp.text,
                    type: 'summary',
                    card: sumResp.summaryCard,
                });
                return sumResp;
            }
            if (intentPre.intent === 'food_log' ||
                (intentPre.intent === 'portion_detail' &&
                    currentState === 'waiting_for_portions')) {
                await this.db.saveChatRecord({
                    openid,
                    role: 'user',
                    content: message,
                });
                const guide = this.profileGuideResponse({ variant: 'blocked_food' });
                await this.db.saveChatRecord({
                    openid,
                    role: 'assistant',
                    content: '【需先完善档案】',
                    type: 'profile_guide',
                    profileGuide: guide.profileGuide,
                });
                return guide;
            }
            await this.db.saveChatRecord({ openid, role: 'user', content: message });
            const profResp = await this.handleProfileConversation(message, openid, userState);
            if (profResp) {
                const assistantContent = [profResp.text, profResp.followUp]
                    .filter(Boolean)
                    .join('\n\n');
                await this.db.saveChatRecord({
                    openid,
                    role: 'assistant',
                    content: profResp.type === 'profile_guide'
                        ? '【完善档案】'
                        : assistantContent || '【档案】',
                    type: profResp.type,
                    card: profResp.profilePlanCard,
                    profileGuide: profResp.profileGuide,
                });
                return profResp;
            }
        }
        if (openid && savedProfile) {
            await this.db.saveChatRecord({ openid, role: 'user', content: message });
        }
        let intent = await this.extractIntent(message, currentState);
        if (savedProfile && openid && intent.intent === 'general') {
            const compact = message.replace(/\s/g, '');
            const looksView = /(我的|个人)(档案|信息|资料)|查看.*档案|^档案$|健康档案/.test(compact);
            const looksEdit = /(修改|改|更新|换成|改成|设为|设置)/.test(message) &&
                /(身高|体重|年龄|性别|疾病|过敏|目标|减脂|增肌|维持)/.test(message);
            if (looksView) {
                intent = { intent: 'profile_view' };
            }
            else if (looksEdit) {
                intent = { intent: 'profile_edit' };
            }
        }
        console.log('[ChatService] intent=', JSON.stringify(intent));
        let response;
        const effectiveTarget = savedProfile?.dailyCalories ?? targetCalories;
        if (intent.intent === 'profile_view') {
            if (!openid || !savedProfile) {
                response = {
                    type: 'chat',
                    text: '请先登录并完成首次建档后，再查看个人档案。若尚未建档，直接发送身高、体重、性别即可开始～',
                };
            }
            else {
                response = {
                    type: 'profile_plan',
                    text: '这是你在本应用中的健康档案与每日目标。需要修改时告诉我，例如「体重改成70」～',
                    profilePlanCard: this.buildProfileViewCard(savedProfile),
                };
            }
        }
        else if (intent.intent === 'profile_edit') {
            if (!openid || !savedProfile) {
                response = {
                    type: 'chat',
                    text: '请先登录并完成首次建档后再修改档案。未建档请先发送身高、体重、性别等信息～',
                };
            }
            else {
                response = await this.handleProfileEditForUser(openid, savedProfile, message);
            }
        }
        else if (intent.intent === 'daily_summary') {
            if (!openid) {
                response = {
                    type: 'chat',
                    text: '请先登录后再查看饮食汇总～',
                };
            }
            else {
                response = await this.handleDailySummary(openid, savedProfile, effectiveTarget);
            }
        }
        else if (intent.intent === 'weekly_summary') {
            if (!openid) {
                response = {
                    type: 'chat',
                    text: '请先登录后再查看饮食汇总～',
                };
            }
            else {
                response = await this.handleWeeklySummary(openid, savedProfile, effectiveTarget);
            }
        }
        else if (intent.intent === 'food_log') {
            response = await this._handleFoodLog(intent, openid, effectiveTarget, mergedProfile);
        }
        else if (intent.intent === 'portion_detail' &&
            currentState === 'waiting_for_portions' &&
            pendingFood) {
            response = await this._handlePortionDetail(intent.portions || message, pendingFood, openid);
        }
        else {
            if (currentState !== 'idle' && openid) {
                await this.db.setUserState(openid, { conversationState: 'idle' });
            }
            const text = await this.generateGeneralReply(message, mergedProfile);
            response = { type: 'chat', text };
        }
        if (openid) {
            const assistantContent = [response.text, response.followUp]
                .filter(Boolean)
                .join('\n\n');
            await this.db.saveChatRecord({
                openid,
                role: 'assistant',
                content: response.type === 'profile_guide'
                    ? '【完善档案】'
                    : assistantContent || response.text,
                type: response.type,
                nutrition: response.nutrition,
                card: response.type === 'profile_plan'
                    ? response.profilePlanCard
                    : response.type === 'summary'
                        ? response.summaryCard
                        : response.card,
                profileGuide: response.profileGuide,
                suggestion: response.suggestion,
            });
        }
        return response;
    }
    async _handleFoodLog(intent, openid, targetCalories, userProfile) {
        const food = intent.food || '';
        const mealType = this.getMealType();
        const feedback = await this.generateMealFeedback(food, mealType, userProfile);
        if (intent.isVague || !intent.portions) {
            const askText = await this.askForPortions(food);
            if (openid) {
                await this.db.setUserState(openid, {
                    conversationState: 'waiting_for_portions',
                    pendingFoodName: food,
                });
            }
            return { type: 'chat', text: feedback, followUp: askText };
        }
        else {
            return this._calculateAndReturnCard(food, intent.portions, mealType, feedback, openid);
        }
    }
    async _handlePortionDetail(portions, pendingFood, openid) {
        const mealType = this.getMealType();
        return this._calculateAndReturnCard(pendingFood, portions, mealType, '', openid);
    }
    async _calculateAndReturnCard(food, portions, mealType, feedbackText, openid) {
        const card = await this.calculateNutrition(food, portions);
        if (!card) {
            return {
                type: 'chat',
                text: '抱歉，暂时无法计算这道食物的营养成分，请稍后再试 😔',
            };
        }
        card.mealType = mealType;
        if (openid) {
            await this.db.setUserState(openid, {
                conversationState: 'pending_confirm',
                pendingFoodName: food,
                pendingCard: { ...card },
            });
        }
        return { type: 'card', text: feedbackText, card };
    }
    async confirmMeal(openid, card, targetCalories, userProfile) {
        const mealId = (0, crypto_1.randomUUID)();
        const mealType = card.mealType || this.getMealType();
        await this.db.updateLatestCardStatus(openid, 'confirmed', mealId);
        await this.db.saveChatRecord({
            openid,
            role: 'user',
            content: '✓ 确认记录',
            mealId,
        });
        await this.db.saveMealRecord({
            mealId,
            openid,
            foodName: card.foodName,
            quantity: card.quantity,
            calories: card.calories,
            protein: card.protein,
            carbs: card.carbs,
            fat: card.fat,
            fiber: card.fiber,
            purine: card.purine,
            healthReminder: card.healthReminder,
            mealType,
        });
        await this.db.clearUserState(openid);
        const todaysMeals = await this.db.getTodaysMeals(openid);
        const advice = await this.generateDailyAdvice(todaysMeals, targetCalories, userProfile);
        const nutrition = {
            foodName: card.foodName,
            weight: card.quantity,
            calories: card.calories,
            carbs: card.carbs,
            protein: card.protein,
            fat: card.fat,
        };
        await this.db.saveChatRecord({
            openid,
            role: 'assistant',
            content: advice,
            type: 'nutrition',
            nutrition,
            mealId,
            suggestion: advice,
        });
        return {
            type: 'nutrition',
            text: '',
            nutrition,
            suggestion: advice,
            mealId,
        };
    }
    async confirmProfilePlan(openid, plan) {
        await this.db.updateLatestCardStatus(openid, 'confirmed');
        const isUpdate = plan.profilePlanMode === 'update';
        await this.db.saveChatRecord({
            openid,
            role: 'user',
            content: isUpdate ? '✓ 确认修改档案' : '✓ 确认档案',
        });
        const record = {
            openid,
            heightCm: plan.heightCm,
            weightKg: plan.weightKg,
            gender: plan.gender,
            age: plan.age,
            diseases: plan.diseases,
            allergies: plan.allergies,
            goal: plan.goal,
            bmi: plan.bmi,
            bmiCategory: plan.bmiCategory,
            dailyCalories: plan.dailyCalories,
            proteinG: plan.proteinG,
            fatG: plan.fatG,
            carbsG: plan.carbsG,
            fiberMinG: plan.fiberMinG,
            vegetablesMinG: plan.vegetablesMinG,
            fruitMinG: plan.fruitMinG,
            fruitMaxG: plan.fruitMaxG,
            fatCalorieRatio: plan.dailyCalories > 0
                ? Math.round(((plan.fatG * 9) / plan.dailyCalories) * 1000) / 1000
                : undefined,
        };
        await this.db.upsertUserHealthProfile({
            ...record,
            profileConfirmedAt: new Date(),
        });
        await this.db.setUserState(openid, {
            conversationState: 'idle',
            profileDraft: undefined,
            pendingCard: undefined,
        });
        const text = isUpdate
            ? '档案已更新 🎉 每日营养目标已按新数据重新计算，继续告诉我你吃了什么吧～'
            : '档案已保存 🎉 现在可以告诉我你吃了什么，我会按你的每日目标帮你记录与分析～';
        await this.db.saveChatRecord({
            openid,
            role: 'assistant',
            content: text,
            type: 'chat',
        });
        return {
            type: 'chat',
            text,
            targetCalories: plan.dailyCalories,
        };
    }
    async rejectMeal(openid) {
        const st = await this.db.getUserState(openid);
        if (st?.conversationState === 'pending_profile_edit_confirm') {
            await this.db.updateLatestCardStatus(openid, 'rejected');
            await this.db.saveChatRecord({
                openid,
                role: 'user',
                content: '✕ 取消档案修改',
            });
            await this.db.setUserState(openid, {
                conversationState: 'idle',
                pendingCard: undefined,
                profileDraft: undefined,
            });
            const text = '已取消修改，档案保持原样～ 需要再改随时说「修改体重」等就可以。';
            await this.db.saveChatRecord({
                openid,
                role: 'assistant',
                content: text,
                type: 'chat',
            });
            return { type: 'chat', text };
        }
        if (st?.conversationState === 'pending_profile_plan_confirm') {
            await this.db.updateLatestCardStatus(openid, 'rejected');
            await this.db.saveChatRecord({
                openid,
                role: 'user',
                content: '✕ 取消档案确认',
            });
            await this.db.setUserState(openid, {
                conversationState: 'collecting_profile',
                pendingCard: undefined,
            });
            const text = '已取消。请重新发送你的身高、体重、性别等信息，或补充修改后再试～';
            await this.db.saveChatRecord({
                openid,
                role: 'assistant',
                content: text,
                type: 'chat',
            });
            return { type: 'chat', text, profileRequired: true };
        }
        await this.db.updateLatestCardStatus(openid, 'rejected');
        await this.db.saveChatRecord({
            openid,
            role: 'user',
            content: '✕ 取消记录',
        });
        await this.db.clearUserState(openid);
        const text = '没关系，已取消这次记录～ 随时告诉我你吃了什么 🌱';
        await this.db.saveChatRecord({
            openid,
            role: 'assistant',
            content: text,
            type: 'chat',
        });
        return { type: 'chat', text };
    }
    async getDailyStats(openid) {
        const meals = await this.db.getTodaysMeals(openid);
        const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
        return { totalCalories, meals };
    }
    async getWeeklyReport(openid, targetCalories, userProfile) {
        const meals = await this.db.getWeeklyMeals(openid);
        const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
        const report = await this.generateWeeklyReport(meals, targetCalories, userProfile);
        return { report, meals, totalCalories };
    }
    async getChatHistory(openid) {
        return this.db.getChatHistory(openid);
    }
    async getUserProfileForClient(openid) {
        const p = await this.db.getUserHealthProfile(openid);
        if (!p) {
            return { hasProfile: false, targetCalories: 1800 };
        }
        return {
            hasProfile: true,
            targetCalories: p.dailyCalories,
            profile: p,
        };
    }
    async getBaiduAccessToken() {
        if (this.baiduAccessToken && Date.now() < this.tokenExpiry) {
            return this.baiduAccessToken;
        }
        const res = await axios_1.default.post(`https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.baiduAk}&client_secret=${this.baiduSk}`);
        this.baiduAccessToken = res.data.access_token;
        const expiresIn = res.data.expires_in;
        this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
        return this.baiduAccessToken;
    }
    async recognizeMultipleObjects(imageBase64) {
        try {
            const token = await this.getBaiduAccessToken();
            const params = new URLSearchParams({ image: imageBase64 });
            console.log('[Baidu] 调用菜品识别接口，图片大小:', imageBase64.length, 'chars');
            const res = await axios_1.default.post(`https://aip.baidubce.com/rest/2.0/image-classify/v2/dish?access_token=${token}`, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            const raw = res.data.result;
            console.log('[Baidu] 菜品识别原始结果（前5条）:', JSON.stringify(raw?.slice(0, 5)));
            if (!raw || raw.length === 0) {
                console.log('[Baidu] 无识别结果');
                return [];
            }
            const dishes = raw.filter((item) => item.probability > 0.2).slice(0, 3);
            console.log('[Baidu] 识别到菜品:', dishes
                .map((i) => `${i.name}(${(i.probability * 100).toFixed(1)}%)`)
                .join('、'));
            return dishes.map((i) => i.name);
        }
        catch (err) {
            console.error('[Baidu] 菜品识别失败:', err instanceof Error ? err.message : String(err));
            return [];
        }
    }
    async analyzeImage(imageBase64, openid, userProfile) {
        if (openid) {
            const hp = await this.db.getUserHealthProfile(openid);
            if (!hp) {
                const guide = this.profileGuideResponse({ variant: 'blocked_image' });
                await this.db.saveChatRecord({
                    openid,
                    role: 'user',
                    content: '[图片]（已拦截：需先建档）',
                });
                await this.db.saveChatRecord({
                    openid,
                    role: 'assistant',
                    content: '【需先完善档案】',
                    type: 'profile_guide',
                    profileGuide: guide.profileGuide,
                });
                return guide;
            }
            const st = await this.db.getUserState(openid);
            if (st?.conversationState === 'pending_profile_edit_confirm') {
                const guide = this.profileGuideResponse({ variant: 'pending_edit_card' });
                await this.db.saveChatRecord({
                    openid,
                    role: 'user',
                    content: '[图片]（待确认档案修改）',
                });
                await this.db.saveChatRecord({
                    openid,
                    role: 'assistant',
                    content: '【请先确认档案修改】',
                    type: 'profile_guide',
                    profileGuide: guide.profileGuide,
                });
                return guide;
            }
        }
        const dishList = await this.recognizeMultipleObjects(imageBase64);
        const foodName = dishList.length > 0 ? dishList.join('、') : '未知食物';
        console.log('[analyzeImage] 最终识别食物:', foodName);
        if (openid) {
            await this.db.saveChatRecord({
                openid,
                role: 'user',
                content: `[图片] ${foodName}`,
            });
        }
        const mealType = this.getMealType();
        const feedback = await this.generateMealFeedback(foodName, mealType, userProfile);
        const askText = await this.askForPortions(foodName);
        if (openid) {
            await this.db.setUserState(openid, {
                conversationState: 'waiting_for_portions',
                pendingFoodName: foodName,
            });
        }
        if (openid) {
            await this.db.saveChatRecord({
                openid,
                role: 'assistant',
                content: `${feedback}\n\n${askText}`,
                type: 'chat',
                recognizedFood: foodName,
            });
        }
        return {
            type: 'chat',
            text: feedback,
            followUp: askText,
            recognizedFood: foodName,
        };
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], ChatService);
//# sourceMappingURL=chat.service.js.map