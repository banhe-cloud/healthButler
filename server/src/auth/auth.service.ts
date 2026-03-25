import { Injectable, BadRequestException } from '@nestjs/common';
import axios from 'axios';

const WECHAT_URL = 'https://api.weixin.qq.com/sns/jscode2session';

export interface LoginResult {
  openid: string;
  session_key?: string;
}

@Injectable()
export class AuthService {
  async code2Openid(code: string): Promise<LoginResult> {
    const appId = process.env.WECHAT_APPID;
    const appSecret = process.env.WECHAT_APP_SECRET;
    if (!appId || !appSecret) {
      throw new BadRequestException('服务端未配置微信小程序');
    }

    const url = `${WECHAT_URL}?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`;
    const res = await axios.get(url, { timeout: 5000 });

    if (res.data.errcode) {
      const msg = `微信登录失败 errcode=${res.data.errcode} errmsg=${res.data.errmsg}`;
      console.error('[AuthService]', msg);
      throw new BadRequestException(msg);
    }
    return { openid: res.data.openid, session_key: res.data.session_key };
  }
}
