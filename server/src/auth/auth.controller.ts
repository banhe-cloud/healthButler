import { Controller, Post, Body, BadRequestException, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/login
   * 小程序传 code，返回 openid
   */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { code: string }) {
    console.log('[AuthController] POST /auth/login code=', body.code?.slice(0, 10), '...');
    if (!body.code?.trim()) {
      throw new BadRequestException('code 不能为空');
    }
    return this.authService.code2Openid(body.code.trim());
  }
}
