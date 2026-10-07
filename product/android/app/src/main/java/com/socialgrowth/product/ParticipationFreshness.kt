package com.socialgrowth.product

/** Monotonic local run boundary: an expired confirmation needs another visible decision. */
class ParticipationFreshness {
    private var deadline: Long? = null
    fun canContinue(now: Long): Boolean = deadline?.let { now < it } ?: true
    fun confirmed(roundStarted: Long) { deadline = roundStarted + 10_000L }
    fun nextRoundDelay(roundStarted: Long, now: Long): Long =
        (roundStarted + 4_000L - now).coerceIn(0L, 4_000L)
}
