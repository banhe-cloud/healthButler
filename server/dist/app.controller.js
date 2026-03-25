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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppController = void 0;
const common_1 = require("@nestjs/common");
const app_service_1 = require("./app.service");
const database_service_1 = require("./database/database.service");
let AppController = class AppController {
    appService;
    db;
    constructor(appService, db) {
        this.appService = appService;
        this.db = db;
    }
    getHello() {
        return this.appService.getHello();
    }
    async debugDb() {
        const records = await this.db.getRecentRecords(20);
        return { count: records.length, sample: records };
    }
    debugEnv() {
        const key = process.env.MINIMAX_API_KEY;
        return {
            hasKey: !!key,
            keyPrefix: key ? key.slice(0, 20) + '...' : null,
            model: process.env.MINIMAX_MODEL,
        };
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", String)
], AppController.prototype, "getHello", null);
__decorate([
    (0, common_1.Get)('debug/db'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "debugDb", null);
__decorate([
    (0, common_1.Get)('debug/env'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "debugEnv", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [app_service_1.AppService,
        database_service_1.DatabaseService])
], AppController);
//# sourceMappingURL=app.controller.js.map