# Audio/Video Synchronization Issue Analysis

## Problem Summary
After ads are blocked, the video and audio become desynchronized. The audio continues playing but the video freezes or plays out of sync.

## Root Cause

The synchronization issue is caused by the **Resilience.execute()** function in [Code.js](file:///f:/Fynn/Projects/Tw%20Adb/Code.js#L279-L317), specifically the ad blocking recovery mechanism that manipulates the video element.

### Critical Issues Found

#### 1. **Video Source Manipulation Without Proper State Preservation** (Lines 289-307)

When an ad is detected, the code does the following:
```javascript
const src = video.src;
// ...
video.src = '';      // ⚠️ Clears the source
video.load();        // ⚠️ Forces reload

await Fn.sleep(CONFIG.timing.FORCE_PLAY_DEFER_MS);  // Only 1ms delay!
video.src = src + bust;  // ⚠️ Sets new source with cache-busting param
video.load();            // ⚠️ Forces another reload
video.play();
```

**Problem:** This sequence:
- Destroys the current playback state
- Does NOT preserve the current playback position (`currentTime`)
- Does NOT preserve playback rate
- Forces two consecutive reloads with only a 1ms delay between them
- The cache-busting parameter changes the URL, potentially causing the browser to treat it as a completely new video source

#### 2. **Immediate Pause After Playback Resume** (Lines 309-311)

```javascript
await Fn.sleep(CONFIG.timing.REVERSION_DELAY_MS);  // Only 2ms delay!
ctx[keys.k1]();      // Pause - ⚠️ Immediately pauses the video
ctx[keys.k0](true);  // Mute/Toggle
```

**Problem:** After forcing the video to play, the code waits only **2 milliseconds** and then:
- Immediately pauses the video again
- This creates a race condition where the video hasn't had time to properly buffer or sync

#### 3. **Timing Issues**


The configuration values are critically low:
```javascript
timing: {
    REVERSION_DELAY_MS: 2,        // ⚠️ Only 2ms - not enough time for video to stabilize
    FORCE_PLAY_DEFER_MS: 1,       // ⚠️ Only 1ms - not enough time between src changes
}
```

These delays are far too short for the browser to:
- Complete video loading
- Initialize audio/video decoders
- Synchronize audio and video tracks
- Buffer sufficient data

## Why This Causes Desynchronization

1. **State Loss**: When you clear `video.src` and reload, you lose the synchronized playback state
2. **No Position Restoration**: The video restarts from beginning or an arbitrary position, but audio may continue from where it was
3. **Insufficient Buffer Time**: 1-2ms delays don't give the browser time to properly sync the media tracks
4. **Race Conditions**: The pause command comes before the video has stabilized after the forced play

## The Fix

To resolve the synchronization issue, you need to:

### Critical Changes:

1. **Preserve playback position and state**
2. **Increase timing delays to allow proper buffering**
3. **Remove the immediate pause after play**
4. **Handle blob URLs differently (already partially done)**
5. **Consider using Media Source Extensions (MSE) approach instead of src manipulation**

### Recommended Solution:

```javascript
execute: async (container) => {
    const ctx = PlayerContext.get(container);
    if (!ctx) {
        Adapters.EventBus.emit(CONFIG.events.LOG, { status: 'REVERT_FAIL', detail: 'No player context' });
        return;
    }

    const keys = PlayerContext.getKeys();
    const video = container.querySelector(CONFIG.selectors.VIDEO);

    try {
        if (video) {
            const src = video.src;
            
            // ✅ PRESERVE STATE
            const currentTime = video.currentTime;
            const playbackRate = video.playbackRate;
            const wasPaused = video.paused;
            const volume = video.volume;
            const muted = video.muted;
            
            if (src.startsWith('blob:')) {
                if (CONFIG.debug) console.warn('[MAD-3000] Blob detected, skipping src reload.');
                video.play();
            } else {
                const separator = src.includes('?') ? '&' : '?';
                const bust = separator + 't=' + Math.random().toString(36).substring(2);
                
                video.src = '';
                video.load();

                // ✅ INCREASED DELAY - allow proper cleanup
                await Fn.sleep(100);  // Changed from 1ms to 100ms
                
                video.src = src + bust;
                video.load();
                
                // ✅ RESTORE STATE AFTER LOAD
                video.currentTime = currentTime;
                video.playbackRate = playbackRate;
                video.volume = volume;
                video.muted = muted;
                
                // ✅ WAIT FOR CANPLAY EVENT instead of arbitrary delay
                await new Promise((resolve) => {
                    const handler = () => {
                        video.removeEventListener('canplay', handler);
                        resolve();
                    };
                    video.addEventListener('canplay', handler);
                    // Timeout fallback
                    setTimeout(handler, 3000);
                });
                
                if (!wasPaused) {
                    video.play();
                }
            }
        }

        // ✅ REMOVED IMMEDIATE PAUSE - let video stabilize
        // The pause/mute should only happen if we're actually trying to skip an ad
        // Not after we've restored the main stream
        
        Adapters.EventBus.emit(CONFIG.events.REPORT, { status: 'SUCCESS' });
    } catch (e) {
        Resilience.fallback(container);
    }
}
```

### Alternative Approach: DOM Replacement

If the issue persists, consider using the `fallback()` method as the primary strategy instead:
- Clone the player container
- Replace the old container with the clone
- This creates a fresh player instance without state corruption

## Additional Considerations

1. **Health Monitor Timing**: The health check runs every 2000ms but considers video "stuck" after only 2 checks (4 seconds). This might be too aggressive.

2. **Video Listener**: The `loadstart` event triggers acquisition, which might fire too frequently during normal playback transitions.

3. **Consider Network-Based Blocking**: Instead of manipulating playback after ads are detected, block them at the network level before they ever reach the player.

## Testing Recommendations

After implementing fixes:

1. Test with live streams (where sync is most critical)
2. Test with VODs
3. Monitor browser console for timing issues
4. Check that `currentTime` is properly preserved across ad blocks
5. Verify that playback rate and volume settings persist
