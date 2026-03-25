import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ChatService, CardData, ProfilePlanCardData } from './chat.service';
import { UserProfile } from './system-prompt';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * GET /chat/history?openid=xxx
   * 拉取用户聊天记录（用于恢复对话）
   */
  /**
   * GET /chat/user-profile?openid=xxx
   * 是否已建档及每日目标（小程序同步 targetCalories）
   */
  @Get('user-profile')
  async getUserProfile(@Query('openid') openid: string) {
    if (!openid?.trim()) {
      throw new BadRequestException('openid 不能为空');
    }
    return this.chatService.getUserProfileForClient(openid.trim());
  }

  @Get('history')
  async getHistory(@Query('openid') openid: string) {
    if (!openid?.trim()) {
      throw new BadRequestException('openid 不能为空');
    }
    return this.chatService.getChatHistory(openid.trim());
  }

  /**
   * POST /chat/message
   * 发送文本消息，后端状态机驱动对话流程
   * body: { message, openid?, targetCalories?, userProfile? }
   */
  @Post('message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Body()
    body: {
      message: string;
      openid?: string;
      targetCalories?: number;
      userProfile?: UserProfile;
      // history 字段保留兼容性，但后端不再使用（状态由服务端维护）
      history?: unknown[];
      dailyIntake?: number;
    },
  ) {
    if (!body.message?.trim()) {
      throw new BadRequestException('消息内容不能为空');
    }
    return this.chatService.processMessage(
      body.message.trim(),
      body.openid?.trim(),
      body.targetCalories ?? 1800,
      body.userProfile,
    );
  }

  /**
   * POST /chat/confirm
   * 用户确认营养卡片，保存餐食记录并返回今日饮食建议
   * body: { openid, card, targetCalories?, userProfile? }
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirmMeal(
    @Body()
    body: {
      openid: string;
      card: CardData;
      targetCalories?: number;
      userProfile?: UserProfile;
    },
  ) {
    if (!body.openid?.trim()) {
      throw new BadRequestException('openid 不能为空');
    }
    if (!body.card) {
      throw new BadRequestException('card 数据不能为空');
    }
    return this.chatService.confirmMeal(
      body.openid.trim(),
      body.card,
      body.targetCalories ?? 1800,
      body.userProfile,
    );
  }

  /**
   * POST /chat/reject
   * 用户取消营养卡片
   * body: { openid }
   */
  /**
   * POST /chat/confirm-profile
   * 确认档案与每日摄入计划
   */
  @Post('confirm-profile')
  @HttpCode(HttpStatus.OK)
  async confirmProfile(
    @Body()
    body: {
      openid: string;
      plan: ProfilePlanCardData;
    },
  ) {
    if (!body.openid?.trim()) {
      throw new BadRequestException('openid 不能为空');
    }
    if (!body.plan || body.plan.cardKind !== 'profile_plan') {
      throw new BadRequestException('档案卡片数据无效');
    }
    return this.chatService.confirmProfilePlan(body.openid.trim(), body.plan);
  }

  @Post('reject')
  @HttpCode(HttpStatus.OK)
  async rejectMeal(
    @Body()
    body: {
      openid: string;
    },
  ) {
    if (!body.openid?.trim()) {
      throw new BadRequestException('openid 不能为空');
    }
    return this.chatService.rejectMeal(body.openid.trim());
  }

  /**
   * GET /chat/daily-stats?openid=xxx
   * 获取今日餐食统计（热量、各餐详情）
   */
  @Get('daily-stats')
  async getDailyStats(@Query('openid') openid: string) {
    if (!openid?.trim()) {
      throw new BadRequestException('openid 不能为空');
    }
    return this.chatService.getDailyStats(openid.trim());
  }

  /**
   * GET /chat/weekly-report?openid=xxx&targetCalories=1800
   * 获取本周饮食报告
   */
  @Get('weekly-report')
  async getWeeklyReport(
    @Query('openid') openid: string,
    @Query('targetCalories') targetCalories?: string,
    @Query('userProfile') userProfileStr?: string,
  ) {
    if (!openid?.trim()) {
      throw new BadRequestException('openid 不能为空');
    }
    let userProfile: UserProfile | undefined;
    if (userProfileStr) {
      try {
        userProfile = JSON.parse(userProfileStr) as UserProfile;
      } catch {
        // 忽略解析失败
      }
    }
    return this.chatService.getWeeklyReport(
      openid.trim(),
      parseInt(targetCalories ?? '1800', 10),
      userProfile,
    );
  }

  /**
   * POST /chat/image
   * 小程序图片分析入口（multipart/form-data）
   * field: image（文件）, openid, targetCalories, userProfile
   */
  @Post('image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async analyzeImage(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      dailyIntake?: string;
      targetCalories?: string;
      openid?: string;
      userProfile?: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('请上传食物图片');
    }
    let userProfile: UserProfile | undefined;
    if (body.userProfile) {
      try {
        userProfile = JSON.parse(body.userProfile) as UserProfile;
      } catch {
        // 忽略解析失败
      }
    }
    const imageBase64 = file.buffer.toString('base64');
    return this.chatService.analyzeImage(
      imageBase64,
      body.openid?.trim(),
      userProfile,
    );
  }
}
