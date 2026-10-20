// YouTube embeds refuse to play (error 153) when the embedding page doesn't send an
// http(s) Referer: extension pages are chrome-extension:// so YouTube can't identify them.
// This declarativeNetRequest rule sets a Referer on the player iframe request, and only
// for iframes created by this extension's own pages (initiatorDomains = extension id).

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
            requestHeaders: [{ header: 'referer', operation: 'set', value: 'https://www.youtube.com/' }],
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
