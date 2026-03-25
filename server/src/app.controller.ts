import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('debug/db')
  async debugDb() {
    const records = await this.db.getRecentRecords(20);
    return { count: records.length, sample: records };
  }

  @Get('debug/env')
  debugEnv() {
    const key = process.env.MINIMAX_API_KEY;
    return {
      hasKey: !!key,
      keyPrefix: key ? key.slice(0, 20) + '...' : null,
      model: process.env.MINIMAX_MODEL,
    };
  }
}
