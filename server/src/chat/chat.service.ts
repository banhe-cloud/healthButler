import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import axios from 'axios';
import {
  DatabaseService,
  MealRecord,
  UserConversationState,
} from '../database/database.service';
import {
  UserProfile,
  INTENT_EXTRACTION_SYSTEM,
  NUTRITION_CALC_SYSTEM,
  MEAL_FEEDBACK_SYSTEM,
  ASK_PORTIONS_SYSTEM,
  DAILY_ADVICE_SYSTEM,
  GENERAL_CHAT_SYSTEM,
  WEEKLY_REPORT_SYSTEM,
  PROFILE_EXTRACTION_SYSTEM,
  PLAN_ADJUSTMENT_SYSTEM,
  SUMMARY_ADVICE_SYSTEM,
} from './system-prompt';
import {
  computeBmi,
  bmiCategoryLabel,
  computeDailyPlan,
  recomputeWithFatGrams,
  type FitnessGoal,
  type Gender,
} from './profile-plan.util';
import { UserHealthProfile, ProfileDraft } from '../database/database.service';

export interface NutritionData {
  foodName: string;
  weight: string;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
}

export interface CardData {
  foodName: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  purine: number;
  healthReminder: string;
  mealType?: string;
}

/** 档案确认卡片（与餐食卡片分开展示） */
export interface ProfilePlanCardData {
  cardKind: 'profile_plan';
  /** 首次建档确认 / 更新档案确认 / 仅查看（无确认按钮） */
  profilePlanMode?: 'create' | 'update' | 'view';
  heightCm: number;
  weightKg: number;
  gender: Gender;
  age?: number;
  diseases?: string;
  allergies?: string;
  goal: FitnessGoal;
  bmi: number;
  bmiCategory: string;
  evaluationText: string;
  adviceText: string;
  dailyCalories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberMinG: number;
  vegetablesMinG: number;
  fruitMinG: number;
  fruitMaxG: number;
  planLines: string[];
}

/** 档案引导卡片（小程序专用样式，不用 Markdown） */
export type ProfileGuideVariant =
  | 'missing'
  | 'blocked_food'
  | 'blocked_image'
  | 'pending_card'
  /** 待确认档案修改卡片 */
  | 'pending_edit_card';

export interface ProfileGuidePayload {
  variant: ProfileGuideVariant;
  /** 仍缺的信息，如 ['身高(cm)','体重(kg)','性别'] */
  missingFields?: string[];
}

/** 汇总卡片（今日/本周）进度条数据 */
export interface SummaryMetricRow {
  key: string;
  label: string;
  current: number;
  target: number;
  unit: string;
  /** 进度条宽度 0～100（超过目标时仍显示为 100 满条，由文案说明） */
  barPercent: number;
}

export interface SummaryCardData {
  period: 'today' | 'week';
  title: string;
  subtitle: string;
  metrics: SummaryMetricRow[];
  mealLines: string[];
  advice: string;
}

export interface ChatResponse {
  type: 'nutrition' | 'chat' | 'card' | 'profile_plan' | 'profile_guide' | 'summary';
  text: string;
  /** 需要在主消息之后额外展示的第二条气泡（如：反馈 + 追问分成两条） */
  followUp?: string;
  nutrition?: NutritionData;
  card?: CardData;
  profilePlanCard?: ProfilePlanCardData;
  suggestion?: string;
  recognizedFood?: string;
  /** 已确认餐食记录的唯一 ID，确认后返回，用于关联聊天记录 */
  mealId?: string;
  /** 档案确认后同步给前端的每日热量目标 */
  targetCalories?: number;
  /** 未完成档案时禁止正常对话 */
  profileRequired?: boolean;
  /** 档案引导 UI 数据 */
  profileGuide?: ProfileGuidePayload;
  /** 今日/本周汇总卡片 */
  summaryCard?: SummaryCardData;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type MealType = '早饭' | '午饭' | '下午茶' | '晚饭' | '夜宵';

interface IntentResult {
  intent:
    | 'food_log'
    | 'portion_detail'
    | 'general'
    | 'daily_summary'
    | 'weekly_summary'
    | 'profile_view'
    | 'profile_edit';
  food?: string;
  portions?: string | null;
  isVague?: boolean;
}

interface ProfileExtract {
  heightCm?: number | null;
  weightKg?: number | null;
  gender?: Gender | null;
  age?: number | null;
  diseases?: string | null;
  allergies?: string | null;
  goal?: FitnessGoal | null;
}

interface PlanAdjustmentIntent {
  intent: 'none' | 'set_fat_grams' | 'set_calories';
  fatGrams?: number;
  calories?: number;
}

@Injectable()
export class ChatService {
  private readonly llm: ChatOpenAI;
  private baiduAccessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(private readonly db: DatabaseService) {
    this.llm = new ChatOpenAI({
      apiKey: process.env.MINIMAX_API_KEY || '',
      model: process.env.MINIMAX_MODEL || 'abab6.5-chat',
      configuration: {
        baseURL: 'https://api.minimaxi.com/v1',
      },
      timeout: 30000,
    });
  }

  private get baiduAk(): string {
    return process.env.BAIDU_AK || '';
  }
  private get baiduSk(): string {
    return process.env.BAIDU_SK || '';
  }

  // ==================== 基础 AI 调用 ====================

  /** 单次 AI 调用：给定系统提示 + 用户消息，返回文本 */
  private async callAI(
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    try {
      const response = await this.llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
      ]);
      const content = response.content;
      return typeof content === 'string' ? content : JSON.stringify(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(`AI调用失败: ${msg}`);
    }
  }

  /** 从 AI 返回文本中解析 JSON，带 markdown 清洗和括号匹配 */
  private parseJSON<T>(text: string): T | null {
    const cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
    let depth = 0;
    let start = -1;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === '{') {
        if (depth === 0) start = i;
        depth++;
        } else if (cleaned[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
            try {
              return JSON.parse(cleaned.slice(start, i + 1)) as T;
            } catch {
              break;
            }
          }
        }
      }
      return null;
    }
  }

  // ==================== 业务逻辑辅助（后端控制） ====================

  /** 根据当前时间判断餐次（纯后端逻辑，无需 AI） */
  private getMealType(): MealType {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 10) return '早饭';
    if (hour >= 10 && hour < 14) return '午饭';
    if (hour >= 14 && hour < 17) return '下午茶';
    if (hour >= 17 && hour < 21) return '晚饭';
    return '夜宵';
  }

  // ==================== AI 功能调用（每个只做一件事） ====================

  /** AI：提取用户消息的意图 */
  private async extractIntent(
    message: string,
    currentState: string,
  ): Promise<IntentResult> {
    const stateHint =
      currentState === 'waiting_for_portions'
        ? '\n（注意：系统刚刚询问了用户食物的具体分量，用户现在的回复很可能是在回答分量问题）'
        : '';
    const raw = await this.callAI(
      INTENT_EXTRACTION_SYSTEM,
      `用户消息：${message}${stateHint}`,
    );
    const result = this.parseJSON<IntentResult>(raw);
    if (!result || !result.intent) {
      console.warn('[ChatService] extractIntent parse failed, raw=', raw);
      return { intent: 'general' };
    }
    return result;
  }

  /** AI：计算营养成分 */
  private async calculateNutrition(
    food: string,
    portions: string,
  ): Promise<CardData | null> {
    const raw = await this.callAI(
      NUTRITION_CALC_SYSTEM,
      `食物：${food}\n分量：${portions}`,
    );
    const result = this.parseJSON<CardData>(raw);
    if (!result) {
      console.warn('[ChatService] calculateNutrition parse failed, raw=', raw);
    }
    return result;
  }

  /** AI：生成亲切的餐食反馈 */
  private async generateMealFeedback(
    food: string,
    mealType: MealType,
    userProfile?: UserProfile,
  ): Promise<string> {
    const profileStr = userProfile
      ? `用户信息：身高${userProfile.height || '未知'}，体重${userProfile.weight || '未知'}${userProfile.medicalHistory ? '，病史：' + userProfile.medicalHistory : ''}${userProfile.allergies ? '，过敏：' + userProfile.allergies : ''}`
      : '';
    return this.callAI(
      MEAL_FEEDBACK_SYSTEM,
      `${mealType}：${food}。${profileStr}`,
    );
  }

  /** AI：生成询问具体分量的话 */
  private async askForPortions(food: string): Promise<string> {
    return this.callAI(ASK_PORTIONS_SYSTEM, `食物：${food}`);
  }

  /** AI：根据今日餐食生成建议 */
  private async generateDailyAdvice(
    meals: MealRecord[],
    targetCalories: number,
    userProfile?: UserProfile,
  ): Promise<string> {
    const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
    const mealSummary =
      meals.length > 0
        ? meals
            .map((m) => `${m.mealType}-${m.foodName}(${m.calories}kcal)`)
            .join('，')
        : '暂无记录';
    const profileStr = userProfile
      ? `用户：身高${userProfile.height || '未知'}，体重${userProfile.weight || '未知'}`
      : '';
    return this.callAI(
      DAILY_ADVICE_SYSTEM,
      `今天饮食记录：${mealSummary}。总热量${totalCalories}kcal，目标${targetCalories}kcal。${profileStr}`,
    );
  }

  /** AI：生成通用对话回复 */
  private async generateGeneralReply(
    message: string,
    userProfile?: UserProfile,
  ): Promise<string> {
    const profileStr = userProfile?.weight
      ? `（用户体重${userProfile.weight}，身高${userProfile.height}）`
      : '';
    return this.callAI(GENERAL_CHAT_SYSTEM, `${message}${profileStr}`);
  }

  /** AI：生成周报 */
  private async generateWeeklyReport(
    meals: MealRecord[],
    targetCalories: number,
    userProfile?: UserProfile,
  ): Promise<string> {
    const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
    const days = Math.max(
      1,
      new Set(meals.map((m) => new Date(m.confirmedAt).toDateString())).size,
    );
    const avgCalories = Math.round(totalCalories / days);
    const mealSummary = meals
      .map((m) => `${m.mealType}-${m.foodName}(${m.calories}kcal)`)
      .join('，');
    const profileStr = userProfile
      ? `用户：身高${userProfile.height || '未知'}，体重${userProfile.weight || '未知'}`
      : '';
    return this.callAI(
      WEEKLY_REPORT_SYSTEM,
      `本周${days}天饮食记录：${mealSummary || '暂无'}。总热量${totalCalories}kcal，日均${avgCalories}kcal，目标${targetCalories}kcal/天。${profileStr}`,
    );
  }

  private barPercent(current: number, target: number): number {
    if (target <= 0) return 0;
    return Math.min(100, Math.round((current / target) * 100));
  }

  private macroTargets(
    hp: UserHealthProfile | null,
    fallbackCal: number,
  ): {
    cal: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  } {
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

  private aggregateMeals(meals: MealRecord[]): {
    cal: number;
    p: number;
    c: number;
    f: number;
    fi: number;
  } {
    return meals.reduce(
      (a, m) => ({
        cal: a.cal + m.calories,
        p: a.p + m.protein,
        c: a.c + m.carbs,
        f: a.f + m.fat,
        fi: a.fi + m.fiber,
      }),
      { cal: 0, p: 0, c: 0, f: 0, fi: 0 },
    );
  }

  /** 汇总建议：个人档案摘要（供 AI 个性化肯定/建议） */
  private summaryProfileContext(hp: UserHealthProfile | null): string {
    if (!hp) {
      return '【档案】用户尚未在应用内完善健康档案，当前营养目标为默认估算。请提醒尽快完善档案，并在建议中避免假设具体疾病或过敏。';
    }
    const gender = hp.gender === 'male' ? '男' : '女';
    const goalLabel: Record<string, string> = {
      fat_loss: '减脂',
      maintain: '维持体重',
      muscle: '增肌',
    };
    const goal = goalLabel[hp.goal] || hp.goal;
    const bmiStr =
      hp.bmi != null && Number.isFinite(Number(hp.bmi))
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

  /** 今日进食行为摘要（餐次分布、热量集中度等） */
  private summaryBehaviorToday(meals: MealRecord[]): string {
    if (meals.length === 0) {
      return '【行为】今日暂无已确认的饮食记录，可肯定用户若在其他渠道进食可继续记录。';
    }
    const calByType: Record<string, number> = {};
    const countByType: Record<string, number> = {};
    for (const m of meals) {
      const t = m.mealType || '其他';
      countByType[t] = (countByType[t] || 0) + 1;
      calByType[t] = (calByType[t] || 0) + m.calories;
    }
    const totalCal = meals.reduce((s, m) => s + m.calories, 0);
    const dist = Object.entries(countByType)
      .map(([k, v]) => `${k}${v}次`)
      .join('、');
    const lines: string[] = [
      `【行为】今日已确认 ${meals.length} 餐，总热量约 ${Math.round(totalCal)} kcal。餐次分布：${dist}。`,
    ];
    const sorted = Object.entries(calByType).sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    if (top && totalCal > 0 && top[1] / totalCal >= 0.48) {
      lines.push(
        `热量相对集中在「${top[0]}」（约${Math.round((top[1] / totalCal) * 100)}%），可结合目标点评是否需调整分配。`,
      );
    }
    return lines.join('');
  }

  /** 本周进食行为摘要 */
  private summaryBehaviorWeek(
    meals: MealRecord[],
    uniqueDays: number,
  ): string {
    if (meals.length === 0) {
      return '【行为】近7天暂无已确认的饮食记录。';
    }
    const days = Math.max(1, uniqueDays);
    const avgMeals = meals.length / days;
    return `【行为】近7天有记录 ${uniqueDays} 天，共 ${meals.length} 餐，平均每天约 ${avgMeals.toFixed(1)} 餐；坚持记录值得肯定。`;
  }

  private async handleDailySummary(
    openid: string,
    hp: UserHealthProfile | null,
    fallbackCal: number,
  ): Promise<ChatResponse> {
    const meals = await this.db.getTodaysMeals(openid);
    const t = this.macroTargets(hp, fallbackCal);
    const agg = this.aggregateMeals(meals);
    const metrics: SummaryMetricRow[] = [
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
    const mealLines = meals.map(
      (m) => `${m.mealType} · ${m.foodName} · ${m.calories}kcal`,
    );
    const subtitle = meals.length
      ? `已记录 ${meals.length} 餐`
      : '今日暂无已确认的饮食记录';
    const advicePayload = [
      this.summaryProfileContext(hp),
      this.summaryBehaviorToday(meals),
      `【数据】今日汇总（对比每日目标）。热量 ${Math.round(agg.cal)}/${Math.round(t.cal)} kcal，蛋白质 ${Math.round(agg.p * 10) / 10}/${t.protein}g，碳水 ${Math.round(agg.c * 10) / 10}/${t.carbs}g，脂肪 ${Math.round(agg.f * 10) / 10}/${t.fat}g，膳食纤维 ${Math.round(agg.fi * 10) / 10}/${t.fiber}g。餐次明细：${mealLines.join('；') || '无'}`,
    ].join('\n');
    const advice = await this.callAI(SUMMARY_ADVICE_SYSTEM, advicePayload);
    const summaryCard: SummaryCardData = {
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

  private async handleWeeklySummary(
    openid: string,
    hp: UserHealthProfile | null,
    fallbackCal: number,
  ): Promise<ChatResponse> {
    const meals = await this.db.getWeeklyMeals(openid);
    const t = this.macroTargets(hp, fallbackCal);
    const agg = this.aggregateMeals(meals);
    const uniqueDays = new Set(
      meals.map((m) => new Date(m.confirmedAt).toDateString()),
    ).size;
    const days = Math.max(1, uniqueDays);
    const avg = {
      cal: agg.cal / days,
      p: agg.p / days,
      c: agg.c / days,
      f: agg.f / days,
      fi: agg.fi / days,
    };
    const metrics: SummaryMetricRow[] = [
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
    const mealLines =
      meals.length <= 15
        ? meals.map(
            (m) =>
              `${new Date(m.confirmedAt).getMonth() + 1}/${new Date(m.confirmedAt).getDate()} ${m.mealType} · ${m.foodName} · ${m.calories}kcal`,
          )
        : [
            ...meals.slice(0, 12).map(
              (m) =>
                `${new Date(m.confirmedAt).getMonth() + 1}/${new Date(m.confirmedAt).getDate()} ${m.mealType} · ${m.foodName} · ${m.calories}kcal`,
            ),
            `…共 ${meals.length} 餐`,
          ];
    const subtitle = `近7天 ${uniqueDays} 天有记录 · 共 ${meals.length} 餐`;
    const advicePayload = [
      this.summaryProfileContext(hp),
      this.summaryBehaviorWeek(meals, uniqueDays),
      `【数据】本周汇总（各指标为日均值，对比每日目标）。日均热量 ${Math.round(avg.cal)}/${Math.round(t.cal)} kcal，日均蛋白质 ${Math.round(avg.p * 10) / 10}/${t.protein}g，日均碳水 ${Math.round(avg.c * 10) / 10}/${t.carbs}g，日均脂肪 ${Math.round(avg.f * 10) / 10}/${t.fat}g，日均膳食纤维 ${Math.round(avg.fi * 10) / 10}/${t.fiber}g。本周总热量 ${Math.round(agg.cal)} kcal。餐次抽样：${mealLines.slice(0, 5).join('；')}`,
    ].join('\n');
    const advice = await this.callAI(SUMMARY_ADVICE_SYSTEM, advicePayload);
    const summaryCard: SummaryCardData = {
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

  // ==================== 用户档案 ====================

  private mergeDraft(
    prev: ProfileDraft | undefined,
    patch: ProfileExtract,
  ): ProfileDraft {
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

  private profileMissingList(d: ProfileDraft): string[] {
    const miss: string[] = [];
    if (!d.heightCm || d.heightCm <= 0) miss.push('身高(cm)');
    if (!d.weightKg || d.weightKg <= 0) miss.push('体重(kg)');
    if (!d.gender) miss.push('性别(男/女)');
    return miss;
  }

  private profileDraftFromHp(hp: UserHealthProfile): ProfileDraft {
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

  private profilePatchHasValues(patch: ProfileExtract): boolean {
    return (
      patch.heightCm != null ||
      patch.weightKg != null ||
      patch.gender != null ||
      patch.age != null ||
      patch.diseases != null ||
      patch.allergies != null ||
      patch.goal != null
    );
  }

  private profileHpEqualsDraft(hp: UserHealthProfile, d: ProfileDraft): boolean {
    return (
      hp.heightCm === d.heightCm &&
      hp.weightKg === d.weightKg &&
      hp.gender === d.gender &&
      (hp.age ?? null) === (d.age ?? null) &&
      (hp.diseases || '') === (d.diseases || '') &&
      (hp.allergies || '') === (d.allergies || '') &&
      hp.goal === (d.goal || hp.goal)
    );
  }

  /** 根据草稿生成档案确认卡片（首次建档 / 更新档案） */
  private async composeProfilePlanCardFromDraft(
    draft: ProfileDraft,
    mode: 'create' | 'update',
  ): Promise<ProfilePlanCardData> {
    const height = draft.heightCm!;
    const weight = draft.weightKg!;
    const gender = draft.gender!;
    const goal = draft.goal || 'fat_loss';

    const bmi = computeBmi(height, weight);
    const bmiCat = bmiCategoryLabel(bmi);
    const plan = computeDailyPlan(weight, gender, goal);

    const evalPrompt = `用户：${gender === 'male' ? '男' : '女'}，${height}cm，${weight}kg，BMI约${bmi}（${bmiCat}）。请用2-3句中文给出体态评价（亲切）+ 一句饮食方向建议（不提具体数字）。`;
    const evaluationText = await this.callAI(
      MEAL_FEEDBACK_SYSTEM.replace('根据用户的餐食情况', '根据用户身体数据'),
      evalPrompt,
    );
    const advicePrompt =
      mode === 'update'
        ? `目标：${goal}。BMI类别：${bmiCat}。用户正在更新健康档案，请给一条简短说明：确认后将按新数据重新计算每日营养计划（55字内）。`
        : `目标：${goal}。BMI类别：${bmiCat}。请给一条开启饮食管理前的鼓励与提醒（60字内）。`;
    const adviceText = await this.callAI(
      DAILY_ADVICE_SYSTEM.replace(
        '根据今天已记录的饮食数据',
        '根据该用户的档案与目标',
      ),
      advicePrompt,
    );

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

  /** 已建档：仅查看，不显示确认按钮 */
  private buildProfileViewCard(hp: UserHealthProfile): ProfilePlanCardData {
    const bmi = hp.bmi ?? computeBmi(hp.heightCm, hp.weightKg);
    const bmiCat = hp.bmiCategory ?? bmiCategoryLabel(bmi);
    const goalLabel =
      hp.goal === 'muscle' ? '增肌' : hp.goal === 'maintain' ? '维持' : '减脂';
    const planLines = [
      `每日热量约 ${hp.dailyCalories} kcal`,
      `蛋白质 ${hp.proteinG}g · 脂肪 ${hp.fatG}g · 碳水 ${hp.carbsG}g`,
      `膳食纤维 ≥ ${hp.fiberMinG}g/天；蔬菜 ≥ ${hp.vegetablesMinG}g/天；水果 ${hp.fruitMinG}～${hp.fruitMaxG}g/天`,
    ];
    const evaluationText = `当前档案：${hp.gender === 'male' ? '男' : '女'}，${hp.heightCm}cm，${hp.weightKg}kg；健康目标：${goalLabel}；BMI 约 ${bmi}（${bmiCat}）。`;
    const adviceText =
      '需要修改时直接说，例如「体重改成70」「过敏改成无」「目标改成增肌」，我会先让你确认再保存～';
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

  private async handleProfileEditForUser(
    openid: string,
    hp: UserHealthProfile,
    message: string,
  ): Promise<ChatResponse> {
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
    const profilePlanCard = await this.composeProfilePlanCardFromDraft(
      draft,
      'update',
    );
    await this.db.setUserState(openid, {
      conversationState: 'pending_profile_edit_confirm',
      profileDraft: draft,
      pendingCard: profilePlanCard as unknown as object,
    });
    return {
      type: 'profile_plan',
      text: '请确认下方更新后的档案与每日营养计划；点「确认修改」后才会保存到云端。',
      followUp: '若有误可点取消，再重新说明要改的内容。',
      profilePlanCard,
    };
  }

  private async extractProfilePatch(message: string): Promise<ProfileExtract> {
    const raw = await this.callAI(
      PROFILE_EXTRACTION_SYSTEM,
      `用户说：${message}`,
    );
    return this.parseJSON<ProfileExtract>(raw) || {};
  }

  private async extractPlanAdjustment(
    message: string,
  ): Promise<PlanAdjustmentIntent> {
    const raw = await this.callAI(PLAN_ADJUSTMENT_SYSTEM, message);
    const r = this.parseJSON<PlanAdjustmentIntent>(raw);
    return r?.intent ? r : { intent: 'none' };
  }

  private healthToUserProfile(h: UserHealthProfile): UserProfile {
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

  private profileGuideResponse(guide: ProfileGuidePayload): ChatResponse {
    return {
      type: 'profile_guide',
      text: '',
      profileGuide: guide,
      profileRequired: true,
    };
  }

  private async handlePlanAdjustment(
    message: string,
    openid: string,
    hp: UserHealthProfile,
  ): Promise<ChatResponse | null> {
    const adj = await this.extractPlanAdjustment(message);
    if (adj.intent === 'none') return null;

    if (
      adj.intent === 'set_fat_grams' &&
      adj.fatGrams != null &&
      adj.fatGrams > 0
    ) {
      const plan = recomputeWithFatGrams(
        hp.weightKg,
        hp.gender,
        hp.goal,
        adj.fatGrams,
      );
      await this.db.patchUserHealthProfile(openid, {
        fatG: plan.fatG,
        carbsG: plan.carbsG,
        fatCalorieRatio: plan.fatCalorieRatio,
        dailyCalories: plan.calories,
      });
      const text = `已把每日脂肪目标调整为 ${plan.fatG}g，碳水已重新计算为 ${plan.carbsG}g（总热量 ${plan.calories} kcal）。`;
      return { type: 'chat', text, targetCalories: plan.calories };
    }

    if (
      adj.intent === 'set_calories' &&
      adj.calories != null &&
      adj.calories > 0
    ) {
      const base = computeDailyPlan(hp.weightKg, hp.gender, hp.goal);
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

  /** 档案流程：返回 null 表示需继续主流程 */
  private async handleProfileConversation(
    message: string,
    openid: string,
    userState: UserConversationState | null,
  ): Promise<ChatResponse | null> {
    const hp = await this.db.getUserHealthProfile(openid);
    if (hp) return null;

    const st = userState?.conversationState || 'idle';

    if (st === 'pending_profile_plan_confirm') {
      return this.profileGuideResponse({ variant: 'pending_card' });
    }

    const draft = this.mergeDraft(
      userState?.profileDraft,
      await this.extractProfilePatch(message),
    );

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

    const profilePlanCard = await this.composeProfilePlanCardFromDraft(
      draft,
      'create',
    );

    await this.db.setUserState(openid, {
      conversationState: 'pending_profile_plan_confirm',
      profileDraft: draft,
      pendingCard: profilePlanCard as unknown as object,
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

  // ==================== 状态机：主流程 ====================

  /**
   * 主入口：处理用户文本消息
   * 后端负责所有流程决策，AI 只负责理解用户意图 + 生成自然语言
   */
  async processMessage(
    message: string,
    openid?: string,
    targetCalories = 1800,
    userProfile?: UserProfile,
  ): Promise<ChatResponse> {
    const savedProfile = openid
      ? await this.db.getUserHealthProfile(openid)
      : null;
    const mergedProfile: UserProfile | undefined = savedProfile
      ? this.healthToUserProfile(savedProfile)
      : userProfile;
    // 读取当前会话状态
    const userState = openid ? await this.db.getUserState(openid) : null;
    const currentState = userState?.conversationState || 'idle';
    const pendingFood = userState?.pendingFoodName || '';

    console.log(
      '[ChatService] processMessage state=',
      currentState,
      'openid=',
      openid || '(none)',
    );

    // 已建档：待确认档案修改时，请先点确认/取消
    if (openid && savedProfile && currentState === 'pending_profile_edit_confirm') {
      await this.db.saveChatRecord({ openid, role: 'user', content: message });
      const guide = this.profileGuideResponse({ variant: 'pending_edit_card' });
      await this.db.saveChatRecord({
        openid,
        role: 'assistant',
        content: '【请先确认档案修改】',
        type: 'profile_guide',
        profileGuide: guide.profileGuide as object,
      });
      return guide;
    }

    // 已建档：可识别「调整脂肪/热量」
    if (openid && savedProfile) {
      const adj = await this.handlePlanAdjustment(
        message,
        openid,
        savedProfile,
      );
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

    // 未建档：走档案收集，拦截饮食记录（汇总查询仍可用数据库）
    if (openid && !savedProfile) {
      const intentPre = await this.extractIntent(message, currentState);
      if (
        intentPre.intent === 'daily_summary' ||
        intentPre.intent === 'weekly_summary'
      ) {
        await this.db.saveChatRecord({ openid, role: 'user', content: message });
        const sumResp =
          intentPre.intent === 'daily_summary'
            ? await this.handleDailySummary(openid, null, targetCalories)
            : await this.handleWeeklySummary(openid, null, targetCalories);
        await this.db.saveChatRecord({
          openid,
          role: 'assistant',
          content: sumResp.text,
          type: 'summary',
          card: sumResp.summaryCard as object,
        });
        return sumResp;
      }
      if (
        intentPre.intent === 'food_log' ||
        (intentPre.intent === 'portion_detail' &&
          currentState === 'waiting_for_portions')
      ) {
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
          profileGuide: guide.profileGuide as object,
        });
        return guide;
      }

      await this.db.saveChatRecord({ openid, role: 'user', content: message });
      const profResp = await this.handleProfileConversation(
        message,
        openid,
        userState,
      );
      if (profResp) {
        const assistantContent = [profResp.text, profResp.followUp]
          .filter(Boolean)
          .join('\n\n');
        await this.db.saveChatRecord({
          openid,
          role: 'assistant',
          content:
            profResp.type === 'profile_guide'
              ? '【完善档案】'
              : assistantContent || '【档案】',
          type: profResp.type,
          card: profResp.profilePlanCard as unknown as object,
          profileGuide: profResp.profileGuide as object | undefined,
        });
        return profResp;
      }
    }

    // 保存用户消息（未建档分支已保存）
    if (openid && savedProfile) {
      await this.db.saveChatRecord({ openid, role: 'user', content: message });
    }

    // AI 理解意图
    let intent = await this.extractIntent(message, currentState);
    // 口语兜底：已建档用户「我的信息」「体重改成70」等
    if (savedProfile && openid && intent.intent === 'general') {
      const compact = message.replace(/\s/g, '');
      const looksView =
        /(我的|个人)(档案|信息|资料)|查看.*档案|^档案$|健康档案/.test(compact);
      const looksEdit =
        /(修改|改|更新|换成|改成|设为|设置)/.test(message) &&
        /(身高|体重|年龄|性别|疾病|过敏|目标|减脂|增肌|维持)/.test(message);
      if (looksView) {
        intent = { intent: 'profile_view' };
      } else if (looksEdit) {
        intent = { intent: 'profile_edit' };
      }
    }
    console.log('[ChatService] intent=', JSON.stringify(intent));

    let response: ChatResponse;

    const effectiveTarget = savedProfile?.dailyCalories ?? targetCalories;

    if (intent.intent === 'profile_view') {
      if (!openid || !savedProfile) {
        response = {
          type: 'chat',
          text: '请先登录并完成首次建档后，再查看个人档案。若尚未建档，直接发送身高、体重、性别即可开始～',
        };
      } else {
        response = {
          type: 'profile_plan',
          text: '这是你在本应用中的健康档案与每日目标。需要修改时告诉我，例如「体重改成70」～',
          profilePlanCard: this.buildProfileViewCard(savedProfile),
        };
      }
    } else if (intent.intent === 'profile_edit') {
      if (!openid || !savedProfile) {
        response = {
          type: 'chat',
          text: '请先登录并完成首次建档后再修改档案。未建档请先发送身高、体重、性别等信息～',
        };
      } else {
        response = await this.handleProfileEditForUser(
          openid,
          savedProfile,
          message,
        );
      }
    } else if (intent.intent === 'daily_summary') {
      if (!openid) {
        response = {
          type: 'chat',
          text: '请先登录后再查看饮食汇总～',
        };
      } else {
        response = await this.handleDailySummary(
          openid,
          savedProfile,
          effectiveTarget,
        );
      }
    } else if (intent.intent === 'weekly_summary') {
      if (!openid) {
        response = {
          type: 'chat',
          text: '请先登录后再查看饮食汇总～',
        };
      } else {
        response = await this.handleWeeklySummary(
          openid,
          savedProfile,
          effectiveTarget,
        );
      }
    } else if (intent.intent === 'food_log') {
      // 用户在记录食物
      response = await this._handleFoodLog(
        intent,
        openid,
        effectiveTarget,
        mergedProfile,
      );
    } else if (
      intent.intent === 'portion_detail' &&
      currentState === 'waiting_for_portions' &&
      pendingFood
    ) {
      // 用户在回答分量问题
      response = await this._handlePortionDetail(
        intent.portions || message,
        pendingFood,
        openid,
      );
    } else {
      // 通用对话：如果当前在等待状态中，重置（用户转移话题）
      if (currentState !== 'idle' && openid) {
        await this.db.setUserState(openid, { conversationState: 'idle' });
      }
      const text = await this.generateGeneralReply(message, mergedProfile);
      response = { type: 'chat', text };
    }

    // 保存 AI 回复（card / profile_plan / profile_guide）
    if (openid) {
      const assistantContent = [response.text, response.followUp]
        .filter(Boolean)
        .join('\n\n');
      await this.db.saveChatRecord({
        openid,
        role: 'assistant',
        content:
          response.type === 'profile_guide'
            ? '【完善档案】'
            : assistantContent || response.text,
        type: response.type,
        nutrition: response.nutrition,
        card:
          response.type === 'profile_plan'
            ? (response.profilePlanCard as unknown as object)
            : response.type === 'summary'
              ? (response.summaryCard as object)
              : response.card,
        profileGuide: response.profileGuide as object | undefined,
        suggestion: response.suggestion,
      });
    }

    return response;
  }

  /** 处理食物记录意图 */
  private async _handleFoodLog(
    intent: IntentResult,
    openid: string | undefined,
    targetCalories: number,
    userProfile?: UserProfile,
  ): Promise<ChatResponse> {
    const food = intent.food || '';
    const mealType = this.getMealType();

    // AI 生成亲切反馈
    const feedback = await this.generateMealFeedback(
      food,
      mealType,
      userProfile,
    );

    if (intent.isVague || !intent.portions) {
      // 分量模糊 → 询问具体分量
      const askText = await this.askForPortions(food);
      if (openid) {
        await this.db.setUserState(openid, {
          conversationState: 'waiting_for_portions',
          pendingFoodName: food,
        });
      }
      return { type: 'chat', text: feedback, followUp: askText };
    } else {
      // 分量明确 → 直接计算营养并展示确认卡
      return this._calculateAndReturnCard(
        food,
        intent.portions,
        mealType,
        feedback,
        openid,
      );
    }
  }

  /** 处理用户提供的分量详情 */
  private async _handlePortionDetail(
    portions: string,
    pendingFood: string,
    openid: string | undefined,
  ): Promise<ChatResponse> {
    const mealType = this.getMealType();
    return this._calculateAndReturnCard(
      pendingFood,
      portions,
      mealType,
      '',
      openid,
    );
  }

  /** 计算营养并返回确认卡片 */
  private async _calculateAndReturnCard(
    food: string,
    portions: string,
    mealType: MealType,
    feedbackText: string,
    openid: string | undefined,
  ): Promise<ChatResponse> {
    const card = await this.calculateNutrition(food, portions);
    if (!card) {
      return {
        type: 'chat',
        text: '抱歉，暂时无法计算这道食物的营养成分，请稍后再试 😔',
      };
    }

    card.mealType = mealType;

    // 保存卡片到状态，等待用户确认
    if (openid) {
      await this.db.setUserState(openid, {
        conversationState: 'pending_confirm',
        pendingFoodName: food,
        pendingCard: { ...card },
      });
    }

    return { type: 'card', text: feedbackText, card };
  }

  // ==================== 用户操作：确认 / 取消 ====================

  /** 用户确认卡片：保存餐食记录，返回今日饮食建议 */
  async confirmMeal(
    openid: string,
    card: CardData,
    targetCalories: number,
    userProfile?: UserProfile,
  ): Promise<ChatResponse> {
    // 生成全局唯一的餐食 ID（UUID v4）
    const mealId = randomUUID();
    const mealType = card.mealType || this.getMealType();

    // 将历史卡片消息标记为已确认，并关联 mealId
    await this.db.updateLatestCardStatus(openid, 'confirmed', mealId);

    // 保存用户「确认」操作，关联 mealId
    await this.db.saveChatRecord({
      openid,
      role: 'user',
      content: '✓ 确认记录',
      mealId,
    });

    // 保存餐食记录到 confirmed_meals 集合
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

    // 重置会话状态
    await this.db.clearUserState(openid);

    // 获取今日所有已记录餐食，生成建议
    const todaysMeals = await this.db.getTodaysMeals(openid);
    const advice = await this.generateDailyAdvice(
      todaysMeals,
      targetCalories,
      userProfile,
    );

    const nutrition: NutritionData = {
      foodName: card.foodName,
      weight: card.quantity,
      calories: card.calories,
      carbs: card.carbs,
      protein: card.protein,
      fat: card.fat,
    };

    // 保存 AI 建议消息，同样关联 mealId，便于后续查询
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
      text: '', // 卡片上方不显示文字
      nutrition,
      suggestion: advice, // 建议显示在卡片下方
      mealId,
    };
  }

  /** 确认档案卡片：写入 user_profiles，清空草稿 */
  async confirmProfilePlan(
    openid: string,
    plan: ProfilePlanCardData,
  ): Promise<ChatResponse> {
    await this.db.updateLatestCardStatus(openid, 'confirmed');

    const isUpdate = plan.profilePlanMode === 'update';

    await this.db.saveChatRecord({
      openid,
      role: 'user',
      content: isUpdate ? '✓ 确认修改档案' : '✓ 确认档案',
    });

    const record: Omit<UserHealthProfile, 'updatedAt' | 'profileConfirmedAt'> =
      {
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
        fatCalorieRatio:
          plan.dailyCalories > 0
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

  /** 用户取消卡片 */
  async rejectMeal(openid: string): Promise<ChatResponse> {
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
      const text =
        '已取消。请重新发送你的身高、体重、性别等信息，或补充修改后再试～';
      await this.db.saveChatRecord({
        openid,
        role: 'assistant',
        content: text,
        type: 'chat',
      });
      return { type: 'chat', text, profileRequired: true };
    }

    // 将历史卡片消息标记为已取消
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

  // ==================== 统计查询 ====================

  async getDailyStats(
    openid: string,
  ): Promise<{ totalCalories: number; meals: MealRecord[] }> {
    const meals = await this.db.getTodaysMeals(openid);
    const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
    return { totalCalories, meals };
  }

  async getWeeklyReport(
    openid: string,
    targetCalories: number,
    userProfile?: UserProfile,
  ): Promise<{ report: string; meals: MealRecord[]; totalCalories: number }> {
    const meals = await this.db.getWeeklyMeals(openid);
    const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
    const report = await this.generateWeeklyReport(
      meals,
      targetCalories,
      userProfile,
    );
    return { report, meals, totalCalories };
  }

  async getChatHistory(openid: string) {
    return this.db.getChatHistory(openid);
  }

  /** 小程序进入时拉取：是否已建档 + 每日热量目标 */
  async getUserProfileForClient(openid: string): Promise<{
    hasProfile: boolean;
    targetCalories: number;
    profile?: UserHealthProfile;
  }> {
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

  // ==================== 图片识别 ====================

  async getBaiduAccessToken(): Promise<string> {
    if (this.baiduAccessToken && Date.now() < this.tokenExpiry) {
      return this.baiduAccessToken;
    }
    const res = await axios.post(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.baiduAk}&client_secret=${this.baiduSk}`,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    this.baiduAccessToken = res.data.access_token as string;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const expiresIn = res.data.expires_in as number;
    this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
    return this.baiduAccessToken;
  }

  /**
   * 菜品识别：使用 /v2/dish 接口，返回置信度最高的菜品名称列表。
   * 取置信度 > 0.2 的前 3 个候选。
   */
  async recognizeMultipleObjects(imageBase64: string): Promise<string[]> {
    interface DishItem {
      name: string;
      probability: number;
    }

    try {
      const token = await this.getBaiduAccessToken();
      const params = new URLSearchParams({ image: imageBase64 });

      console.log(
        '[Baidu] 调用菜品识别接口，图片大小:',
        imageBase64.length,
        'chars',
      );
      const res = await axios.post(
        `https://aip.baidubce.com/rest/2.0/image-classify/v2/dish?access_token=${token}`,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const raw = res.data.result as DishItem[] | undefined;
      console.log(
        '[Baidu] 菜品识别原始结果（前5条）:',
        JSON.stringify(raw?.slice(0, 5)),
      );

      if (!raw || raw.length === 0) {
        console.log('[Baidu] 无识别结果');
        return [];
      }

      const dishes = raw.filter((item) => item.probability > 0.2).slice(0, 3);
      console.log(
        '[Baidu] 识别到菜品:',
        dishes
          .map((i) => `${i.name}(${(i.probability * 100).toFixed(1)}%)`)
          .join('、'),
      );

      return dishes.map((i) => i.name);
    } catch (err) {
      console.error(
        '[Baidu] 菜品识别失败:',
        err instanceof Error ? err.message : String(err),
      );
      return [];
    }
  }

  async analyzeImage(
    imageBase64: string,
    openid?: string,
    userProfile?: UserProfile,
  ): Promise<ChatResponse> {
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
          profileGuide: guide.profileGuide as object,
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
          profileGuide: guide.profileGuide as object,
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

    // 走食物记录流程（分量模糊，需询问具体克数）
    const mealType = this.getMealType();
    const feedback = await this.generateMealFeedback(
      foodName,
      mealType,
      userProfile,
    );
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
}
