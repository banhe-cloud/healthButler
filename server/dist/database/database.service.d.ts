import { OnModuleInit } from '@nestjs/common';
export interface ChatRecord {
    openid: string;
    role: 'user' | 'assistant';
    content: string;
    type?: string;
    nutrition?: object;
    card?: object;
    cardStatus?: 'confirmed' | 'rejected';
    mealId?: string;
    suggestion?: string;
    recognizedFood?: string;
    profileGuide?: object;
    createdAt: Date;
}
export interface MealRecord {
    mealId: string;
    openid: string;
    foodName: string;
    quantity: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    purine: number;
    healthReminder: string;
    mealType: string;
    confirmedAt: Date;
}
export type FitnessGoal = 'fat_loss' | 'maintain' | 'muscle';
export interface UserHealthProfile {
    openid: string;
    heightCm: number;
    weightKg: number;
    gender: 'male' | 'female';
    age?: number;
    diseases?: string;
    allergies?: string;
    goal: FitnessGoal;
    bmi?: number;
    bmiCategory?: string;
    dailyCalories: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    fiberMinG: number;
    vegetablesMinG: number;
    fruitMinG: number;
    fruitMaxG: number;
    fatCalorieRatio?: number;
    profileConfirmedAt: Date;
    updatedAt: Date;
}
export interface ProfileDraft {
    heightCm?: number;
    weightKg?: number;
    gender?: 'male' | 'female';
    age?: number;
    diseases?: string;
    allergies?: string;
    goal?: FitnessGoal;
}
export interface UserConversationState {
    openid: string;
    conversationState: 'idle' | 'waiting_for_portions' | 'pending_confirm' | 'collecting_profile' | 'pending_profile_plan_confirm' | 'pending_profile_edit_confirm';
    pendingFoodName?: string;
    pendingPortions?: string;
    pendingCard?: object;
    profileDraft?: ProfileDraft;
    updatedAt: Date;
}
export declare class DatabaseService implements OnModuleInit {
    private app;
    private db;
    onModuleInit(): Promise<void>;
    private ensureCollection;
    private get chatCollection();
    private get mealCollection();
    private get stateCollection();
    private get profileCollection();
    getUserHealthProfile(openid: string): Promise<UserHealthProfile | null>;
    upsertUserHealthProfile(profile: Omit<UserHealthProfile, 'updatedAt' | 'profileConfirmedAt'> & {
        profileConfirmedAt?: Date;
    }): Promise<void>;
    patchUserHealthProfile(openid: string, patch: Partial<Pick<UserHealthProfile, 'dailyCalories' | 'proteinG' | 'fatG' | 'carbsG' | 'fatCalorieRatio' | 'weightKg'>>): Promise<void>;
    saveChatRecord(record: Omit<ChatRecord, 'createdAt'>): Promise<void>;
    getChatHistory(openid: string, limit?: number): Promise<ChatRecord[]>;
    getRecentRecords(limit?: number): Promise<ChatRecord[]>;
    updateLatestCardStatus(openid: string, status: 'confirmed' | 'rejected', mealId?: string): Promise<void>;
    getUserState(openid: string): Promise<UserConversationState | null>;
    setUserState(openid: string, state: Partial<Omit<UserConversationState, 'openid' | 'updatedAt'>>): Promise<void>;
    clearUserState(openid: string): Promise<void>;
    saveMealRecord(record: Omit<MealRecord, 'confirmedAt'>): Promise<void>;
    getMealById(mealId: string): Promise<MealRecord | null>;
    getTodaysMeals(openid: string): Promise<MealRecord[]>;
    getWeeklyMeals(openid: string): Promise<MealRecord[]>;
}
