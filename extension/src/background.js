/**
 * Background Service Worker
 *
 * - Fetches career-ops data from the local daemon (localhost:3737)
 * - Caches data in chrome.storage.local
 * - Responds to sidebar/content-script messages
 * - Opens side panel when extension icon is clicked
 */

const DAEMON_URL = 'http://localhost:3737';
const OLLAMA_URL = 'http://localhost:11444';
let cachedData = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return true;
  } catch (err) {
    console.warn('[Background] Failed to inject content script:', err);
    return false;
  }
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return { success: false, error: 'No active tab' };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (err) {
    console.warn('[Background] Initial message failed:', err);

    const injected = await injectContentScript(tab.id);
    if (!injected) {
      return {
        success: false,
        error: 'Could not connect to the active page. Make sure the extension is on a supported application page like *.greenhouse.io and refresh the tab.',
      };
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (retryErr) {
      console.warn('[Background] Retry message failed:', retryErr);
      return {
        success: false,
        error: 'Could not connect to the active page. Make sure the extension is on a supported application page like *.greenhouse.io and refresh the tab.',
      };
    }
  }
}

// ---- Open side panel on action click ----

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    // Fallback: some Chrome versions need windowId
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (e) {
      console.warn('[Background] Could not open side panel:', e);
    }
  }
});

// ---- Sync data from daemon ----

async function syncData() {
  try {
    const res = await fetch(`${DAEMON_URL}/api/sync`);
    if (!res.ok) throw new Error(`Daemon ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Sync failed');

    cachedData = json;
    await chrome.storage.local.set({ careerOpsData: json, lastSync: json.lastSync });
    console.log(`[Background] Synced: ${json.count.postings} postings, ${json.count.reports} reports`);
    return json;
  } catch (err) {
    // Try cache first, then surface a friendly status if the daemon is unavailable.
    const stored = await chrome.storage.local.get('careerOpsData');
    if (stored.careerOpsData) {
      cachedData = stored.careerOpsData;
      console.info('[Background] Daemon unavailable, loaded cached data.');
      return cachedData;
    }

    if (err.message === 'Failed to fetch' || err.message.includes('Daemon')) {
      console.info('[Background] Daemon not reachable. Start the local daemon with `npm run daemon` and refresh the sidebar.');
    } else {
      console.error('[Background] Sync failed:', err.message);
    }

    throw err;
  }
}

// ---- Lifecycle ----

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed');
  syncData().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  syncData().catch(() => {});
});

// ---- Message router ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // keep channel open for async
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'GET_POSTINGS': {
      const data = cachedData || await syncData();
      return {
        success: true,
        postings: data.data.postings,
        profile: data.data.profile,
        cv: data.data.cv,
        pdfs: data.data.pdfs,
        contextFiles: data.data.contextFiles,
        lastSync: data.lastSync,
      };
    }

    case 'SYNC_DATA': {
      const data = await syncData();
      return {
        success: true,
        postings: data.data.postings,
        profile: data.data.profile,
        cv: data.data.cv,
        pdfs: data.data.pdfs,
        contextFiles: data.data.contextFiles,
        count: data.count,
        lastSync: data.lastSync,
      };
    }

    case 'GET_REPORT': {
      const { reportFilename } = msg.payload;
      const res = await fetch(`${DAEMON_URL}/api/report-raw/${encodeURIComponent(reportFilename)}`);
      const json = await res.json();
      return json;
    }

    case 'UPDATE_STATUS': {
      const { postingNumber, status } = msg.payload;
      const res = await fetch(`${DAEMON_URL}/api/status/${postingNumber}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();

      // Refresh cache after status update
      if (json.success) {
        syncData().catch(() => {});
      }
      return json;
    }

    case 'GET_AVAILABLE_PDFS': {
      const res = await fetch(`${DAEMON_URL}/api/output-pdfs`);
      return await res.json();
    }

    case 'GET_PDF': {
      const { filename } = msg.payload;
      const res = await fetch(`${DAEMON_URL}/api/output-pdf/${encodeURIComponent(filename)}`);
      return await res.json();
    }

    case 'GET_WORKSPACE_CONTEXT': {
      const query = new URLSearchParams();
      if (msg.payload?.reportFilename) {
        query.set('reportFilename', msg.payload.reportFilename);
      }
      const res = await fetch(`${DAEMON_URL}/api/context?${query.toString()}`);
      return await res.json();
    }

    case 'GET_SERVER_SETTINGS': {
      const res = await fetch(`${DAEMON_URL}/api/settings`);
      return await res.json();
    }

    case 'SET_SERVER_SETTINGS': {
      const { rootPath } = msg.payload || {};
      const res = await fetch(`${DAEMON_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath }),
      });
      return await res.json();
    }

    case 'GET_OLLAMA_MODELS': {
      try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`);
        if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
        const json = await res.json();
        const models = (json.models || []).map(m => m.name);
        return { success: true, models };
      } catch (err) {
        return { success: false, models: [], error: `Could not reach Ollama at ${OLLAMA_URL}: ${err.message}` };
      }
    }

    case 'GENERATE_OLLAMA_ANSWER': {
      try {
        const { model, question, reportFilename, fieldLabel, fieldMeta } = msg.payload || {};
        if (!model || !question) {
          return { success: false, error: 'Missing model or question' };
        }

        // Use daemon endpoint which builds the prompt with context
        const res = await fetch(`${DAEMON_URL}/api/ollama/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            question,
            reportFilename,
            fieldLabel,
            fieldMeta,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `Daemon returned ${res.status}`);
        }

        const json = await res.json();
        if (!json.success) {
          throw new Error(json.error || 'Generation failed');
        }

        return {
          success: true,
          answer: json.answer,
          model: json.model,
          contextFiles: json.contextFiles,
        };
      } catch (err) {
        return { success: false, error: `Ollama generation failed: ${err.message}` };
      }
    }

    case 'DETECT_FORM': {
      return await sendToActiveTab({ type: 'DETECT_FORM' });
    }

    case 'AUTOFILL_FORM': {
      return await sendToActiveTab({
        type: 'AUTOFILL_FORM',
        payload: msg.payload,
      });
    }

    case 'ATTACH_FILE': {
      return await sendToActiveTab({
        type: 'ATTACH_FILE',
        payload: msg.payload,
      });
    }

    default:
      return { success: false, error: `Unknown message type: ${msg.type}` };
  }
}

// Periodic re-sync every 10 minutes
setInterval(() => { syncData().catch(() => {}); }, 10 * 60 * 1000);
