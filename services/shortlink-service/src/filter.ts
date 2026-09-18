/**
 * 爬虫、社媒卡片预取与无效访问过滤识别器
 */
export class BotFilter {
  private static CRAWLER_USER_AGENTS = [
    'facebookexternalhit',
    'facebot',
    'twitterbot',
    'telegrambot',
    'googlebot',
    'bingbot',
    'linkedinbot',
    'slackbot',
    'whatsapp',
  ];

  public static isCrawler(userAgent: string): boolean {
    const ua = userAgent.toLowerCase();
    return this.CRAWLER_USER_AGENTS.some(bot => ua.includes(bot));
  }
}
