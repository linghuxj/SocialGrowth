import type { ExperienceRule, PlatformType } from './types.js';

/**
 * 经验规则自然语言解析与冲突检查引擎
 */
export class ExperienceRuleEngine {
  private rules: ExperienceRule[] = [];

  public registerRule(rule: ExperienceRule): void {
    this.rules.push(rule);
  }

  public getRules(): ExperienceRule[] {
    return this.rules;
  }

  /**
   * 检查规则与既有官方规则或已确认内部规则的冲突
   */
  public checkConflicts(newRule: Partial<ExperienceRule>): { hasConflict: boolean; description?: string } {
    // 示例冲突规则：例如如果对 Instagram 或 YouTube 尝试在文案/评论中直接插入可点击链接
    if (newRule.platforms?.includes('instagram') && newRule.structuredAction?.includes('文案直接挂外链')) {
      return {
        hasConflict: true,
        description: 'Instagram Reels/Feed 帖文文案中链接不可直接点击，与平台官方规则冲突。应改为 Bio 引导。',
      };
    }

    if (newRule.platforms?.includes('youtube') && newRule.structuredAction?.includes('Shorts评论放短链')) {
      return {
        hasConflict: true,
        description: 'YouTube Shorts 评论中的链接不可点击，且高频评论可能触发垃圾内容政策限制。',
      };
    }

    return { hasConflict: false };
  }
}
