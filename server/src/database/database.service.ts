import { Injectable, OnModuleInit } from '@nestjs/common';
import cloudbase from '@cloudbase/node-sdk';

export interface ChatRecord {
  openid: string;
  role: 'user' | 'assistant';
  content: string;
  type?: string;
  /** 已记录的营养数据（type=nutrition 时） */
  nutrition?: object;
  /** 待确认卡片数据（type=card 时），用于历史记录还原 */
  card?: object;
  /** 卡片状态：confirmed=已确认 rejected=已取消（历史记录展示用） */
  cardStatus?: 'confirmed' | 'rejected';
  /** 关联的已确认餐食记录 ID */
  mealId?: string;
  suggestion?: string;
  recognizedFood?: string;
  /** type=profile_guide 时的结构化展示数据 */
  profileGuide?: object;
  createdAt: Date;
}

/**
 * 已确认餐食记录（confirmed_meals 集合）
 * 每条记录代表用户点击「确认记录」后的一次饮食
 */
export interface MealRecord {
  /** 唯一餐食 ID（UUID，不可变） */
  mealId: string;
  /** 用户标识 */
  openid: string;
  /** 食物名称 */
  foodName: string;
  /** 具体分量描述 */
  quantity: string;
  /** 热量 kcal */
  calories: number;
  /** 蛋白质 g */
  protein: number;
  /** 碳水化合物 g */
  carbs: number;
  /** 脂肪 g */
  fat: number;
  /** 膳食纤维 g */
  fiber: number;
  /** 嘌呤 mg */
  purine: number;
  /** 健康提示 */
  healthReminder: string;
  /** 餐次：早饭/午饭/下午茶/晚饭/夜宵 */
  mealType: string;
  /** 用户确认时间 */
  confirmedAt: Date;
}

export type FitnessGoal = 'fat_loss' | 'maintain' | 'muscle';

/** 用户健康档案（user_profiles 集合） */
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
  conversationState:
    | 'idle'
    | 'waiting_for_portions'
    | 'pending_confirm'
    | 'collecting_profile'
    | 'pending_profile_plan_confirm'
    /** 已建档用户修改档案，待确认更新卡片 */
    | 'pending_profile_edit_confirm';
  pendingFoodName?: string;
  pendingPortions?: string;
  pendingCard?: object;
  /** 档案填写草稿 */
  profileDraft?: ProfileDraft;
  updatedAt: Date;
}

@Injectable()
export class DatabaseService implements OnModuleInit {
  private app: ReturnType<typeof cloudbase.init>;
  private db: ReturnType<ReturnType<typeof cloudbase.init>['database']>;

  async onModuleInit() {
    this.app = cloudbase.init({
      env: process.env.CLOUDBASE_ENV_ID,
      secretId: process.env.CLOUDBASE_SECRET_ID,
      secretKey: process.env.CLOUDBASE_SECRET_KEY,
    });
    this.db = this.app.database();
    await this.ensureCollection('chat_records');
    await this.ensureCollection('confirmed_meals');
    await this.ensureCollection('user_states');
    await this.ensureCollection('user_profiles');
  }

  private async ensureCollection(name: string) {
    try {
      await this.db.createCollection(name);
      console.log(`[DatabaseService] collection "${name}" created`);
    } catch (e: any) {
      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      const code = e?.code as string | undefined;
      const msg = e?.message as string | undefined;
      /* eslint-enable @typescript-eslint/no-unsafe-member-access */
      if (
        ![
          'DATABASE_COLLECTION_EXIST',
          'DATABASE_COLLECTION_ALREADY_EXIST',
        ].includes(code ?? '')
      ) {
        console.error(`[DatabaseService] ensureCollection error:`, msg ?? e);
      }
    }
  }

  private get chatCollection() {
    return this.db.collection('chat_records');
  }

  private get mealCollection() {
    return this.db.collection('confirmed_meals');
  }

  private get stateCollection() {
    return this.db.collection('user_states');
  }

  private get profileCollection() {
    return this.db.collection('user_profiles');
  }

  // ==================== User Health Profile ====================

  async getUserHealthProfile(
    openid: string,
  ): Promise<UserHealthProfile | null> {
    try {
      const res = await this.profileCollection.where({ openid }).limit(1).get();
      const list = (res.data || []) as UserHealthProfile[];
      return list.length > 0 ? list[0] : null;
    } catch (e) {
      console.error('[DatabaseService] getUserHealthProfile error:', e);
      return null;
    }
  }

  async upsertUserHealthProfile(
    profile: Omit<UserHealthProfile, 'updatedAt' | 'profileConfirmedAt'> & {
      profileConfirmedAt?: Date;
    },
  ): Promise<void> {
    try {
      const existing = await this.profileCollection
        .where({ openid: profile.openid })
        .limit(1)
        .get();
      const now = new Date();
      const record: UserHealthProfile = {
        ...profile,
        profileConfirmedAt: profile.profileConfirmedAt ?? now,
        updatedAt: now,
      };
      if (existing.data && existing.data.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const id = existing.data[0]._id as string;
        await this.profileCollection.doc(id).update({
          ...record,
          updatedAt: now,
        });
      } else {
        await this.profileCollection.add(record);
      }
    } catch (e) {
      console.error('[DatabaseService] upsertUserHealthProfile error:', e);
    }
  }

  async patchUserHealthProfile(
    openid: string,
    patch: Partial<
      Pick<
        UserHealthProfile,
        | 'dailyCalories'
        | 'proteinG'
        | 'fatG'
        | 'carbsG'
        | 'fatCalorieRatio'
        | 'weightKg'
      >
    >,
  ): Promise<void> {
    try {
      const existing = await this.profileCollection
        .where({ openid })
        .limit(1)
        .get();
      if (!existing.data || existing.data.length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const id = existing.data[0]._id as string;
      await this.profileCollection.doc(id).update({
        ...patch,
        updatedAt: new Date(),
      });
    } catch (e) {
      console.error('[DatabaseService] patchUserHealthProfile error:', e);
    }
  }

  // ==================== Chat Records ====================

  async saveChatRecord(record: Omit<ChatRecord, 'createdAt'>): Promise<void> {
    console.log(
      '[DatabaseService] saving record openid=',
      record.openid,
      'role=',
      record.role,
    );
    try {
      await this.chatCollection.add({ ...record, createdAt: new Date() });
      console.log('[DatabaseService] save OK');
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'EXCEED_REQUEST_LIMIT') {
        console.warn(
          '[DatabaseService] CloudBase 写入配额已用完，本条记录未保存。功能正常，可在控制台升级套餐。',
        );
      } else {
        console.error('[DatabaseService] saveChatRecord error:', e);
      }
    }
  }

  async getChatHistory(openid: string, limit = 50): Promise<ChatRecord[]> {
    try {
      const res = await this.chatCollection
        .where({ openid })
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      const list = (res.data || []) as ChatRecord[];
      return list.reverse();
    } catch (e) {
      console.error('[DatabaseService] getChatHistory error:', e);
      return [];
    }
  }

  async getRecentRecords(limit = 20): Promise<ChatRecord[]> {
    try {
      const res = await this.chatCollection.limit(limit).get();
      return (res.data || []) as ChatRecord[];
    } catch (e) {
      console.error('[DatabaseService] getRecentRecords error:', e);
      return [];
    }
  }

  /**
   * 将用户最近一条 type=card 的助手消息标记为已确认/已取消，
   * 同时写入关联的 mealId（仅 confirmed 时）。
   */
  async updateLatestCardStatus(
    openid: string,
    status: 'confirmed' | 'rejected',
    mealId?: string,
  ): Promise<void> {
    try {
      const res = await this.chatCollection
        .where({ openid, role: 'assistant' })
        .orderBy('createdAt', 'desc')
        .limit(15)
        .get();
      const rows = (res.data || []) as Array<{ _id?: string; type?: string }>;
      const latest = rows.find(
        (r) => r.type === 'card' || r.type === 'profile_plan',
      );
      if (!latest?._id) return;
      const docId = latest._id;
      const update: Record<string, unknown> = { cardStatus: status };
      if (mealId) update.mealId = mealId;
      await this.chatCollection.doc(docId).update(update);
    } catch (e) {
      console.error('[DatabaseService] updateLatestCardStatus error:', e);
    }
  }

  // ==================== User Conversation State ====================

  async getUserState(openid: string): Promise<UserConversationState | null> {
    try {
      const res = await this.stateCollection.where({ openid }).limit(1).get();
      const list = (res.data || []) as UserConversationState[];
      return list.length > 0 ? list[0] : null;
    } catch (e) {
      console.error('[DatabaseService] getUserState error:', e);
      return null;
    }
  }

  async setUserState(
    openid: string,
    state: Partial<Omit<UserConversationState, 'openid' | 'updatedAt'>>,
  ): Promise<void> {
    try {
      const existing = await this.stateCollection
        .where({ openid })
        .limit(1)
        .get();
      const record = { ...state, openid, updatedAt: new Date() };
      if (existing.data && existing.data.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const id = existing.data[0]._id as string;
        await this.stateCollection.doc(id).update(record);
      } else {
        await this.stateCollection.add(record);
      }
    } catch (e) {
      console.error('[DatabaseService] setUserState error:', e);
    }
  }

  async clearUserState(openid: string): Promise<void> {
    await this.setUserState(openid, {
      conversationState: 'idle',
      pendingFoodName: undefined,
      pendingPortions: undefined,
      pendingCard: undefined,
      profileDraft: undefined,
    });
  }

  // ==================== Confirmed Meal Records ====================

  /**
   * 保存已确认的餐食记录到 confirmed_meals 集合。
   * mealId 由调用方生成（crypto.randomUUID），confirmedAt 自动填入当前时间。
   */
  async saveMealRecord(record: Omit<MealRecord, 'confirmedAt'>): Promise<void> {
    try {
      await this.mealCollection.add({ ...record, confirmedAt: new Date() });
      console.log('[DatabaseService] meal saved ok, mealId=', record.mealId);
    } catch (e) {
      console.error('[DatabaseService] saveMealRecord error:', e);
    }
  }

  /** 按 mealId 查询单条餐食记录 */
  async getMealById(mealId: string): Promise<MealRecord | null> {
    try {
      const res = await this.mealCollection.where({ mealId }).limit(1).get();
      const list = (res.data || []) as MealRecord[];
      return list.length > 0 ? list[0] : null;
    } catch (e) {
      console.error('[DatabaseService] getMealById error:', e);
      return null;
    }
  }

  async getTodaysMeals(openid: string): Promise<MealRecord[]> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const res = await this.mealCollection
        .where({ openid, confirmedAt: this.db.command.gte(today) })
        .orderBy('confirmedAt', 'asc')
        .get();
      return (res.data || []) as MealRecord[];
    } catch (e) {
      console.error('[DatabaseService] getTodaysMeals error:', e);
      return [];
    }
  }

  async getWeeklyMeals(openid: string): Promise<MealRecord[]> {
    try {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);
      const res = await this.mealCollection
        .where({ openid, confirmedAt: this.db.command.gte(weekAgo) })
        .orderBy('confirmedAt', 'asc')
        .get();
      return (res.data || []) as MealRecord[];
    } catch (e) {
      console.error('[DatabaseService] getWeeklyMeals error:', e);
      return [];
    }
  }
}
