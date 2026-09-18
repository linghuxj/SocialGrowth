import type { AccountProfile, SliceMetadata, MatchScoreResult } from './types.js';

/**
 * 漫剧切片标签与矩阵账号画像智能匹配算法引擎 (Tag-to-Profile)
 */
export class TagMatchingEngine {
  public calculateMatch(slice: SliceMetadata, account: AccountProfile): MatchScoreResult {
    let genreScore = 0;
    const matchedGenres = slice.genres.filter(g => account.verticals.includes(g));
    if (account.verticals.length > 0) {
      genreScore = (matchedGenres.length / account.verticals.length) * 50;
    }

    let audienceScore = 0;
    const matchedAudience = slice.audienceTags.filter(t => account.targetAudience.includes(t));
    if (account.targetAudience.length > 0) {
      audienceScore = (matchedAudience.length / account.targetAudience.length) * 30;
    }

    const languageScore = slice.language.toLowerCase() === account.language.toLowerCase() ? 20 : 0;
    const totalScore = Math.min(100, Math.round(genreScore + audienceScore + languageScore));

    return {
      sliceId: slice.sliceId,
      accountId: account.accountId,
      score: totalScore,
      factors: {
        genreMatch: Math.round(genreScore),
        audienceMatch: Math.round(audienceScore),
        languageMatch: languageScore,
      },
      recommended: totalScore >= 60,
    };
  }
}
