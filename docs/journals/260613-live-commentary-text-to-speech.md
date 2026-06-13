# Live Commentary Text-to-Speech: Web Speech API Integration

**Date**: 2026-06-13 01:17  
**Severity**: Low (feature ship, no production incidents)  
**Component**: Live match commentary UI  
**Status**: Resolved

## What Happened

Shipped text-to-speech reader for live match events. 🔊 button on live match cards vocalizes key commentary via Web Speech API (browser speechSynthesis). Commit 564a6bf, pushed main, auto-deployed to VPS. New module `live-commentary-text-to-speech.js`; wired into `app.js` with button render, click handler, feed polling hook, auto-release at FT. Cache-bust: `index.html` version bump to `260613-1`.

## The Brutal Truth

Honestly, this should have shipped broken if code review hadn't caught real bugs. We introduced a "safety" seen-Set cap that created invisible cascades on large feeds—something I added as defensive coding that solved zero actual problems. Worse: the cap bug silently passed initial smoke tests because the test harness scoped it away. That's the pattern that scares me: tests passing but the feature broken in prod. Real browser test on Android still pending, so we're running partially blind on platform variance.

The core decision—Web Speech API over backend TTS—was right (free, KISS, acceptable robot voice), but it exposed async speech lifecycle bugs that backend solutions would have hidden at the cost of complexity. We paid with debugging instead of paying with infrastructure.

## Technical Details

**New code**: `public/live-commentary-text-to-speech.js` (204 lines)
- Entry: `initLiveSpeech(matchId, matchPanel)` called on card render
- Feed hook: polls `/api/live/{id}` every 10s, feeds `enqueueCommentary(entries)` (scoring, penalties, red cards, half/FT marks only)
- Speech state: `activeMatch`, `speechQueue`, `seenCommentaryIds` (Set, no cap)
- Release: `releaseLiveSpeech()` drains queue gracefully; `stopLiveSpeech()` cancels mid-sentence
- Button: `<button class="live-speech-btn">🔊</button>` in `app.js` card render; `stopImmediatePropagation()` to prevent card listener interference

**Bug fixes before ship** (code-reviewer caught all 4):

1. **HIGH**: Clicking another live card left speech subscribed to starved match
   - Symptom: 🔊 stayed "active" (visual state), no sound (subscription stale)
   - Fix: `stopLiveSpeech()` on card switch; reinit with new match
   - Root: no cleanup; assumed one match at a time without enforcing it

2. **MED**: Seen-Set cap-500 with LRU eviction cascaded on 600-entry feeds
   - Symptom: backlog replayed entire (60+ stale announcements)
   - Fix: removed cap entirely (YAGNI; Set cleared per match anyway)
   - Root: added as "safety" without tracing actual mem footprint; eviction violated monotonicity

3. **MED**: FT auto-stop used `cancel()`, cutting mid-sentence goal/FT marks
   - Symptom: final announcements silent; premature queue drain
   - Fix: split `releaseLiveSpeech()` (drain queue naturally) vs `stopLiveSpeech()` (cancel)
   - Root: confused "stop" with "drain"; FT should let final events finish

4. **MED**: Transient `/api/live` fallback payload `matches:[]` killed speech permanently
   - Symptom: one poll error = silent for session
   - Fix: skip end-check on empty matches; keep queue alive
   - Root: defensive check too strict; false-positive end-of-match on network hiccup

## What We Tried

1. Backend TTS (Gemini/MiniMax): rejected (quota, complexity, latency)
2. Service Worker caching for Web Speech API: rejected (YAGNI; browser handles)
3. Pre-queue priming with entire backlog: rejected (too noisy, dupes); settled on mark-seen + skip backlog on enable
4. Speech queue with priority (goals before saves): rejected (KISS); queue in commentary order, good enough

## Root Cause Analysis

Two root causes exposed:

**1. Defensive coding trap**: Added seen-Set cap without a real blocker. No memory pressure existed. This is classic junior-engineer "but what if 10,000 matches happen"—solve for the problem in front of you. The cap then became a bug surface (eviction logic) solving a phantom.

**2. Async lifecycle underspecified**: Speech state (active match, queue, subscription) was never formally tied to panel state. We got lucky with card switching until card-click race hit. Needed explicit: "speech follows panel; switching panel stops old speech and inits new."

## Lessons Learned

1. **YAGNI holds**: "Safety" features that anticipate imaginary constraints become bugs. Cap wasn't needed; Set clears per match. Next time: ship with the minimal feature, add caps only when you see the actual footprint.

2. **Smoke tests can hide design bugs**: Test 8 (600-entry feed) passed because harness scoped it. A dedicated large-feed smoke test would have caught the cascade immediately. Need broader test coverage even when individual tests pass.

3. **Async cleanup is explicit or invisible**: No middle ground. Either formalize lifecycle (seen-Set gets cleared on match switch, period) or you get hard-to-trace state bugs. Implicit assumptions bite back.

4. **Code review is the real gate**: All 4 bugs were logic, not syntax. Static checks miss them. That's why code-reviewer + smoke tests together caught what either would miss alone.

## Next Steps

1. **Browser verification** (blocking for feature confidence): Chrome/Android real browser, actual live match, verify speak() fires from setInterval (non-gesture context). Current blocker: no live match running during test window.

2. **Test formalization**: Add dedicated large-feed (600+ entries) smoke test to catch future eviction/cascade bugs.

3. **Lifecycle documentation**: Add code comments formalizing speech state machine ("speech active iff panel.activeMatch == speech.activeMatch").

4. **Monitor production**: Track speak() errors (browser support variance), queue lengths, match-switch timing. Real-world Android/Safari gaps will show up fast.

---

**Status**: DONE

**Summary**: Web Speech API text-to-speech for live match events shipped with 4 real bugs caught and fixed pre-release via code review; YAGNI-driven defensive cap eviction bug and async lifecycle underspecification were key lessons.
