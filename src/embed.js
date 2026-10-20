// YouTube embeds refuse to play when the embedding page has no http(s) Referer (error 153,
// extension pages are chrome-extension://) or claims to be youtube.com (error 152).
// The player normally goes through the https relay page (PLAYER_RELAY). As a fallback, this
// declarativeNetRequest rule gives direct embeds the relay's origin as Referer, only for
// iframes created by this extension's own pages (initiatorDomains = extension id).
import { PLAYER_RELAY } from './config.js';

const RULE_ID = 153;

export async function ensureEmbedReferer() {
  try {
    if (!chrome?.declarativeNetRequest) return false;
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: [
        {
          id: RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'referer', operation: 'set', value: new URL(PLAYER_RELAY).origin + '/' }],
          },
          condition: {
            requestDomains: ['youtube-nocookie.com', 'youtube.com'],
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ['sub_frame'],
          },
        },
      ],
    });
    return true;
  } catch {
    return false; // preview outside the extension, or API unavailable
  }
}

/** Opens a video in a small standalone Chrome window (always works, unlike embeds). */
export function openPopout(videoId) {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  try {
    chrome.windows.create({ url, type: 'popup', width: 1024, height: 640, focused: true });
  } catch {
    window.open(url, '_blank', 'popup,width=1024,height=640');
  }
}
