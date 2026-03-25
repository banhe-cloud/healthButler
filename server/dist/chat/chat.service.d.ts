import { DatabaseService, MealRecord } from '../database/database.service';
import { UserProfile } from './system-prompt';
import { type FitnessGoal, type Gender } from './profile-plan.util';
import { UserHealthProfile } from '../database/database.service';
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
export interface ProfilePlanCardData {
    cardKind: 'profile_plan';
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
export type ProfileGuideVariant = 'missing' | 'blocked_food' | 'blocked_image' | 'pending_card' | 'pending_edit_card';
export interface ProfileGuidePayload {
    variant: ProfileGuideVariant;
    missingFields?: string[];
}
export interface SummaryMetricRow {
    key: string;
    label: string;
    current: number;
    target: number;
    unit: string;
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
    followUp?: string;
    nutrition?: NutritionData;
    card?: CardData;
    profilePlanCard?: ProfilePlanCardData;
    suggestion?: string;
    recognizedFood?: string;
    mealId?: string;
    targetCalories?: number;
    profileRequired?: boolean;
    profileGuide?: ProfileGuidePayload;
    summaryCard?: SummaryCardData;
}
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}
export declare class ChatService {
    private readonly db;
    private readonly llm;
    private baiduAccessToken;
    private tokenExpiry;
    constructor(db: DatabaseService);
    private get baiduAk();
    private get baiduSk();
    private callAI;
    private parseJSON;
    private getMealType;
    private extractIntent;
    private calculateNutrition;
    private generateMealFeedback;
    private askForPortions;
    private generateDailyAdvice;
    private generateGeneralReply;
    private generateWeeklyReport;
    private barPercent;
    private macroTargets;
    private aggregateMeals;
    private summaryProfileContext;
    private summaryBehaviorToday;
    private summaryBehaviorWeek;
    private handleDailySummary;
    private handleWeeklySummary;
    private mergeDraft;
    private profileMissingList;
    private profileDraftFromHp;
    private profilePatchHasValues;
    private profileHpEqualsDraft;
    private composeProfilePlanCardFromDraft;
    private buildProfileViewCard;
    private handleProfileEditForUser;
    private extractProfilePatch;
    private extractPlanAdjustment;
    private healthToUserProfile;
    private profileGuideResponse;
    private handlePlanAdjustment;
    private handleProfileConversation;
    processMessage(message: string, openid?: string, targetCalories?: number, userProfile?: UserProfile): Promise<ChatResponse>;
    private _handleFoodLog;
    private _handlePortionDetail;
    private _calculateAndReturnCard;
    confirmMeal(openid: string, card: CardData, targetCalories: number, userProfile?: UserProfile): Promise<ChatResponse>;
    confirmProfilePlan(openid: string, plan: ProfilePlanCardData): Promise<ChatResponse>;
    rejectMeal(openid: string): Promise<ChatResponse>;
    getDailyStats(openid: string): Promise<{
        totalCalories: number;
        meals: MealRecord[];
    }>;
    getWeeklyReport(openid: string, targetCalories: number, userProfile?: UserProfile): Promise<{
        report: string;
        meals: MealRecord[];
        totalCalories: number;
    }>;
    getChatHistory(openid: string): Promise<import("../database/database.service").ChatRecord[]>;
    getUserProfileForClient(openid: string): Promise<{
        hasProfile: boolean;
        targetCalories: number;
        profile?: UserHealthProfile;
    }>;
    getBaiduAccessToken(): Promise<string>;
    recognizeMultipleObjects(imageBase64: string): Promise<string[]>;
    analyzeImage(imageBase64: string, openid?: string, userProfile?: UserProfile): Promise<ChatResponse>;
}
