# AI Prediction Rework: 5-Score On-Demand + OCR

**Date**: 2026-06-13 02:30
**Severity**: Medium
**Component**: AI match prediction, Gemini vision OCR, match modal UI
**Status**: Resolved

## What Happened

Completed rework of AI match prediction pipeline across 5 phases. Eliminated background worker (initAiPredictionWorker); shifted to on-demand prediction triggered when user opens an upcoming match ≤48h old. New architecture: ensureAiPrediction(match, context) with persistent cache, Gemini now returns 5 possible scorelines instead of single prediction, and new bongdaplus-exact-score-ocr.js module reads correct-score odds tables from image via vision OCR. Shipped in commits 02dbff1 → 1b79542 → 2c1f5b5, auto-deployed VPS + pushed origin.

## The Brutal Truth

On-demand shift is cleaner and quota-conscious, but **deployment surface-tested a stale-cache schema bug that should have been caught before deploy**. VPS ai-predictions.json held OLD worker-format entries (predictedScore but missing scores array). The AI modal table rendered empty slots because new code assumed a valid scores array, and stale cache entries failed validation silently. Required post-deploy cache invalidation + code patch.

OCR implementation also underestimated the artifact: the bongdaplus image is a CORRECT-SCORE ODDS table, not labeled "predictions" — first prompt was too narrow and returned empty text. Visually inspected the actual downloaded image to diagnose, then broadened the prompt. **Felt like a waste** because the image was there all along; just describing it correctly required reading the actual artifact, not the user request.

Negative-cache persistence bit us: OCR had already cached `text:""` for the match before the prompt fix was deployed. Redeploy alone didn't help; had to manually rm VPS cache files. This cascaded because the fix lived in the generator, not the cache.

## Technical Details

**Stale-cache schema issue:**
- Old worker format: `{predictedScore:"0-1"}` (just the top prediction)
- New format: `{analysis:"...", scores:[{score:"0-1",reason:"..."},{...}],predictedScore:"0-1"}` (5 options + analysis)
- getAiPrediction(match) returned stale entries as-is; new code tried `table.scores.map(...)` → undefined.map → error caught, table rendered empty
- Fix: getAiPrediction now validates `entry.scores && Array.isArray(entry.scores) && entry.scores.length > 0` → treats invalid entries as cache miss → auto-regenerates new format

**OCR prompt scope:**
- First version: "Extract the predicted score from the image"
- Reality: Image is a CORRECT-SCORE ODDS table with headers "NIÊM YẾT" (odds posted) / "BÀN THẮNG" (goals), structured as score+odds pairs
- First prod run returned text:"" though image downloaded successfully
- Fix: Broadened to "Identify correct-score odds table. Return 3–5 most likely scores (lowest odds)" + cache-aware retry

**Negative-cache trap:**
- OCR caches both hits and misses: `{text:"some data"}` or `{text:""}` + timestamp
- Deploy of prompt fix didn't invalidate existing miss entries
- Solution: Added cache expiry or manual file rm on VPS

**Latency regression:**
- ensureAiPrediction always called buildInsight(match) even when returning cached prediction
- buildInsight fetches ESPN stats (~8s), unused on cache hit
- Fix: Skip insight build when AI result already cached; cache-hit latency dropped 7.6s → 0.35s

## What We Tried

1. **Stale cache:** Initially assumed cache was empty on deploy (wrong). Added post-deploy validation instead of pre-deploy schema migration. Lesson learned after deploy.
2. **OCR prompt:** Tested with manual image before deploy; didn't match real bongdaplus structure. Expanded prompt on second iteration.
3. **Negative cache:** Attempted redeploy without cache clear; didn't work. Required manual file deletion.

## Root Cause Analysis

1. **Schema versioning weakness:** No migration or cache invalidation strategy when changing persistent data format. Assumed fresh cache on deploy (false). Should have added a schema version field + validation guard from day one, or added a deploy script to clear/migrate old entries.

2. **Artifact mismatch:** OCR prompt written to "read predictions from image" without inspecting the actual image first. The artifact is a CORRECT-SCORE ODDS display, not a prediction table. Lesson: multimodal prompts require describing the real structure, not the user's paraphrase.

3. **Negative-cache stickiness:** Negative caches (miss entries, empty results) persist across deploys. When the generator logic changes, the cache doesn't know to invalidate. No TTL or versioning on negative cache entries. Sequential requests can recover, but **initial request after deploy hits the stale miss**.

4. **Latency optimization missed:** AI endpoint optimized for correctness, not performance. Building insight on every request (even cache hits) is wasteful. Should have profiled cache-hit path earlier.

## Lessons Learned

1. **Persistent cache schema changes require a guard:** Add a schema version or validation check. On read, treat invalid entries as cache miss and regenerate. Don't assume the cache is empty or correct on deploy. Example:
   ```javascript
   const isValidAiPrediction = (entry) => 
     entry && entry.scores && Array.isArray(entry.scores) && entry.scores.length > 0;
   if (!isValidAiPrediction(cached)) { /* regenerate */ }
   ```

2. **Inspect the actual artifact before writing multimodal prompts:** "Read text from image" requires describing what the image actually contains (table structure, headers, layout), not what the user *called* it. Download/view the sample before finalizing the prompt.

3. **Negative caches need TTL or a clear strategy:** Either set an expiry time on miss entries, add a schema version tag, or provide a cache-clear script in deploy. Document when/how to clear on deploy.

4. **Profile the cache-hit path:** On-demand architectures make cache hits critical to latency. Measure cache-hit latency separately and optimize expensive operations (external API calls, insight building) to skip when cached.

5. **Test schema migration before deploy:** If changing a cache format, write a pre-deploy validator or migration script. Don't discover schema mismatches in production.

## Next Steps

1. **Add schema version to ai-predictions.json:** Version field on each entry; validation on read. Prevents future silent failures.
2. **Document cache-clear in deploy checklist:** If generator logic changes, clear negative-cache entries or set a TTL.
3. **Multimodal artifact checklist:** For future OCR/vision tasks, add a step: "inspect real artifact before writing prompt."
4. **Profile on-demand paths:** Measure cache hit, cache miss, in-flight scenarios; ensure latency targets met.

---

**Status:** DONE

Reworked AI predictions from background worker to on-demand 5-score generation with OCR; surfaced stale-cache schema bug and negative-cache persistence on deploy — both fixable but worth documenting for future schema-change work.
