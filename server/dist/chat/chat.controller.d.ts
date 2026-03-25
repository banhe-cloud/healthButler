import { ChatService, CardData, ProfilePlanCardData } from './chat.service';
import { UserProfile } from './system-prompt';
export declare class ChatController {
    private readonly chatService;
    constructor(chatService: ChatService);
    getUserProfile(openid: string): Promise<{
        hasProfile: boolean;
        targetCalories: number;
        profile?: import("../database/database.service").UserHealthProfile;
    }>;
    getHistory(openid: string): Promise<import("../database/database.service").ChatRecord[]>;
    sendMessage(body: {
        message: string;
        openid?: string;
        targetCalories?: number;
        userProfile?: UserProfile;
        history?: unknown[];
        dailyIntake?: number;
    }): Promise<import("./chat.service").ChatResponse>;
    confirmMeal(body: {
        openid: string;
        card: CardData;
        targetCalories?: number;
        userProfile?: UserProfile;
    }): Promise<import("./chat.service").ChatResponse>;
    confirmProfile(body: {
        openid: string;
        plan: ProfilePlanCardData;
    }): Promise<import("./chat.service").ChatResponse>;
    rejectMeal(body: {
        openid: string;
    }): Promise<import("./chat.service").ChatResponse>;
    getDailyStats(openid: string): Promise<{
        totalCalories: number;
        meals: import("../database/database.service").MealRecord[];
    }>;
    getWeeklyReport(openid: string, targetCalories?: string, userProfileStr?: string): Promise<{
        report: string;
        meals: import("../database/database.service").MealRecord[];
        totalCalories: number;
    }>;
    analyzeImage(file: Express.Multer.File, body: {
        dailyIntake?: string;
        targetCalories?: string;
        openid?: string;
        userProfile?: string;
    }): Promise<import("./chat.service").ChatResponse>;
}
