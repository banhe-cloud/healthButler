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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const chat_service_1 = require("./chat.service");
let ChatController = class ChatController {
    chatService;
    constructor(chatService) {
        this.chatService = chatService;
    }
    async getUserProfile(openid) {
        if (!openid?.trim()) {
            throw new common_1.BadRequestException('openid 不能为空');
        }
        return this.chatService.getUserProfileForClient(openid.trim());
    }
    async getHistory(openid) {
        if (!openid?.trim()) {
            throw new common_1.BadRequestException('openid 不能为空');
        }
        return this.chatService.getChatHistory(openid.trim());
    }
    async sendMessage(body) {
        if (!body.message?.trim()) {
            throw new common_1.BadRequestException('消息内容不能为空');
        }
        return this.chatService.processMessage(body.message.trim(), body.openid?.trim(), body.targetCalories ?? 1800, body.userProfile);
    }
    async confirmMeal(body) {
        if (!body.openid?.trim()) {
            throw new common_1.BadRequestException('openid 不能为空');
        }
        if (!body.card) {
            throw new common_1.BadRequestException('card 数据不能为空');
        }
        return this.chatService.confirmMeal(body.openid.trim(), body.card, body.targetCalories ?? 1800, body.userProfile);
    }
    async confirmProfile(body) {
        if (!body.openid?.trim()) {
            throw new common_1.BadRequestException('openid 不能为空');
        }
        if (!body.plan || body.plan.cardKind !== 'profile_plan') {
            throw new common_1.BadRequestException('档案卡片数据无效');
        }
        return this.chatService.confirmProfilePlan(body.openid.trim(), body.plan);
    }
    async rejectMeal(body) {
        if (!body.openid?.trim()) {
            throw new common_1.BadRequestException('openid 不能为空');
        }
        return this.chatService.rejectMeal(body.openid.trim());
    }
    async getDailyStats(openid) {
        if (!openid?.trim()) {
            throw new common_1.BadRequestException('openid 不能为空');
        }
        return this.chatService.getDailyStats(openid.trim());
    }
    async getWeeklyReport(openid, targetCalories, userProfileStr) {
        if (!openid?.trim()) {
            throw new common_1.BadRequestException('openid 不能为空');
        }
        let userProfile;
        if (userProfileStr) {
            try {
                userProfile = JSON.parse(userProfileStr);
            }
            catch {
            }
        }
        return this.chatService.getWeeklyReport(openid.trim(), parseInt(targetCalories ?? '1800', 10), userProfile);
    }
    async analyzeImage(file, body) {
        if (!file) {
            throw new common_1.BadRequestException('请上传食物图片');
        }
        let userProfile;
        if (body.userProfile) {
            try {
                userProfile = JSON.parse(body.userProfile);
            }
            catch {
            }
        }
        const imageBase64 = file.buffer.toString('base64');
        return this.chatService.analyzeImage(imageBase64, body.openid?.trim(), userProfile);
    }
};
exports.ChatController = ChatController;
__decorate([
    (0, common_1.Get)('user-profile'),
    __param(0, (0, common_1.Query)('openid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getUserProfile", null);
__decorate([
    (0, common_1.Get)('history'),
    __param(0, (0, common_1.Query)('openid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Post)('message'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "sendMessage", null);
__decorate([
    (0, common_1.Post)('confirm'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "confirmMeal", null);
__decorate([
    (0, common_1.Post)('confirm-profile'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "confirmProfile", null);
__decorate([
    (0, common_1.Post)('reject'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "rejectMeal", null);
__decorate([
    (0, common_1.Get)('daily-stats'),
    __param(0, (0, common_1.Query)('openid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getDailyStats", null);
__decorate([
    (0, common_1.Get)('weekly-report'),
    __param(0, (0, common_1.Query)('openid')),
    __param(1, (0, common_1.Query)('targetCalories')),
    __param(2, (0, common_1.Query)('userProfile')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getWeeklyReport", null);
__decorate([
    (0, common_1.Post)('image'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('image', {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: 10 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "analyzeImage", null);
exports.ChatController = ChatController = __decorate([
    (0, common_1.Controller)('chat'),
    __metadata("design:paramtypes", [chat_service_1.ChatService])
], ChatController);
//# sourceMappingURL=chat.controller.js.map