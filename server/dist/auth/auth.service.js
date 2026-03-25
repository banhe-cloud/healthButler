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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const WECHAT_URL = 'https://api.weixin.qq.com/sns/jscode2session';
let AuthService = class AuthService {
    async code2Openid(code) {
        const appId = process.env.WECHAT_APPID;
        const appSecret = process.env.WECHAT_APP_SECRET;
        if (!appId || !appSecret) {
            throw new common_1.BadRequestException('服务端未配置微信小程序');
        }
        const url = `${WECHAT_URL}?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`;
        const res = await axios_1.default.get(url, { timeout: 5000 });
        if (res.data.errcode) {
            const msg = `微信登录失败 errcode=${res.data.errcode} errmsg=${res.data.errmsg}`;
            console.error('[AuthService]', msg);
            throw new common_1.BadRequestException(msg);
        }
        return { openid: res.data.openid, session_key: res.data.session_key };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)()
], AuthService);
//# sourceMappingURL=auth.service.js.map