"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const common_1 = require("@nestjs/common");
const node_sdk_1 = __importDefault(require("@cloudbase/node-sdk"));
let DatabaseService = class DatabaseService {
    app;
    db;
    async onModuleInit() {
        this.app = node_sdk_1.default.init({
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
    async ensureCollection(name) {
        try {
            await this.db.createCollection(name);
            console.log(`[DatabaseService] collection "${name}" created`);
        }
        catch (e) {
            const code = e?.code;
            const msg = e?.message;
            if (![
                'DATABASE_COLLECTION_EXIST',
                'DATABASE_COLLECTION_ALREADY_EXIST',
            ].includes(code ?? '')) {
                console.error(`[DatabaseService] ensureCollection error:`, msg ?? e);
            }
        }
    }
    get chatCollection() {
        return this.db.collection('chat_records');
    }
    get mealCollection() {
        return this.db.collection('confirmed_meals');
    }
    get stateCollection() {
        return this.db.collection('user_states');
    }
    get profileCollection() {
        return this.db.collection('user_profiles');
    }
    async getUserHealthProfile(openid) {
        try {
            const res = await this.profileCollection.where({ openid }).limit(1).get();
            const list = (res.data || []);
            return list.length > 0 ? list[0] : null;
        }
        catch (e) {
            console.error('[DatabaseService] getUserHealthProfile error:', e);
            return null;
        }
    }
    async upsertUserHealthProfile(profile) {
        try {
            const existing = await this.profileCollection
                .where({ openid: profile.openid })
                .limit(1)
                .get();
            const now = new Date();
            const record = {
                ...profile,
                profileConfirmedAt: profile.profileConfirmedAt ?? now,
                updatedAt: now,
            };
            if (existing.data && existing.data.length > 0) {
                const id = existing.data[0]._id;
                await this.profileCollection.doc(id).update({
                    ...record,
                    updatedAt: now,
                });
            }
            else {
                await this.profileCollection.add(record);
            }
        }
        catch (e) {
            console.error('[DatabaseService] upsertUserHealthProfile error:', e);
        }
    }
    async patchUserHealthProfile(openid, patch) {
        try {
            const existing = await this.profileCollection
                .where({ openid })
                .limit(1)
                .get();
            if (!existing.data || existing.data.length === 0)
                return;
            const id = existing.data[0]._id;
            await this.profileCollection.doc(id).update({
                ...patch,
                updatedAt: new Date(),
            });
        }
        catch (e) {
            console.error('[DatabaseService] patchUserHealthProfile error:', e);
        }
    }
    async saveChatRecord(record) {
        console.log('[DatabaseService] saving record openid=', record.openid, 'role=', record.role);
        try {
            await this.chatCollection.add({ ...record, createdAt: new Date() });
            console.log('[DatabaseService] save OK');
        }
        catch (e) {
            const code = e?.code;
            if (code === 'EXCEED_REQUEST_LIMIT') {
                console.warn('[DatabaseService] CloudBase 写入配额已用完，本条记录未保存。功能正常，可在控制台升级套餐。');
            }
            else {
                console.error('[DatabaseService] saveChatRecord error:', e);
            }
        }
    }
    async getChatHistory(openid, limit = 50) {
        try {
            const res = await this.chatCollection
                .where({ openid })
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();
            const list = (res.data || []);
            return list.reverse();
        }
        catch (e) {
            console.error('[DatabaseService] getChatHistory error:', e);
            return [];
        }
    }
    async getRecentRecords(limit = 20) {
        try {
            const res = await this.chatCollection.limit(limit).get();
            return (res.data || []);
        }
        catch (e) {
            console.error('[DatabaseService] getRecentRecords error:', e);
            return [];
        }
    }
    async updateLatestCardStatus(openid, status, mealId) {
        try {
            const res = await this.chatCollection
                .where({ openid, role: 'assistant' })
                .orderBy('createdAt', 'desc')
                .limit(15)
                .get();
            const rows = (res.data || []);
            const latest = rows.find((r) => r.type === 'card' || r.type === 'profile_plan');
            if (!latest?._id)
                return;
            const docId = latest._id;
            const update = { cardStatus: status };
            if (mealId)
                update.mealId = mealId;
            await this.chatCollection.doc(docId).update(update);
        }
        catch (e) {
            console.error('[DatabaseService] updateLatestCardStatus error:', e);
        }
    }
    async getUserState(openid) {
        try {
            const res = await this.stateCollection.where({ openid }).limit(1).get();
            const list = (res.data || []);
            return list.length > 0 ? list[0] : null;
        }
        catch (e) {
            console.error('[DatabaseService] getUserState error:', e);
            return null;
        }
    }
    async setUserState(openid, state) {
        try {
            const existing = await this.stateCollection
                .where({ openid })
                .limit(1)
                .get();
            const record = { ...state, openid, updatedAt: new Date() };
            if (existing.data && existing.data.length > 0) {
                const id = existing.data[0]._id;
                await this.stateCollection.doc(id).update(record);
            }
            else {
                await this.stateCollection.add(record);
            }
        }
        catch (e) {
            console.error('[DatabaseService] setUserState error:', e);
        }
    }
    async clearUserState(openid) {
        await this.setUserState(openid, {
            conversationState: 'idle',
            pendingFoodName: undefined,
            pendingPortions: undefined,
            pendingCard: undefined,
            profileDraft: undefined,
        });
    }
    async saveMealRecord(record) {
        try {
            await this.mealCollection.add({ ...record, confirmedAt: new Date() });
            console.log('[DatabaseService] meal saved ok, mealId=', record.mealId);
        }
        catch (e) {
            console.error('[DatabaseService] saveMealRecord error:', e);
        }
    }
    async getMealById(mealId) {
        try {
            const res = await this.mealCollection.where({ mealId }).limit(1).get();
            const list = (res.data || []);
            return list.length > 0 ? list[0] : null;
        }
        catch (e) {
            console.error('[DatabaseService] getMealById error:', e);
            return null;
        }
    }
    async getTodaysMeals(openid) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const res = await this.mealCollection
                .where({ openid, confirmedAt: this.db.command.gte(today) })
                .orderBy('confirmedAt', 'asc')
                .get();
            return (res.data || []);
        }
        catch (e) {
            console.error('[DatabaseService] getTodaysMeals error:', e);
            return [];
        }
    }
    async getWeeklyMeals(openid) {
        try {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            weekAgo.setHours(0, 0, 0, 0);
            const res = await this.mealCollection
                .where({ openid, confirmedAt: this.db.command.gte(weekAgo) })
                .orderBy('confirmedAt', 'asc')
                .get();
            return (res.data || []);
        }
        catch (e) {
            console.error('[DatabaseService] getWeeklyMeals error:', e);
            return [];
        }
    }
};
exports.DatabaseService = DatabaseService;
exports.DatabaseService = DatabaseService = __decorate([
    (0, common_1.Injectable)()
], DatabaseService);
//# sourceMappingURL=database.service.js.map